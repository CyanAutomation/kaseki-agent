import { Router, Request, Response } from 'express';
import * as path from 'path';
import { JobScheduler } from '../job-scheduler';
import { DEFAULT_JOB_INDEX_MAX_ENTRIES, KasekiApiConfig } from '../kaseki-api-config';
import { RunsListResponse } from '../kaseki-api-types';
import { sendErrorResponse } from '../utils/response-helpers';
import { getJobOrRespond } from '../utils/route-helpers';
import { StatusResponseBuilder } from '../utils/status-response-builder';
import { StatusMetadataHelper } from '../utils/status-response-metadata-helper';
import type { ResultCache } from '../result-cache';
import { encodeCursor, isAfterCursor, parseCursor, parseLimit, type RunCursor } from './cursor-pagination';

/**
 * Create status-related routes (runs list, status, cancel).
 */
export function createStatusRoutes(
  scheduler: JobScheduler,
  config: KasekiApiConfig,
  artifactCache?: Pick<ResultCache, 'getOrLoad'>
): Router {
  const router = Router();
  const statusBuilder = new StatusResponseBuilder(scheduler, config, artifactCache);
  // Shared exit-code resolver (direct-fs path) used as a fallback when the
  // status builder has no resolved exit code (non-terminal jobs or empty cache).
  const metadataHelper = new StatusMetadataHelper();

  /**
   * GET /api/v1/runs - List all runs.
   */
  router.get('/runs', async (req: Request, res: Response) => {
    let limit: number;
    let cursor: RunCursor | undefined;
    try {
      limit = parseLimit(req.query.limit);
      cursor = parseCursor(req.query.cursor);
    } catch (error) {
      return sendErrorResponse(res, 400, 'Bad Request', error instanceof Error ? error.message : 'Invalid pagination query');
    }

    const statusFilter = typeof req.query.status === 'string' ? req.query.status : undefined;
    if (statusFilter && !['queued', 'running', 'completed', 'failed'].includes(statusFilter)) {
      return sendErrorResponse(res, 400, 'Bad Request', 'status must be queued, running, completed, or failed');
    }
    const repoFilter = typeof req.query.repo === 'string' ? req.query.repo : undefined;
    const from = parseDateFilter(req.query.from, 'from', res);
    if (from === null) return;
    const to = parseDateFilter(req.query.to, 'to', res);
    if (to === null) return;
    if (from && to && from > to) return sendErrorResponse(res, 400, 'Bad Request', 'from must be earlier than or equal to to');

    const allJobs = typeof scheduler.listAllJobs === 'function'
      ? await scheduler.listAllJobs()
      : scheduler.listJobs();
    const filteredJobs = allJobs.filter((job) =>
      (!statusFilter || job.status === statusFilter) &&
      (!repoFilter || job.request?.repoUrl === repoFilter) &&
      (from === undefined || job.createdAt.getTime() >= from) &&
      (to === undefined || job.createdAt.getTime() <= to),
    );
    const pageCandidates = cursor
      ? filteredJobs.filter((job) => isAfterCursor(job.createdAt, job.id, cursor))
      : filteredJobs;
    const jobs = pageCandidates.slice(0, limit);
    const hasMore = pageCandidates.length > limit;

    const response: RunsListResponse = {
      runs: jobs.map((job) => {
        const status = statusBuilder.buildStatus(job);
        return {
          id: job.id,
          status: job.status,
          createdAt: job.createdAt.toISOString(),
          completedAt: job.completedAt?.toISOString(),
          exitCode: status.exitCode ?? metadataHelper.resolveExitCode(
            job,
            job.resultDir || path.join(config.resultsDir, job.id)
          ) ?? undefined,
          failureClass: status.failureClass,
          failedCommand: status.failedCommand,
          criticalChangeContract: status.criticalChangeContract,
          error: status.error,
          lifecyclePhase: status.lifecyclePhase,
          elapsedSeconds: status.elapsedSeconds,
          taskProgressPercent: status.taskProgressPercent,
          progress: status.progress,
          phaseOutcome: status.phaseOutcome,
          diagnosticEntryPoint: status.diagnosticEntryPoint,
          correlationId: status.correlationId,
          requestId: status.requestId,
          projectName: status.projectName,
        };
      }),
      total: filteredJobs.length,
      hasMore,
      nextCursor: hasMore && jobs.length > 0
        ? encodeCursor(jobs[jobs.length - 1].createdAt, jobs[jobs.length - 1].id)
        : undefined,
      retention: {
        terminalJobMemoryMaxEntries: config.jobIndexMaxEntries ?? DEFAULT_JOB_INDEX_MAX_ENTRIES,
        note: 'Run history is read from the durable jobs index; artifact files may expire independently.',
      },
    };

    res.json(response);
  });

  router.get('/runs/:id', async (req: Request, res: Response) => {
    const job = typeof scheduler.getJobIncludingHistory === 'function'
      ? await scheduler.getJobIncludingHistory(req.params.id)
      : scheduler.getJob(req.params.id);
    if (!job) return sendErrorResponse(res, 404, 'Not Found', `Run not found: ${req.params.id}`);
    return res.json({
      id: job.id,
      status: job.status,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString(),
      completedAt: job.completedAt?.toISOString(),
      projectName: job.request.projectName,
      repoUrl: job.request.repoUrl,
      links: {
        self: `/api/v1/runs/${encodeURIComponent(job.id)}`,
        status: `/api/v1/runs/${encodeURIComponent(job.id)}/status`,
        events: `/api/v1/runs/${encodeURIComponent(job.id)}/events`,
        eventStream: `/api/v1/runs/${encodeURIComponent(job.id)}/events/stream`,
        artifacts: `/api/v1/runs/${encodeURIComponent(job.id)}/artifacts`,
        analysis: `/api/v1/runs/${encodeURIComponent(job.id)}/analysis`,
        scorecard: `/api/v1/runs/${encodeURIComponent(job.id)}/scorecard`,
        webhookDeliveries: `/api/v1/runs/${encodeURIComponent(job.id)}/webhook-deliveries`,
      },
    });
  });

  /**
   * GET /api/v1/runs/:id/status - Get run status.
   */
  router.get('/runs/:id/status', async (req: Request, res: Response) => {
    const job = await getJobOrRespond(scheduler, req.params.id, res);
    if (!job) {
      return;
    }

    const { resultDir: _resultDir, ...response } = statusBuilder.buildStatus(job);
    res.json(response);
  });

  /**
   * POST /api/v1/runs/:id/cancel - Cancel a queued or running run.
   */
  router.post('/runs/:id/cancel', async (req: Request, res: Response) => {
    const requestedId = req.params.id;
    const resolvedJob = typeof scheduler.getJobIncludingHistory === 'function'
      ? await scheduler.getJobIncludingHistory(requestedId) ?? (await scheduler.listAllJobs()).find((job) => job.id.toLowerCase() === requestedId.toLowerCase())
      : scheduler.getJob(requestedId) ?? scheduler.listJobs().find((job) => job.id.toLowerCase() === requestedId.toLowerCase());
    const wasTerminal = resolvedJob?.status === 'completed' || resolvedJob?.status === 'failed';
    const job = wasTerminal ? resolvedJob : resolvedJob ? scheduler.cancelJob(resolvedJob.id) : undefined;
    if (!job) {
      const hint = requestedId.toLowerCase() !== requestedId ? ` Did you mean: ${requestedId.toLowerCase()}?` : '';
      return sendErrorResponse(res, 404, 'Not Found', `Run not found: ${requestedId}.${hint}`);
    }

    const { resultDir: _resultDir, ...response } = statusBuilder.buildStatus(job);
    res.json({ ...response, cancelOutcome: wasTerminal ? 'already_terminal' : 'cancelled' });
  });

  return router;
}

function parseDateFilter(value: unknown, name: string, res: Response): number | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    sendErrorResponse(res, 400, 'Bad Request', `${name} must be a valid ISO 8601 timestamp`);
    return null;
  }
  return Date.parse(value);
}
