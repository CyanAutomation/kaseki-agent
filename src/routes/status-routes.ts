import { Router, Request, Response } from 'express';
import { JobScheduler } from '../job-scheduler';
import { DEFAULT_JOB_INDEX_MAX_ENTRIES, KasekiApiConfig } from '../kaseki-api-config';
import { RunsListResponse } from '../kaseki-api-types';
import { sendErrorResponse } from '../utils/response-helpers';
import { findRunJob } from '../utils/route-helpers';
import { StatusResponseBuilder } from '../utils/status-response-builder';
import { StatusMetadataHelper } from '../utils/status-response-metadata-helper';
import type { ResultCache } from '../result-cache';
import { encodeCursor, isAfterCursor, parseCursor, parseLimit, type RunCursor } from './cursor-pagination';
import { SoyuzApiError } from '../integrations/soyuz/SoyuzApiClient';
import { SoyuzSubmissionClient, normalizeSoyuzRunStatus } from '../integrations/soyuz/SoyuzSubmissionClient';
import { runResultDir } from '../utils/run-result-dir';

/**
 * Create status-related routes (runs list, status, cancel).
 */
export function createStatusRoutes(
  scheduler: JobScheduler,
  config: KasekiApiConfig,
  artifactCache?: Pick<ResultCache, 'getOrLoad'>,
  submissionClient?: SoyuzSubmissionClient,
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
          id: job.soyuz?.externalRunId ?? job.id,
          ...(job.soyuz ? { localRunId: job.id } : {}),
          status: job.status,
          createdAt: job.createdAt.toISOString(),
          completedAt: job.completedAt?.toISOString(),
          exitCode: status.exitCode ?? metadataHelper.resolveExitCode(
            job,
            runResultDir(job, config.resultsDir)
          ) ?? undefined,
          failureClass: status.failureClass,
          failedCommand: status.failedCommand,
          criticalChangeContract: status.criticalChangeContract,
          error: status.error,
          diagnosticSummary: status.diagnosticSummary,
          runner: status.runner,
          lifecyclePhase: status.lifecyclePhase,
          elapsedSeconds: status.elapsedSeconds,
          taskProgressPercent: status.taskProgressPercent,
          progress: status.progress,
          phaseOutcome: status.phaseOutcome,
          diagnosticEntryPoint: status.diagnosticEntryPoint,
          correlationId: status.correlationId,
          requestId: status.requestId,
          projectName: status.projectName,
          origin: status.origin,
          retryOf: status.retryOf,
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
    const job = await findRunJob(scheduler, req.params.id);
    if (!job && submissionClient && isCanonicalSoyuzId(req.params.id)) {
      try {
        const remote = await submissionClient.getWorkerRun(req.params.id);
        return res.json({
          id: remote.runId,
          status: normalizeSoyuzRunStatus(remote.status),
          updatedAt: remote.updatedAt,
          stage: remote.stage ?? undefined,
          cancelRequestedAt: remote.cancelRequestedAt ?? undefined,
          operationalHealth: remote.operationalHealth,
          origin: remote.origin,
          retryOf: remote.retryOf ?? undefined,
        });
      } catch (error) {
        if (error instanceof SoyuzApiError) {
          return sendErrorResponse(res, error.status === 404 ? 404 : 503, error.status === 404 ? 'Not Found' : 'Soyuz Unavailable', error.message);
        }
        return sendErrorResponse(res, 503, 'Soyuz Unavailable', 'Could not read canonical Soyuz run state');
      }
    }
    if (!job) return sendErrorResponse(res, 404, 'Not Found', `Run not found: ${req.params.id}`);
    const canonicalId = job.soyuz?.externalRunId ?? job.id;
    return res.json({
      id: canonicalId,
      ...(job.soyuz ? { localRunId: job.id } : {}),
      status: job.status,
      origin: job.soyuz?.origin,
      retryOf: job.soyuz?.retryOf ?? undefined,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString(),
      completedAt: job.completedAt?.toISOString(),
      projectName: job.request.projectName,
      repoUrl: job.request.repoUrl,
      links: {
        self: `/api/v1/runs/${encodeURIComponent(canonicalId)}`,
        status: `/api/v1/runs/${encodeURIComponent(canonicalId)}/status`,
        events: `/api/v1/runs/${encodeURIComponent(canonicalId)}/events`,
        eventStream: `/api/v1/runs/${encodeURIComponent(canonicalId)}/events/stream`,
        artifacts: `/api/v1/runs/${encodeURIComponent(canonicalId)}/artifacts`,
        analysis: `/api/v1/runs/${encodeURIComponent(canonicalId)}/analysis`,
        scorecard: `/api/v1/runs/${encodeURIComponent(canonicalId)}/scorecard`,
        webhookDeliveries: `/api/v1/runs/${encodeURIComponent(canonicalId)}/webhook-deliveries`,
      },
    });
  });

  registerRunStatusRoute(router, scheduler, statusBuilder, submissionClient);
  registerRunCancelRoute(router, scheduler, statusBuilder, submissionClient);

  return router;
}

function registerRunStatusRoute(
  router: Router,
  scheduler: JobScheduler,
  statusBuilder: StatusResponseBuilder,
  submissionClient?: SoyuzSubmissionClient,
): void {
  router.get('/runs/:id/status', async (req: Request, res: Response) => {
    const job = await findRunJob(scheduler, req.params.id);
    if (job) {
      const { resultDir: _resultDir, ...response } = statusBuilder.buildStatus(job);
      return res.json(response);
    }
    if (await respondWithRemoteRunStatus(submissionClient, req.params.id, res)) return;
    return sendErrorResponse(res, 404, 'Not Found', `Run not found: ${req.params.id}`);
  });
}

async function respondWithRemoteRunStatus(
  submissionClient: SoyuzSubmissionClient | undefined,
  runId: string,
  res: Response,
): Promise<boolean> {
  if (!submissionClient || !isCanonicalSoyuzId(runId)) return false;
  try {
    const remote = await submissionClient.getWorkerRun(runId);
    const lifecyclePhase = remote.status === 'queued' || remote.status === 'admitting'
      ? 'queued'
      : ['completed', 'failed', 'cancelled', 'admission_failed'].includes(remote.status)
        ? 'terminal'
        : 'executing';
    res.json({
      id: remote.runId,
      status: normalizeSoyuzRunStatus(remote.status),
      lifecyclePhase,
      progress: remote.stage ? { stage: remote.stage } : undefined,
      updatedAt: remote.updatedAt,
      cancelRequestedAt: remote.cancelRequestedAt ?? undefined,
      operationalHealth: remote.operationalHealth,
      origin: remote.origin,
      retryOf: remote.retryOf ?? undefined,
    });
  } catch (error) {
    if (error instanceof SoyuzApiError) {
      sendErrorResponse(res, error.status === 404 ? 404 : 503, error.status === 404 ? 'Not Found' : 'Soyuz Unavailable', error.message);
    } else {
      sendErrorResponse(res, 503, 'Soyuz Unavailable', 'Could not read canonical Soyuz run state');
    }
  }
  return true;
}

function registerRunCancelRoute(
  router: Router,
  scheduler: JobScheduler,
  statusBuilder: StatusResponseBuilder,
  submissionClient?: SoyuzSubmissionClient,
): void {
  router.post('/runs/:id/cancel', async (req: Request, res: Response) => {
    const requestedId = req.params.id;
    const resolvedJob = await findCancelableJob(scheduler, requestedId);
    if (await respondWithRemoteCancellation(submissionClient, resolvedJob, requestedId, res)) return;
    return respondWithLocalCancellation(scheduler, statusBuilder, resolvedJob, requestedId, res);
  });
}

async function findCancelableJob(scheduler: JobScheduler, requestedId: string) {
  if (typeof scheduler.getJobIncludingHistory === 'function') {
    return await scheduler.getJobIncludingHistory(requestedId)
      ?? (await scheduler.listAllJobs()).find((job) => job.id.toLowerCase() === requestedId.toLowerCase());
  }
  return scheduler.getJob(requestedId)
    ?? scheduler.listJobs().find((job) => job.id.toLowerCase() === requestedId.toLowerCase());
}

async function respondWithRemoteCancellation(
  submissionClient: SoyuzSubmissionClient | undefined,
  resolvedJob: Awaited<ReturnType<typeof findCancelableJob>>,
  requestedId: string,
  res: Response,
): Promise<boolean> {
  if (!submissionClient || (!resolvedJob?.soyuz && (resolvedJob || !isCanonicalSoyuzId(requestedId)))) return false;
  const canonicalId = resolvedJob?.soyuz?.externalRunId ?? requestedId;
  try {
    const remote = await submissionClient.cancelRun(canonicalId);
    res.json({
      id: remote.id,
      ...(resolvedJob?.soyuz ? { localRunId: resolvedJob.id } : {}),
      status: normalizeSoyuzRunStatus(remote.status),
      origin: remote.origin,
      cancelOutcome: isTerminalSoyuzStatus(remote.status) ? 'already_terminal' : 'cancel_requested',
      retryOf: remote.retryOf ?? undefined,
    });
  } catch (error) {
    if (error instanceof SoyuzApiError) {
      sendErrorResponse(res, error.status === 404 ? 404 : 503, error.status === 404 ? 'Not Found' : 'Soyuz Cancel Failed', error.message, { code: error.code });
    } else {
      sendErrorResponse(res, 503, 'Soyuz Cancel Uncertain', 'Could not confirm the Soyuz cancellation request');
    }
  }
  return true;
}

function respondWithLocalCancellation(
  scheduler: JobScheduler,
  statusBuilder: StatusResponseBuilder,
  resolvedJob: Awaited<ReturnType<typeof findCancelableJob>>,
  requestedId: string,
  res: Response,
) {
  const wasTerminal = resolvedJob?.status === 'completed' || resolvedJob?.status === 'failed';
  const job = wasTerminal ? resolvedJob : resolvedJob ? scheduler.cancelJob(resolvedJob.id) : undefined;
  if (!job) {
    const hint = requestedId.toLowerCase() !== requestedId ? ` Did you mean: ${requestedId.toLowerCase()}?` : '';
    return sendErrorResponse(res, 404, 'Not Found', `Run not found: ${requestedId}.${hint}`);
  }
  const { resultDir: _resultDir, ...response } = statusBuilder.buildStatus(job);
  return res.json({ ...response, cancelOutcome: wasTerminal ? 'already_terminal' : 'cancelled' });
}

function isTerminalSoyuzStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function isCanonicalSoyuzId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function parseDateFilter(value: unknown, name: string, res: Response): number | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    sendErrorResponse(res, 400, 'Bad Request', `${name} must be a valid ISO 8601 timestamp`);
    return null;
  }
  return Date.parse(value);
}
