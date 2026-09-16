import type { Evidence } from './run-scorecard-evidence';
import type { RunScorecard } from './types/run-scorecard';
import { PHASES, DIMENSIONS, WEIGHTS } from './run-scorecard-phases';
import { computeImplementationQualityScore } from './run-scorecard-scoring-efficiency';
import { determinePhaseOutcome, determineDimensionStatus, calculateEffectiveWeight, calculateWeightedPoints } from './run-scorecard-scoring-helpers';

export { PHASES, DIMENSIONS, WEIGHTS, computeImplementationQualityScore };

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

/**
 * Extracts and normalizes the evaluation score from evidence.
 * Handles two scales: 0–100 (direct) and 1–5 (completion scale).
 * Applies penalty for contradictions.
 */
export function normalizeEvaluationScore(evidence: Evidence): number {
  const rawEvaluationScore = typeof evidence.evaluation?.task_completion_score === 'number'
    ? evidence.evaluation.task_completion_score
    : typeof evidence.evaluation?.score === 'number'
      ? evidence.evaluation.score
      : evidence.evaluatorAvailable ? 80 : 0;
  // Run evaluations use either a 0–100 score or a 1–5 completion scale.
  // Normalise the latter before it reaches the common scorecard scale.
  const evaluationScore = rawEvaluationScore > 0 && rawEvaluationScore <= 5
    ? rawEvaluationScore * 20
    : rawEvaluationScore;
  const contradictionPenalty = Array.isArray(evidence.evaluation?.contradictions) ? evidence.evaluation.contradictions.length * 15 : 0;
  return clamp(evaluationScore - contradictionPenalty);
}

function sourceScores(evidence: Evidence): number[] {
  // A missing goal-check is not neutral evidence. Keep the score provisional
  // and prevent a completed process from looking like verified goal attainment.
  const completion = !evidence.goalCheckAvailable ? 0 : evidence.goalMet === undefined ? 60 : evidence.goalMet ? 100 : 20;

  return [
    evidence.present.includes('goal-setting.json') ? 85 : 50,
    evidence.present.includes('scouting.json') ? 85 : 50,
    computeImplementationQualityScore(evidence),
    evidence.validation === 'passed' ? 100 : evidence.validation === 'failed' ? 0 : 50,
    completion,
    normalizeEvaluationScore(evidence),
  ];
}

function disabledPhases(evidence: Evidence): Set<string> {
  return new Set(Array.isArray(evidence.metadata.disabled_phases)
    ? evidence.metadata.disabled_phases.map(value => String(value).toLowerCase().replace(/[- ]/g, '_'))
    : []);
}

export function buildDimensions(evidence: Evidence) {
  const disabled = disabledPhases(evidence);
  const scores = sourceScores(evidence);
  const eligible = WEIGHTS.reduce((total, weight, index) => total + (disabled.has(PHASES[index]) ? 0 : weight), 0);
  return DIMENSIONS.map((id, index) => {
    const applicable = !disabled.has(PHASES[index]);
    const effective = calculateEffectiveWeight(WEIGHTS[index], applicable, eligible);
    const status = determineDimensionStatus(id, applicable, evidence.phaseReached[PHASES[index]], evidence.diffBytes, evidence.noChangeAccepted);
    const normalizedScore = scores[index];
    return {
      id,
      weight: WEIGHTS[index],
      effective_weight: effective,
      raw_measurements: { source_score: scores[index], retries: evidence.retries, model_tokens: (evidence.tokenUsage.input_tokens + evidence.tokenUsage.output_tokens) || null, cache_read_tokens: evidence.tokenUsage.cache_read_tokens },
      normalized_score: normalizedScore,
      weighted_points: calculateWeightedPoints(normalizedScore, effective),
      status,
      rationale: `Score derived from available ${id.replace(/_/g, ' ')} evidence.`,
      evidence: [],
      warnings: [],
    };
  });
}

export function buildPhases(evidence: Evidence): RunScorecard['phases'] {
  const disabled = disabledPhases(evidence);
  return Object.fromEntries(PHASES.map(phase => {
    const usage = evidence.phaseTokens[phase] ?? {
      input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
      unknown_tokens: 0, unavailable: true, completeness: 'unavailable' as const,
    };
    const isDisabled = disabled.has(phase);
    const outcome = determinePhaseOutcome(phase, evidence, isDisabled);
    return [phase, {
      phase,
      enabled: !isDisabled,
      outcome,
      started_at: null, ended_at: null, duration_ms: evidence.phaseDurationsMs[phase] ?? null, token_usage: usage,
      measurements: { retries: evidence.phaseRetries[phase] ?? 0 },
      completeness: isDisabled ? 'not_applicable' : usage.unavailable ? 'provisional' : 'complete',
      confidence: isDisabled ? 100 : usage.unavailable ? 50 : 100,
      evidence: [], warnings: [],
    }];
  })) as unknown as RunScorecard['phases'];
}
