#!/usr/bin/env node
import fs from 'node:fs';
import { once } from 'node:events';
import readline from 'node:readline';

interface PiEvent {
  type?: string;
  timestamp?: string | number;
  message?: {
    model?: string;
    api?: string;
    timestamp?: string | number;
    content?: Array<{ type: string }>;
  };
  assistantMessageEvent?: {
    type?: string;
    message?: {
      model?: string;
      api?: string;
      timestamp?: string | number;
      content?: Array<{ type: string }>;
    };
    partial?: {
      model?: string;
      api?: string;
      timestamp?: string | number;
      content?: Array<{ type: string }>;
    };
  };
}

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
}

const inputPath = process.argv[2] ?? '/tmp/pi-events.raw.jsonl';
const filteredPath = process.argv[3] ?? '/results/pi-events.jsonl';
const summaryPath = process.argv[4] ?? '/results/pi-summary.json';

// Maximum number of distinct keys tracked per dynamic summary map.
// Once this cap is reached, unseen keys are folded into "__other__" so
// summary objects stay bounded and may truncate long-tail categories.
const MAX_DISTINCT_SUMMARY_KEYS = 1000;
const OTHER_BUCKET_KEY = '__other__';

const eventCounts: EventCountMap = {};
const assistantEventCounts: EventCountMap = {};
const models: EventCountMap = {};
const apis: EventCountMap = {};
let toolStartCount = 0;
let toolEndCount = 0;
let invalidJsonLines = 0;
let firstTimestamp: string | null = null;
let lastTimestamp: string | null = null;
let minTimestampMs: number | null = null;
let maxTimestampMs: number | null = null;

interface IncrementOptions {
  maxDistinctKeys?: number;
}

function increment(
  map: EventCountMap,
  key: string | undefined,
  options: IncrementOptions = {}
): void {
  if (!key) return;
  const { maxDistinctKeys } = options;
  let targetKey = key;
  if (
    Number.isInteger(maxDistinctKeys) &&
    maxDistinctKeys! > 0 &&
    map[key] === undefined &&
    Object.keys(map).filter((k) => k !== OTHER_BUCKET_KEY).length >= maxDistinctKeys!
  ) {
    targetKey = OTHER_BUCKET_KEY;
  }
  map[targetKey] = (map[targetKey] ?? 0) + 1;
}

function observeModelAndApi(message: any): void {
  if (!message || typeof message !== 'object') return;
  increment(models, message.model, { maxDistinctKeys: MAX_DISTINCT_SUMMARY_KEYS });
  increment(apis, message.api, { maxDistinctKeys: MAX_DISTINCT_SUMMARY_KEYS });
}

function eventTimestamp(event: PiEvent): string | null {
  const candidates = [
    event.timestamp,
    event.message?.timestamp,
    event.assistantMessageEvent?.message?.timestamp,
    event.assistantMessageEvent?.partial?.timestamp,
  ];
  for (const value of candidates) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value))
      return new Date(value).toISOString();
  }
  return null;
}

function toEpochMilliseconds(timestamp: string | null): number | null {
  if (!timestamp) return null;
  const epochMs = Date.parse(timestamp);
  return Number.isFinite(epochMs) ? epochMs : null;
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

async function main(): Promise<void> {
  const input = fs.createReadStream(inputPath, { encoding: 'utf8' });
  const output = fs.createWriteStream(filteredPath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    if (!line.trim()) continue;
    let event: PiEvent;
    try {
      event = JSON.parse(line);
    } catch {
      invalidJsonLines++;
      continue;
    }

    increment(eventCounts, event.type ?? '<missing>', {
      maxDistinctKeys: MAX_DISTINCT_SUMMARY_KEYS,
    });
    const timestamp = eventTimestamp(event);
    if (timestamp) {
      firstTimestamp ??= timestamp;
      lastTimestamp = timestamp;

      const epochMs = toEpochMilliseconds(timestamp);
      if (epochMs !== null) {
        minTimestampMs =
          minTimestampMs === null ? epochMs : Math.min(minTimestampMs, epochMs);
        maxTimestampMs =
          maxTimestampMs === null ? epochMs : Math.max(maxTimestampMs, epochMs);
      }
    }

    observeModelAndApi(event.message);
    observeModelAndApi(event.assistantMessageEvent?.message);
    observeModelAndApi(event.assistantMessageEvent?.partial);

    const assistantType = event.assistantMessageEvent?.type;
    increment(assistantEventCounts, assistantType, {
      maxDistinctKeys: MAX_DISTINCT_SUMMARY_KEYS,
    });
    if (event.type === 'tool_execution_start') toolStartCount++;
    if (event.type === 'tool_execution_end') toolEndCount++;

    if (shouldKeep(event)) {
      const canContinue = output.write(`${JSON.stringify(sanitize(event))}\n`);
      if (!canContinue) {
        await once(output, 'drain');
      }
    }
  }

  await new Promise<void>((resolve) => output.end(resolve));

  const selectedModel =
    Object.entries(models).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  const selectedApi =
    Object.entries(apis).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

  const summary: Summary = {
    selected_model: selectedModel,
    selected_api: selectedApi,
    event_counts: eventCounts,
    assistant_event_counts: assistantEventCounts,
    tool_start_count: toolStartCount,
    tool_end_count: toolEndCount,
    invalid_json_lines: invalidJsonLines,
    first_event_at:
      minTimestampMs !== null ? new Date(minTimestampMs).toISOString() : firstTimestamp,
    last_event_at:
      maxTimestampMs !== null ? new Date(maxTimestampMs).toISOString() : lastTimestamp,
  };

  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error: Error) => {
  console.error(error);
  process.exit(1);
});
