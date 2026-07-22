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
import { TokenUsageAggregator, type TokenUsageSummary, type ModelTokenStats } from './pi-event-aggregation/token-usage-aggregator.js';
import {
  type ProviderErrorSummary,
  extractMessageTextLength,
  extractProviderError,
} from './pi-event-filter-helpers.js';

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
  provider_errors?: ProviderErrorSummary[];
  primary_provider_error?: ProviderErrorSummary;
  inference_health?: InferenceHealthSummary;
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

interface InferenceHealthSummary {
  transport_success: boolean;
  stream_success: boolean;
  tool_call_valid: boolean;
  agent_turn_success: boolean;
  provider_error_count: number;
  malformed_tool_call_count: number;
  prompt_token_budget: number;
  prompt_token_budget_exceeded: boolean;
  context_compaction_recommended: boolean;
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

interface AssistantTurnState {
  textLength: number;
  toolResultCount: number;
}

type PiEventFilterState = {
  aggregator: EventCounterAggregator;
  toolReliability: ToolReliabilityAggregator;
  executionTime: ExecutionTimeAggregator;
  tokenUsage: TokenUsageAggregator;
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
  // Could extract from message content in future if needed
  return null;
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
  return typeof message?.responseId === 'string' ? message.responseId : undefined;
}

function extractResponseIdFromEvent(event: PiEvent): string | undefined {
  return (
    extractResponseIdFromMessage((event as any).message) ??
    extractResponseIdFromMessage((event as any).assistantMessageEvent?.message) ??
    extractResponseIdFromMessage((event as any).assistantMessageEvent?.partial)
  );
}

function extractToolResultCount(event: PiEvent): number {
  const toolResults = (event as any).toolResults;
  if (Array.isArray(toolResults)) return toolResults.length;
  const messageToolCalls = (event as any).message?.toolCalls ?? (event as any).message?.tool_calls;
  if (Array.isArray(messageToolCalls)) return messageToolCalls.length;
  return 0;
}

function recordAssistantTurnState(event: PiEvent, states: Map<string, AssistantTurnState>): void {
  const responseId = extractResponseIdFromEvent(event);
  if (!responseId) return;

  const current = states.get(responseId) ?? { textLength: 0, toolResultCount: 0 };
  current.textLength += extractMessageTextLength((event as any).message);
  current.textLength += extractMessageTextLength((event as any).assistantMessageEvent?.message);
  current.textLength += extractMessageTextLength((event as any).assistantMessageEvent?.partial);
  current.toolResultCount += extractToolResultCount(event);
  states.set(responseId, current);
}

function extractEmptyAssistantTurn(event: PiEvent, states: Map<string, AssistantTurnState>): ProviderErrorSummary | null {
  const message = (event as any).message;
  if (!message || typeof message !== 'object' || message.role !== 'assistant') return null;

  const stopReason = typeof message.stopReason === 'string' ? message.stopReason.trim() : '';
  if (stopReason !== 'stop') return null;

  const usage = extractUsage(event);
  const outputTokens = numericUsageValue(usage, ['output', 'output_tokens', 'completion_tokens']);
  if (!outputTokens || outputTokens <= 0) return null;

  const responseId = extractResponseIdFromMessage(message);
  const priorState = responseId ? states.get(responseId) : undefined;
  if (
    extractMessageTextLength(message) > 0 ||
    extractToolResultCount(event) > 0 ||
    (priorState?.textLength ?? 0) > 0 ||
    (priorState?.toolResultCount ?? 0) > 0
  ) return null;

  const inputTokens = numericUsageValue(usage, ['input', 'input_tokens', 'prompt_tokens']);
  const totalTokens = numericUsageValue(usage, ['totalTokens', 'total_tokens', 'total']);
  const provider = typeof message.provider === 'string' ? message.provider : undefined;
  const api = typeof message.api === 'string' ? message.api : undefined;
  const model = typeof message.model === 'string' ? message.model : undefined;

  // Token-based classification: High token count with no output suggests provider infrastructure issue,
  // while low token count suggests possible config/auth/model problem
  const details = [
    provider ? `provider=${provider}` : '',
    api ? `api=${api}` : '',
    model ? `model=${model}` : '',
    responseId ? `response_id=${responseId}` : '',
    inputTokens !== undefined ? `input_tokens=${inputTokens}` : '',
    `output_tokens=${outputTokens}`,
    totalTokens !== undefined ? `total_tokens=${totalTokens}` : '',
  ].filter(Boolean).join(' ');

  return {
    type: 'provider_empty_assistant_turn',
    provider,
    api,
    model,
    stop_reason: stopReason,
    response_id: responseId,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    message: `Provider returned a successful stop response with output tokens but no assistant text or tool calls. ${details}`.trim(),
  };
}

/**
 * Extract model name from event (for token usage association).
 */
function extractModelName(event: PiEvent): string {
  const model = (event as any).message?.model || (event as any).model || 'unknown';
  return typeof model === 'string' ? model : 'unknown';
}

function createFilterState(): PiEventFilterState {
  return {
    aggregator: new EventCounterAggregator(),
    toolReliability: new ToolReliabilityAggregator(),
    executionTime: new ExecutionTimeAggregator(),
    tokenUsage: new TokenUsageAggregator(),
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
  }

  recordProviderErrors(event, state);
  recordAgentTiming(event, state);
  recordToolExecution(event, state);
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
  const tokenSummary = state.tokenUsage.getSummary();
  const modelStats = state.tokenUsage.getModelStats();
  const promptTokenBudget = positiveIntEnv('KASEKI_PROMPT_TOKEN_WARN_THRESHOLD', 20_000);
  const malformedToolCallCount = state.providerErrors.filter((error) => error.type === 'malformed_tool_call').length;
  const inferenceHealth: InferenceHealthSummary = {
    transport_success: state.invalidJsonLines === 0,
    stream_success: state.providerErrors.length === 0,
    tool_call_valid: malformedToolCallCount === 0,
    agent_turn_success: state.providerErrors.length === 0,
    provider_error_count: state.providerErrors.length,
    malformed_tool_call_count: malformedToolCallCount,
    prompt_token_budget: promptTokenBudget,
    prompt_token_budget_exceeded: tokenSummary.total_input_tokens > promptTokenBudget,
    context_compaction_recommended: tokenSummary.total_input_tokens > promptTokenBudget,
  };
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
    inference_health: inferenceHealth,
    model_reliability: buildModelReliability(modelStats, state.providerErrors),
    ...(state.providerErrors.length > 0 ? { provider_errors: state.providerErrors, primary_provider_error: state.providerErrors[0] } : {}),
  };
}

function writeSummaryFiles(summaryPath: string, summary: Summary): void {
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  if (path.basename(summaryPath) !== 'pi-summary.json') return;

  const providerErrors = summary.provider_errors ?? [];
  const inferenceHealth = summary.inference_health!;
  fs.writeFileSync(path.join(path.dirname(summaryPath), 'gateway-summary.json'), `${JSON.stringify({
    schema_version: 1,
    logical_agent_turns: summary.event_counts.message_end || 0,
    routing_steps: null,
    note: 'routing_steps requires Cloudflare log enrichment; logical turns exclude gateway-internal routing records.',
    input_tokens: summary.token_usage!.total_input_tokens,
    output_tokens: summary.token_usage!.total_output_tokens,
    provider_errors: providerErrors.length,
    malformed_tool_calls: inferenceHealth.malformed_tool_call_count,
    inference_health: inferenceHealth,
    model_reliability: summary.model_reliability,
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
