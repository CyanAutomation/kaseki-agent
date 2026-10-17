/**
 * Route helper utilities for common patterns across API routes.
 */

import { Response } from 'express';
import { JobScheduler } from '../job-scheduler';
import { Job } from '../kaseki-api-types';
import { sendErrorResponse } from './response-helpers';

/** Public run identity prefers Soyuz when a local job has been mapped to it. */
export function publicRunId(job: Pick<Job, 'id' | 'soyuz'>): string {
  return job.soyuz?.externalRunId ?? job.id;
}

export function localRunId(job: Pick<Job, 'id' | 'soyuz'>): string | undefined {
  return job.soyuz ? job.id : undefined;
}

/** Prefer durable history when supported, with a fallback for lightweight schedulers. */
export async function findRunJob(scheduler: JobScheduler, jobId: string): Promise<Job | undefined> {
  const direct = typeof scheduler.getJobIncludingHistory === 'function'
    ? scheduler.getJobIncludingHistory(jobId)
    : scheduler.getJob(jobId);
  const job = await direct;
  if (job) return job;
  const normalizedId = jobId.toLowerCase();
  const jobs = typeof scheduler.listAllJobs === 'function' ? await scheduler.listAllJobs() : scheduler.listJobs();
  return jobs.find((candidate) => candidate.id.toLowerCase() === normalizedId
    || candidate.soyuz?.externalRunId.toLowerCase() === normalizedId);
}

/**
 * Extract and validate a job ID from a request, sending an error response if not found.
 * Consolidates the pattern used across artifact, log, and status routes.
 *
 * @param scheduler Job scheduler instance
 * @param jobId Job ID to look up
 * @param res Express response object (for error responses)
 * @returns Job object if found, null if error response already sent
 */
export async function getJobOrRespond(
  scheduler: JobScheduler,
  jobId: string,
  res: Response
): Promise<Job | null> {
  const job = scheduler.getJob(jobId) ??
    (typeof scheduler.getJobIncludingHistory === 'function' ? await scheduler.getJobIncludingHistory(jobId) : undefined) ??
    await findJobCaseInsensitive(scheduler, jobId);
  if (!job) {
    const normalizedHint = jobId.toLowerCase();
    const hint = normalizedHint !== jobId ? ` Did you mean: ${normalizedHint}?` : '';
    sendErrorResponse(res, 404, 'Not Found', `Run not found: ${jobId}.${hint}`);
    return null;
  }
  return job;
}

async function findJobCaseInsensitive(scheduler: JobScheduler, jobId: string): Promise<Job | undefined> {
  const lowerJobId = jobId.toLowerCase();
  if (lowerJobId === jobId) {
    return undefined;
  }
  const jobs = typeof scheduler.listAllJobs === 'function' ? await scheduler.listAllJobs() : scheduler.listJobs();
  return jobs.find((job) => job.id.toLowerCase() === lowerJobId
    || job.soyuz?.externalRunId.toLowerCase() === lowerJobId);
}
