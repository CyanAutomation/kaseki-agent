import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { JobScheduler } from '../job-scheduler';
import { KasekiApiConfig } from '../kaseki-api-config';
import { LogResponse, AnalysisResponse } from '../kaseki-api-types';
import { sendErrorResponse } from '../utils/response-helpers';

function isNonEmptyFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

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

function decodeUtf8TailSafely(buffer: Buffer): string {
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

function tailLogByLines(content: string, maxLines: number): string {
  if (maxLines <= 0) {
    return '';
  }

  const lines = content.split(/\r?\n/);
  if (lines.length <= maxLines) {
    return content;
  }
  return lines.slice(-maxLines).join('\n');
}

function readTailBytes(logFile: string, size: number, maxSize: number): Buffer {
  const truncated = Buffer.alloc(maxSize);
  const fd = fs.openSync(logFile, 'r');
  try {
    fs.readSync(fd, truncated, 0, maxSize, size - maxSize);
  } finally {
    fs.closeSync(fd);
  }

  return truncated;
}

function normalizeProgressEvent(event: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...event };
  if (typeof normalized.stage === 'string') {
    if (typeof normalized.message !== 'string' && typeof normalized.detail === 'string') {
      normalized.message = normalized.detail;
    }
    if (typeof normalized.message !== 'string') {
      normalized.message = normalized.stage;
    }
  }
  if (typeof normalized.updatedAt !== 'string' && typeof normalized.timestamp === 'string') {
    normalized.updatedAt = normalized.timestamp;
  }
  return normalized;
}

/**
 * Create log-related routes (progress, events, logs, analysis).
 */
export function createLogRoutes(scheduler: JobScheduler, config: KasekiApiConfig): Router {
  const router = Router();

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
                const event = normalizeProgressEvent(JSON.parse(line));
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
      const tailParam = Number(req.query.tail ?? 25);
      const tail = Number.isFinite(tailParam) ? Math.max(0, Math.floor(tailParam)) : 25;
      const events =
        typeof scheduler.getLiveProgressEvents === 'function'
          ? scheduler.getLiveProgressEvents(job.id, tail).map((event) => normalizeProgressEvent(event))
          : [];
      if (events.length > 0) {
        return res.json({
          id: job.id,
          status: job.status,
          events,
          total: events.length,
          source: 'docker-logs',
        });
      }
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
            return normalizeProgressEvent(JSON.parse(line));
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
   * GET /api/runs/:id/events - Controller-friendly event stream snapshot.
   *
   * This endpoint always prefers promoted progress.jsonl events, then appends
   * live Docker progress while a worker is still running.
   */
  router.get('/runs/:id/events', (req: Request, res: Response) => {
    const job = scheduler.getJob(req.params.id);
    if (!job) {
      return sendErrorResponse(res, 404, 'Not Found', `Run not found: ${req.params.id}`);
    }

    const tailParam = Number(req.query.tail ?? 50);
    const tail = Number.isFinite(tailParam) ? Math.max(0, Math.floor(tailParam)) : 50;
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

    const selectedEvents = tail > 0 ? events.slice(-tail) : [];
    res.json({
      id: job.id,
      status: job.status,
      events: selectedEvents,
      total: events.length,
      sources: Array.from(sources),
    });
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
              size: Buffer.byteLength(liveContent, 'utf-8'),
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
            'canonical stderr.log was not generated for this failed run.',
          ].join('\n');

          const fallbackResponse: LogResponse = {
            logType: 'stderr',
            content: syntheticStderr,
            size: Buffer.byteLength(syntheticStderr, 'utf-8'),
          };

          return res.status(200).json(fallbackResponse);
        }
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
