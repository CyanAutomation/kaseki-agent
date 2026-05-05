import { Router, Request, Response } from 'express';
import { JobScheduler } from '../job-scheduler';
import { KasekiApiConfig } from '../kaseki-api-config';
import { RunsListResponse } from '../kaseki-api-types';
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
      })),
      total: allJobs.length,
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
