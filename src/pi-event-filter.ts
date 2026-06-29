#!/usr/bin/env node
import fs from 'node:fs';
import { once } from 'node:events';
import readline from 'node:readline';
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
}

interface AssistantTurnState {
  textLength: number;
  toolResultCount: number;
}

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

export async function runPiEventFilter(
  inputPath = '/tmp/pi-events.raw.jsonl',
  filteredPath = '/results/pi-events.jsonl',
  summaryPath = '/results/pi-summary.json',
): Promise<void> {
  startRssSampler();
  const input = fs.createReadStream(inputPath, { encoding: 'utf8' });
  const output = fs.createWriteStream(filteredPath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  const aggregator = new EventCounterAggregator();
  const toolReliability = new ToolReliabilityAggregator();
  const executionTime = new ExecutionTimeAggregator();
  const tokenUsage = new TokenUsageAggregator();
  const providerErrors: ProviderErrorSummary[] = [];
  const assistantTurnStates = new Map<string, AssistantTurnState>();
  const tracker = new TimestampTracker();
  let invalidJsonLines = 0;

  // Track agent phase timing
  let agentPhaseStart: number | null = null;
  let lastPhase = 'unknown';

  for await (const line of lines) {
    if (!line.trim()) continue;
    let event: PiEvent;
    try {
      event = JSON.parse(line);
    } catch {
      invalidJsonLines++;
      continue;
    }

    // Record event type
    aggregator.recordEventType(event.type);

    // Track timestamp
    const timestamp = extractEventTimestamp(event);
    if (timestamp) {
      tracker.record(timestamp);
    }

    // Record model and API observations
    aggregator.recordModelAndApi(event.message);
    aggregator.recordModelAndApi(event.assistantMessageEvent?.message);
    aggregator.recordModelAndApi(event.assistantMessageEvent?.partial);

    // Record assistant event type
    const assistantType = event.assistantMessageEvent?.type;
    aggregator.recordAssistantEventType(assistantType);

    // Track token usage from events
    const usage = extractUsage(event);
    if (usage) {
      const modelName = extractModelName(event);
      tokenUsage.recordUsage(modelName, usage);
    }
    recordAssistantTurnState(event, assistantTurnStates);
    const providerError = extractProviderError(event);
    if (providerError) {
      providerErrors.push(providerError);
    }
    const emptyAssistantTurn = extractEmptyAssistantTurn(event, assistantTurnStates);
    if (emptyAssistantTurn) {
      providerErrors.push(emptyAssistantTurn);
    }

    // Track agent timing (API invocation time)
    const timestampSecs = extractTimestampSeconds(event);
    if (isAgentStart(event)) {
      const phase = extractPhase(event);
      lastPhase = phase;
      agentPhaseStart = timestampSecs;
    } else if (isAgentEnd(event) && agentPhaseStart !== null && timestampSecs !== null) {
      const duration = timestampSecs - agentPhaseStart;
      if (duration >= 0) {
        executionTime.recordApiCall(lastPhase, duration);
      }
      agentPhaseStart = null;
    }

    // Track tool executions with reliability metrics
    if (event.type === 'tool_execution_start') {
      aggregator.recordToolStart();
      const toolName = extractToolName(event);
      toolReliability.recordToolStart(toolName);
    }
    if (event.type === 'tool_execution_end') {
      aggregator.recordToolEnd();
      const toolOutput = extractToolOutput(event);
      toolReliability.recordToolEnd(toolOutput);
    }

    // Write event if it should be kept
    if (shouldKeep(event)) {
      const canContinue = output.write(`${JSON.stringify(sanitize(event))}\n`);
      if (!canContinue) {
        await once(output, 'drain');
      }
    }
  }

  await new Promise<void>((resolve) => output.end(resolve));

  // Generate summary
  const summary: Summary = {
    ...aggregator.summary(),
    invalid_json_lines: invalidJsonLines,
    first_event_at: tracker.firstEpochMs() !== null ? new Date(tracker.firstEpochMs()!).toISOString() : tracker.firstTimestamp(),
    last_event_at: tracker.lastEpochMs() !== null ? new Date(tracker.lastEpochMs()!).toISOString() : tracker.lastTimestamp(),
    tool_reliability: toolReliability.getSummary(),
    tool_stats: toolReliability.getToolStats(),
    execution_time: executionTime.getSummary(),
    execution_api_stats: executionTime.getApiStats(),
    execution_tool_stats: executionTime.getToolStats(),
    token_usage: tokenUsage.getSummary(),
    model_token_stats: tokenUsage.getModelStats(),
    ...(providerErrors.length > 0 ? { provider_errors: providerErrors, primary_provider_error: providerErrors[0] } : {}),
  };

  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
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
