export type DockerLogProgressEvent = {
  source: 'docker-logs';
  stage: string;
  message: string;
  timestamp: string;
  updatedAt: string;
  status?: 'started' | 'finished';
};

const ORCHESTRATOR_STAGE_PATTERN = /^==>\s+(.+?)\s*$/;
const STRUCTURED_PROGRESS_PATTERN = /^\[progress\]\s+([^:]+):\s*(.+)$/;

export function progressEventsFromDockerLogTail(
  content: string | undefined,
  timestamp = new Date().toISOString()
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
  for (const line of content.split(/\r?\n/)) {
    const stageMatch = line.match(ORCHESTRATOR_STAGE_PATTERN);
    if (stageMatch) {
      append({
        source: 'docker-logs',
        stage: stageMatch[1].trim(),
        message: 'started',
        status: 'started',
        timestamp,
        updatedAt: timestamp,
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
        timestamp,
        updatedAt: timestamp,
      });
    }
  }

  return events;
}
