#!/usr/bin/env node
import fs from 'node:fs';
import { once } from 'node:events';
import readline from 'node:readline';
import path from 'node:path';
import { TimestampTracker } from './timestamp-tracker.js';
import { extractEventTimestamp, PiEvent } from './lib/event-timestamp-helpers.js';
import { EventCounterAggregator, type EventCountMap } from './pi-event-aggregation/event-counter-aggregator.js';
import { ToolReliabilityAggregator, type ToolReliabilitySummary, type ToolStats } from './pi-event-aggregation/tool-reliability-aggregator.js';
import { ExecutionTimeAggregator, type ExecutionTimeSummary, type ExecutionStats } from './pi-event-aggregation/execution-time-aggregator.js';
import { TokenUsageAggregator, type TokenUsageSummary, type ModelTokenStats, type PhaseTokenStats } from './pi-event-aggregation/token-usage-aggregator.js';
import {
  type ProviderErrorSummary,
  extractProviderError,
} from './pi-event-filter-helpers.js';
import {
  extractEmptyAssistantTurn,
} from './pi-event-filter-helpers/empty-assistant-turn.js';
import {
  recordAssistantTurnState,
  type AssistantTurnState,
} from './pi-event-filter-helpers/assistant-turn-state.js';

export { extractProviderError };

// ============================================================================
// MAIN SCRIPT
// ============================================================================

interface Summary {
  selected_model: string;
  selected_api: string;
  event_counts: EventCountMap;
  assistant_event_counts: EventCountMap;
  tool_start_count: number;
  tool_end_count: number;
  invalid_json_lines: number;
  first_event_at: string | null;
  last_event_at: string | null;
  tool_reliability?: ToolReliabilitySummary;
  tool_stats?: ToolStats;
  execution_time?: ExecutionTimeSummary;
  execution_api_stats?: ExecutionStats;
  execution_tool_stats?: ExecutionStats;
  token_usage?: TokenUsageSummary;
  model_token_stats?: ModelTokenStats;
  phase_token_stats?: PhaseTokenStats;
  completion_usage?: ProviderCompletionUsage[];
  tool_output_usage?: ToolOutputUsageSummary;
  provider_errors?: ProviderErrorSummary[];
  primary_provider_error?: ProviderErrorSummary;
  inference_health?: InferenceHealthSummary;
  phase_budget?: PhaseBudgetSummary;
  model_reliability?: Record<string, ModelReliabilitySummary>;
  artifact_retention?: {
    retained_bytes: number;
    max_output_bytes: number;
    max_event_bytes: number;
    dropped_oversized_events: number;
    dropped_budget_events: number;
    output_budget_exhausted: boolean;
  };
}

/** Usage reported by the provider for one completed assistant response. */
interface ProviderCompletionUsage {
  phase: string;
  /** Stable orchestration attempt identity, distinct from the provider response ID. */
  attempt_id?: string;
  request_id?: string;
  turn: number;
  response_id?: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
}

interface TokenLedgerEntry extends ProviderCompletionUsage {
  context_tokens: number;
  /** Input tokens billed at the standard (cache-miss) input rate. */
  billed_input_tokens: number;
  /** Input tokens served from the provider cache and billed at the cache-read rate. */
  cached_input_tokens: number;
  estimated_input_cost_usd: number | null;
  estimated_cache_read_cost_usd: number | null;
  estimated_cache_write_cost_usd: number | null;
  estimated_output_cost_usd: number | null;
  estimated_cost_usd: number | null;
  pricing_source: 'configured' | 'unpriced';
  pricing_model: string | null;
}

interface ToolOutputUsageSummary {
  total_results: number;
  total_bytes: number;
  estimated_tokens: number;
  by_tool: Record<string, { results: number; bytes: number; estimated_tokens: number }>;
}

interface InferenceHealthSummary {
  transport_success: boolean;
  stream_success: boolean;
  tool_call_valid: boolean;
  agent_turn_success: boolean;
  provider_error_count: number;
  malformed_tool_call_count: number;
  prompt_token_budget: number;
  largest_context_tokens: number;
  prompt_token_budget_exceeded: boolean;
  context_compaction_recommended: boolean;
}

interface PhaseBudgetSummary {
  /** Budgets are advisory targets: they are reported, never enforced as run limits. */
  enforcement: 'soft_target';
  max_context_tokens: number;
  max_turns: number;
  max_tool_output_tokens: number;
  context_exceeded: boolean;
  turns_exceeded: boolean;
  tool_output_exceeded: boolean;
  exceeded: boolean;
}

interface ModelReliabilitySummary {
  input_tokens: number;
  output_tokens: number;
  observed_error_count: number;
  malformed_tool_call_count: number;
  observed_success: boolean;
}

function positiveIntEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeNumberEnv(name: string): number | null {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

interface TokenPricing {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

interface TokenPricingSchedule {
  base: TokenPricing;
  tiers: Array<{ minContextTokens: number; pricing: TokenPricing }>;
}

function tokenPricingFromValue(value: unknown): TokenPricing | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  const input = typeof entry.input_usd_per_mtoken === 'number' ? entry.input_usd_per_mtoken : null;
  const cacheRead = typeof entry.cache_read_usd_per_mtoken === 'number' ? entry.cache_read_usd_per_mtoken : null;
  const cacheWrite = typeof entry.cache_write_usd_per_mtoken === 'number' ? entry.cache_write_usd_per_mtoken : null;
  const output = typeof entry.output_usd_per_mtoken === 'number' ? entry.output_usd_per_mtoken : null;
  return [input, cacheRead, cacheWrite, output].every((rate) => rate !== null && Number.isFinite(rate) && rate >= 0)
    ? { input: input!, cacheRead: cacheRead!, cacheWrite: cacheWrite!, output: output! }
    : null;
}

function tokenPricingScheduleFromValue(value: unknown): TokenPricingSchedule | null {
  const base = tokenPricingFromValue(value);
  if (!base || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rawTiers: unknown[] = Array.isArray((value as Record<string, unknown>).tiers)
    ? (value as Record<string, unknown>).tiers as unknown[]
    : [];
  const tiers = rawTiers.flatMap((tier) => {
    if (!tier || typeof tier !== 'object' || Array.isArray(tier)) return [];
    const minContextTokens = (tier as Record<string, unknown>).min_context_tokens;
    const pricing = tokenPricingFromValue(tier);
    return typeof minContextTokens === 'number' && Number.isInteger(minContextTokens) && minContextTokens > 0 && pricing
      ? [{ minContextTokens, pricing }]
      : [];
  }).sort((left, right) => left.minContextTokens - right.minContextTokens);
  return { base, tiers };
}

function configuredTokenPricing(model: string, contextTokens: number): { pricing: TokenPricing; model: string } | null {
  try {
    const configured = JSON.parse(process.env.KASEKI_LLM_PRICING_JSON ?? '') as Record<string, unknown>;
    const normalizedModel = model.trim().toLowerCase();
    const matchedModel = Object.keys(configured).find((key) => key.trim().toLowerCase() === normalizedModel)
      ?? Object.keys(configured).find((key) => key === '*');
    if (matchedModel) {
      const schedule = tokenPricingScheduleFromValue(configured[matchedModel]);
      if (schedule) {
        const matchingTier = schedule.tiers.filter((tier) => contextTokens >= tier.minContextTokens).at(-1);
        return { pricing: matchingTier?.pricing ?? schedule.base, model: matchedModel };
      }
    }
  } catch { /* invalid optional catalog leaves the response explicitly unpriced */ }

  // Backwards-compatible single-rate fallback. It is intentionally opt-in:
  // docker-compose does not set it, so changing models cannot silently reuse it.
  const input = nonNegativeNumberEnv('KASEKI_LLM_INPUT_USD_PER_MTOKEN');
  const cacheRead = nonNegativeNumberEnv('KASEKI_LLM_CACHE_READ_USD_PER_MTOKEN');
  const cacheWrite = nonNegativeNumberEnv('KASEKI_LLM_CACHE_WRITE_USD_PER_MTOKEN');
  const output = nonNegativeNumberEnv('KASEKI_LLM_OUTPUT_USD_PER_MTOKEN');
  return [input, cacheRead, cacheWrite, output].every((rate) => rate !== null)
    ? { pricing: { input: input!, cacheRead: cacheRead!, cacheWrite: cacheWrite!, output: output! }, model: '*' }
    : null;
}

const MAX_FILTERED_EVENT_BYTES = positiveIntEnv('KASEKI_PI_EVENT_MAX_BYTES', 256 * 1024);
const MAX_FILTERED_OUTPUT_BYTES = positiveIntEnv('KASEKI_PI_EVENTS_MAX_BYTES', 16 * 1024 * 1024);
const CRITICAL_EVENT_RESERVE_BYTES = Math.min(1024 * 1024, Math.floor(MAX_FILTERED_OUTPUT_BYTES / 4));

function isCriticalRetentionEvent(event: PiEvent): boolean {
  const type = String(event.type ?? '').toLowerCase();
  const assistantType = String(event.assistantMessageEvent?.type ?? '').toLowerCase();
  return /error|agent_end|agentend|message_end|message_stop|tool_execution_end/.test(`${type} ${assistantType}`)
    || extractProviderError(event) !== null;
}

function buildModelReliability(
  modelStats: ModelTokenStats,
  providerErrors: ProviderErrorSummary[],
): Record<string, ModelReliabilitySummary> {
  return Object.fromEntries(Object.entries(modelStats).map(([model, stats]) => {
    const errors = providerErrors.filter((error) => error.model === model);
    return [model, {
      input_tokens: stats.input_tokens,
      output_tokens: stats.output_tokens,
      observed_error_count: errors.length,
      malformed_tool_call_count: errors.filter((error) => error.type === 'malformed_tool_call').length,
      observed_success: errors.length === 0,
    }];
  }));
}

type PiEventFilterState = {
  aggregator: EventCounterAggregator;
  toolReliability: ToolReliabilityAggregator;
  executionTime: ExecutionTimeAggregator;
  tokenUsage: TokenUsageAggregator;
  completionUsage: Map<string, ProviderCompletionUsage>;
  toolOutputUsage: ToolOutputUsageSummary;
  providerErrors: ProviderErrorSummary[];
  providerErrorKeys: Set<string>;
  assistantTurnStates: Map<string, AssistantTurnState>;
  tracker: TimestampTracker;
  invalidJsonLines: number;
  retainedBytes: number;
  droppedOversizedEvents: number;
  droppedBudgetEvents: number;
  outputBudgetExhausted: boolean;
  agentPhaseStart: number | null;
  lastPhase: string;
};

let rssSampler: NodeJS.Timeout | null = null;
let maxRssBytes = 0;

function startRssSampler(): void {
  if (process.env.PI_EVENT_FILTER_TRACK_RSS !== '1') return;
  maxRssBytes = process.memoryUsage().rss;
  rssSampler = setInterval(() => {
    maxRssBytes = Math.max(maxRssBytes, process.memoryUsage().rss);
  }, 25);
  rssSampler.unref();
}

function stopRssSampler(): void {
  if (process.env.PI_EVENT_FILTER_TRACK_RSS !== '1') return;
  if (rssSampler) {
    clearInterval(rssSampler);
    rssSampler = null;
  }
  maxRssBytes = Math.max(maxRssBytes, process.memoryUsage().rss);
  process.stderr.write(`MAX_RSS_BYTES=${maxRssBytes}
`);
}

function shouldKeep(event: PiEvent): boolean {
  const assistantType = event.assistantMessageEvent?.type;
  if (assistantType?.startsWith('thinking_')) return false;
  return true;
}

function sanitize(event: PiEvent): PiEvent {
  const copy = JSON.parse(JSON.stringify(event)) as PiEvent;
  if (copy.assistantMessageEvent?.partial?.content) {
    copy.assistantMessageEvent.partial.content =
      copy.assistantMessageEvent.partial.content.filter(
        (part) => part?.type !== 'thinking'
      );
  }
  if (copy.message?.content) {
    copy.message.content = copy.message.content.filter(
      (part) => part?.type !== 'thinking'
    );
  }
  return copy;
}

/**
 * Extract tool name from a Pi event.
 * Handles both tool_execution events and tool_call events.
 */
function extractToolName(event: PiEvent): string | null {
  // Handle tool_call events (e.g., hashline_edit)
  if ((event as any).tool_name) {
    return (event as any).tool_name;
  }
  if (typeof (event as any).toolName === 'string') return (event as any).toolName;
  if (typeof (event as any).tool?.name === 'string') return (event as any).tool.name;
  // Could extract from message content in future if needed
  return null;
}

function toolOutputBytes(event: PiEvent): number {
  const value = (event as any).result ?? (event as any).output ?? (event as any).message?.content;
  if (value === undefined || value === null) return 0;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return Buffer.byteLength(text);
}

/**
 * Extract message content from a tool_execution_end event for error detection.
 * Aggregates output_text parts and visible content.
 */
function extractToolOutput(event: PiEvent): string {
  const parts: string[] = [];

  if (event.message?.content && Array.isArray(event.message.content)) {
    for (const part of event.message.content) {
      if (part?.type === 'output_text' && part.text) {
        parts.push(part.text);
      }
    }
  }

  return parts.join(' ');
}

/**
 * Extract Unix timestamp in seconds from event timestamp.
 * Handles both ISO strings and Unix epoch numbers.
 */
function extractTimestampSeconds(event: PiEvent): number | null {
  const timestamp = (event as any).timestamp;
  if (!timestamp) return null;

  if (typeof timestamp === 'number') {
    // Already a Unix timestamp (ms or seconds)
    if (timestamp > 1e10) {
      // Likely milliseconds
      return timestamp / 1000;
    }
    return timestamp;
  }

  if (typeof timestamp === 'string') {
    // ISO 8601 string
    const ms = new Date(timestamp).getTime();
    return isNaN(ms) ? null : ms / 1000;
  }

  return null;
}

/**
 * Detect if this event marks the start of an agent invocation.
 */
function isAgentStart(event: PiEvent): boolean {
  return event.type === 'agent_start' || event.type === 'agentstart';
}

/**
 * Detect if this event marks the end of an agent invocation.
 */
function isAgentEnd(event: PiEvent): boolean {
  return event.type === 'agent_end' || event.type === 'agentend';
}

/**
 * Extract the phase name from an agent event (e.g., from assistantMessageEvent context).
 */
function extractPhase(event: PiEvent): string {
  // Try to infer phase from event context
  // This is a heuristic; actual phase names come from kaseki-agent.sh
  const context = (event as any).context || (event as any).phase || 'unknown';
  return typeof context === 'string' ? context : 'unknown';
}

/**
 * Extract usage information from a Pi event.
 * Looks for usage in message, assistantMessageEvent, or top-level usage field.
 */
function extractUsage(event: PiEvent): any {
  // Check message.usage (OpenRouter format)
  if ((event as any).message?.usage) {
    return (event as any).message.usage;
  }
  // Check top-level usage field
  if ((event as any).usage) {
    return (event as any).usage;
  }
  // Check assistantMessageEvent.usage
  if ((event as any).assistantMessageEvent?.usage) {
    return (event as any).assistantMessageEvent.usage;
  }
  return null;
}

// (isProviderErrorRetryable, classifyProviderError, extractProviderError moved to pi-event-filter-helpers.ts)
function numericUsageValue(usage: any, keys: string[]): number | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function extractResponseIdFromMessage(message: any): string | undefined {
  for (const value of [message?.responseId, message?.response_id]) {
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function extractResponseIdFromEvent(event: PiEvent): string | undefined {
  return (
    extractResponseIdFromMessage((event as any).message) ??
    extractResponseIdFromMessage((event as any).assistantMessageEvent?.message) ??
    extractResponseIdFromMessage((event as any).assistantMessageEvent?.partial)
  );
}

/**
 * Extract model name from event (for token usage association).
 */
function extractModelName(event: PiEvent): string {
  const model = (event as any).message?.model || (event as any).model || 'unknown';
  return typeof model === 'string' ? model : 'unknown';
}

function createFilterState(): PiEventFilterState {
  const phase = process.env.KASEKI_INFERENCE_PHASE || 'unknown';
  const tokenUsage = new TokenUsageAggregator();
  tokenUsage.setCurrentPhase(phase);
  return {
    aggregator: new EventCounterAggregator(),
    toolReliability: new ToolReliabilityAggregator(),
    executionTime: new ExecutionTimeAggregator(),
    tokenUsage,
    completionUsage: new Map(),
    toolOutputUsage: { total_results: 0, total_bytes: 0, estimated_tokens: 0, by_tool: {} },
    providerErrors: [],
    providerErrorKeys: new Set<string>(),
    assistantTurnStates: new Map<string, AssistantTurnState>(),
    tracker: new TimestampTracker(),
    invalidJsonLines: 0,
    retainedBytes: 0,
    droppedOversizedEvents: 0,
    droppedBudgetEvents: 0,
    outputBudgetExhausted: false,
    agentPhaseStart: null,
    lastPhase: 'unknown',
  };
}

function recordParsedEvent(event: PiEvent, state: PiEventFilterState): void {
  state.aggregator.recordEventType(event.type);

  const timestamp = extractEventTimestamp(event);
  if (timestamp) {
    state.tracker.record(timestamp);
  }

  state.aggregator.recordModelAndApi(event.message);
  state.aggregator.recordModelAndApi(event.assistantMessageEvent?.message);
  state.aggregator.recordModelAndApi(event.assistantMessageEvent?.partial);
  state.aggregator.recordAssistantEventType(event.assistantMessageEvent?.type);

  const usage = extractUsage(event);
  if (usage) {
    state.tokenUsage.recordUsage(extractModelName(event), usage);
    recordCompletionUsage(event, usage, state);
  }

  recordProviderErrors(event, state);
  recordAgentTiming(event, state);
  recordToolExecution(event, state);
}

function recordCompletionUsage(event: PiEvent, usage: any, state: PiEventFilterState): void {
  const input = numericUsageValue(usage, ['input', 'input_tokens', 'prompt_tokens']) ?? 0;
  const output = numericUsageValue(usage, ['output', 'output_tokens', 'completion_tokens']) ?? 0;
  const details = usage?.prompt_tokens_details ?? usage?.input_tokens_details ?? {};
  const cacheCreation = numericUsageValue(details, ['cache_creation_input_tokens', 'cache_creation_tokens'])
    ?? numericUsageValue(usage, ['cacheWrite', 'cache_write_tokens']) ?? 0;
  const cacheRead = numericUsageValue(details, ['cache_read_input_tokens', 'cache_read_tokens'])
    ?? numericUsageValue(usage, ['cacheRead', 'cache_read_tokens']) ?? 0;
  if (input + output + cacheCreation + cacheRead === 0) return;

  const responseId = extractResponseIdFromEvent(event);
  // Providers often emit the final usage on several stream events. Keep the
  // largest cumulative value for that response instead of double-counting it.
  const key = responseId || `event-${state.completionUsage.size + 1}`;
  const existing = state.completionUsage.get(key);
  const candidate: ProviderCompletionUsage = {
    phase: process.env.KASEKI_INFERENCE_PHASE || 'unknown',
    attempt_id: process.env.KASEKI_INFERENCE_ATTEMPT || undefined,
    request_id: process.env.KASEKI_INFERENCE_REQUEST_ID || undefined,
    turn: state.completionUsage.size + (existing ? 0 : 1),
    ...(responseId ? { response_id: responseId } : {}),
    model: extractModelName(event),
    input_tokens: input,
    output_tokens: output,
    cache_creation_tokens: cacheCreation,
    cache_read_tokens: cacheRead,
    total_tokens: input + output + cacheCreation + cacheRead,
  };
  if (!existing || candidate.total_tokens > existing.total_tokens) state.completionUsage.set(key, candidate);
}

function buildTokenLedger(completions: Iterable<ProviderCompletionUsage>): TokenLedgerEntry[] {
  return Array.from(completions, (completion) => {
    const context_tokens = completion.input_tokens + completion.cache_creation_tokens + completion.cache_read_tokens;
    const configuredPricing = configuredTokenPricing(completion.model, context_tokens);
    const pricing = configuredPricing?.pricing;
    const estimated_input_cost_usd = pricing ? completion.input_tokens * pricing.input / 1_000_000 : null;
    const estimated_cache_read_cost_usd = pricing ? completion.cache_read_tokens * pricing.cacheRead / 1_000_000 : null;
    const estimated_cache_write_cost_usd = pricing ? completion.cache_creation_tokens * pricing.cacheWrite / 1_000_000 : null;
    const estimated_output_cost_usd = pricing ? completion.output_tokens * pricing.output / 1_000_000 : null;
    const estimated_cost_usd = pricing
      ? estimated_input_cost_usd! + estimated_cache_read_cost_usd! + estimated_cache_write_cost_usd! + estimated_output_cost_usd!
      : null;
    return {
      ...completion,
      context_tokens,
      billed_input_tokens: completion.input_tokens,
      cached_input_tokens: completion.cache_read_tokens,
      estimated_input_cost_usd,
      estimated_cache_read_cost_usd,
      estimated_cache_write_cost_usd,
      estimated_output_cost_usd,
      estimated_cost_usd,
      pricing_source: pricing ? 'configured' : 'unpriced',
      pricing_model: configuredPricing?.model ?? null,
    };
  });
}

/**
 * Streaming providers can repeat the current response usage on several events.
 * `completionUsage` keeps the final maximum for each response ID, so derive
 * cost-facing aggregates from it rather than summing every streamed event.
 */
function summarizeCompletedResponses(completions: Iterable<ProviderCompletionUsage>): {
  tokenUsage: TokenUsageSummary;
  modelStats: ModelTokenStats;
  phaseStats: PhaseTokenStats;
} {
  const tokenUsage: TokenUsageSummary = {
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_cache_creation_tokens: 0,
    total_cache_read_tokens: 0,
    total_tokens: 0,
    cache_efficiency_percent: 0,
  };
  const modelStats: ModelTokenStats = {};
  const phaseStats: PhaseTokenStats = {};

  for (const completion of completions) {
    const add = (target: { input_tokens: number; output_tokens: number; cache_creation_tokens: number; cache_read_tokens: number; total_tokens: number }) => {
      target.input_tokens += completion.input_tokens;
      target.output_tokens += completion.output_tokens;
      target.cache_creation_tokens += completion.cache_creation_tokens;
      target.cache_read_tokens += completion.cache_read_tokens;
      target.total_tokens += completion.total_tokens;
    };
    tokenUsage.total_input_tokens += completion.input_tokens;
    tokenUsage.total_output_tokens += completion.output_tokens;
    tokenUsage.total_cache_creation_tokens += completion.cache_creation_tokens;
    tokenUsage.total_cache_read_tokens += completion.cache_read_tokens;
    tokenUsage.total_tokens += completion.total_tokens;

    const model = modelStats[completion.model] ??= { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, total_tokens: 0 };
    add(model);
    const phase = phaseStats[completion.phase] ??= { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, total_tokens: 0 };
    add(phase);
  }
  tokenUsage.cache_efficiency_percent = tokenUsage.total_tokens === 0
    ? 0
    : Math.round((tokenUsage.total_cache_read_tokens / tokenUsage.total_tokens) * 10000) / 100;
  return { tokenUsage, modelStats, phaseStats };
}

function recordProviderErrors(event: PiEvent, state: PiEventFilterState): void {
  recordAssistantTurnState(event, state.assistantTurnStates);
  const providerError = extractProviderError(event);
  if (providerError) {
    const key = JSON.stringify([
      providerError.type,
      providerError.response_id,
      providerError.status_code,
      providerError.error_code,
      providerError.message,
    ]);
    if (!state.providerErrorKeys.has(key)) {
      state.providerErrorKeys.add(key);
      state.providerErrors.push(providerError);
    }
  }
  const emptyAssistantTurn = extractEmptyAssistantTurn(event, state.assistantTurnStates);
  if (emptyAssistantTurn) {
    state.providerErrors.push(emptyAssistantTurn);
  }
}

function recordAgentTiming(event: PiEvent, state: PiEventFilterState): void {
  const timestampSecs = extractTimestampSeconds(event);
  if (isAgentStart(event)) {
    state.lastPhase = extractPhase(event);
    state.agentPhaseStart = timestampSecs;
    return;
  }
  if (isAgentEnd(event) && state.agentPhaseStart !== null && timestampSecs !== null) {
    const duration = timestampSecs - state.agentPhaseStart;
    if (duration >= 0) {
      state.executionTime.recordApiCall(state.lastPhase, duration);
    }
    state.agentPhaseStart = null;
  }
}

function recordToolExecution(event: PiEvent, state: PiEventFilterState): void {
  if (event.type === 'tool_execution_start') {
    state.aggregator.recordToolStart();
    state.toolReliability.recordToolStart(extractToolName(event));
  }
  if (event.type === 'tool_execution_end') {
    state.aggregator.recordToolEnd();
    state.toolReliability.recordToolEnd(extractToolOutput(event));
    const name = extractToolName(event) || 'unknown';
    const bytes = toolOutputBytes(event);
    const estimatedTokens = Math.ceil(bytes / 4);
    const stats = state.toolOutputUsage.by_tool[name] ?? { results: 0, bytes: 0, estimated_tokens: 0 };
    stats.results++;
    stats.bytes += bytes;
    stats.estimated_tokens += estimatedTokens;
    state.toolOutputUsage.by_tool[name] = stats;
    state.toolOutputUsage.total_results++;
    state.toolOutputUsage.total_bytes += bytes;
    state.toolOutputUsage.estimated_tokens += estimatedTokens;
  }
}

async function writeRetainedEvent(
  event: PiEvent,
  output: fs.WriteStream,
  state: PiEventFilterState,
): Promise<void> {
  if (!shouldKeep(event)) return;

  const serialized = `${JSON.stringify(sanitize(event))}\n`;
  const serializedBytes = Buffer.byteLength(serialized);
  if (serializedBytes > MAX_FILTERED_EVENT_BYTES) {
    state.droppedOversizedEvents++;
    return;
  }
  const eventBudget = isCriticalRetentionEvent(event)
    ? MAX_FILTERED_OUTPUT_BYTES
    : MAX_FILTERED_OUTPUT_BYTES - CRITICAL_EVENT_RESERVE_BYTES;
  if (state.retainedBytes + serializedBytes > eventBudget) {
    state.droppedBudgetEvents++;
    state.outputBudgetExhausted = true;
    return;
  }
  state.retainedBytes += serializedBytes;
  const canContinue = output.write(serialized);
  if (!canContinue) {
    await once(output, 'drain');
  }
}

function buildSummary(state: PiEventFilterState): Summary {
  const { tokenUsage: tokenSummary, modelStats, phaseStats } = summarizeCompletedResponses(state.completionUsage.values());
  const promptTokenBudget = positiveIntEnv('KASEKI_PROMPT_TOKEN_WARN_THRESHOLD', 20_000);
  // Compaction is a per-request decision. A run with many short turns should
  // not be flagged merely because its aggregate usage is high, while a single
  // uncached 45k-token request must be flagged immediately.
  const largestContextTokens = Math.max(
    0,
    ...Array.from(
      state.completionUsage.values(),
      (usage) => usage.input_tokens + usage.cache_creation_tokens + usage.cache_read_tokens,
    ),
  );
  const inferenceHealth = buildInferenceHealth(state, promptTokenBudget, largestContextTokens);
  const phaseBudget = buildPhaseBudget(state, promptTokenBudget, largestContextTokens);
  return {
    ...state.aggregator.summary(),
    invalid_json_lines: state.invalidJsonLines,
    artifact_retention: {
      retained_bytes: state.retainedBytes,
      max_output_bytes: MAX_FILTERED_OUTPUT_BYTES,
      max_event_bytes: MAX_FILTERED_EVENT_BYTES,
      dropped_oversized_events: state.droppedOversizedEvents,
      dropped_budget_events: state.droppedBudgetEvents,
      output_budget_exhausted: state.outputBudgetExhausted,
    },
    first_event_at: state.tracker.firstEpochMs() !== null ? new Date(state.tracker.firstEpochMs()!).toISOString() : state.tracker.firstTimestamp(),
    last_event_at: state.tracker.lastEpochMs() !== null ? new Date(state.tracker.lastEpochMs()!).toISOString() : state.tracker.lastTimestamp(),
    tool_reliability: state.toolReliability.getSummary(),
    tool_stats: state.toolReliability.getToolStats(),
    execution_time: state.executionTime.getSummary(),
    execution_api_stats: state.executionTime.getApiStats(),
    execution_tool_stats: state.executionTime.getToolStats(),
    token_usage: tokenSummary,
    model_token_stats: modelStats,
    phase_token_stats: phaseStats,
    completion_usage: [...state.completionUsage.values()],
    tool_output_usage: state.toolOutputUsage,
    inference_health: inferenceHealth,
    phase_budget: phaseBudget,
    model_reliability: buildModelReliability(modelStats, state.providerErrors),
    ...(state.providerErrors.length > 0 ? { provider_errors: state.providerErrors, primary_provider_error: state.providerErrors[0] } : {}),
  };
}

function buildInferenceHealth(
  state: PiEventFilterState,
  promptTokenBudget: number,
  largestContextTokens: number,
): InferenceHealthSummary {
  const malformedToolCallCount = state.providerErrors.filter((error) => error.type === 'malformed_tool_call').length;
  return {
    transport_success: state.invalidJsonLines === 0,
    stream_success: state.providerErrors.length === 0,
    tool_call_valid: malformedToolCallCount === 0,
    agent_turn_success: state.providerErrors.length === 0,
    provider_error_count: state.providerErrors.length,
    malformed_tool_call_count: malformedToolCallCount,
    prompt_token_budget: promptTokenBudget,
    largest_context_tokens: largestContextTokens,
    prompt_token_budget_exceeded: largestContextTokens > promptTokenBudget,
    context_compaction_recommended: largestContextTokens > promptTokenBudget,
  };
}

function buildPhaseBudget(
  state: PiEventFilterState,
  promptTokenBudget: number,
  largestContextTokens: number,
): PhaseBudgetSummary {
  const phaseBudget: PhaseBudgetSummary = {
    enforcement: 'soft_target',
    max_context_tokens: positiveIntEnv('KASEKI_PHASE_MAX_CONTEXT_TOKENS', promptTokenBudget),
    max_turns: positiveIntEnv('KASEKI_PHASE_MAX_TURNS', 24),
    max_tool_output_tokens: positiveIntEnv('KASEKI_PHASE_MAX_TOOL_OUTPUT_TOKENS', 12_000),
    context_exceeded: largestContextTokens > positiveIntEnv('KASEKI_PHASE_MAX_CONTEXT_TOKENS', promptTokenBudget),
    turns_exceeded: state.completionUsage.size > positiveIntEnv('KASEKI_PHASE_MAX_TURNS', 24),
    tool_output_exceeded: state.toolOutputUsage.estimated_tokens > positiveIntEnv('KASEKI_PHASE_MAX_TOOL_OUTPUT_TOKENS', 12_000),
    exceeded: false,
  };
  phaseBudget.exceeded = phaseBudget.context_exceeded || phaseBudget.turns_exceeded || phaseBudget.tool_output_exceeded;
  return phaseBudget;
}

function writeSummaryFiles(summaryPath: string, summary: Summary): void {
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  const ledger = buildTokenLedger(summary.completion_usage ?? []);
  const ledgerPath = path.join(path.dirname(summaryPath), 'token-ledger.jsonl');
  if (ledger.length > 0) {
    const existing = fs.existsSync(ledgerPath)
      ? fs.readFileSync(ledgerPath, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
        try { return [JSON.parse(line) as TokenLedgerEntry]; } catch { return []; }
      })
      : [];
    const entries = new Map<string, TokenLedgerEntry>();
    for (const entry of existing) entries.set(`${entry.phase}:${entry.attempt_id ?? ''}:${entry.response_id ?? entry.turn}`, entry);
    for (const entry of ledger) entries.set(`${entry.phase}:${entry.attempt_id ?? ''}:${entry.response_id ?? entry.turn}`, {
      timestamp: new Date().toISOString(),
      ...entry,
      resolved_model: process.env.KASEKI_RESOLVED_MODEL || entry.model,
    } as TokenLedgerEntry);
    fs.writeFileSync(ledgerPath, `${Array.from(entries.values()).map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  }
  if (path.basename(summaryPath) !== 'pi-summary.json') return;

  const providerErrors = summary.provider_errors ?? [];
  const inferenceHealth = summary.inference_health!;
  fs.writeFileSync(path.join(path.dirname(summaryPath), 'gateway-summary.json'), `${JSON.stringify({
    schema_version: 1,
    logical_agent_turns: summary.event_counts.message_end || 0,
    routing_steps: null,
    note: 'See token-ledger.jsonl for canonical per-response totals. routing_steps requires Cloudflare log enrichment.',
    input_tokens: summary.token_usage!.total_input_tokens,
    output_tokens: summary.token_usage!.total_output_tokens,
    provider_errors: providerErrors.length,
    malformed_tool_calls: inferenceHealth.malformed_tool_call_count,
    inference_health: inferenceHealth,
    model_reliability: summary.model_reliability,
    token_ledger: {
      artifact: 'token-ledger.jsonl',
      response_count: ledger.length,
      priced_response_count: ledger.filter((entry) => entry.estimated_cost_usd !== null).length,
      billed_input_tokens: ledger.reduce((total, entry) => total + entry.billed_input_tokens, 0),
      cached_input_tokens: ledger.reduce((total, entry) => total + entry.cached_input_tokens, 0),
      output_tokens: ledger.reduce((total, entry) => total + entry.output_tokens, 0),
      estimated_cost_usd: ledger.every((entry) => entry.estimated_cost_usd !== null)
        ? ledger.reduce((total, entry) => total + entry.estimated_cost_usd!, 0)
        : null,
    },
  }, null, 2)}\n`);
}

export async function runPiEventFilter(
  inputPath = '/tmp/pi-events.raw.jsonl',
  filteredPath = '/results/pi-events.jsonl',
  summaryPath = '/results/pi-summary.json',
): Promise<void> {
  startRssSampler();
  const input = fs.createReadStream(inputPath, { encoding: 'utf8' });
  const output = fs.createWriteStream(filteredPath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  const state = createFilterState();

  for await (const line of lines) {
    if (!line.trim()) continue;
    let event: PiEvent;
    try {
      event = JSON.parse(line);
    } catch {
      state.invalidJsonLines++;
      continue;
    }

    recordParsedEvent(event, state);
    await writeRetainedEvent(event, output, state);
  }

  await new Promise<void>((resolve) => output.end(resolve));
  writeSummaryFiles(summaryPath, buildSummary(state));
  stopRssSampler();
}

function isDirectCliExecution(): boolean {
  return process.argv[1]
    ? /(?:^|\/)(?:kaseki-)?pi-event-filter(?:\.(?:ts|js))?$/.test(process.argv[1])
    : false;
}

if (isDirectCliExecution()) {
  runPiEventFilter(process.argv[2], process.argv[3], process.argv[4]).catch((error: Error) => {
    stopRssSampler();
    console.error(error);
    process.exit(1);
  });
}
