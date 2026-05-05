/**
 * Route helper utilities for common patterns across API routes.
 */

import { Response } from 'express';
import { JobScheduler } from '../job-scheduler';
import { Job } from '../kaseki-api-types';
import { sendErrorResponse } from './response-helpers';

/**
 * Extract and validate a job ID from a request, sending an error response if not found.
 * Consolidates the pattern used across artifact, log, and status routes.
 *
 * @param scheduler Job scheduler instance
 * @param jobId Job ID to look up
 * @param res Express response object (for error responses)
 * @returns Job object if found, null if error response already sent
 */
export function getJobOrRespond(
  scheduler: JobScheduler,
  jobId: string,
  res: Response
): Job | null {
  const job = scheduler.getJob(jobId);
  if (!job) {
    sendErrorResponse(res, 404, 'Not Found', `Run not found: ${jobId}`);
    return null;
  }
  return job;
}
