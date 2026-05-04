import { Request, Response, NextFunction } from 'express';
import { JobScheduler } from '../job-scheduler';
import { Job } from '../kaseki-api-types';
import { sendErrorResponse } from '../utils/response-helpers';

/**
 * Extend Express Request to include the job from middleware.
 */
declare global {
  namespace Express {
    interface Request {
      job?: Job;
    }
  }
}

/**
 * Middleware that looks up a job by ID and attaches it to the request.
 * If the job is not found, responds with a 404 error.
 *
 * Usage:
 * ```typescript
 * router.get('/runs/:id/status', jobLookupMiddleware(scheduler), (req, res) => {
 *   const job = req.job!; // guaranteed to exist
 *   // ...
 * });
 * ```
 */
export function jobLookupMiddleware(scheduler: JobScheduler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const jobId = req.params.id;
    if (!jobId) {
      return sendErrorResponse(res, 400, 'Bad Request', 'Job ID is required');
    }

    const job = scheduler.getJob(jobId);
    if (!job) {
      return sendErrorResponse(res, 404, 'Not Found', `Run not found: ${jobId}`);
    }

    req.job = job;
    next();
  };
}
