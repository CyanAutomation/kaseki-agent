import type { Evidence } from './run-scorecard-evidence';
import type { ScorecardConfig } from './run-scorecard-config';
import type { RunScorecard } from './types/run-scorecard';

export const DIMENSIONS = ['goal_quality', 'scouting_quality', 'implementation_quality', 'validation_quality', 'goal_attainment', 'evaluation_quality'] as const;
const PHASES = ['goal_setting', 'scouting', 'coding', 'validation', 'goal_check', 'run_evaluation'] as const;
export const WEIGHTS = [.15, .1, .3, .25, .15, .05];

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
function efficiency(actual: number | undefined, target: number): number {
  return actual === undefined ? 50 : clamp(100 * Math.min(1, target / Math.max(1, actual)));
}

function sourceScores(evidence: Evidence, config: ScorecardConfig): number[] {
  const completion = evidence.goalMet === undefined ? 60 : evidence.goalMet ? 100 : 20;
  const evaluationScore = typeof evidence.evaluation?.task_completion_score === 'number'
    ? evidence.evaluation.task_completion_score
    : typeof evidence.evaluation?.score === 'number'
      ? evidence.evaluation.score
      : evidence.evaluatorAvailable ? 80 : 0;
  return [
    completion,
    evidence.present.includes('scouting.json') ? 85 : 50,
    evidence.diffBytes === 0 ? 0 : clamp(80 + .2 * (
      (efficiency(evidence.elapsedSeconds, config.targets.elapsedSeconds)
        + efficiency(evidence.tokens, config.targets.tokens)
        + efficiency(evidence.retries, config.targets.retries)) / 3)),
    evidence.validation === 'passed' ? 100 : evidence.validation === 'failed' ? 0 : 50,
    completion,
    clamp(evaluationScore - (Array.isArray(evidence.evaluation?.contradictions) ? evidence.evaluation.contradictions.length * 15 : 0)),
  ];
}

function disabledPhases(evidence: Evidence): Set<string> {
  return new Set(Array.isArray(evidence.metadata.disabled_phases)
    ? evidence.metadata.disabled_phases.map(value => String(value).toLowerCase().replace(/[- ]/g, '_'))
    : []);
}

export function buildDimensions(evidence: Evidence, config: ScorecardConfig) {
  const disabled = disabledPhases(evidence);
  const scores = sourceScores(evidence, config);
  const eligible = WEIGHTS.reduce((total, weight, index) => total + (disabled.has(PHASES[index]) ? 0 : weight), 0);
  return DIMENSIONS.map((id, index) => {
    const applicable = !disabled.has(PHASES[index]);
    const effective = applicable ? WEIGHTS[index] / eligible : 0;
    return {
      id,
      weight: WEIGHTS[index],
      effective_weight: effective,
      raw_measurements: { source_score: scores[index], retries: evidence.retries, tokens: evidence.tokens ?? null },
      normalized_score: scores[index],
      weighted_points: Number((scores[index] * effective).toFixed(2)),
      status: !applicable ? 'not_applicable' : id === 'implementation_quality' && evidence.diffBytes === 0 ? 'unavailable' : 'complete',
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
    return [phase, {
      phase,
      enabled: !disabled.has(phase),
      outcome: disabled.has(phase)
        ? 'skipped'
        : evidence.status === 'cancelled' || evidence.status === 'running'
          ? 'not_started'
          : phase === 'validation' && evidence.validation === 'failed' ? 'failed'
            : phase === 'goal_check' && evidence.goalCheckFailed ? 'failed'
              : phase === 'run_evaluation' && !evidence.evaluatorAvailable ? 'failed'
              : 'succeeded',
      started_at: null, ended_at: null, duration_ms: null, token_usage: usage,
      measurements: { retries: evidence.phaseRetries[phase] ?? 0 },
      completeness: disabled.has(phase) ? 'not_applicable' : usage.unavailable ? 'provisional' : 'complete',
      confidence: disabled.has(phase) ? 100 : usage.unavailable ? 50 : 100,
      evidence: [], warnings: [],
    }];
  })) as unknown as RunScorecard['phases'];
}
