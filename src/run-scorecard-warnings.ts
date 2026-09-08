import type { Evidence } from './run-scorecard-evidence-types';
import type { ScorecardConfig } from './run-scorecard-config';

export function buildScorecardWarnings(evidence: Evidence, coverage: { missing: string[] }, config: ScorecardConfig) {
  const modelTokens = evidence.tokenUsage.input_tokens + evidence.tokenUsage.output_tokens;
  return [
    ...coverage.missing.map(value => `Missing evidence: ${value}`),
    // Cache reads are reported separately in token_totals. They can carry a
    // materially different price and must not consume the model-output budget.
    ...(modelTokens > config.targets.tokens ? [`Token budget exceeded: ${modelTokens} model tokens used versus ${config.targets.tokens} target.`] : []),
    ...(evidence.tokenUsage.cache_read_tokens > 0 ? [`Cache reads observed: ${evidence.tokenUsage.cache_read_tokens} tokens (reported separately from the model token budget).`] : []),
    ...(!evidence.goalCheckAvailable ? ['Goal-check evaluator unavailable: objective attainment requires human review.'] : []),
    ...(!evidence.evaluatorAvailable ? ['Run evaluator unavailable: patch and validation evidence are reported separately; score capped below A.'] : []),
  ];
}

export default buildScorecardWarnings;
