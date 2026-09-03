import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { JobScheduler } from '../job-scheduler';
import { KasekiApiConfig } from '../kaseki-api-config';
import { LogResponse, AnalysisResponse, type Job } from '../kaseki-api-types';
import { sendErrorResponse } from '../utils/response-helpers';
import { isNonEmptyFile } from '../utils/file-helpers';
import { readLogContent, readCombinedLogs, collectDiagnostics, isPathInsideDirectory, logFileForType, VALID_LOG_TYPES } from './log-file-reader';
import { getJobOrRespond } from '../utils/route-helpers';
import { normalizeProgressEvent } from '../utils/progress-normalizer';
import { progressEventsFromDockerLogTail } from '../utils/docker-log-progress-events';
import { CachedArtifactReader } from '../utils/cached-artifact-reader';
import { AnalysisArtifactHelper } from '../utils/analysis-artifact-helper';
import type { ResultCache } from '../result-cache';

function readStructuredEventSnapshot(
  scheduler: JobScheduler,
  config: KasekiApiConfig,
  job: { id: string; status: string; startedAt?: Date },
  tail: number
): { id: string; status: string; events: Array<Record<string, unknown>>; total: number; nextCursor: string; sources: string[] } {
  const progressFile = path.join(config.resultsDir, job.id, 'progress.jsonl');
  const events: Array<Record<string, unknown>> = [];
  const sources = new Set<string>();

  if (fs.existsSync(progressFile) && isNonEmptyFile(progressFile)) {
    try {
      const lines = fs.readFileSync(progressFile, 'utf-8').trim().split('\n');
      for (const line of lines) {
        try {
          events.push(normalizeProgressEvent(JSON.parse(line)));
        } catch {
          // Skip partial or malformed progress records.
        }
      }
      sources.add('progress.jsonl');
    } catch {
      // Live Docker fallback below keeps the endpoint useful while a run is active.
    }
  }

  if (job.status === 'running' && typeof scheduler.getLiveProgressEvents === 'function') {
    const liveEvents = scheduler.getLiveProgressEvents(job.id, tail);
    for (const event of liveEvents) {
      events.push(normalizeProgressEvent(event));
    }
    if (liveEvents.length > 0) {
      sources.add('docker-logs');
    }
  }

  if (
    job.status === 'running' &&
    events.length === 0 &&
    typeof scheduler.getLiveDockerLogTail === 'function'
  ) {
    const dockerEvents = progressEventsFromDockerLogTail(
      scheduler.getLiveDockerLogTail(job.id, 300) ?? undefined,
      // Timestamp-less Docker headings are a current tail observation. Using
      // job.startedAt made newly observed stages appear stale immediately.
      new Date().toISOString()
    );
    for (const event of dockerEvents) {
      events.push(normalizeProgressEvent(event));
    }
    if (dockerEvents.length > 0) {
      sources.add('docker-logs');
    }
  }

  const selectedEvents = tail > 0 ? events.slice(-tail) : [];
  const selectedEventsWithIds = selectedEvents.map((event, index) => ({
    ...event,
    id: String(Math.max(0, events.length - selectedEvents.length + index)),
  }));
  return {
    id: job.id,
    status: job.status,
    events: selectedEventsWithIds,
    total: events.length,
    nextCursor: String(events.length),
    sources: Array.from(sources)
  };
}

function streamProgressEvents(
  scheduler: JobScheduler,
  config: KasekiApiConfig,
  job: { id: string; status: string; startedAt?: Date },
  req: Request,
  res: Response
): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const lastEventId = req.get('Last-Event-ID');
  const requestedCursor = Number(lastEventId ?? req.query.cursor ?? 0);
  let lastEventCount = Number.isFinite(requestedCursor)
    ? Math.max(0, Math.floor(requestedCursor) + (lastEventId ? 1 : 0))
    : 0;
  let noChangeCount = 0;
  const maxNoChangeAttempts = 10;

  const sendProgressUpdate = () => {
    const currentJob = scheduler.getJob(job.id);

    if (currentJob && (currentJob.status === 'completed' || currentJob.status === 'failed')) {
      res.write(
        `data: ${JSON.stringify({
          type: 'status',
          status: currentJob.status,
          elapsed: Math.round((new Date().getTime() - (currentJob.startedAt?.getTime() || 0)) / 1000)
        })}\n\n`
      );
      res.end();
      return;
    }

    const progressFile = path.join(config.resultsDir, job.id, 'progress.jsonl');

    let hasNewEvents = false;
    if (fs.existsSync(progressFile)) {
      try {
        const content = fs.readFileSync(progressFile, 'utf-8');
        const lines = content.trim().length > 0 ? content.trim().split('\n') : [];

        if (lines.length > lastEventCount) {
          const newLines = lines.slice(lastEventCount);
          for (const [index, line] of newLines.entries()) {
            try {
              const event = normalizeProgressEvent(JSON.parse(line));
              const eventId = lastEventCount + index;
              res.write(`id: ${eventId}\nevent: progress\ndata: ${JSON.stringify({ ...event, id: String(eventId) })}\n\n`);
            } catch {
              // Skip invalid JSON lines.
            }
          }
          lastEventCount = lines.length;
          noChangeCount = 0;
          hasNewEvents = true;
        }
      } catch {
        // Ignore file read errors.
      }
    }

    if (!hasNewEvents) {
      noChangeCount++;
    }
    if (noChangeCount >= maxNoChangeAttempts) {
      res.end();
    }
  };

  res.write(`data: ${JSON.stringify({ type: 'start', jobId: job.id, status: job.status })}\n\n`);

  const heartbeat = setInterval(() => {
    if (!res.destroyed) {
      res.write(`event: heartbeat\ndata: ${JSON.stringify({ type: 'heartbeat', jobId: job.id, cursor: String(lastEventCount), timestamp: new Date().toISOString() })}\n\n`);
    }
  }, 15000);
  heartbeat.unref?.();

  const interval = setInterval(() => {
    if (res.destroyed) {
      clearInterval(interval);
      clearInterval(heartbeat);
      return;
    }
    sendProgressUpdate();
  }, 2000);
  interval.unref?.();

  req.on('close', () => {
    clearInterval(interval);
    clearInterval(heartbeat);
  });
}

function buildAnalysisResponse(
  job: Job,
  config: KasekiApiConfig,
  analysisHelper: AnalysisArtifactHelper
): AnalysisResponse {
  const runDir = job.resultDir || path.join(config.resultsDir, job.id);
  const response: AnalysisResponse = {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString(),
    exitCode: job.exitCode,
    failureClass: job.failureClass
  };
  const analysisWarnings: string[] = [];

  addElapsedSeconds(response, job);
  addAnalysisMetadata(response, runDir, analysisWarnings, analysisHelper);
  addAnalysisChanges(response, runDir, analysisWarnings, analysisHelper);
  addAnalysisValidation(response, runDir, analysisWarnings, analysisHelper);

  const diagnostics = collectDiagnostics(runDir);
  if (diagnostics) {
    response.diagnostics = diagnostics;
  }
  if (analysisWarnings.length > 0) {
    response.analysisWarnings = analysisWarnings;
  }

  return response;
}

function addElapsedSeconds(response: AnalysisResponse, job: Job): void {
  if (!job.startedAt) return;
  const elapsed = (job.completedAt || new Date()).getTime() - job.startedAt.getTime();
  response.elapsedSeconds = Math.round(elapsed / 1000);
}

function addAnalysisMetadata(
  response: AnalysisResponse,
  runDir: string,
  analysisWarnings: string[],
  analysisHelper: AnalysisArtifactHelper
): void {
  const metadata = analysisHelper.safelyReadArtifact('metadata.json', analysisWarnings, () =>
    analysisHelper.readMetadata(runDir)
  );
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    response.metadata = {
      model: typeof metadata.model === 'string' ? metadata.model : undefined,
      instance: typeof metadata.instance === 'string' ? metadata.instance : undefined,
      repo: typeof metadata.repo === 'string' ? metadata.repo : undefined,
      ref: typeof metadata.ref === 'string' ? metadata.ref : undefined
    };
  } else if (metadata !== undefined) {
    analysisWarnings.push('Could not read metadata.json; expected a JSON object.');
  }
}

function addAnalysisChanges(
  response: AnalysisResponse,
  runDir: string,
  analysisWarnings: string[],
  analysisHelper: AnalysisArtifactHelper
): void {
  const changes = analysisHelper.safelyReadArtifact('changed-files.txt', analysisWarnings, () => {
    const changedFiles = analysisHelper.readChangedFiles(runDir);
    if (!changedFiles) return undefined;
    const diffPath = path.join(runDir, 'git.diff');
    return {
      changedFiles,
      diffSize: fs.existsSync(diffPath) ? fs.statSync(diffPath).size : 0
    };
  });
  if (changes) response.changes = changes;
}

function addAnalysisValidation(
  response: AnalysisResponse,
  runDir: string,
  analysisWarnings: string[],
  analysisHelper: AnalysisArtifactHelper
): void {
  // failure.json is produced from the terminal worker state. It can report a
  // failed validation phase after an earlier metadata/timing snapshot recorded
  // successful commands, so it must win for the summary outcome.
  const failure = analysisHelper.safelyReadArtifact('failure.json', analysisWarnings, () =>
    analysisHelper.readFailure(runDir)
  );
  const failureValidationExit = typeof failure?.validation_exit_code === 'number'
    ? failure.validation_exit_code
    : typeof failure?.validation_exit_code === 'string'
      ? Number(failure.validation_exit_code)
      : undefined;
  const validationTimingsContent = analysisHelper.readValidationTimings(runDir);
  if (!validationTimingsContent) {
    if (Number.isFinite(failureValidationExit) && failureValidationExit !== 0) {
      response.validation = { passed: false, commandResults: [] };
      return;
    }
    const validationLogPath = path.join(runDir, 'validation.log');
    if (fs.existsSync(validationLogPath)) {
      const validation = analysisHelper.safelyReadArtifact('validation.log', analysisWarnings, () =>
        readValidationLogSummary(fs.readFileSync(validationLogPath, 'utf-8'))
      );
      if (validation) response.validation = validation;
    }
    return;
  }

  const validation = analysisHelper.safelyReadArtifact('validation-timings.tsv', analysisWarnings, () =>
    readValidationTimingSummary(validationTimingsContent, analysisWarnings)
  );
  if (!validation) return;

  response.validation = {
    ...validation,
    passed: Number.isFinite(failureValidationExit) && failureValidationExit !== 0 ? false : validation.passed,
  };
}

function readValidationLogSummary(
  content: string,
): NonNullable<AnalysisResponse['validation']> | undefined {
  const command = content.match(/^\[validation pipeline\] command=(.+)$/m)?.[1]?.trim();
  const status = content.match(/^\[validation pipeline\] statuses: command=(\d+)\b/m)?.[1];
  if (!command || status === undefined) return undefined;
  const exitCode = Number.parseInt(status, 10);
  if (!Number.isFinite(exitCode)) return undefined;
  return {
    passed: exitCode === 0,
    commandResults: [{ command, exitCode, elapsed: 0 }],
  };
}

function readValidationTimingSummary(
  validationTimingsContent: string,
  analysisWarnings: string[],
): NonNullable<AnalysisResponse['validation']> {
  const lines = validationTimingsContent.trim().split('\n');
  const commandResults = lines
    .slice(1)
    .flatMap((line) => validationTimingRecord(line, analysisWarnings));

  return {
    passed: commandResults.every((result) => result.exitCode === 0),
    commandResults
  };
}

function validationTimingRecord(
  line: string,
  analysisWarnings: string[],
): NonNullable<AnalysisResponse['validation']>['commandResults'] {
  const [command, exitCode, elapsed] = line.split('\t');
  const parsedExitCode = Number.parseInt(exitCode, 10);
  const parsedElapsed = Number.parseInt(elapsed, 10);
  if (!command || !Number.isFinite(parsedExitCode) || !Number.isFinite(parsedElapsed)) {
    analysisWarnings.push('Skipped malformed validation-timings.tsv record.');
    return [];
  }
  return [{ command, exitCode: parsedExitCode, elapsed: parsedElapsed }];
}

/**
 * Create log-related routes (progress, events, logs, analysis).
 */
export function createLogRoutes(
  scheduler: JobScheduler,
  config: KasekiApiConfig,
  artifactCache?: Pick<ResultCache, 'getOrLoad'>
): Router {
  const router = Router();
  const cachedReader = artifactCache ? new CachedArtifactReader(artifactCache as ResultCache) : undefined;
  const analysisHelper = new AnalysisArtifactHelper(cachedReader);

  /**
   * GET /api/runs/:id/events - Canonical structured event snapshot.
   *
   * This endpoint always prefers promoted progress.jsonl events, then appends
   * live Docker progress while a worker is still running.
   */
  router.get('/runs/:id/events', (req: Request, res: Response) => {
    const job = getJobOrRespond(scheduler, req.params.id, res);
    if (!job) {
      return;
    }

    const tailParam = Number(req.query.tail ?? 50);
    const tail = Number.isFinite(tailParam) ? Math.max(0, Math.floor(tailParam)) : 50;
    res.json(readStructuredEventSnapshot(scheduler, config, job, tail));
  });

  /**
   * GET /api/runs/:id/events/stream - Server-Sent Events stream for progress updates.
   */
  router.get('/runs/:id/events/stream', (req: Request, res: Response) => {
    const job = getJobOrRespond(scheduler, req.params.id, res);
    if (!job) {
      return;
    }

    streamProgressEvents(scheduler, config, job, req, res);
  });

  /**
   * GET /api/runs/:id/progress - Legacy structured event snapshot endpoint.
   *
   * Non-streaming responses intentionally match GET /api/runs/:id/events.
   * Use GET /api/runs/:id/events/stream for SSE; ?stream=sse remains as a
   * legacy alias for older clients.
   */
  router.get('/runs/:id/progress', (req: Request, res: Response) => {
    const job = getJobOrRespond(scheduler, req.params.id, res);
    if (!job) {
      return;
    }

    const wantsSSE = req.query.stream === 'sse' || req.get('Accept')?.includes('text/event-stream');

    if (wantsSSE) {
      res.setHeader('Deprecation', 'true');
      res.setHeader('Link', '</api/runs/' + job.id + '/events/stream>; rel="successor-version"');
      streamProgressEvents(scheduler, config, job, req, res);
      return;
    }

    res.setHeader('Deprecation', 'true');
    res.setHeader('Link', '</api/runs/' + job.id + '/events>; rel="successor-version"');
    const tailParam = Number(req.query.tail ?? 50);
    const tail = Number.isFinite(tailParam) ? Math.max(0, Math.floor(tailParam)) : 50;
    res.json(readStructuredEventSnapshot(scheduler, config, job, tail));
  });

  /**
   * GET /api/runs/:id/logs/:logtype - Retrieve logs.
   */
  router.get('/runs/:id/logs/:logtype', (req: Request, res: Response) => {
    const job = getJobOrRespond(scheduler, req.params.id, res);
    if (!job) {
      return;
    }

    const logType = req.params.logtype;
    if (!(VALID_LOG_TYPES as readonly string[]).includes(logType)) {
      return sendErrorResponse(
        res,
        400,
        'Bad Request',
        `Unknown log type: ${logType}. Valid types: ${VALID_LOG_TYPES.join(', ')}`
      );
    }

    try {
      const runDir = path.join(config.resultsDir, job.id);
      if (logType === 'combined') {
        const combined = readCombinedLogs(runDir, req);
        if (combined) {
          return res.json(combined);
        }
        if (job.status === 'running' && typeof scheduler.getLiveDockerLogTail === 'function') {
          const liveContent = scheduler.getLiveDockerLogTail(job.id, 300);
          if (liveContent) {
            const response: LogResponse = {
              logType: 'combined',
              content: liveContent,
              size: Buffer.byteLength(liveContent, 'utf-8'),
              sources: [{ logType: 'docker-live', size: Buffer.byteLength(liveContent, 'utf-8') }],
            };
            return res.json(response);
          }
        }
        return sendErrorResponse(res, 404, 'Not Found', 'No log files found for combined log');
      }

      const logFile = logFileForType(runDir, logType);

      if (!isPathInsideDirectory(logFile, runDir)) {
        return sendErrorResponse(res, 400, 'Bad Request', 'Invalid log file path');
      }

      if (!fs.existsSync(logFile)) {
        if (
          job.status === 'running' &&
          (logType === 'stdout' || logType === 'stderr' || logType === 'progress') &&
          typeof scheduler.getLiveDockerLogTail === 'function'
        ) {
          const liveContent = scheduler.getLiveDockerLogTail(job.id, 300);
          if (liveContent) {
            const response: LogResponse = {
              logType: logType as any,
              content: liveContent,
              size: Buffer.byteLength(liveContent, 'utf-8')
            };
            return res.json(response);
          }
        }
        if (logType === 'stderr' && job.status === 'failed') {
          const syntheticStderr = [
            '[kaseki] Synthetic stderr fallback',
            `job id: ${job.id}`,
            `exit code: ${job.exitCode ?? 'unknown'}`,
            `failure class: ${job.failureClass ?? 'unknown'}`,
            `job.error: ${job.error ?? 'unknown'}`,
            'canonical stderr.log was not generated for this failed run.'
          ].join('\n');

          const fallbackResponse: LogResponse = {
            logType: 'stderr',
            content: syntheticStderr,
            size: Buffer.byteLength(syntheticStderr, 'utf-8')
          };

          return res.status(200).json(fallbackResponse);
        }
        return sendErrorResponse(res, 404, 'Not Found', `Log file not found: ${logType}`);
      }

      const { content, size } = readLogContent(logFile, req);

      const response: LogResponse = {
        logType: logType as any,
        content,
        size
      };

      res.json(response);
    } catch (err) {
      sendErrorResponse(res, 500, 'Internal Server Error', `Failed to read log: ${(err as Error).message}`);
    }
  });

  /**
   * GET /api/runs/:id/analysis - Comprehensive run analysis.
   */
  router.get('/runs/:id/analysis', (req: Request, res: Response) => {
    const job = getJobOrRespond(scheduler, req.params.id, res);
    if (!job) {
      return;
    }

    try {
      res.json(buildAnalysisResponse(job, config, analysisHelper));
    } catch (err) {
      sendErrorResponse(res, 500, 'Internal Server Error', `Failed to analyze run: ${(err as Error).message}`);
    }
  });

  return router;
}
