#!/usr/bin/env node
import fs from 'node:fs';
import { once } from 'node:events';
import readline from 'node:readline';
import { EventCounterAggregator } from './event-aggregator';
import { TimestampTracker } from './timestamp-tracker';

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
  startRssSampler();
  const input = fs.createReadStream(inputPath, { encoding: 'utf8' });
  const output = fs.createWriteStream(filteredPath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  const aggregator = new EventCounterAggregator();
  const tracker = new TimestampTracker();
  let invalidJsonLines = 0;

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
    const timestamp = eventTimestamp(event);
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

    // Track tool executions
    if (event.type === 'tool_execution_start') aggregator.recordToolStart();
    if (event.type === 'tool_execution_end') aggregator.recordToolEnd();

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
  };

  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  stopRssSampler();
}

main().catch((error: Error) => {
  stopRssSampler();
  console.error(error);
  process.exit(1);
});
