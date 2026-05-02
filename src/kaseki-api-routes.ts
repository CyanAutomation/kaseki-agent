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
  AnalysisResponse,
  RunsListResponse,
  ErrorResponse,
} from './kaseki-api-types';
import { KasekiApiConfig, validateApiKey } from './kaseki-api-config';

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
  let start = 0;
  while (start < buffer.length && isUtf8ContinuationByte(buffer[start])) {
    start++;
  }

  let end = buffer.length;
  if (end > start) {
    let leadIndex = end - 1;
    while (leadIndex > start && isUtf8ContinuationByte(buffer[leadIndex])) {
      leadIndex--;
    }

    if (isUtf8ContinuationByte(buffer[leadIndex])) {
      end = leadIndex;
    } else {
      const seqLen = utf8SequenceLength(buffer[leadIndex]);
      const availableBytes = end - leadIndex;
      if (availableBytes < seqLen) {
        end = leadIndex;
      }
    }
  }

  return buffer.subarray(start, end).toString('utf-8');
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
      return sendErrorResponse(res, 401, 'Unauthorized', 'Missing or invalid Authorization header');
    }

    const token = authHeader.slice(7);
    if (!validateApiKey(config, token)) {
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

      // Submit to scheduler
      const job = scheduler.submitJob(runRequest);

      const response: RunResponse = {
        id: job.id,
        status: job.status,
        createdAt: job.createdAt.toISOString(),
      };

      res.status(202).json(response); // 202 Accepted
    } catch (err: unknown) {
      if (err instanceof Error && 'errors' in err) {
        // Zod validation error
        const details = (err as any).errors.map((e: any) => `${(e.path as string[]).join('.')}: ${e.message}`).join('; ');
        return sendErrorResponse(res, 400, 'Bad Request', details);
      }
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
      error: job.error,
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

    res.json(response);
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
    const allowedFiles = ['git.diff', 'metadata.json', 'result-summary.md', 'pi-events.jsonl', 'pi-summary.json'];

    if (!allowedFiles.includes(fileName)) {
      return sendErrorResponse(
        res,
        400,
        'Bad Request',
        `Artifact not allowed: ${fileName}. Allowed: ${allowedFiles.join(', ')}`
      );
    }

    try {
      const filePath = path.join(config.resultsDir, job.id, fileName);

      if (!fs.existsSync(filePath)) {
        return sendErrorResponse(res, 404, 'Not Found', `Artifact not found: ${fileName}`);
      }

      // Determine content type
      let contentType = 'text/plain';
      if (fileName.endsWith('.json')) {
        contentType = 'application/json';
      } else if (fileName.endsWith('.md')) {
        contentType = 'text/markdown';
      } else if (fileName === 'git.diff') {
        contentType = 'text/plain';
      }

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
