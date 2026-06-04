#!/usr/bin/env node
import fs from 'node:fs';
import { once } from 'node:events';
import readline from 'node:readline';
import { EventCounterAggregator } from './event-aggregator.js';
import { ToolReliabilityAggregator, ToolReliabilitySummary, ToolStats } from './tool-reliability-aggregator.js';
import { ExecutionTimeAggregator, ExecutionTimeSummary, ExecutionStats } from './execution-time-aggregator.js';
import { TimestampTracker } from './timestamp-tracker.js';
import { extractEventTimestamp, PiEvent } from './lib/event-timestamp-helpers.js';

interface EventCountMap {
  [key: string]: number;
}

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

async function main(): Promise<void> {
  startRssSampler();
  const input = fs.createReadStream(inputPath, { encoding: 'utf8' });
  const output = fs.createWriteStream(filteredPath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  const aggregator = new EventCounterAggregator();
  const toolReliability = new ToolReliabilityAggregator();
  const executionTime = new ExecutionTimeAggregator();
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
  };

  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  stopRssSampler();
}

main().catch((error: Error) => {
  stopRssSampler();
  console.error(error);
  process.exit(1);
});
