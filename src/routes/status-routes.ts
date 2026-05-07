import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { JobScheduler } from '../job-scheduler';
import { DEFAULT_JOB_INDEX_MAX_ENTRIES, KasekiApiConfig } from '../kaseki-api-config';
import { Job, RunsListResponse } from '../kaseki-api-types';
import { resolveInstanceExitCode } from '../instance-state-derivation';
import { sendErrorResponse } from '../utils/response-helpers';
import { getJobOrRespond } from '../utils/route-helpers';
import { StatusResponseBuilder } from '../utils/status-response-builder';

/**
 * Create status-related routes (runs list, status, cancel).
 */
export function createStatusRoutes(scheduler: JobScheduler, config: KasekiApiConfig): Router {
  const router = Router();
  const statusBuilder = new StatusResponseBuilder(scheduler, config);

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
        exitCode: resolveJobExitCode(job, config),
        failureClass: job.failureClass,
        error: job.error,
      })),
      total: allJobs.length,
      retention: {
        terminalJobIndexMaxEntries: config.jobIndexMaxEntries ?? DEFAULT_JOB_INDEX_MAX_ENTRIES,
        note: 'Older terminal runs may be omitted from this API index after compaction; their artifacts remain on disk under the results directory.',
      },
    };

    res.json(response);
  });

  /**
   * GET /api/runs/:id/status - Get run status.
   */
  router.get('/runs/:id/status', (req: Request, res: Response) => {
    const job = getJobOrRespond(scheduler, req.params.id, res);
    if (!job) {
      return;
    }

    const response = statusBuilder.buildStatus(job);
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

    const response = statusBuilder.buildStatus(job);
    res.json(response);
  });

  return router;
}

function resolveJobExitCode(job: Job, config: KasekiApiConfig): number | undefined {
  if (job.exitCode !== undefined && job.exitCode !== null) {
    return job.exitCode;
  }
  if (!(job.status === 'completed' || job.status === 'failed')) {
    return undefined;
  }
  const runDir = job.resultDir || path.join(config.resultsDir, job.id);
  try {
    const metadataPath = path.join(runDir, 'metadata.json');
    const metadata = fs.existsSync(metadataPath)
      ? JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
      : {};
    return resolveInstanceExitCode(runDir, metadata) ?? undefined;
  } catch {
    return undefined;
  }
}
