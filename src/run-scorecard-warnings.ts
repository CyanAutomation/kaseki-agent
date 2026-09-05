import type { Evidence } from './run-scorecard-evidence-types';
import type { ScorecardConfig } from './run-scorecard-config';

export function buildScorecardWarnings(evidence: Evidence, coverage: { missing: string[] }, config: ScorecardConfig) {
  return [
    ...coverage.missing.map(value => `Missing evidence: ${value}`),
    ...(evidence.tokens !== undefined && evidence.tokens > config.targets.tokens ? [`Token budget exceeded: ${evidence.tokens} used versus ${config.targets.tokens} target.`] : []),
    ...(!evidence.goalCheckAvailable ? ['Goal-check evaluator unavailable: objective attainment requires human review.'] : []),
    ...(!evidence.evaluatorAvailable ? ['Run evaluator unavailable: patch and validation evidence are reported separately; score capped below A.'] : []),
  ];
}

export default buildScorecardWarnings;
