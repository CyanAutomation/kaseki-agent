#!/usr/bin/env node
import fs from 'node:fs';
import { once } from 'node:events';
import readline from 'node:readline';
import { TimestampTracker } from './timestamp-tracker.js';
import { extractEventTimestamp, PiEvent } from './lib/event-timestamp-helpers.js';

// ============================================================================
// AGGREGATOR CLASSES (consolidated from separate modules to eliminate import issues)
// ============================================================================

// === EventCounterAggregator ===

interface EventCountMap {
  [key: string]: number;
}

interface AggregatorSummary {
  selected_model: string;
  selected_api: string;
  event_counts: EventCountMap;
  assistant_event_counts: EventCountMap;
  tool_start_count: number;
  tool_end_count: number;
}

const MAX_DISTINCT_SUMMARY_KEYS = 1000;
const OTHER_BUCKET_KEY = '__other__';

/**
 * EventCounterAggregator manages counter maps for event stream aggregation.
 *
 * Responsibilities:
 * - Track event type counts with cardinality cap
 * - Track assistant message type counts
 * - Observe and count models and APIs
 * - Track tool execution start/end events
 * - Provide summarized output with top model/API selected
 */
class EventCounterAggregator {
  private eventCounts: EventCountMap = {};
  private assistantEventCounts: EventCountMap = {};
  private models: EventCountMap = {};
  private apis: EventCountMap = {};
  private toolStartCount = 0;
  private toolEndCount = 0;

  /**
   * Increment a counter in a map with cardinality cap.
   * Once a map reaches MAX_DISTINCT_SUMMARY_KEYS entries, new unseen keys
   * are folded into the "__other__" bucket.
   */
  private incrementMap(
    map: EventCountMap,
    key: string | undefined,
    maxDistinctKeys: number = MAX_DISTINCT_SUMMARY_KEYS
  ): void {
    if (!key) return;

    let targetKey = key;
    if (
      map[key] === undefined &&
      Object.keys(map).filter((k) => k !== OTHER_BUCKET_KEY).length >= maxDistinctKeys
    ) {
      targetKey = OTHER_BUCKET_KEY;
    }
    map[targetKey] = (map[targetKey] ?? 0) + 1;
  }

  /**
   * Record an event type observation.
   */
  recordEventType(eventType: string | undefined): void {
    this.incrementMap(this.eventCounts, eventType ?? '<missing>', MAX_DISTINCT_SUMMARY_KEYS);
  }

  /**
   * Record an assistant message type observation.
   */
  recordAssistantEventType(assistantType: string | undefined): void {
    this.incrementMap(
      this.assistantEventCounts,
      assistantType,
      MAX_DISTINCT_SUMMARY_KEYS
    );
  }

  /**
   * Record model and API observations from a message object.
   */
  recordModelAndApi(message: any): void {
    if (!message || typeof message !== 'object') return;
    this.incrementMap(this.models, message.model, MAX_DISTINCT_SUMMARY_KEYS);
    this.incrementMap(this.apis, message.api, MAX_DISTINCT_SUMMARY_KEYS);
  }

  /**
   * Record a tool execution start event.
   */
  recordToolStart(): void {
    this.toolStartCount++;
  }

  /**
   * Record a tool execution end event.
   */
  recordToolEnd(): void {
    this.toolEndCount++;
  }

  /**
   * Get the top model by frequency.
   */
  private topByFrequency(map: EventCountMap): string {
    return Object.entries(map).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  }

  /**
   * Generate summary with selected model/API and all counters.
   */
  summary(): AggregatorSummary {
    return {
      selected_model: this.topByFrequency(this.models),
      selected_api: this.topByFrequency(this.apis),
      event_counts: this.eventCounts,
      assistant_event_counts: this.assistantEventCounts,
      tool_start_count: this.toolStartCount,
      tool_end_count: this.toolEndCount,
    };
  }
}

// === ToolReliabilityAggregator ===

interface ToolReliabilitySummary {
  total_tool_calls: number;
  successful_tool_calls: number;
  failed_tool_calls: number;
  success_rate_percent: number;
}

interface ToolStats {
  [toolName: string]: {
    total: number;
    successful: number;
    failed: number;
    success_rate_percent: number;
  };
}

const ERROR_PATTERNS = [
  'error',
  'failed',
  'failure',
  'exception',
  'cannot',
  'unable to',
  'invalid',
  'undefined',
  'null',
  'not found',
  'does not exist',
  'exit code',
  'exited with code',
];

/**
 * ToolReliabilityAggregator tracks the success/failure rate of tool calls.
 *
 * It uses pattern-based error detection to classify tool outcomes:
 * - Success: tool_execution_end with no error patterns in message
 * - Failure: tool_execution_end with one or more error patterns detected
 *
 * Per-tool statistics are tracked separately from overall summary.
 */
class ToolReliabilityAggregator {
  private totalToolCalls = 0;
  private successfulToolCalls = 0;
  private failedToolCalls = 0;

  // Per-tool tracking: toolName -> { total, successful, failed }
  private toolStats: Map<
    string,
    { total: number; successful: number; failed: number }
  > = new Map();

  private currentToolName: string | null = null;

  /**
   * Detect error patterns in a message string (case-insensitive).
   */
  private detectError(message: string | null | undefined): boolean {
    if (!message || typeof message !== 'string') return false;
    const lowerMessage = message.toLowerCase();
    return ERROR_PATTERNS.some((pattern) => lowerMessage.includes(pattern));
  }

  /**
   * Record the start of a tool execution (with optional tool name).
   */
  recordToolStart(toolName: string | null = null): void {
    this.currentToolName = toolName || `tool_${this.totalToolCalls}`;
  }

  /**
   * Record the end of a tool execution with its output message.
   * Analyzes the message for error patterns to determine success/failure.
   */
  recordToolEnd(message: string | null | undefined): void {
    const toolName = this.currentToolName || `tool_${this.totalToolCalls}`;
    const isError = this.detectError(message);

    this.totalToolCalls += 1;

    if (isError) {
      this.failedToolCalls += 1;
    } else {
      this.successfulToolCalls += 1;
    }

    // Track per-tool statistics
    const existing = this.toolStats.get(toolName) || {
      total: 0,
      successful: 0,
      failed: 0,
    };
    existing.total += 1;
    if (isError) {
      existing.failed += 1;
    } else {
      existing.successful += 1;
    }
    this.toolStats.set(toolName, existing);

    this.currentToolName = null;
  }

  /**
   * Get the overall success/failure summary.
   */
  getSummary(): ToolReliabilitySummary {
    const successRate =
      this.totalToolCalls === 0
        ? 0
        : Math.round(
          (this.successfulToolCalls / this.totalToolCalls) * 10000
        ) / 100;

    return {
      total_tool_calls: this.totalToolCalls,
      successful_tool_calls: this.successfulToolCalls,
      failed_tool_calls: this.failedToolCalls,
      success_rate_percent: successRate,
    };
  }

  /**
   * Get per-tool success rates.
   */
  getToolStats(): ToolStats {
    const result: ToolStats = {};

    for (const [toolName, stats] of this.toolStats.entries()) {
      const successRate =
        stats.total === 0
          ? 0
          : Math.round((stats.successful / stats.total) * 10000) / 100;

      result[toolName] = {
        total: stats.total,
        successful: stats.successful,
        failed: stats.failed,
        success_rate_percent: successRate,
      };
    }

    return result;
  }
}

// === ExecutionTimeAggregator ===

interface ExecutionTimeSummary {
  api_time_seconds: number;
  tool_time_seconds: number;
  total_time_seconds: number;
  api_percent: number;
  tool_percent: number;
}

interface ExecutionStats {
  [identifier: string]: {
    calls: number;
    total_seconds: number;
  };
}

/**
 * ExecutionTimeAggregator tracks wall time spent in two categories:
 * 1. API calls (Pi agent invocations, scouting, goal-check, etc.)
 * 2. Tool execution (npm, git, bash, validation commands)
 *
 * This breakdown helps identify if the bottleneck is API latency or tool execution.
 */
class ExecutionTimeAggregator {
  private apiTimeSeconds = 0;
  private toolTimeSeconds = 0;

  // Per-API tracking: apiName -> { calls, total_seconds }
  private apiStats: Map<string, { calls: number; total_seconds: number }> =
    new Map();

  // Per-tool tracking: toolName -> { calls, total_seconds }
  private toolStats: Map<string, { calls: number; total_seconds: number }> =
    new Map();

  /**
   * Record an API call duration.
   * @param apiName - Identifier for the API call (e.g., 'pi-agent', 'pi-scouting')
   * @param durationSeconds - Duration in seconds
   */
  recordApiCall(apiName: string, durationSeconds: number): void {
    this.apiTimeSeconds += durationSeconds;

    const existing = this.apiStats.get(apiName) || {
      calls: 0,
      total_seconds: 0,
    };
    existing.calls += 1;
    existing.total_seconds += durationSeconds;
    this.apiStats.set(apiName, existing);
  }

  /**
   * Record a tool execution duration.
   * @param toolName - Identifier for the tool (e.g., 'npm test', 'git clone')
   * @param durationSeconds - Duration in seconds
   */
  recordToolExecution(toolName: string, durationSeconds: number): void {
    this.toolTimeSeconds += durationSeconds;

    const existing = this.toolStats.get(toolName) || {
      calls: 0,
      total_seconds: 0,
    };
    existing.calls += 1;
    existing.total_seconds += durationSeconds;
    this.toolStats.set(toolName, existing);
  }

  /**
   * Get the overall execution time summary.
   */
  getSummary(): ExecutionTimeSummary {
    const totalSeconds = this.apiTimeSeconds + this.toolTimeSeconds;
    const apiPercent =
      totalSeconds === 0
        ? 0
        : Math.round((this.apiTimeSeconds / totalSeconds) * 10000) / 100;
    const toolPercent =
      totalSeconds === 0
        ? 0
        : Math.round((this.toolTimeSeconds / totalSeconds) * 10000) / 100;

    return {
      api_time_seconds: this.apiTimeSeconds,
      tool_time_seconds: this.toolTimeSeconds,
      total_time_seconds: totalSeconds,
      api_percent: apiPercent,
      tool_percent: toolPercent,
    };
  }

  /**
   * Get per-API statistics.
   */
  getApiStats(): ExecutionStats {
    const result: ExecutionStats = {};

    for (const [apiName, stats] of this.apiStats.entries()) {
      result[apiName] = { ...stats };
    }

    return result;
  }

  /**
   * Get per-tool statistics.
   */
  getToolStats(): ExecutionStats {
    const result: ExecutionStats = {};

    for (const [toolName, stats] of this.toolStats.entries()) {
      result[toolName] = { ...stats };
    }

    return result;
  }
}

// === TokenUsageAggregator ===

interface UsageObject {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: {
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

interface TokenUsageSummary {
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  total_tokens: number;
  cache_efficiency_percent: number;
}

interface ModelTokenStats {
  [modelName: string]: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
    total_tokens: number;
  };
}

/**
 * TokenUsageAggregator tracks token usage across Pi event streams.
 *
 * Accumulates:
 * - Input tokens (prompt_tokens)
 * - Output tokens (completion_tokens)
 * - Cache creation tokens (prompt_tokens_details.cache_creation_input_tokens)
 * - Cache read tokens (prompt_tokens_details.cache_read_input_tokens)
 *
 * Also tracks per-model usage for cost estimation and performance analysis.
 */
class TokenUsageAggregator {
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCacheCreationTokens = 0;
  private totalCacheReadTokens = 0;

  // Per-model tracking
  private modelStats: Map<
    string,
    {
      input_tokens: number;
      output_tokens: number;
      cache_creation_tokens: number;
      cache_read_tokens: number;
    }
  > = new Map();

  /**
   * Get or initialize model stats.
   */
  private ensureModelStats(
    modelName: string
  ): {
    input_tokens: number;
    output_tokens: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
  } {
    if (!this.modelStats.has(modelName)) {
      this.modelStats.set(modelName, {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
      });
    }
    return this.modelStats.get(modelName)!;
  }

  /**
   * Record input tokens for a model.
   */
  recordInputTokens(modelName: string, tokens: number): void {
    this.totalInputTokens += tokens;
    const stats = this.ensureModelStats(modelName);
    stats.input_tokens += tokens;
  }

  /**
   * Record output tokens for a model.
   */
  recordOutputTokens(modelName: string, tokens: number): void {
    this.totalOutputTokens += tokens;
    const stats = this.ensureModelStats(modelName);
    stats.output_tokens += tokens;
  }

  /**
   * Record cache creation tokens for a model.
   */
  recordCacheCreationTokens(modelName: string, tokens: number): void {
    this.totalCacheCreationTokens += tokens;
    const stats = this.ensureModelStats(modelName);
    stats.cache_creation_tokens += tokens;
  }

  /**
   * Record cache read tokens for a model.
   */
  recordCacheReadTokens(modelName: string, tokens: number): void {
    this.totalCacheReadTokens += tokens;
    const stats = this.ensureModelStats(modelName);
    stats.cache_read_tokens += tokens;
  }

  /**
   * Record usage from an OpenRouter-style usage object.
   * @param modelName - Model identifier
   * @param usage - Usage object with prompt_tokens, completion_tokens, etc.
   */
  recordUsage(modelName: string, usage: UsageObject | null | undefined): void {
    if (!usage || typeof usage !== 'object') return;

    if (typeof usage.prompt_tokens === 'number') {
      this.recordInputTokens(modelName, usage.prompt_tokens);
    }

    if (typeof usage.completion_tokens === 'number') {
      this.recordOutputTokens(modelName, usage.completion_tokens);
    }

    if (usage.prompt_tokens_details) {
      const details = usage.prompt_tokens_details;
      if (typeof details.cache_creation_input_tokens === 'number') {
        this.recordCacheCreationTokens(
          modelName,
          details.cache_creation_input_tokens
        );
      }
      if (typeof details.cache_read_input_tokens === 'number') {
        this.recordCacheReadTokens(modelName, details.cache_read_input_tokens);
      }
    }
  }

  /**
   * Get the overall token usage summary.
   */
  getSummary(): TokenUsageSummary {
    const totalTokens =
      this.totalInputTokens +
      this.totalOutputTokens +
      this.totalCacheCreationTokens +
      this.totalCacheReadTokens;

    // Cache efficiency: percentage of tokens from cache reads
    const cacheEfficiency =
      totalTokens === 0
        ? 0
        : Math.round((this.totalCacheReadTokens / totalTokens) * 10000) / 100;

    return {
      total_input_tokens: this.totalInputTokens,
      total_output_tokens: this.totalOutputTokens,
      total_cache_creation_tokens: this.totalCacheCreationTokens,
      total_cache_read_tokens: this.totalCacheReadTokens,
      total_tokens: totalTokens,
      cache_efficiency_percent: cacheEfficiency,
    };
  }

  /**
   * Get per-model token usage statistics.
   */
  getModelStats(): ModelTokenStats {
    const result: ModelTokenStats = {};

    for (const [modelName, stats] of this.modelStats.entries()) {
      const total =
        stats.input_tokens +
        stats.output_tokens +
        stats.cache_creation_tokens +
        stats.cache_read_tokens;

      result[modelName] = {
        ...stats,
        total_tokens: total,
      };
    }

    return result;
  }
}

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

interface ProviderErrorSummary {
  type: 'model_unavailable' | 'provider_error' | 'provider_empty_assistant_turn';
  provider?: string;
  api?: string;
  model?: string;
  stop_reason?: string;
  response_id?: string;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  message: string;
  retryable?: boolean; // true if error appears transient (503, 429, connection), false if permanent (404, deprecated)
}

const inputPath = process.argv[2] ?? '/tmp/pi-events.raw.jsonl';
const filteredPath = process.argv[3] ?? '/results/pi-events.jsonl';
const summaryPath = process.argv[4] ?? '/results/pi-summary.json';

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

/**
 * Determine if a provider error should be retried.
 * Retryable errors: transient issues like 503, 429, connection errors, temporary unavailability
 * Non-retryable errors: permanent issues like 404 (not found), deprecated models
 */
function isProviderErrorRetryable(message: string): boolean {
  const lower = message.toLowerCase();

  // Non-retryable: permanent errors (check for 404 or "not found" without other retryable indicators)
  if (lower.includes('404') || lower.includes('deprecated')) {
    return false; // 404s and deprecated models are permanent
  }

  // Retryable: transient errors
  if (
    lower.includes('503') || // Service Unavailable
    lower.includes('429') || // Rate Limited / Too Many Requests
    lower.includes('timeout') || // Connection timeout
    lower.includes('econnreset') || // Connection reset
    lower.includes('econnrefused') || // Connection refused
    lower.includes('etimedout') || // Network timeout
    lower.includes('ehostunreach') || // No route to host
    lower.includes('enetunreach') || // Network unreachable
    lower.includes('unavailable') || // Model/service temporarily unavailable
    lower.includes('offline') || // Service is temporarily offline
    lower.includes('service is down') // Service is down
  ) {
    return true;
  }

  // Default: non-retryable (unknown error, assume permanent unless we detect transience)
  return false;
}

function classifyProviderError(
  message: string
): {
  type: ProviderErrorSummary['type'];
  retryable: boolean;
} {
  const lower = message.toLowerCase();
  let type: ProviderErrorSummary['type'] = 'provider_error';

  if (
    lower.includes('model is unavailable') ||
    lower.includes('model unavailable') ||
    lower.includes('no endpoints found') ||
    lower.includes('not a valid model') ||
    lower.includes('model_not_found')
  ) {
    type = 'model_unavailable';
  }

  const retryable = isProviderErrorRetryable(message);

  return { type, retryable };
}

function extractProviderError(event: PiEvent): ProviderErrorSummary | null {
  const message = (event as any).message;
  if (!message || typeof message !== 'object') return null;

  // Defensively extract errorMessage as string
  let errorMessage = '';
  if (typeof message.errorMessage === 'string') {
    errorMessage = message.errorMessage.trim();
  } else if (message.errorMessage !== undefined && message.errorMessage !== null) {
    // Attempt to convert to string if it exists but isn't already a string
    try {
      errorMessage = String(message.errorMessage).trim();
    } catch {
      // If conversion fails, treat as empty
      return null;
    }
  }

  // Defensively extract stopReason as string
  const stopReason = typeof message.stopReason === 'string' ? message.stopReason.trim() : '';

  if (!errorMessage || stopReason !== 'error') return null;

  const { type, retryable } = classifyProviderError(errorMessage);

  return {
    type,
    retryable,
    provider: typeof message.provider === 'string' ? message.provider : undefined,
    api: typeof message.api === 'string' ? message.api : undefined,
    model: typeof message.model === 'string' ? message.model : undefined,
    stop_reason: stopReason,
    message: errorMessage,
  };
}

function numericUsageValue(usage: any, keys: string[]): number | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function extractMessageTextLength(message: any): number {
  if (!message || typeof message !== 'object') {
    return 0;
  }

  // Primary path: accumulate text from message.content array
  const content = message?.content;
  if (typeof content === 'string') return content.trim().length;
  if (Array.isArray(content)) {
    const contentLength = content.reduce((sum, part) => {
      if (typeof part === 'string') return sum + part.trim().length;
      if (!part || typeof part !== 'object') return sum;
      const text = typeof part.text === 'string'
        ? part.text
        : typeof part.output_text === 'string'
          ? part.output_text
          : '';
      return sum + text.trim().length;
    }, 0);
    if (contentLength > 0) return contentLength;
  }

  // Fallback paths for streaming responses where deltas weren't accumulated into message.content[]
  // This handles cases where Pi CLI's streaming handler or the gateway provider populates
  // alternative fields instead of (or in addition to) the standard message.content array.

  // Fallback 1: message.text (used by some streaming implementations)
  if (typeof message?.text === 'string') {
    const textLength = message.text.trim().length;
    if (textLength > 0) return textLength;
  }

  // Fallback 2: message.output_text (gateway/OpenRouter alternative)
  if (typeof message?.output_text === 'string') {
    const outputTextLength = message.output_text.trim().length;
    if (outputTextLength > 0) return outputTextLength;
  }

  // Fallback 3: nested body.output[].content[].text (OpenRouter-specific format)
  if (Array.isArray(message?.body?.output)) {
    try {
      const nestedLength = message.body.output.reduce((sum: number, item: any) => {
        if (!item || typeof item !== 'object') return sum;
        if (Array.isArray(item.content)) {
          return sum + item.content.reduce((itemSum: number, part: any) => {
            const text = typeof part?.text === 'string' ? part.text : '';
            return itemSum + text.trim().length;
          }, 0);
        }
        return sum;
      }, 0);
      if (nestedLength > 0) return nestedLength;
    } catch {
      // If extraction fails, continue to fallback
    }
  }

  // No content found in any source
  return 0;
}

function extractToolResultCount(event: PiEvent): number {
  const toolResults = (event as any).toolResults;
  if (Array.isArray(toolResults)) return toolResults.length;
  const messageToolCalls = (event as any).message?.toolCalls ?? (event as any).message?.tool_calls;
  if (Array.isArray(messageToolCalls)) return messageToolCalls.length;
  return 0;
}

function extractEmptyAssistantTurn(event: PiEvent): ProviderErrorSummary | null {
  const message = (event as any).message;
  if (!message || typeof message !== 'object' || message.role !== 'assistant') return null;

  const stopReason = typeof message.stopReason === 'string' ? message.stopReason.trim() : '';
  if (stopReason !== 'stop') return null;

  const usage = extractUsage(event);
  const outputTokens = numericUsageValue(usage, ['output', 'output_tokens', 'completion_tokens']);
  if (!outputTokens || outputTokens <= 0) return null;

  if (extractMessageTextLength(message) > 0 || extractToolResultCount(event) > 0) return null;

  const inputTokens = numericUsageValue(usage, ['input', 'input_tokens', 'prompt_tokens']);
  const totalTokens = numericUsageValue(usage, ['totalTokens', 'total_tokens', 'total']);
  const provider = typeof message.provider === 'string' ? message.provider : undefined;
  const api = typeof message.api === 'string' ? message.api : undefined;
  const model = typeof message.model === 'string' ? message.model : undefined;
  const responseId = typeof message.responseId === 'string' ? message.responseId : undefined;
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

async function main(): Promise<void> {
  startRssSampler();
  const input = fs.createReadStream(inputPath, { encoding: 'utf8' });
  const output = fs.createWriteStream(filteredPath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  const aggregator = new EventCounterAggregator();
  const toolReliability = new ToolReliabilityAggregator();
  const executionTime = new ExecutionTimeAggregator();
  const tokenUsage = new TokenUsageAggregator();
  const providerErrors: ProviderErrorSummary[] = [];
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
    const providerError = extractProviderError(event);
    if (providerError) {
      providerErrors.push(providerError);
    }
    const emptyAssistantTurn = extractEmptyAssistantTurn(event);
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

main().catch((error: Error) => {
  stopRssSampler();
  console.error(error);
  process.exit(1);
});
