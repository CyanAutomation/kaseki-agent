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
    // Docker log drivers commonly prefix RFC3339 timestamps. Preserve those
    // instead of assigning every recovered event the snapshot retrieval time.
    const timestampMatch = rawLine.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s+(.*)$/);
    const eventTimestamp = timestampMatch?.[1] || timestamp;
    // eslint-disable-next-line no-control-regex
    const line = (timestampMatch?.[2] || rawLine).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
    const stageMatch = line.match(ORCHESTRATOR_STAGE_PATTERN);
    if (stageMatch) {
      append({
        source: 'docker-logs',
        stage: stageMatch[1].trim(),
        message: 'started',
        status: 'started',
        timestamp: eventTimestamp,
        updatedAt: eventTimestamp,
        ...(!timestampMatch ? { timestampEstimated: true } : {}),
      });
      continue;
    }

    const progressMatch = line.match(STRUCTURED_PROGRESS_PATTERN);
    if (progressMatch) {
      const message = progressMatch[2].trim();
      append({
        source: 'docker-logs',
        stage: progressMatch[1].trim(),
        message,
        status: message.includes('finished') ? 'finished' : undefined,
        timestamp: eventTimestamp,
        updatedAt: eventTimestamp,
        ...(!timestampMatch ? { timestampEstimated: true } : {}),
      });
    }
  }

  return events;
}
