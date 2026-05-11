#!/usr/bin/env node

import fs from 'fs';
import readline from 'readline';
import { sanitizeToolName } from './progress-stream-utils.js';
import {
  EventSampler,
  formatElapsed,
  truncate,
  extractTopic,
} from './pi-progress-summarizer.js';
import { ANSI_COLORS, stripAnsi } from './ansi-colors.js';

interface EventCountMap {
  [key: string]: number;
}

interface PiEvent {
  type?: string;
  event?: string;
  name?: string;
  kind?: string;
  tool_name?: string;
  toolName?: string;
  tool?: { name: string };
  call?: { name: string };
  message?: { content?: any };
}

interface ProgressPayload {
  timestamp: string;
  updatedAt: string;
  stage: string;
  message: string;
  percentComplete?: number;
  summary?: string;
  [key: string]: any;
}

const progressJsonlPath = process.argv[2] || '/results/progress.jsonl';
const progressLogPath = process.argv[3] || '/results/progress.log';
const streamToStdout = process.env.KASEKI_STREAM_PROGRESS !== '0';
const enableSummarization = process.env.KASEKI_PROGRESS_SUMMARIZATION !== '0';

const counts: EventCountMap = {};
let toolStartCount = 0;
let toolEndCount = 0;
let messageUpdateCount = 0;
let lastHeartbeat = 0;
let streamOpen = true;
const startTime = Date.now();

// Sample 1 in every 15 message_update events
const messageSampler = new EventSampler(15);

/**
 * ToolBatchAggregator: Batches tool calls by type and emits summaries
 * Reduces noise by aggregating rapid tool sequences
 */
class ToolBatchAggregator {
  private toolBuffer: Map<string, number> = new Map(); // tool name -> count
  private lastFlushTime: number = Date.now();
  private coalesceWindow: number = 3000; // 3 seconds

  recordTool(tool: string): void {
    const count = (this.toolBuffer.get(tool) || 0) + 1;
    this.toolBuffer.set(tool, count);
    this.lastFlushTime = Date.now();
  }

  shouldFlush(): boolean {
    const elapsed = Date.now() - this.lastFlushTime;
    // Flush if buffer is full or coalesce window elapsed
    return this.toolBuffer.size > 0 && elapsed > this.coalesceWindow;
  }

  flush(): void {
    if (this.toolBuffer.size === 0) {
      return;
    }

    // Build summary: "read_file (3x), write_file (1x), grep_search (2x)"
    const summary = Array.from(this.toolBuffer.entries())
      .map(([tool, count]) => `${tool} (${count}x)`)
      .join(', ');

    const elapsed = formatElapsed(startTime);
    const message = `[tools] ${summary} (${elapsed})`;
    emit('pi tool batch', stripAnsi(message), {
      toolBatchSummary: Object.fromEntries(this.toolBuffer),
    });

    this.toolBuffer.clear();
  }

  clear(): void {
    this.toolBuffer.clear();
  }
}

const toolBatchAggregator = new ToolBatchAggregator();

function append(file: string, text: string): void {
  fs.appendFileSync(file, text);
}

function eventType(event: PiEvent | any): string {
  return event?.type || event?.event || event?.name || event?.kind || 'unknown';
}

function toolName(event: PiEvent | any): string {
  const candidates = [
    event?.tool_name,
    event?.toolName,
    event?.tool?.name,
    event?.name,
    event?.call?.name,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }
    const sanitized = sanitizeToolLabel(candidate);
    if (sanitized !== 'tool') {
      return sanitized;
    }
  }

  return 'tool';
}

function sanitizeToolLabel(value: string): string {
  return sanitizeToolName(value);
}

function emit(stage: string, message: string, extra: Record<string, any> = {}): void {
  const now = new Date().toISOString();
  const payload: ProgressPayload = {
    timestamp: now,
    updatedAt: now,
    stage,
    message,
    ...extra,
  };

  // For JSONL, strip ANSI codes
  const cleanMessage = stripAnsi(message);
  const cleanPayload = { ...payload, message: cleanMessage };

  append(progressJsonlPath, `${JSON.stringify(cleanPayload)}\n`);
  const line = `[progress] ${stage}: ${message}\n`;
  append(progressLogPath, line);
  if (streamToStdout) {
    process.stdout.write(line);
  }
}

function maybeHeartbeat(force: boolean = false, reason: string = 'events'): void {
  const now = Date.now();
  if (!force && now - lastHeartbeat < 15000) {
    return;
  }
  lastHeartbeat = now;

  // Flush any pending tool batches
  if (toolBatchAggregator.shouldFlush()) {
    toolBatchAggregator.flush();
  }

  const elapsed = formatElapsed(startTime);
  const message = `${ANSI_COLORS.DIM}Time Check: ${elapsed} elapsed${ANSI_COLORS.RESET}`;

  emit('pi agent', message, {
    reason,
  });
}

/**
 * Emit enhanced summary for message updates
 */
function emitMessageSummary(event: PiEvent): void {
  if (!enableSummarization || !messageSampler.shouldEmit()) {
    return;
  }

  const elapsed = formatElapsed(startTime);
  let detail: string | undefined;

  if (event.message?.content) {
    const content = event.message.content;
    const contentText = Array.isArray(content)
      ? content.map((c: any) => (c.text || c.content || '').substring(0, 50)).join(' ')
      : String(content).substring(0, 200);

    // Try to extract topic first (more concise)
    if (contentText.length > 10) {
      const topic = extractTopic(contentText);
      if (topic) {
        detail = topic;
      } else {
        // Fallback to truncated content
        detail = truncate(contentText, 60);
      }
    }
  }

  if (detail) {
    const message = `${detail} (${elapsed})`;
    emit('pi agent', stripAnsi(message), { type: 'message_update' });
  }
}

emit('pi agent', 'started');
const heartbeatTimer = setInterval(() => {
  if (streamOpen) {
    maybeHeartbeat(true, 'timer');
  }
}, 30000);

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on('line', (line: string) => {
  if (line.trim().length === 0) {
    return;
  }

  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    counts.invalid_json = (counts.invalid_json || 0) + 1;
    maybeHeartbeat();
    return;
  }

  const type = eventType(event);
  counts[type] = (counts[type] || 0) + 1;

  if (type === 'tool_execution_start' || type === 'toolcall_start') {
    const tool = toolName(event);
    toolStartCount += 1;

    // Aggregate tool calls instead of emitting individual start messages
    if (enableSummarization) {
      toolBatchAggregator.recordTool(tool);
    }
  } else if (type === 'tool_execution_end' || type === 'toolcall_end') {
    toolEndCount += 1;

    // Tool end is batched; suppress individual emission
  } else if (type === 'message_update') {
    messageUpdateCount += 1;

    if (enableSummarization) {
      emitMessageSummary(event);
    }
  } else if (type === 'agent_start') {
    messageSampler.reset();
    toolBatchAggregator.clear();
    emit('pi agent', 'agent started', { type });
  } else if (type === 'agent_end') {
    // Flush any pending tool batches before agent ends
    toolBatchAggregator.flush();
    emit('pi agent', 'agent finished', { type });
  } else if (type === 'auto_retry_start') {
    // Flush pending batches before retry
    toolBatchAggregator.flush();
    emit(
      'pi agent',
      `${ANSI_COLORS.YELLOW}auto retry started${ANSI_COLORS.RESET}`,
      { type }
    );
  } else if (type === 'auto_retry_end') {
    emit('pi agent', 'auto retry finished', { type });
  }

  maybeHeartbeat();
});

rl.on('close', () => {
  streamOpen = false;
  clearInterval(heartbeatTimer);

  // Flush any pending tool batches
  toolBatchAggregator.flush();
  maybeHeartbeat(true, 'close');

  const finalElapsed = formatElapsed(startTime);
  emit('pi agent', `event stream ended | ${ANSI_COLORS.DIM}${finalElapsed} total${ANSI_COLORS.RESET}`, {
    counts,
    toolStartCount,
    toolEndCount,
    messageUpdateCount,
  });
});
