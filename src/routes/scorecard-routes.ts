import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { JobScheduler } from '../job-scheduler';
import { ResultCache } from '../result-cache';
import { RunScorecardSchema, type RunScorecard } from '../types/run-scorecard';
import { formatRunScorecardMarkdown } from '../run-scorecard-markdown';
import type { Job, ScorecardSummary, ScorecardsListResponse } from '../kaseki-api-types';
import { sendErrorResponse } from '../utils/response-helpers';
import { matchesFilters, parseFilters, parsePagination } from './scorecard-route-utils';

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
  router.get('/runs/:id/scorecard', (req: Request, res: Response) => {
    const job = scheduler.getJob(req.params.id);
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

  router.get('/scorecards', (req: Request, res: Response) => {
    const { limit, offset } = parsePagination(req.query as Record<string, unknown>);
    const filters = parseFilters(req.query as Record<string, unknown>);
    const matches: ScorecardSummary[] = [];
    // listJobs is the scheduler's bounded retained index; never enumerate resultsDir.
    for (const job of scheduler.listJobs()) {
      const card = readScorecard(job, cache).card;
      if (!card) continue;
      const item = summary(card, job);
      if (!matchesFilters(item, filters)) continue;
      matches.push(item);
      if (matches.length >= offset + limit + 1) break;
    }
    const scorecards = matches.slice(offset, offset + limit);
    const response: ScorecardsListResponse = { scorecards, pagination: { limit, offset, returned: scorecards.length,
      hasMore: matches.length > offset + limit }, filters };
    res.json(response);
  });
  return router;
}
