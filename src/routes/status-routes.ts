import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { JobScheduler } from '../job-scheduler';
import { KasekiApiConfig } from '../kaseki-api-config';
import { StatusResponse, RunsListResponse } from '../kaseki-api-types';
import { sendErrorResponse } from '../utils/response-helpers';

const STATUS_KEY_FILES = ['metadata.json', 'result-summary.md', 'failure.json', 'stderr.log'] as const;

function isNonEmptyFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

function isTerminalJobStatus(status: 'queued' | 'running' | 'completed' | 'failed'): boolean {
  return status === 'completed' || status === 'failed';
}

/**
 * Create status-related routes (runs list, status, cancel).
 */
export function createStatusRoutes(scheduler: JobScheduler, config: KasekiApiConfig): Router {
  const router = Router();

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
        } else if (typeof scheduler.getLiveProgressEvents === 'function') {
          const liveEvents = scheduler.getLiveProgressEvents(job.id, 1);
          const lastEvent = liveEvents[liveEvents.length - 1];
          if (lastEvent) {
            response.progress = String(lastEvent.message || lastEvent.stage || 'running');
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
            acc[fileName] = isNonEmptyFile(filePath);
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
        if (keyFileAvailability['failure.json']) {
          response.diagnosticEntryPoint = 'failure.json';
        } else if (keyFileAvailability['result-summary.md']) {
          response.diagnosticEntryPoint = 'result-summary.md';
        }
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

  return router;
}
