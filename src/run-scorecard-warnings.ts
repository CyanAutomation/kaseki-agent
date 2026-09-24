import type { Evidence } from './run-scorecard-evidence-types';
import { ScorecardContext } from './run-scorecard-context';

export function buildScorecardWarnings(evidence: Evidence, coverage: { missing: string[] }) {
  const config = ScorecardContext.getConfig();
  const modelTokens = evidence.tokenUsage.input_tokens + evidence.tokenUsage.output_tokens;
  return [
    ...coverage.missing.map(value => `Missing evidence: ${value}`),
    // Cache reads are reported separately in token_totals. They can carry a
    // materially different price and must not consume the model-output budget.
    ...(modelTokens > config.targets.tokens ? [`Token budget exceeded: ${modelTokens} model tokens used versus ${config.targets.tokens} target.`] : []),
    ...(evidence.tokenUsage.cache_read_tokens > 0 ? [`Cache reads observed: ${evidence.tokenUsage.cache_read_tokens} tokens (reported separately from the model token budget).`] : []),
    ...(!evidence.goalCheckAvailable ? ['Goal-check evaluator unavailable: objective attainment requires human review.'] : []),
    ...(!evidence.evaluatorAvailable ? ['Run evaluator unavailable: patch and validation evidence are reported separately; score capped below A.'] : []),
    ...(evidence.status === 'failed' || evidence.status === 'timed_out' || evidence.status === 'cancelled'
      ? [`Score capped at 59 because the run lifecycle ended as ${evidence.status}.`] : []),
    ...(evidence.diffBytes === 0 && !evidence.noChangeAccepted && evidence.validation === 'unknown'
      ? ['Score capped at 49 because both durable patch and validation evidence are missing.']
      : evidence.diffBytes === 0 && !evidence.noChangeAccepted
        ? ['Score capped at 69 because no durable patch was recorded.']
        : evidence.validation === 'unknown'
          ? ['Score capped at 59 because validation outcome is unknown.'] : []),
  ];
}

export default buildScorecardWarnings;
