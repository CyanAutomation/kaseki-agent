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
  const job = scheduler.getJob(jobId) ?? findJobCaseInsensitive(scheduler, jobId);
  if (!job) {
    const normalizedHint = jobId.toLowerCase();
    const hint = normalizedHint !== jobId ? ` Did you mean: ${normalizedHint}?` : '';
    sendErrorResponse(res, 404, 'Not Found', `Run not found: ${jobId}.${hint}`);
    return null;
  }
  return job;
}

function findJobCaseInsensitive(scheduler: JobScheduler, jobId: string): Job | undefined {
  const lowerJobId = jobId.toLowerCase();
  if (lowerJobId === jobId) {
    return undefined;
  }
  return scheduler.listJobs().find((job) => job.id.toLowerCase() === lowerJobId);
}
