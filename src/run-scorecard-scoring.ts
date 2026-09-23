import { RunScorecardSchema, type RunScorecard } from './types/run-scorecard';
import type { Evidence } from './run-scorecard-evidence';
import { ScorecardContext } from './run-scorecard-context';
import { buildDimensions, buildPhases, DIMENSIONS, WEIGHTS, PHASES } from './run-scorecard-scoring-parts';
import { buildScorecardWarnings } from './run-scorecard-warnings';
import { assignGrade } from './run-scorecard-scoring-grades';
import {
  calculateUncappedScore,
  applyScoringCap,
  calculateConfidenceScore,
  getConfidenceRationale,
  determineCompleteness,
  hasEvaluatorReliability,
  calculateMissingCritical,
} from './run-scorecard-scoring-calculation';

export { assignGrade } from './run-scorecard-scoring-grades';

export function calculateCoverage(evidence: Evidence) {
  const fields: Array<[string, boolean]> = [
    ['metadata', evidence.present.includes('metadata.json')], ['timings', evidence.elapsedSeconds !== undefined],
    ['tokens', evidence.tokens !== undefined], ['validation', evidence.validation !== 'unknown'],
    ['quality gates', evidence.quality !== 'unknown'], ['goal check', evidence.goalCheckAvailable],
    ['changes', evidence.present.includes('changed-files.txt') || evidence.present.includes('git.diff')],
    ['evaluation', !!evidence.evaluation],
  ];
  const missing = fields.filter(([, present]) => !present).map(([key]) => key);
  return { ratio: Number(((fields.length - missing.length) / fields.length).toFixed(3)), observed: fields.length - missing.length, possible: fields.length, missing };
}

export function buildScorecard(evidence: Evidence, now = new Date()): RunScorecard {
  const config = ScorecardContext.getConfig();
  const coverage = calculateCoverage(evidence);
  const timestamp = (value: unknown): string | null => {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
    return RunScorecardSchema.shape.started_at.unwrap().safeParse(value).success ? value : null;
  };
  const started = timestamp(evidence.metadata.started_at);
  const ended = timestamp(evidence.metadata.ended_at);
  const dimensions = buildDimensions(evidence);
  const wallClockMs = (evidence.elapsedSeconds ?? 0) * 1000;
  const measuredStageMs = evidence.stageElapsedSeconds === undefined ? null : evidence.stageElapsedSeconds * 1000;
  const categorizedStageMs = Object.values(evidence.phaseDurationsMs).reduce((total, duration) => total + duration, 0)
    + (evidence.preAgentValidationMs ?? 0);

  // Calculate and cap the score
  const uncappedScore = calculateUncappedScore(dimensions.map(d => d.weighted_points));
  const evaluatorReliable = hasEvaluatorReliability(evidence.goalCheckAvailable, evidence.evaluatorAvailable);
  const score = applyScoringCap(uncappedScore, evaluatorReliable);

  // Calculate confidence metrics
  const confidenceValue = calculateConfidenceScore(coverage.ratio, evidence.unknownTokenRequests > 0, evaluatorReliable);
  const confidenceRationale = getConfidenceRationale(coverage.observed, coverage.possible, evaluatorReliable);

  return RunScorecardSchema.parse({
    schema_version: '1.0', rubric_version: config.rubricVersion,
    run_id: typeof evidence.metadata.instance === 'string' ? evidence.metadata.instance : 'unknown-run',
    started_at: started, ended_at: ended, scored_at: now.toISOString(), lifecycle_status: evidence.status,
    overall_score: score, grade: assignGrade(score),
    evidence_coverage: {
      required: coverage.possible, available: Math.min(coverage.observed, coverage.possible), ratio: Math.min(1, coverage.ratio),
      missing_critical: calculateMissingCritical(evidence.diffBytes, evidence.validation, evidence.goalCheckAvailable, evidence.evaluatorAvailable),
    },
    completeness: determineCompleteness(coverage.ratio),
    confidence: { score: confidenceValue, rationale: confidenceRationale },
    dimensions, phases: buildPhases(evidence), token_totals: evidence.tokenUsage,
    timing_totals: {
      wall_clock_ms: wallClockMs,
      pre_agent_validation_ms: evidence.stageElapsedSeconds === undefined ? null : (evidence.preAgentValidationMs ?? 0),
      measured_stage_ms: measuredStageMs,
      unclassified_stage_ms: measuredStageMs === null ? null : Math.max(0, measuredStageMs - categorizedStageMs),
      unaccounted_wall_clock_ms: measuredStageMs === null ? null : Math.max(0, wallClockMs - measuredStageMs),
      phase_duration_ms: Object.fromEntries(PHASES.map(phase => [phase, evidence.phaseDurationsMs[phase] ?? null])),
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
      enabled_phase_reliability_penalty_points: evaluatorReliable ? 0 : 10, disabled_phase_policy: 'reweight_eligible_dimensions',
    },
    warnings: buildScorecardWarnings(evidence, coverage),
  });
}
