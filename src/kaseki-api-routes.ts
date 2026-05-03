import { Router, Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { JobScheduler } from './job-scheduler';
import { ResultCache } from './result-cache';
import {
  RunRequestSchema,
  RunResponse,
  StatusResponse,
  LogResponse,
  ArtifactResponse,
  RunArtifactsResponse,
  AnalysisResponse,
  RunsListResponse,
  ErrorResponse,
} from './kaseki-api-types';
import { KasekiApiConfig, validateApiKey } from './kaseki-api-config';
import { createEventLogger } from './logger';

function isUtf8ContinuationByte(byte: number): boolean {
  return (byte & 0xc0) === 0x80;
}

function utf8SequenceLength(leadingByte: number): number {
  if ((leadingByte & 0x80) === 0) return 1;
  if ((leadingByte & 0xe0) === 0xc0) return 2;
  if ((leadingByte & 0xf0) === 0xe0) return 3;
  if ((leadingByte & 0xf8) === 0xf0) return 4;
  return 1;
}

export function decodeUtf8TailSafely(buffer: Buffer): string {
  let end = buffer.length;
  if (end > 0) {
    let continuationCount = 0;
    let candidateLead = end - 1;

    while (candidateLead >= 0 && isUtf8ContinuationByte(buffer[candidateLead])) {
      continuationCount++;
      candidateLead--;
    }

    if (candidateLead < 0) {
      end = 0;
    } else {
      const sequenceLength = utf8SequenceLength(buffer[candidateLead]);
      const expectedContinuationCount = sequenceLength - 1;

      if (sequenceLength > 1 && continuationCount !== expectedContinuationCount) {
        end = candidateLead;
      }
    }
  }

  return buffer.subarray(0, end).toString('utf-8');
}

export function tailLogByLines(content: string, maxLines: number): string {
  if (maxLines <= 0) {
    return '';
  }

  const lines = content.split(/\r?\n/);
  if (lines.length <= maxLines) {
    return content;
  }
  return lines.slice(-maxLines).join('\n');
}

export function readTailBytes(logFile: string, size: number, maxSize: number): Buffer {
  const truncated = Buffer.alloc(maxSize);
  const fd = fs.openSync(logFile, 'r');
  try {
    fs.readSync(fd, truncated, 0, maxSize, size - maxSize);
  } finally {
    fs.closeSync(fd);
  }

  return truncated;
}

function isTerminalJobStatus(status: 'queued' | 'running' | 'completed' | 'failed'): boolean {
  return status === 'completed' || status === 'failed';
}

const ALWAYS_SAFE_SUMMARY_ARTIFACTS = [
  'git.diff',
  'metadata.json',
  'result-summary.md',
  'pi-events.jsonl',
  'pi-summary.json',
  'progress.log',
] as const;

const FAILURE_ONLY_DIAGNOSTICS_ARTIFACTS = [
  'failure.json',
  'stderr.log',
  'stdout.log',
  'validation.log',
  'quality.log',
] as const;

const STATUS_KEY_FILES = ['metadata.json', 'result-summary.md', 'failure.json', 'stderr.log'] as const;

function artifactContentType(fileName: string): string {
  if (fileName.endsWith('.json')) return 'application/json';
  if (fileName.endsWith('.md')) return 'text/markdown';
  return 'text/plain';
}

export function readArtifactContent(
  filePath: string,
  jobStatus: 'queued' | 'running' | 'completed' | 'failed',
  cache: ResultCache
): string | null {
  if (!isTerminalJobStatus(jobStatus)) {
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  }
  return cache.getOrLoad(filePath);
}

/**
 * Create the API routes.
 */
export function createApiRouter(scheduler: JobScheduler, config: KasekiApiConfig): Router {
  const router = Router();
  const cache = new ResultCache();
  const logger = createEventLogger('api');

  /**
   * Middleware: Request/Response logging.
   */
  router.use((req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    const originalSend = res.send;

    res.send = function (data: any) {
      const duration = Date.now() - startTime;
      const statusCode = res.statusCode;

      // Log request/response event
      logger.event('api_request_complete', {
        method: req.method,
        path: req.path,
        statusCode,
        durationMs: duration,
        query: Object.keys(req.query).length > 0 ? req.query : undefined,
      });

      return originalSend.call(this, data);
    };

    next();
  });

  /**
   * Middleware: API key validation.
   */
  router.use((req: Request, res: Response, next: NextFunction) => {
    // Skip auth for health check
    if (req.path === '/health') {
      return next();
    }

    const authHeader = req.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.event('api_auth_failed', {
        path: req.path,
        reason: 'missing_or_invalid_header',
      });
      return sendErrorResponse(res, 401, 'Unauthorized', 'Missing or invalid Authorization header');
    }

    const token = authHeader.slice(7);
    if (!validateApiKey(config, token)) {
      logger.event('api_auth_failed', {
        path: req.path,
        reason: 'invalid_api_key',
      });
      return sendErrorResponse(res, 401, 'Unauthorized', 'Invalid API key');
    }

    next();
  });

  /**
   * Health check endpoint.
   */
  router.get('/health', (_req: Request, res: Response) => {
    const queueStatus = scheduler.getQueueStatus();
    const errors: string[] = [];

    // Check if results directory is accessible
    if (!fs.existsSync(config.resultsDir)) {
      errors.push(`Results directory not accessible: ${config.resultsDir}`);
    }

    const status = errors.length === 0 ? 'healthy' : 'degraded';

    res.json({
      status,
      timestamp: new Date().toISOString(),
      queue: queueStatus,
      errors: errors.length > 0 ? errors : undefined,
    });
  });

  /**
   * POST /api/runs - Trigger a new kaseki run.
   */
  router.post('/runs', (req: Request, res: Response) => {
    try {
      // Validate request body
      const runRequest = RunRequestSchema.parse(req.body);

      // Log request
      logger.event('api_run_request', {
        repoUrl: runRequest.repoUrl,
        ref: runRequest.ref,
        taskMode: runRequest.taskMode,
      });

      // Submit to scheduler
      const job = scheduler.submitJob(runRequest);

      const response: RunResponse = {
        id: job.id,
        status: job.status,
        createdAt: job.createdAt.toISOString(),
        correlationId: job.correlationId,
        requestId: job.requestId,
      };

      res.status(202).json(response); // 202 Accepted
    } catch (err: unknown) {
      if (err instanceof Error && 'errors' in err) {
        // Zod validation error
        const details = (err as any).errors.map((e: any) => `${(e.path as string[]).join('.')}: ${e.message}`).join('; ');
        logger.event('api_validation_error', {
          path: '/runs',
          details,
        });
        return sendErrorResponse(res, 400, 'Bad Request', details);
      }
      logger.event('api_error', {
        path: '/runs',
        error: (err as Error).message,
      });
      return sendErrorResponse(res, 400, 'Bad Request', (err as Error).message);
    }
  });

  /**
   * POST /api/webhooks/test - Test webhook configuration.
   */
  router.post('/webhooks/test', async (req: Request, res: Response) => {
    try {
      const { url, secret } = req.body;

      if (!url || typeof url !== 'string') {
        return sendErrorResponse(res, 400, 'Bad Request', 'Webhook URL is required');
      }

      // Validate URL format
      try {
        new URL(url);
      } catch {
        return sendErrorResponse(res, 400, 'Bad Request', 'Invalid webhook URL format');
      }

      // Send test webhook
      let statusCode: number | undefined;
      let error: string | undefined;
      let durationMs = 0;
      const startTime = Date.now();

      try {
        const testPayload = {
          eventType: 'webhook.test',
          jobId: 'test',
          timestamp: new Date().toISOString(),
          data: { message: 'This is a test webhook from kaseki-agent API' },
        };

        // Generate HMAC signature if secret provided
        let signature: string | null = null;
        if (secret && typeof secret === 'string') {
          const crypto = require('crypto');
          const body = JSON.stringify(testPayload);
          signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
        }

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Kaseki-Event': 'webhook.test',
            'X-Kaseki-Job-Id': 'test',
            ...(signature && { 'X-Kaseki-Signature': `sha256=${signature}` }),
          },
          body: JSON.stringify(testPayload),
          signal: AbortSignal.timeout(10000),
        });

        durationMs = Date.now() - startTime;
        statusCode = response.status;

        if (!response.ok) {
          error = `HTTP ${response.status} ${response.statusText}`;
        }
      } catch (err) {
        durationMs = Date.now() - startTime;
        error = err instanceof Error ? err.message : String(err);
      }

      const result = {
        url,
        statusCode,
        durationMs,
        success: !error,
        error,
      };

      logger.event('webhook_test', result);

      res.json(result);
    } catch (err) {
      logger.event('api_error', {
        path: '/webhooks/test',
        error: (err as Error).message,
      });
      return sendErrorResponse(res, 400, 'Bad Request', (err as Error).message);
    }
  });

  /**
   * GET /api/runs - List all runs.
   */
  router.get('/runs', (_req: Request, res: Response) => {
    const allJobs = scheduler.listJobs();

    const response: RunsListResponse = {
      runs: allJobs.map((job) => ({
        id: job.id,
        status: job.status,
        createdAt: job.createdAt.toISOString(),
        completedAt: job.completedAt?.toISOString(),
        resultDir: job.resultDir,
      })),
      total: allJobs.length,
    };

    res.json(response);
  });

  /**
   * GET /api/runs/:id/status - Get run status.
   */
  router.get('/runs/:id/status', (req: Request, res: Response) => {
    const job = scheduler.getJob(req.params.id);
    if (!job) {
      return sendErrorResponse(res, 404, 'Not Found', `Run not found: ${req.params.id}`);
    }

    const response: StatusResponse = {
      id: job.id,
      status: job.status,
      exitCode: job.exitCode,
      failureClass: job.failureClass,
      correlationId: job.correlationId,
      requestId: job.requestId,
      error: job.error,
      resultDir: job.resultDir,
    };

    // Add timing information if available
    if (job.startedAt) {
      const elapsed = (job.completedAt || new Date()).getTime() - job.startedAt.getTime();
      response.elapsedSeconds = Math.round(elapsed / 1000);

      // Calculate timeout risk
      const timeoutMs = config.agentTimeoutSeconds * 1000;
      response.timeoutRiskPercent = Math.round((elapsed / timeoutMs) * 100);
    }

    // Add progress from progress.jsonl if available
    if (job.status === 'running') {
      try {
        const progressFile = path.join(config.resultsDir, job.id, 'progress.jsonl');
        if (fs.existsSync(progressFile)) {
          const lines = fs.readFileSync(progressFile, 'utf-8').trim().split('\n');
          if (lines.length > 0) {
            const lastEvent = JSON.parse(lines[lines.length - 1]);
            response.progress = lastEvent.detail || lastEvent.stage;
          }
        }
      } catch {
        // Ignore progress file errors
      }
    }

    if (isTerminalJobStatus(job.status)) {
      const runDir = job.resultDir || path.join(config.resultsDir, job.id);
      const keyFileAvailability = STATUS_KEY_FILES.reduce(
        (acc, fileName) => {
          try {
            const filePath = path.join(runDir, fileName);
            acc[fileName] = fs.existsSync(filePath);
          } catch {
            acc[fileName] = false;
          }
          return acc;
        },
        {} as Record<(typeof STATUS_KEY_FILES)[number], boolean>
      );

      response.artifacts = {
        metadataJson: keyFileAvailability['metadata.json'],
        resultSummaryMd: keyFileAvailability['result-summary.md'],
        failureJson: keyFileAvailability['failure.json'],
        stderrLog: keyFileAvailability['stderr.log'],
        availableFiles: STATUS_KEY_FILES.filter((fileName) => keyFileAvailability[fileName]),
      };

      if (job.status === 'failed') {
        // Keep failed-job diagnostic entry-point selection in this terminal-status scope
        // where keyFileAvailability is defined to avoid duplicate/out-of-scope assignments.
        response.diagnosticEntryPoint = keyFileAvailability['failure.json']
          ? 'failure.json'
          : 'result-summary.md';
      }
    }

    res.json(response);
  });

  /**
   * POST /api/runs/:id/cancel - Cancel a queued or running run.
   */
  router.post('/runs/:id/cancel', (req: Request, res: Response) => {
    const job = scheduler.cancelJob(req.params.id);
    if (!job) {
      return sendErrorResponse(res, 404, 'Not Found', `Run not found: ${req.params.id}`);
    }

    const response: StatusResponse = {
      id: job.id,
      status: job.status,
      exitCode: job.exitCode,
      failureClass: job.failureClass,
      correlationId: job.correlationId,
      requestId: job.requestId,
      error: job.error,
      resultDir: job.resultDir,
    };

    res.json(response);
  });

  /**
   * GET /api/runs/:id/progress - Retrieve progress events (supports Server-Sent Events streaming).
   */
  router.get('/runs/:id/progress', (req: Request, res: Response) => {
    const job = scheduler.getJob(req.params.id);
    if (!job) {
      return sendErrorResponse(res, 404, 'Not Found', `Run not found: ${req.params.id}`);
    }

    // Check if client wants SSE streaming
    const wantsSSE = req.query.stream === 'sse' || req.get('Accept')?.includes('text/event-stream');

    if (wantsSSE) {
      // Server-Sent Events streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      let lastEventCount = 0;
      let noChangeCount = 0;
      const maxNoChangeAttempts = 10; // Stop after 10 checks with no change

      const sendProgressUpdate = () => {
        const progressFile = path.join(config.resultsDir, job.id, 'progress.jsonl');
        if (!fs.existsSync(progressFile)) {
          return;
        }

        try {
          const content = fs.readFileSync(progressFile, 'utf-8');
          const lines = content.trim().length > 0 ? content.trim().split('\n') : [];

          if (lines.length > lastEventCount) {
            // Send new events
            const newLines = lines.slice(lastEventCount);
            for (const line of newLines) {
              try {
                const event = JSON.parse(line);
                res.write(`data: ${JSON.stringify(event)}\n\n`);
              } catch {
                // Skip invalid JSON lines
              }
            }
            lastEventCount = lines.length;
            noChangeCount = 0;
          } else if (job.status !== 'running') {
            // Job is not running anymore, send final status
            const currentJob = scheduler.getJob(job.id);
            if (currentJob) {
              res.write(
                `data: ${JSON.stringify({
                  type: 'status',
                  status: currentJob.status,
                  elapsed: Math.round((new Date().getTime() - (currentJob.startedAt?.getTime() || 0)) / 1000),
                })}\n\n`
              );
            }
            res.end();
            return;
          } else {
            noChangeCount++;
            if (noChangeCount >= maxNoChangeAttempts) {
              // No new events for a while, close connection
              res.end();
              return;
            }
          }
        } catch {
          // Ignore file read errors
        }
      };

      // Send initial status
      res.write(`data: ${JSON.stringify({ type: 'start', jobId: job.id, status: job.status })}\n\n`);

      // Send progress updates every 2 seconds
      const interval = setInterval(() => {
        if (res.destroyed) {
          clearInterval(interval);
          return;
        }
        sendProgressUpdate();
      }, 2000);

      // Clean up on client disconnect
      req.on('close', () => {
        clearInterval(interval);
      });

      return;
    }

    // Regular JSONL response
    const progressFile = path.join(config.resultsDir, job.id, 'progress.jsonl');
    if (!fs.existsSync(progressFile)) {
      return sendErrorResponse(res, 404, 'Not Found', 'Progress file not found');
    }

    try {
      const content = fs.readFileSync(progressFile, 'utf-8');
      const lines = content.trim().length > 0 ? content.trim().split('\n') : [];
      const tailParam = Number(req.query.tail ?? lines.length);
      const tail = Number.isFinite(tailParam) ? Math.max(0, Math.floor(tailParam)) : lines.length;
      const selectedLines = tail > 0 ? lines.slice(-tail) : [];
      const events = selectedLines
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter((event): event is Record<string, unknown> => event !== null);

      res.json({
        id: job.id,
        status: job.status,
        events,
        total: lines.length,
      });
    } catch (err) {
      sendErrorResponse(res, 500, 'Internal Server Error', `Failed to read progress: ${(err as Error).message}`);
    }
  });

  /**
   * GET /api/runs/:id/logs/:logtype - Retrieve logs.
   */
  router.get('/runs/:id/logs/:logtype', (req: Request, res: Response) => {
    const job = scheduler.getJob(req.params.id);
    if (!job) {
      return sendErrorResponse(res, 404, 'Not Found', `Run not found: ${req.params.id}`);
    }

    const logType = req.params.logtype;
    const validLogTypes = ['stdout', 'stderr', 'validation', 'progress', 'quality', 'secret-scan'];

    if (!validLogTypes.includes(logType)) {
      return sendErrorResponse(
        res,
        400,
        'Bad Request',
        `Unknown log type: ${logType}. Valid types: ${validLogTypes.join(', ')}`
      );
    }

    try {
      const logFile = path.join(config.resultsDir, job.id, logType === 'stdout' ? 'stdout.log' : `${logType}.log`);

      if (!fs.existsSync(logFile)) {
        return sendErrorResponse(res, 404, 'Not Found', `Log file not found: ${logType}`);
      }

      const stat = fs.statSync(logFile);
      const size = stat.size;

      // For large files, just return metadata and a truncated tail
      const maxSize = 1024 * 100; // 100 KB
      let content = '';

      if (size > maxSize) {
        const truncated = readTailBytes(logFile, size, maxSize);

        let tailContent = decodeUtf8TailSafely(truncated);
        if (req.query.tail === 'lines') {
          const lineCount = Number(req.query.lines ?? 200);
          const maxLines = Number.isFinite(lineCount) ? Math.max(1, Math.floor(lineCount)) : 200;
          tailContent = tailLogByLines(tailContent, maxLines);
        }

        content = `[... truncated, showing last ${maxSize} bytes ...]\n${tailContent}`;
      } else {
        content = fs.readFileSync(logFile, 'utf-8');
      }

      const response: LogResponse = {
        logType: logType as any,
        content,
        size,
      };

      res.json(response);
    } catch (err) {
      sendErrorResponse(res, 500, 'Internal Server Error', `Failed to read log: ${(err as Error).message}`);
    }
  });

  /**
   * GET /api/results/:id/:file - Download artifact.
   */
  router.get('/results/:id/:file', (req: Request, res: Response) => {
    const job = scheduler.getJob(req.params.id);
    if (!job) {
      return sendErrorResponse(res, 404, 'Not Found', `Run not found: ${req.params.id}`);
    }

    const fileName = req.params.file;
    const allowedFiles = [...ALWAYS_SAFE_SUMMARY_ARTIFACTS, ...FAILURE_ONLY_DIAGNOSTICS_ARTIFACTS];

    if (!allowedFiles.some((allowedFile) => allowedFile === fileName)) {
      return sendErrorResponse(
        res,
        400,
        'Bad Request',
        `Artifact not allowed: ${fileName}. Allowed: ${allowedFiles.join(', ')}`
      );
    }

    if (FAILURE_ONLY_DIAGNOSTICS_ARTIFACTS.some((artifact) => artifact === fileName) && job.status !== 'failed') {
      return sendErrorResponse(
        res,
        400,
        'Bad Request',
        `Artifact only available for failed runs: ${fileName}`
      );
    }

    try {
      const filePath = path.join(config.resultsDir, job.id, fileName);

      if (!fs.existsSync(filePath)) {
        return sendErrorResponse(res, 404, 'Not Found', `Artifact not found: ${fileName}`);
      }

      const contentType = artifactContentType(fileName);

      // Read from disk for non-terminal jobs; cache only terminal artifacts.
      const content = readArtifactContent(filePath, job.status, cache);
      if (content === null) {
        return sendErrorResponse(res, 500, 'Internal Server Error', `Failed to read artifact: ${fileName}`);
      }

      const stat = fs.statSync(filePath);

      const response: ArtifactResponse = {
        file: fileName,
        contentType,
        size: stat.size,
        content,
      };

      res.setHeader('Content-Type', contentType);
      res.json(response);
    } catch (err) {
      sendErrorResponse(
        res,
        500,
        'Internal Server Error',
        `Failed to read artifact: ${(err as Error).message}`
      );
    }
  });

  /**
   * GET /api/runs/:id/artifacts - Enumerate allowlisted artifacts and availability.
   */
  router.get('/runs/:id/artifacts', (req: Request, res: Response) => {
    const job = scheduler.getJob(req.params.id);
    if (!job) {
      return sendErrorResponse(res, 404, 'Not Found', `Run not found: ${req.params.id}`);
    }

    const runDir = job.resultDir || path.join(config.resultsDir, job.id);
    const allowedFiles = [...ALWAYS_SAFE_SUMMARY_ARTIFACTS, ...FAILURE_ONLY_DIAGNOSTICS_ARTIFACTS];

    const artifacts = allowedFiles.map((fileName) => {
      const filePath = path.join(runDir, fileName);
      const exists = fs.existsSync(filePath);
      const stat = exists ? fs.statSync(filePath) : undefined;
      const isFailureOnly = FAILURE_ONLY_DIAGNOSTICS_ARTIFACTS.some((artifact) => artifact === fileName);
      const available = exists && (!isFailureOnly || job.status === 'failed');

      return {
        name: fileName,
        size: stat?.size ?? 0,
        contentType: artifactContentType(fileName),
        available,
      };
    });

    const response: RunArtifactsResponse = {
      id: job.id,
      runStatus: job.status,
      exitCode: job.exitCode,
      artifacts,
      recommended:
        job.status === 'failed'
          ? ['failure.json', 'stderr.log', 'stdout.log', 'validation.log', 'quality.log']
          : ['result-summary.md', 'metadata.json', 'pi-summary.json', 'git.diff'],
    };

    res.json(response);
  });

  /**
   * GET /api/runs/:id/analysis - Comprehensive run analysis.
   */
  router.get('/runs/:id/analysis', (req: Request, res: Response) => {
    const job = scheduler.getJob(req.params.id);
    if (!job) {
      return sendErrorResponse(res, 404, 'Not Found', `Run not found: ${req.params.id}`);
    }

    try {
      const response: AnalysisResponse = {
        id: job.id,
        status: job.status,
        createdAt: job.createdAt.toISOString(),
        completedAt: job.completedAt?.toISOString(),
        exitCode: job.exitCode,
        failureClass: job.failureClass,
      };

      // Add timing
      if (job.startedAt) {
        const elapsed = (job.completedAt || new Date()).getTime() - job.startedAt.getTime();
        response.elapsedSeconds = Math.round(elapsed / 1000);
      }

      // Try to read metadata
      const metadataPath = path.join(config.resultsDir, job.id, 'metadata.json');
      if (fs.existsSync(metadataPath)) {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        response.metadata = {
          model: metadata.model,
          instance: metadata.instance,
          repo: metadata.repo,
          ref: metadata.ref,
        };
      }

      // Try to read changed files
      const changedFilesPath = path.join(config.resultsDir, job.id, 'changed-files.txt');
      if (fs.existsSync(changedFilesPath)) {
        const changedFiles = fs
          .readFileSync(changedFilesPath, 'utf-8')
          .trim()
          .split('\n')
          .filter((f) => f);

        const diffPath = path.join(config.resultsDir, job.id, 'git.diff');
        const diffSize = fs.existsSync(diffPath) ? fs.statSync(diffPath).size : 0;

        response.changes = {
          changedFiles,
          diffSize,
        };
      }

      // Try to read validation results
      const validationPath = path.join(config.resultsDir, job.id, 'validation-timings.tsv');
      if (fs.existsSync(validationPath)) {
        const lines = fs.readFileSync(validationPath, 'utf-8').trim().split('\n');
        const commandResults = lines
          .slice(1) // Skip header
          .map((line) => {
            const [command, exitCode, elapsed] = line.split('\t');
            return {
              command,
              exitCode: parseInt(exitCode, 10),
              elapsed: parseInt(elapsed, 10),
            };
          });

        response.validation = {
          passed: commandResults.every((r) => r.exitCode === 0),
          commandResults,
        };
      }

      res.json(response);
    } catch (err) {
      sendErrorResponse(res, 500, 'Internal Server Error', `Failed to analyze run: ${(err as Error).message}`);
    }
  });

  return router;
}

/**
 * Send a standardized error response.
 */
function sendErrorResponse(res: Response, status: number, title: string, detail: string): void {
  const response: ErrorResponse = {
    type: 'https://api.kaseki.local/errors#' + title.toLowerCase().replace(/\s+/g, '-'),
    title,
    status,
    detail,
  };

  res.status(status).json(response);
}
