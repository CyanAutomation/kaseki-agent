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
    !evidence.present.includes('goal-setting.json') ? 0 : evidence.goalSettingFallback ? 35 : 85,
    !evidence.present.includes('scouting.json') ? 0 : evidence.scoutingFallback ? 35 : 85,
    computeImplementationQualityScore(evidence),
    evidence.validation === 'passed' ? 100 : evidence.validation === 'failed' ? 0 : 50,
    completion,
    normalizeEvaluationScore(evidence),
  ];
}

function artifactsForDimension(id: string): string[] {
  const artifacts: Record<string, string[]> = {
    goal_quality: ['goal-setting.json'],
    scouting_quality: ['scouting.json'],
    implementation_quality: ['git.diff', 'changed-files.txt', 'pi-summary.json'],
    validation_quality: ['validation.log', 'validation-timings.tsv', 'timings-manifest.json', 'failure.json'],
    goal_attainment: ['goal-check.json'],
    evaluation_quality: ['run-evaluation.json'],
  };
  return artifacts[id] ?? [];
}

function artifactsForPhase(phase: string): string[] {
  const artifacts: Record<string, string[]> = {
    goal_setting: ['goal-setting.json', 'goal-setting-summary.json'],
    scouting: ['scouting.json', 'scouting-summary.json', 'scouting-validation-errors.jsonl'],
    coding: ['pi-summary.json', 'pi-events.jsonl', 'git.diff', 'changed-files.txt'],
    validation: ['validation.log', 'validation-timings.tsv', 'timings-manifest.json', 'failure.json'],
    goal_check: ['goal-check.json', 'goal-check-attempts.jsonl'],
    run_evaluation: ['run-evaluation.json', 'run-evaluation-summary.json'],
  };
  return artifacts[phase] ?? [];
}

function evidenceReferences(evidence: Evidence, artifacts: string[], provisional = false) {
  return artifacts.filter(artifact => evidence.present.includes(artifact)).map(artifact => ({
    id: artifact,
    artifact,
    completeness: provisional ? 'provisional' as const : 'complete' as const,
  }));
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
      rationale: evidence.goalSettingFallback && id === 'goal_quality'
        ? 'Goal-setting used a fallback artifact; task-specific goal quality is weakly evidenced.'
        : evidence.scoutingFallback && id === 'scouting_quality'
          ? 'Scouting used a conservative fallback; relevance and coverage are not agent-verified.'
          : evidenceReferences(evidence, artifactsForDimension(id)).length
            ? `Score derived from ${evidenceReferences(evidence, artifactsForDimension(id)).map(item => item.artifact).join(', ')}.`
            : `No durable ${id.replace(/_/g, ' ')} evidence was found.`,
      evidence: evidenceReferences(evidence, artifactsForDimension(id),
        (id === 'goal_quality' && evidence.goalSettingFallback) || (id === 'scouting_quality' && evidence.scoutingFallback)),
      warnings: [
        ...(id === 'goal_quality' && evidence.goalSettingFallback ? ['Fallback goal-setting artifact; manual review advised.'] : []),
        ...(id === 'scouting_quality' && evidence.scoutingFallback ? ['Fallback scouting handoff; manual review advised.'] : []),
      ],
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
      evidence: evidenceReferences(evidence, artifactsForPhase(phase),
        (phase === 'goal_setting' && evidence.goalSettingFallback) || (phase === 'scouting' && evidence.scoutingFallback)),
      warnings: [
        ...(phase === 'goal_setting' && evidence.goalSettingFallback ? ['Goal-setting used a fallback artifact.'] : []),
        ...(phase === 'scouting' && evidence.scoutingFallback ? ['Scouting used a fallback handoff.'] : []),
      ],
    }];
  })) as unknown as RunScorecard['phases'];
}
