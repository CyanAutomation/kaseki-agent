export type DockerLogProgressEvent = {
  source: 'docker-logs';
  stage: string;
  message: string;
  timestamp: string;
  updatedAt: string;
  status?: 'started' | 'finished';
  timestampEstimated?: boolean;
};

const ORCHESTRATOR_STAGE_PATTERN = /^==>\s+(.+?)\s*$/;
const STRUCTURED_PROGRESS_PATTERN = /^\[progress\]\s+([^:]+):\s*(.+)$/;
const DEPENDENCY_CACHE_MISS_PATTERN = /^Dependency cache status:\s*.*\bcache miss\b.*$/i;
const TRAILING_TIMESTAMP_PATTERN = /^(.*?)(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)$/;
const DOCKER_LOG_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s+(.*)$/;
// eslint-disable-next-line no-control-regex
const ANSI_CONTROL_CODE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;

function splitTrailingTimestamp(value: string): { text: string; timestamp?: string } {
  const match = value.match(TRAILING_TIMESTAMP_PATTERN);
  if (!match || !match[1].trim()) return { text: value };
  return { text: match[1].trim(), timestamp: match[2] };
}

/**
 * Extracts leading Docker log timestamp (RFC3339 format).
 * Returns the timestamp and the remaining line content.
 */
export function extractDockerLogTimestamp(rawLine: string): { timestamp?: string; line: string } {
  const match = rawLine.match(DOCKER_LOG_TIMESTAMP_PATTERN);
  return match ? { timestamp: match[1], line: match[2] } : { line: rawLine };
}

/**
 * Strips ANSI control codes (colors, formatting) from a line.
 */
export function stripAnsiCodes(line: string): string {
  return line.replace(ANSI_CONTROL_CODE_PATTERN, '');
}

/**
 * Parses orchestrator stage line (== > Stage Name ==).
 * Returns event or null if line doesn't match pattern.
 */
function parseOrchestratorStage(
  line: string,
  eventTimestamp: string,
  dockerTimestamp: string | undefined
): DockerLogProgressEvent | null {
  const stageMatch = line.match(ORCHESTRATOR_STAGE_PATTERN);
  if (!stageMatch) return null;

  const heading = splitTrailingTimestamp(stageMatch[1].trim());
  const recoveredTimestamp = dockerTimestamp || heading.timestamp;
  const isEstimated = !recoveredTimestamp;

  return {
    source: 'docker-logs',
    stage: heading.text,
    // A Docker tail without timestamps is an observation, not durable
    // lifecycle evidence.  Calling it "started" caused future headings
    // from buffered logs to appear as active stages in the API timeline.
    message: isEstimated ? 'observed in log tail' : 'started',
    ...(isEstimated ? {} : { status: 'started' }),
    timestamp: recoveredTimestamp || eventTimestamp,
    updatedAt: recoveredTimestamp || eventTimestamp,
    ...(isEstimated ? { timestampEstimated: true } : {}),
  };
}

/**
 * Parses structured progress line ([progress] Stage: message).
 * Returns event or null if line doesn't match pattern.
 */
function parseStructuredProgress(
  line: string,
  eventTimestamp: string,
  hasDockerTimestamp: boolean
): DockerLogProgressEvent | null {
  const progressMatch = line.match(STRUCTURED_PROGRESS_PATTERN);
  if (!progressMatch) return null;

  const message = progressMatch[2].trim();
  return {
    source: 'docker-logs',
    stage: progressMatch[1].trim(),
    message,
    status: message.includes('finished') ? 'finished' : undefined,
    timestamp: eventTimestamp,
    updatedAt: eventTimestamp,
    ...(hasDockerTimestamp ? {} : { timestampEstimated: true }),
  };
}

/**
 * Parses dependency cache miss indicator line.
 * Returns event or null if line doesn't match pattern.
 */
function parseCacheMiss(
  line: string,
  eventTimestamp: string,
  hasDockerTimestamp: boolean
): DockerLogProgressEvent | null {
  if (!DEPENDENCY_CACHE_MISS_PATTERN.test(line)) return null;

  return {
    source: 'docker-logs',
    stage: 'cold-cache setup',
    message: 'Dependency cache miss; installing packages',
    timestamp: eventTimestamp,
    updatedAt: eventTimestamp,
    ...(hasDockerTimestamp ? {} : { timestampEstimated: true }),
  };
}

export function progressEventsFromDockerLogTail(
  content: string | undefined,
  timestamp = new Date(0).toISOString()
): DockerLogProgressEvent[] {
  if (!content) return [];

  const events: DockerLogProgressEvent[] = [];
  const seenStages = new Set<string>();

  const append = (event: DockerLogProgressEvent): void => {
    const key = `${event.stage.trim().toLocaleLowerCase()}:${event.status ?? ''}:${event.message.trim().toLocaleLowerCase()}`;
    if (seenStages.has(key)) return;
    seenStages.add(key);
    events.push(event);
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const { timestamp: dockerTimestamp, line: lineContent } = extractDockerLogTimestamp(rawLine);
    const eventTimestamp = dockerTimestamp || timestamp;
    const line = stripAnsiCodes(lineContent);
    const hasDockerTimestamp = !!dockerTimestamp;

    // Try to match patterns in order of specificity
    const orchestratorEvent = parseOrchestratorStage(line, eventTimestamp, dockerTimestamp);
    if (orchestratorEvent) {
      append(orchestratorEvent);
      continue;
    }

    const progressEvent = parseStructuredProgress(line, eventTimestamp, hasDockerTimestamp);
    if (progressEvent) {
      append(progressEvent);
      continue;
    }

    const cacheMissEvent = parseCacheMiss(line, eventTimestamp, hasDockerTimestamp);
    if (cacheMissEvent) {
      append(cacheMissEvent);
    }
  }

  return events;
}
