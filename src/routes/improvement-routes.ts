import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { JobScheduler } from '../job-scheduler';
import { KasekiApiConfig } from '../kaseki-api-config';

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

export function createImprovementRoutes(scheduler: JobScheduler, config: KasekiApiConfig): Router {
  const router = Router();

  router.get('/improvements', (req: Request, res: Response) => {
    const limit = normalizeLimit(req.query.limit);
    const terminalJobs = scheduler
      .listJobs()
      .filter((job) => job.status === 'completed' || job.status === 'failed')
      .slice(0, limit);

    const assessmentCounts: Record<string, number> = {};
    const confidenceCounts: Record<string, number> = {};
    const opportunityCounts = new Map<string, ImprovementGroup>();
    const stageCounts = new Map<string, StageAggregate>();
    let evaluationAvailable = 0;
    let evaluationMissing = 0;
    let evaluationInvalid = 0;

    const runs = terminalJobs.map((job) => {
      const runDir = job.resultDir || path.join(config.resultsDir, job.id);
      const metadata = readJson(path.join(runDir, 'metadata.json')) as Record<string, any>;
      const evaluationPath = path.join(runDir, 'run-evaluation.json');
      const evaluation = readJson(evaluationPath) as EvaluationArtifact | null;
      const validEvaluation = evaluation && typeof evaluation === 'object' && !Array.isArray(evaluation);

      if (validEvaluation) {
        evaluationAvailable += 1;
        increment(assessmentCounts, normalizeBucket(evaluation.overall_assessment, 'unknown'));
        increment(confidenceCounts, normalizeBucket(evaluation.reviewer_confidence, 'unknown'));
        for (const opportunity of evaluation.kaseki_improvement_opportunities ?? []) {
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
      } else if (fs.existsSync(evaluationPath)) {
        evaluationInvalid += 1;
      } else {
        evaluationMissing += 1;
      }

      for (const row of readStageTimings(path.join(runDir, 'stage-timings.tsv'))) {
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

      const topImprovement = validEvaluation
        ? normalizeText(evaluation.kaseki_improvement_opportunities?.[0]?.suggestion)
        : '';

      return {
        id: job.id,
        repoUrl: typeof metadata?.repo_url === 'string' ? metadata.repo_url : job.request.repoUrl,
        assessment: validEvaluation ? normalizeBucket(evaluation.overall_assessment, 'unknown') : 'missing',
        confidence: validEvaluation ? normalizeBucket(evaluation.reviewer_confidence, 'unknown') : 'missing',
        taskCompletionScore: validEvaluation && Number.isFinite(evaluation.task_completion_score)
          ? evaluation.task_completion_score
          : undefined,
        topReviewFocus: validEvaluation ? normalizeText(evaluation.human_review_focus?.[0]) : '',
        topImprovement,
        durationSeconds: typeof metadata?.duration_seconds === 'number' ? metadata.duration_seconds : undefined,
        prUrl: typeof metadata?.github_pr_url === 'string' ? metadata.github_pr_url : '',
      };
    });

    res.json({
      limit,
      totalRuns: terminalJobs.length,
      counts: {
        byAssessment: assessmentCounts,
        byConfidence: confidenceCounts,
      },
      evaluator: {
        available: evaluationAvailable,
        missing: evaluationMissing,
        invalid: evaluationInvalid,
      },
      topImprovementOpportunities: Array.from(opportunityCounts.values())
        .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
        .slice(0, 10),
      slowestStages: Array.from(stageCounts.values())
        .sort((a, b) => b.averageSeconds - a.averageSeconds || b.maxSeconds - a.maxSeconds)
        .slice(0, 10),
      runs,
    });
  });

  return router;
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
