#!/usr/bin/env node

import fs from 'fs';
import readline from 'readline';

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
}

interface ProgressPayload {
  timestamp: string;
  stage: string;
  message: string;
  [key: string]: any;
}

const progressJsonlPath = process.argv[2] || '/results/progress.jsonl';
const progressLogPath = process.argv[3] || '/results/progress.log';
const streamToStdout = process.env.KASEKI_STREAM_PROGRESS !== '0';

const counts: EventCountMap = {};
let toolStartCount = 0;
let toolEndCount = 0;
let messageUpdateCount = 0;
let lastHeartbeat = 0;
let streamOpen = true;

function append(file: string, text: string): void {
  fs.appendFileSync(file, text);
}

function eventType(event: PiEvent | any): string {
  return event?.type || event?.event || event?.name || event?.kind || 'unknown';
}

function toolName(event: PiEvent | any): string {
  return (
    event?.tool_name ||
    event?.toolName ||
    event?.tool?.name ||
    event?.name ||
    event?.call?.name ||
    'tool'
  );
}

function emit(stage: string, message: string, extra: Record<string, any> = {}): void {
  const payload: ProgressPayload = {
    timestamp: new Date().toISOString(),
    stage,
    message,
    ...extra,
  };
  append(progressJsonlPath, `${JSON.stringify(payload)}\n`);
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
  emit(
    'pi coding agent',
    `working; events=${eventTotal()}, tool starts=${toolStartCount}, tool ends=${toolEndCount}`,
    {
      counts,
      toolStartCount,
      toolEndCount,
      messageUpdateCount,
      reason,
    }
  );
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
    toolStartCount += 1;
    emit('pi tool', `started ${toolName(event)}`, { type, toolStartCount });
  } else if (type === 'tool_execution_end' || type === 'toolcall_end') {
    toolEndCount += 1;
    emit('pi tool', `finished ${toolName(event)}`, { type, toolEndCount });
  } else if (type === 'message_update') {
    messageUpdateCount += 1;
  } else if (type === 'agent_start') {
    emit('pi coding agent', 'agent started', { type });
  } else if (type === 'agent_end') {
    emit('pi coding agent', 'agent finished', { type });
  } else if (type === 'auto_retry_start') {
    emit('pi coding agent', 'auto retry started', { type });
  } else if (type === 'auto_retry_end') {
    emit('pi coding agent', 'auto retry finished', { type });
  }

  maybeHeartbeat();
});

rl.on('close', () => {
  streamOpen = false;
  clearInterval(heartbeatTimer);
  maybeHeartbeat(true, 'close');
  emit('pi coding agent', 'event stream ended', {
    counts,
    toolStartCount,
    toolEndCount,
    messageUpdateCount,
  });
});
