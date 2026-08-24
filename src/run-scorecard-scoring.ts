import { RunScorecardSchema, type RunScorecard } from './types/run-scorecard';
import type { Evidence } from './run-scorecard-evidence';
import type { ScorecardConfig } from './run-scorecard-config';
import { buildDimensions, buildPhases, DIMENSIONS, WEIGHTS } from './run-scorecard-scoring-parts';

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export function assignGrade(score: number): RunScorecard['grade'] {
  return score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
}

export function calculateCoverage(evidence: Evidence) {
  const fields: Array<[string, boolean]> = [
    ['metadata', evidence.present.includes('metadata.json')], ['timings', evidence.elapsedSeconds !== undefined],
    ['tokens', evidence.tokens !== undefined], ['validation', evidence.validation !== 'unknown'],
    ['quality gates', evidence.quality !== 'unknown'], ['goal check', evidence.goalMet !== undefined],
    ['changes', evidence.present.includes('changed-files.txt') || evidence.present.includes('git.diff')],
    ['evaluation', !!evidence.evaluation],
  ];
  const missing = fields.filter(([, present]) => !present).map(([key]) => key);
  return { ratio: Number(((fields.length - missing.length) / fields.length).toFixed(3)), observed: fields.length - missing.length, possible: fields.length, missing };
}

export function buildScorecard(evidence: Evidence, config: ScorecardConfig, now = new Date()): RunScorecard {
  const coverage = calculateCoverage(evidence);
  const started = typeof evidence.metadata.started_at === 'string' ? evidence.metadata.started_at : now.toISOString();
  const ended = typeof evidence.metadata.ended_at === 'string' ? evidence.metadata.ended_at
    : ['completed', 'failed', 'cancelled', 'timed_out'].includes(evidence.status) ? now.toISOString() : null;
  const dimensions = buildDimensions(evidence, config);
  const uncappedScore = Number(dimensions.reduce((total, dimension) => total + dimension.weighted_points, 0).toFixed(2));
  // A successful patch can still be useful, but it must not look fully
  // evaluated when the evaluator artifact is a fallback or unavailable.
  const score = evidence.evaluatorAvailable ? uncappedScore : Math.min(uncappedScore, 79);
  return RunScorecardSchema.parse({
    schema_version: '1.0', rubric_version: config.rubricVersion,
    run_id: typeof evidence.metadata.instance === 'string' ? evidence.metadata.instance : 'unknown-run',
    started_at: started, ended_at: ended, scored_at: now.toISOString(), lifecycle_status: evidence.status,
    overall_score: score, grade: assignGrade(score),
    evidence_coverage: {
      required: coverage.possible, available: Math.min(coverage.observed, coverage.possible), ratio: Math.min(1, coverage.ratio),
      missing_critical: [...(evidence.diffBytes === 0 ? ['diff'] : []), ...(evidence.validation === 'unknown' ? ['validation_result'] : [])],
    },
    completeness: coverage.ratio === 1 ? 'complete' : 'provisional',
    confidence: { score: clamp(coverage.ratio * 100 * (evidence.unknownTokenRequests > 0 ? .9 : 1)), rationale: `${coverage.observed} of ${coverage.possible} evidence categories are available.` },
    dimensions, phases: buildPhases(evidence), token_totals: evidence.tokenUsage,
    timing_totals: {
      wall_clock_ms: (evidence.elapsedSeconds ?? 0) * 1000,
      phase_duration_ms: { goal_setting: null, scouting: null, coding: null, validation: null, goal_check: null, run_evaluation: null },
      completeness: evidence.elapsedSeconds === undefined ? 'unavailable' : 'complete',
    },
    scoring_config: {
      rubric_version: config.rubricVersion,
      dimension_weights: Object.fromEntries(DIMENSIONS.map((id, index) => [id, WEIGHTS[index]])),
      grade_bands: [['A', 90, 100], ['B', 80, 89], ['C', 70, 79], ['D', 60, 69], ['F', 0, 59]].map(([grade, minimum_score, maximum_score]) => ({ grade, minimum_score, maximum_score })),
      normalization_rules: { efficiency: { function: 'inverse_target_ratio', expression: 'min(100, target / actual * 100)', parameters: { token_target: config.targets.tokens, time_target_seconds: config.targets.elapsedSeconds, retry_target: config.targets.retries } } },
      task_size: config.taskSize,
      selected_targets: { token_budget: Math.round(config.targets.tokens), wall_clock_ms: config.targets.elapsedSeconds * 1000, changed_lines: null, rationale: 'Configured before scoring; preserved with this artifact.' },
      caps: { missing_diff: 69, missing_validation: 59, missing_diff_and_validation: 49 },
      enabled_phase_reliability_penalty_points: 0, disabled_phase_policy: 'reweight_eligible_dimensions',
    },
    warnings: [...coverage.missing.map(value => `Missing evidence: ${value}`),
      ...(!evidence.evaluatorAvailable ? ['Evaluator unavailable: patch and validation evidence are reported separately; score capped below A.'] : [])],
  });
}
