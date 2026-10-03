import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { JobScheduler } from '../job-scheduler';
import { ResultCache } from '../result-cache';
import { RunScorecardSchema, type RunScorecard } from '../types/run-scorecard';
import { formatRunScorecardMarkdown } from '../run-scorecard-markdown';
import type { Job, ScorecardSummary, ScorecardsListResponse } from '../kaseki-api-types';
import { sendErrorResponse } from '../utils/response-helpers';
import { matchesFilters, parseFilters, DEFAULT_LIMIT, MAX_LIMIT } from './scorecard-route-utils';
import { encodeCursor, isAfterCursor, parseCursor, parseLimit } from './cursor-pagination';

const FILE = 'run-scorecard.json';
const terminalCacheInvalidated = new WeakSet<Job>();

function readScorecard(job: Job, cache: ResultCache): { card?: RunScorecard; malformed?: boolean } {
  if (!job.resultDir) return {};
  // Terminal transition may replace a provisional artifact. ResultCache validates
  // inode, mtime and size, and this explicit eviction closes same-stat edge cases.
  if ((job.finalized || job.status === 'completed' || job.status === 'failed') && !terminalCacheInvalidated.has(job)) {
    cache.clearForJob(job.id);
    terminalCacheInvalidated.add(job);
  }
  const content = cache.getOrLoad(path.join(job.resultDir, FILE));
  if (content === null) return {};
  try {
    const parsed = RunScorecardSchema.safeParse(JSON.parse(content));
    return parsed.success ? { card: parsed.data } : { malformed: true };
  } catch { return { malformed: true }; }
}

function modelFor(job: Job): string | undefined {
  const request = job.request as unknown as Record<string, unknown>;
  return typeof request.model === 'string' ? request.model : undefined;
}

function summary(card: RunScorecard, job: Job): ScorecardSummary {
  return { runId: card.run_id, lifecycleStatus: card.lifecycle_status, overallScore: card.overall_score,
    grade: card.grade, rubricVersion: card.rubric_version, completeness: card.completeness,
    confidence: card.confidence.score, startedAt: card.started_at, endedAt: card.ended_at,
    scoredAt: card.scored_at, model: modelFor(job), repository: job.request.repoUrl };
}

export function createScorecardRoutes(scheduler: JobScheduler, cache: ResultCache): Router {
  const router = Router();
  router.get('/runs/:id/scorecard', async (req: Request, res: Response) => {
    const job = typeof scheduler.getJobIncludingHistory === 'function'
      ? await scheduler.getJobIncludingHistory(req.params.id)
      : scheduler.getJob(req.params.id);
    if (!job) return sendErrorResponse(res, 404, 'Run not found', `Unknown run: ${req.params.id}`);
    const result = readScorecard(job, cache);
    if (result.malformed) return sendErrorResponse(res, 422, 'Malformed scorecard', `${FILE} failed schema validation`);
    if (!result.card) {
      if (job.status === 'queued' || job.status === 'running') {
        return sendErrorResponse(res, 409, 'Scorecard not ready', 'The run is in progress and has no provisional scorecard');
      }
      return sendErrorResponse(res, 404, 'Scorecard unavailable', `No scorecard was produced for run ${job.id}`);
    }
    if (req.query.format === 'markdown') return res.type('text/markdown').send(formatRunScorecardMarkdown(result.card));
    if (req.query.format !== undefined) return sendErrorResponse(res, 400, 'Invalid format', 'format must be markdown when provided');
    return res.json(result.card);
  });

  router.get('/scorecards', async (req: Request, res: Response) => {
    let limit: number;
    let cursor;
    try {
      limit = parseLimit(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
      cursor = parseCursor(req.query.cursor);
    } catch (error) {
      return sendErrorResponse(res, 400, 'Bad Request', error instanceof Error ? error.message : 'Invalid pagination query');
    }
    const filters = parseFilters(req.query as Record<string, unknown>);
    const matches: Array<{ job: Job; item: ScorecardSummary }> = [];
    const allJobs = typeof scheduler.listAllJobs === 'function' ? await scheduler.listAllJobs() : scheduler.listJobs();
    for (const job of allJobs) {
      const card = readScorecard(job, cache).card;
      if (!card) continue;
      const item = summary(card, job);
      if (!matchesFilters(item, filters)) continue;
      matches.push({ job, item });
    }
    matches.sort((a, b) => b.job.createdAt.getTime() - a.job.createdAt.getTime() || b.job.id.localeCompare(a.job.id));
    const pageCandidates = cursor ? matches.filter(({ job }) => isAfterCursor(job.createdAt, job.id, cursor)) : matches;
    const page = pageCandidates.slice(0, limit);
    const hasMore = pageCandidates.length > limit;
    const response: ScorecardsListResponse = {
      scorecards: page.map(({ item }) => item),
      total: matches.length,
      pagination: {
        limit,
        returned: page.length,
        hasMore,
        nextCursor: hasMore && page.length > 0 ? encodeCursor(page[page.length - 1].job.createdAt, page[page.length - 1].job.id) : undefined,
      },
      filters,
    };
    res.json(response);
  });
  return router;
}
