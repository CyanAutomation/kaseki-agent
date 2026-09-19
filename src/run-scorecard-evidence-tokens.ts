import { TokenUsageAggregator } from './pi-event-aggregation/token-usage-aggregator';
import type { Evidence } from './run-scorecard-evidence-types';
import { number, object } from './run-scorecard-guards';
import {
  canonicalPhase,
  hasUsage,
  generateIdentity,
  extractUsageFromSummary,
  extractModelName,
} from './run-scorecard-evidence-tokens-accounting';

export { providerRetryCounts, countRetries } from './run-scorecard-evidence-retries';
export { canonicalPhase, extractUsageFromSummary, extractModelName } from './run-scorecard-evidence-tokens-accounting';

export function aggregateTokenUsage(summaries: unknown[]): Pick<Evidence, 'tokens' | 'tokenUsage' | 'phaseTokens' | 'unknownTokenRequests'> {
  const aggregator = new TokenUsageAggregator();
  const identities = new Set<string>();
  let unknown = 0;

  summaries.forEach((raw, index) => {
    const summary = object(raw);
    if (!summary) return;

    // Extract phase and identity
    const phase = canonicalPhase(String(summary.phase ?? summary.stage ?? 'coding'));
    const responseId = summary.response_id ?? summary.id;
    const requestId = summary.request_id;
    const turn = number(summary.turn);
    const identity = generateIdentity(phase, responseId, requestId, turn, index);

    // Skip duplicates
    if (identities.has(identity)) return;
    identities.add(identity);

    // Extract and validate usage
    const usage = extractUsageFromSummary(summary as Record<string, unknown>);
    if (!hasUsage(usage)) {
      unknown += 1;
      return;
    }

    // Record with aggregator
    const model = extractModelName(summary as Record<string, unknown>);
    aggregator.setCurrentPhase(phase);
    aggregator.recordUsage(model, usage);
  });

  // Aggregate results
  const totals = aggregator.getSummary();
  const phaseTokens: Evidence['phaseTokens'] = {};
  for (const [phase, usage] of Object.entries(aggregator.getPhaseStats())) {
    phaseTokens[phase] = {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_tokens: usage.cache_read_tokens,
      cache_write_tokens: usage.cache_creation_tokens,
      unknown_tokens: 0,
      unavailable: false,
      completeness: 'complete',
    };
  }

  return {
    tokens: totals.total_tokens || undefined,
    tokenUsage: {
      input_tokens: totals.total_input_tokens,
      output_tokens: totals.total_output_tokens,
      cache_read_tokens: totals.total_cache_read_tokens,
      cache_write_tokens: totals.total_cache_creation_tokens,
      unknown_tokens: unknown,
      unavailable: totals.total_tokens === 0,
      completeness: totals.total_tokens === 0 ? 'unavailable' : unknown > 0 ? 'provisional' : 'complete',
    },
    phaseTokens,
    unknownTokenRequests: unknown,
  };
}
