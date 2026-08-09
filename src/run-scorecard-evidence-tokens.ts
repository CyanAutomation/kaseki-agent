import { TokenUsageAggregator, type UsageObject } from './pi-event-aggregation/token-usage-aggregator';
import type { Evidence } from './run-scorecard-evidence-types';
import { number, object } from './run-scorecard-evidence-values';

const phases = ['goal_setting', 'scouting', 'coding', 'validation', 'goal_check', 'run_evaluation'] as const;
function canonicalPhase(value: string): typeof phases[number] {
  const normalized = value.toLowerCase().replace(/[- ]/g, '_');
  return (phases as readonly string[]).includes(normalized) ? normalized as typeof phases[number] : 'coding';
}
function normalizedUsage(raw: Record<string, unknown>): UsageObject {
  return {
    prompt_tokens: number(raw.prompt_tokens) ?? number(raw.total_input_tokens) ?? number(raw.input_tokens),
    completion_tokens: number(raw.completion_tokens) ?? number(raw.total_output_tokens) ?? number(raw.output_tokens),
    input: number(raw.input), output: number(raw.output),
    cacheRead: number(raw.cacheRead) ?? number(raw.total_cache_read_tokens) ?? number(raw.cache_read_tokens),
    cacheWrite: number(raw.cacheWrite) ?? number(raw.total_cache_creation_tokens) ?? number(raw.cache_creation_tokens),
    prompt_tokens_details: object(raw.prompt_tokens_details) as UsageObject['prompt_tokens_details'],
  };
}
function hasUsage(value: UsageObject): boolean {
  return [value.prompt_tokens, value.completion_tokens, value.input, value.output, value.cacheRead, value.cacheWrite]
    .some(item => number(item) !== undefined) || value.prompt_tokens_details !== undefined;
}

export function aggregateTokenUsage(summaries: unknown[]): Pick<Evidence, 'tokens' | 'tokenUsage' | 'phaseTokens' | 'unknownTokenRequests'> {
  const aggregator = new TokenUsageAggregator();
  const identities = new Set<string>();
  let unknown = 0;
  summaries.forEach((raw, index) => {
    const summary = object(raw);
    if (!summary) return;
    const phase = canonicalPhase(String(summary.phase ?? summary.stage ?? 'coding'));
    const responseId = summary.response_id ?? summary.id;
    const requestId = summary.request_id;
    const turn = number(summary.turn);
    const identity = responseId !== undefined
      ? `${phase}:response:${String(responseId)}`
      : requestId !== undefined && turn !== undefined
        ? `${phase}:request:${String(requestId)}:turn:${turn}`
        : `${phase}:${String(requestId ?? index)}`;
    if (identities.has(identity)) return;
    identities.add(identity);
    const usage = normalizedUsage(object(summary.usage) ?? object(summary.token_usage) ?? summary);
    if (!hasUsage(usage)) { unknown += 1; return; }
    aggregator.setCurrentPhase(phase);
    aggregator.recordUsage(String(summary.model ?? summary.selected_model ?? 'unknown'), usage);
  });
  const totals = aggregator.getSummary();
  const phaseTokens: Evidence['phaseTokens'] = {};
  for (const [phase, usage] of Object.entries(aggregator.getPhaseStats())) {
    phaseTokens[phase] = {
      input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
      cache_read_tokens: usage.cache_read_tokens, cache_write_tokens: usage.cache_creation_tokens,
      unknown_tokens: 0, unavailable: false, completeness: 'complete',
    };
  }
  return {
    tokens: totals.total_tokens || undefined,
    tokenUsage: {
      input_tokens: totals.total_input_tokens, output_tokens: totals.total_output_tokens,
      cache_read_tokens: totals.total_cache_read_tokens, cache_write_tokens: totals.total_cache_creation_tokens,
      unknown_tokens: unknown, unavailable: totals.total_tokens === 0,
      completeness: totals.total_tokens === 0 ? 'unavailable' : unknown > 0 ? 'provisional' : 'complete',
    },
    phaseTokens, unknownTokenRequests: unknown,
  };
}

export function providerRetryCounts(snapshot: { json: Record<string, unknown>; text: Record<string, string> }): Record<string, number> {
  const attempts = snapshot.text['provider-attempts.jsonl'] ?? '';
  const retriesByPhase = new Map<string, number>();
  for (const line of attempts.split(/\r?\n/)) {
    try {
      const entry = object(JSON.parse(line));
      if (!entry) continue;
      const match = String(entry.attempt ?? '').match(/(?:^|[-_])(\d+)$/);
      if (!match || Number(match[1]) <= 1) continue;
      const phase = canonicalPhase(String(entry.phase ?? 'coding'));
      // provider-attempts.jsonl records each provider invocation. Every
      // primary-N row after primary-1 is one extra billed inference attempt;
      // count rows, not words or artifact filenames.
      retriesByPhase.set(phase, (retriesByPhase.get(phase) ?? 0) + 1);
    } catch { /* a partially written JSONL line is not retry evidence */ }
  }
  return Object.fromEntries(retriesByPhase);
}

export function countRetries(snapshot: { json: Record<string, unknown>; text: Record<string, string> }): number {
  return Object.values(providerRetryCounts(snapshot)).reduce((total, retries) => total + retries, 0);
}
