import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { JobScheduler } from '../job-scheduler';
import { KasekiApiConfig } from '../kaseki-api-config';
import type { Job } from '../kaseki-api-types';

type EvaluationArtifact = {
  overall_assessment?: string;
  reviewer_confidence?: string;
  task_completion_score?: number;
  human_review_focus?: string[];
  efficiency_findings?: string[];
  kaseki_improvement_opportunities?: Array<{
    category?: string;
    priority?: string;
    suggestion?: string;
  }>;
};

type ImprovementGroup = {
  category: string;
  priority: string;
  count: number;
  suggestions: string[];
};

type StageAggregate = {
  stage: string;
  count: number;
  totalSeconds: number;
  averageSeconds: number;
  maxSeconds: number;
};

type ImprovementAccumulator = {
  assessmentCounts: Record<string, number>;
  confidenceCounts: Record<string, number>;
  opportunityCounts: Map<string, ImprovementGroup>;
  stageCounts: Map<string, StageAggregate>;
  evaluationAvailable: number;
  evaluationMissing: number;
  evaluationInvalid: number;
};

type ImprovementRunSummary = {
  id: string;
  repoUrl: string;
  assessment: string;
  confidence: string;
  taskCompletionScore?: number;
  topReviewFocus: string;
  topImprovement: string;
  durationSeconds?: number;
  prUrl: string;
  evaluationDiagnostic?: string;
};

export function createImprovementRoutes(scheduler: JobScheduler, config: KasekiApiConfig): Router {
  const router = Router();

  router.get('/improvements', (req: Request, res: Response) => {
    const limit = normalizeLimit(req.query.limit);
    const terminalJobs = scheduler
      .listJobs()
      .filter((job) => job.status === 'completed' || job.status === 'failed')
      .slice(0, limit);

    const accumulator = createImprovementAccumulator();
    const runs = terminalJobs.map((job) => summarizeImprovementRun(job, config, accumulator));

    res.json({
      limit,
      totalRuns: terminalJobs.length,
      counts: {
        byAssessment: accumulator.assessmentCounts,
        byConfidence: accumulator.confidenceCounts,
      },
      evaluator: {
        available: accumulator.evaluationAvailable,
        missing: accumulator.evaluationMissing,
        invalid: accumulator.evaluationInvalid,
        diagnostics: countEvaluationDiagnostics(runs),
      },
      topImprovementOpportunities: Array.from(accumulator.opportunityCounts.values())
        .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
        .slice(0, 10),
      slowestStages: Array.from(accumulator.stageCounts.values())
        .sort((a, b) => b.averageSeconds - a.averageSeconds || b.maxSeconds - a.maxSeconds)
        .slice(0, 10),
      runs,
    });
  });

  return router;
}

function createImprovementAccumulator(): ImprovementAccumulator {
  return {
    assessmentCounts: {},
    confidenceCounts: {},
    opportunityCounts: new Map<string, ImprovementGroup>(),
    stageCounts: new Map<string, StageAggregate>(),
    evaluationAvailable: 0,
    evaluationMissing: 0,
    evaluationInvalid: 0,
  };
}

function summarizeImprovementRun(
  job: Job,
  config: KasekiApiConfig,
  accumulator: ImprovementAccumulator,
): ImprovementRunSummary {
  const runDir = job.resultDir || path.join(config.resultsDir, job.id);
  const metadata = readJson(path.join(runDir, 'metadata.json')) as Record<string, any>;
  const evaluationPath = path.join(runDir, 'run-evaluation.json');
  const evaluation = readJson(evaluationPath) as EvaluationArtifact | null;
  const validEvaluation = isEvaluationArtifact(evaluation);
  const evaluationDiagnostic = validEvaluation ? undefined : evaluationDiagnosticForRun(runDir);

  recordEvaluationState(evaluationPath, validEvaluation, accumulator);
  if (validEvaluation) {
    recordEvaluationAggregates(evaluation, accumulator);
  }
  recordStageTimings(path.join(runDir, 'stage-timings.tsv'), accumulator.stageCounts);

  return buildRunSummary(job, metadata, evaluation, validEvaluation, evaluationDiagnostic);
}

function isEvaluationArtifact(value: unknown): value is EvaluationArtifact {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function evaluationDiagnosticForRun(runDir: string): string {
  if (fs.existsSync(path.join(runDir, 'run-evaluation-stderr.log'))) {
    return 'invalid_artifact_with_stderr';
  }
  if (hasNonEmptyFile(path.join(runDir, 'run-evaluation-events.jsonl'))) {
    return 'missing_artifact_after_events';
  }
  return 'missing_artifact';
}

function recordEvaluationState(
  evaluationPath: string,
  validEvaluation: boolean,
  accumulator: ImprovementAccumulator,
): void {
  if (validEvaluation) {
    accumulator.evaluationAvailable += 1;
  } else if (fs.existsSync(evaluationPath)) {
    accumulator.evaluationInvalid += 1;
  } else {
    accumulator.evaluationMissing += 1;
  }
}

function recordEvaluationAggregates(evaluation: EvaluationArtifact, accumulator: ImprovementAccumulator): void {
  increment(accumulator.assessmentCounts, normalizeBucket(evaluation.overall_assessment, 'unknown'));
  increment(accumulator.confidenceCounts, normalizeBucket(evaluation.reviewer_confidence, 'unknown'));
  for (const opportunity of evaluation.kaseki_improvement_opportunities ?? []) {
    recordOpportunity(opportunity, accumulator.opportunityCounts);
  }
}

function recordOpportunity(
  opportunity: NonNullable<EvaluationArtifact['kaseki_improvement_opportunities']>[number],
  opportunityCounts: Map<string, ImprovementGroup>,
): void {
  const category = normalizeBucket(opportunity.category, 'uncategorized');
  const priority = normalizeBucket(opportunity.priority, 'unknown');
  const key = `${category}\0${priority}`;
  const group = opportunityCounts.get(key) ?? { category, priority, count: 0, suggestions: [] };
  group.count += 1;
  const suggestion = normalizeText(opportunity.suggestion);
  if (suggestion && !group.suggestions.includes(suggestion) && group.suggestions.length < 5) {
    group.suggestions.push(suggestion);
  }
  opportunityCounts.set(key, group);
}

function recordStageTimings(stageTimingsPath: string, stageCounts: Map<string, StageAggregate>): void {
  for (const row of readStageTimings(stageTimingsPath)) {
    const aggregate = stageCounts.get(row.stage) ?? {
      stage: row.stage,
      count: 0,
      totalSeconds: 0,
      averageSeconds: 0,
      maxSeconds: 0,
    };
    aggregate.count += 1;
    aggregate.totalSeconds += row.seconds;
    aggregate.maxSeconds = Math.max(aggregate.maxSeconds, row.seconds);
    aggregate.averageSeconds = Math.round((aggregate.totalSeconds / aggregate.count) * 10) / 10;
    stageCounts.set(row.stage, aggregate);
  }
}

function buildRunSummary(
  job: Job,
  metadata: Record<string, any>,
  evaluation: EvaluationArtifact | null,
  validEvaluation: boolean,
  evaluationDiagnostic: string | undefined,
): ImprovementRunSummary {
  const topImprovement = validEvaluation
    ? normalizeText(evaluation?.kaseki_improvement_opportunities?.[0]?.suggestion)
    : '';

  return {
    id: job.id,
    repoUrl: typeof metadata?.repo_url === 'string' ? metadata.repo_url : job.request.repoUrl,
    assessment: validEvaluation ? normalizeBucket(evaluation?.overall_assessment, 'unknown') : 'missing',
    confidence: validEvaluation ? normalizeBucket(evaluation?.reviewer_confidence, 'unknown') : 'missing',
    taskCompletionScore: validEvaluation && Number.isFinite(evaluation?.task_completion_score)
      ? evaluation?.task_completion_score
      : undefined,
    topReviewFocus: validEvaluation ? normalizeText(evaluation?.human_review_focus?.[0]) : '',
    topImprovement,
    durationSeconds: typeof metadata?.duration_seconds === 'number' ? metadata.duration_seconds : undefined,
    prUrl: typeof metadata?.github_pr_url === 'string' ? metadata.github_pr_url : '',
    evaluationDiagnostic,
  };
}

function countEvaluationDiagnostics(runs: ImprovementRunSummary[]): Record<string, number> {
  return runs.reduce<Record<string, number>>((counts, run) => {
    if (run.evaluationDiagnostic) {
      counts[run.evaluationDiagnostic] = (counts[run.evaluationDiagnostic] ?? 0) + 1;
    }
    return counts;
  }, {});
}

function normalizeLimit(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(String(raw ?? '50'), 10);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(parsed, 200));
}

function readJson(file: string): unknown {
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.trim()) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readStageTimings(file: string): Array<{ stage: string; seconds: number }> {
  try {
    return fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.split('\t'))
      .filter((parts) => parts.length >= 3)
      .map((parts) => ({ stage: normalizeText(parts[0]), seconds: Number.parseFloat(parts[2]) }))
      .filter((row) => row.stage && Number.isFinite(row.seconds));
  } catch {
    return [];
  }
}

function hasNonEmptyFile(file: string): boolean {
  try {
    return fs.statSync(file).size > 0;
  } catch {
    return false;
  }
}

function normalizeBucket(value: unknown, fallback: string): string {
  const normalized = normalizeText(value).toLowerCase();
  return normalized || fallback;
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .replace(/\b(?:gh[opsru]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}
