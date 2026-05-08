#!/usr/bin/env node

import fs from 'fs';
import readline from 'readline';
import { sanitizeToolName } from './progress-stream-utils.js';
import {
  formatProgressMessage,
  EventSampler,
  extractFilePath,
  detectError,
  formatElapsed,
  truncate,
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

function eventTotal(): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

function maybeHeartbeat(force: boolean = false, reason: string = 'events'): void {
  const now = Date.now();
  if (!force && now - lastHeartbeat < 15000) {
    return;
  }
  lastHeartbeat = now;

  const elapsed = formatElapsed(startTime);
  const workingMsg = `working; events=${eventTotal()}, tool starts=${toolStartCount}, tool ends=${toolEndCount}`;
  const message = `${workingMsg} | ${ANSI_COLORS.DIM}${elapsed} elapsed${ANSI_COLORS.RESET}`;

  emit('pi coding agent', message, {
    counts,
    toolStartCount,
    toolEndCount,
    messageUpdateCount,
    reason,
  });
}

/**
 * Emit enhanced summary for tool execution
 */
function emitToolSummary(event: PiEvent, tool: string, isStart: boolean): void {
  if (!enableSummarization) {
    return;
  }

  const elapsed = formatElapsed(startTime);
  const action = extractFilePath(tool) || tool;
  const { hasError } = detectError(JSON.stringify(event).substring(0, 500));
  const level = hasError ? ('error' as const) : undefined;

  const message = formatProgressMessage(
    'pi tool',
    `${isStart ? 'start' : 'end'} ${action}`,
    undefined,
    level,
    elapsed
  );

  if (message && message.length > 0) {
    emit('pi tool', stripAnsi(message.substring(13)), { level });
  }
}

/**
 * Emit enhanced summary for message updates
 */
function emitMessageSummary(event: PiEvent): void {
  if (!enableSummarization || !messageSampler.shouldEmit()) {
    return;
  }

  const elapsed = formatElapsed(startTime);
  // Try to extract a brief insight from the message
  let detail: string | undefined;

  if (event.message?.content) {
    const content = event.message.content;
    const contentText = Array.isArray(content)
      ? content.map((c: any) => (c.text || c.content || '').substring(0, 50)).join(' ')
      : String(content).substring(0, 100);

    if (contentText.length > 10) {
      detail = truncate(contentText, 60);
    }
  }

  if (detail) {
    const message = formatProgressMessage(
      'pi coding agent',
      'processing',
      detail,
      undefined,
      elapsed
    );

    if (message && message.length > 0) {
      emit('pi coding agent', stripAnsi(message.substring(13)), { type: 'message_update' });
    }
  }
}

emit('pi coding agent', 'started');
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

    const startMsg = `started ${tool}`;
    emit('pi tool', startMsg, { type, toolStartCount });

    if (enableSummarization) {
      emitToolSummary(event, tool, true);
    }
  } else if (type === 'tool_execution_end' || type === 'toolcall_end') {
    const tool = toolName(event);
    toolEndCount += 1;

    const endMsg = `finished ${tool}`;
    emit('pi tool', endMsg, { type, toolEndCount });

    if (enableSummarization) {
      emitToolSummary(event, tool, false);
    }
  } else if (type === 'message_update') {
    messageUpdateCount += 1;

    if (enableSummarization) {
      emitMessageSummary(event);
    }
  } else if (type === 'agent_start') {
    messageSampler.reset();
    emit('pi coding agent', 'agent started', { type });
  } else if (type === 'agent_end') {
    emit('pi coding agent', 'agent finished', { type });
  } else if (type === 'auto_retry_start') {
    emit(
      'pi coding agent',
      `${ANSI_COLORS.YELLOW}auto retry started${ANSI_COLORS.RESET}`,
      { type }
    );
  } else if (type === 'auto_retry_end') {
    emit('pi coding agent', 'auto retry finished', { type });
  }

  maybeHeartbeat();
});

rl.on('close', () => {
  streamOpen = false;
  clearInterval(heartbeatTimer);
  maybeHeartbeat(true, 'close');

  const finalElapsed = formatElapsed(startTime);
  emit('pi coding agent', `event stream ended | ${ANSI_COLORS.DIM}${finalElapsed} total${ANSI_COLORS.RESET}`, {
    counts,
    toolStartCount,
    toolEndCount,
    messageUpdateCount,
  });
});
