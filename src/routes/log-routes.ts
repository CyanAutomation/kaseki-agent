import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { JobScheduler } from '../job-scheduler';
import { KasekiApiConfig } from '../kaseki-api-config';
import { DiagnosticEntryPoint, LogResponse, AnalysisResponse } from '../kaseki-api-types';
import { sendErrorResponse } from '../utils/response-helpers';
import { isNonEmptyFile } from '../utils/file-helpers';
import { decodeUtf8TailSafely, tailLogByLines, readTailBytes } from '../utils/utf8-helpers';
import { getJobOrRespond } from '../utils/route-helpers';
import { normalizeProgressEvent } from '../utils/progress-normalizer';
import { progressEventsFromDockerLogTail } from '../utils/docker-log-progress-events';

const VALID_LOG_TYPES = [
  'stdout',
  'stderr',
  'validation',
  'progress',
  'quality',
  'secret-scan',
  'combined',
  'goal-setting-stderr',
  'scouting-stderr',
  'goal-check-stderr',
  'run-evaluation-stderr',
] as const;
const COMBINED_LOG_TYPES = ['stdout', 'stderr', 'validation', 'progress', 'quality', 'secret-scan'] as const;
const DIAGNOSTIC_FILE_CANDIDATES: DiagnosticEntryPoint[] = [
  'goal-setting-validation-errors.jsonl',
  'goal-setting-stderr.log',
  'scouting-validation-errors.jsonl',
  'scouting-stderr.log',
  'goal-check-validation-errors.jsonl',
  'goal-check-stderr.log',
  'failure.json',
  'analysis.md',
  'result-summary.md',
  'stderr.log',
  'stdout.log',
];
const DIAGNOSTIC_INLINE_LIMIT_BYTES = 65536;

function logFileForType(runDir: string, logType: string): string {
  if (logType.endsWith('-stderr')) {
    return path.join(runDir, `${logType}.log`);
  }
  return path.join(runDir, logType === 'stdout' ? 'stdout.log' : `${logType}.log`);
}

function readLogContent(logFile: string, req: Request): { content: string; size: number } {
  const stat = fs.statSync(logFile);
  const size = stat.size;
  const maxSize = 1024 * 100; // 100 KB

  if (size <= maxSize) {
    return { content: fs.readFileSync(logFile, 'utf-8'), size };
  }

  const truncated = readTailBytes(logFile, size, maxSize);
  let tailContent = decodeUtf8TailSafely(truncated);
  if (req.query.tail === 'lines') {
    const lineCount = Number(req.query.lines ?? 200);
    const maxLines = Number.isFinite(lineCount) ? Math.max(1, Math.floor(lineCount)) : 200;
    tailContent = tailLogByLines(tailContent, maxLines);
  }

  return {
    content: `[... truncated, showing last ${maxSize} bytes ...]\n${tailContent}`,
    size,
  };
}

function readCombinedLogs(runDir: string, req: Request): LogResponse | undefined {
  const parts: string[] = [];
  const sources: NonNullable<LogResponse['sources']> = [];

  for (const logType of COMBINED_LOG_TYPES) {
    const logFile = logFileForType(runDir, logType);
    if (!fs.existsSync(logFile)) {
      continue;
    }
    const { content, size } = readLogContent(logFile, req);
    sources.push({ logType, file: path.basename(logFile), size });
    parts.push(`===== ${logType} (${path.basename(logFile)}) =====\n${content}`);
  }

  if (parts.length === 0) {
    return undefined;
  }

  const content = parts.join('\n\n');
  return {
    logType: 'combined',
    content,
    size: Buffer.byteLength(content, 'utf-8'),
    sources,
  };
}

function readJsonlRecords(filePath: string): Array<Record<string, unknown>> | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  const stat = fs.statSync(filePath);
  if (stat.size <= 0 || stat.size > DIAGNOSTIC_INLINE_LIMIT_BYTES) {
    return undefined;
  }
  try {
    const records = fs
      .readFileSync(filePath, 'utf-8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as unknown);
    return records.every((record) => record && typeof record === 'object' && !Array.isArray(record))
      ? records as Array<Record<string, unknown>>
      : undefined;
  } catch {
    return undefined;
  }
}

function collectDiagnostics(runDir: string): AnalysisResponse['diagnostics'] | undefined {
  const files = DIAGNOSTIC_FILE_CANDIDATES.filter((fileName) => {
    const filePath = path.join(runDir, fileName);
    return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
  });
  if (files.length === 0) {
    return undefined;
  }
  const entryPoint = files[0];
  const details = files
    .filter((fileName) => fileName.endsWith('-validation-errors.jsonl'))
    .flatMap((fileName) => readJsonlRecords(path.join(runDir, fileName)) ?? []);
  return {
    entryPoint,
    files,
    ...(details.length > 0 ? { details } : {}),
  };
}

function readStructuredEventSnapshot(
  scheduler: JobScheduler,
  config: KasekiApiConfig,
  job: { id: string; status: string },
  tail: number
): { id: string; status: string; events: Array<Record<string, unknown>>; total: number; sources: string[] } {
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
    const dockerEvents = progressEventsFromDockerLogTail(scheduler.getLiveDockerLogTail(job.id, 300) ?? undefined);
    for (const event of dockerEvents) {
      events.push(normalizeProgressEvent(event));
    }
    if (dockerEvents.length > 0) {
      sources.add('docker-logs');
    }
  }

  const selectedEvents = tail > 0 ? events.slice(-tail) : [];
  return {
    id: job.id,
    status: job.status,
    events: selectedEvents,
    total: events.length,
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

  let lastEventCount = 0;
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
          for (const line of newLines) {
            try {
              const event = normalizeProgressEvent(JSON.parse(line));
              res.write(`data: ${JSON.stringify(event)}\n\n`);
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

  const interval = setInterval(() => {
    if (res.destroyed) {
      clearInterval(interval);
      return;
    }
    sendProgressUpdate();
  }, 2000);
  interval.unref?.();

  req.on('close', () => {
    clearInterval(interval);
  });
}

/**
 * Create log-related routes (progress, events, logs, analysis).
 */
export function createLogRoutes(scheduler: JobScheduler, config: KasekiApiConfig): Router {
  const router = Router();

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
      const runDir = job.resultDir || path.join(config.resultsDir, job.id);
      const response: AnalysisResponse = {
        id: job.id,
        status: job.status,
        createdAt: job.createdAt.toISOString(),
        completedAt: job.completedAt?.toISOString(),
        exitCode: job.exitCode,
        failureClass: job.failureClass
      };

      // Add timing
      if (job.startedAt) {
        const elapsed = (job.completedAt || new Date()).getTime() - job.startedAt.getTime();
        response.elapsedSeconds = Math.round(elapsed / 1000);
      }

      // Try to read metadata
      const metadataPath = path.join(runDir, 'metadata.json');
      if (fs.existsSync(metadataPath)) {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        response.metadata = {
          model: metadata.model,
          instance: metadata.instance,
          repo: metadata.repo,
          ref: metadata.ref
        };
      }

      // Try to read changed files
      const changedFilesPath = path.join(runDir, 'changed-files.txt');
      if (fs.existsSync(changedFilesPath)) {
        const changedFiles = fs
          .readFileSync(changedFilesPath, 'utf-8')
          .trim()
          .split('\n')
          .filter((f) => f);

        const diffPath = path.join(runDir, 'git.diff');
        const diffSize = fs.existsSync(diffPath) ? fs.statSync(diffPath).size : 0;

        response.changes = {
          changedFiles,
          diffSize
        };
      }

      // Try to read validation results
      const validationPath = path.join(runDir, 'validation-timings.tsv');
      if (fs.existsSync(validationPath)) {
        const lines = fs.readFileSync(validationPath, 'utf-8').trim().split('\n');
        const commandResults = lines
          .slice(1) // Skip header
          .map((line) => {
            const [command, exitCode, elapsed] = line.split('\t');
            return {
              command,
              exitCode: parseInt(exitCode, 10),
              elapsed: parseInt(elapsed, 10)
            };
          });

        response.validation = {
          passed: commandResults.every((r) => r.exitCode === 0),
          commandResults
        };
      }

      const diagnostics = collectDiagnostics(runDir);
      if (diagnostics) {
        response.diagnostics = diagnostics;
      }

      res.json(response);
    } catch (err) {
      sendErrorResponse(res, 500, 'Internal Server Error', `Failed to analyze run: ${(err as Error).message}`);
    }
  });

  return router;
}
