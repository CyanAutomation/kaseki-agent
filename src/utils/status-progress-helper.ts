import * as path from 'path';
import { Job } from '../kaseki-api-types';
import type { StatusResponse } from '../kaseki-api-types';
import { KasekiApiConfig } from '../kaseki-api-config';
import { JobScheduler } from '../job-scheduler';
import { toStructuredProgress } from './progress-normalizer';
import { readLastJsonlEvent } from './file-helpers';
import { progressEventsFromDockerLogTail } from './docker-log-progress-events';

export class StatusProgressHelper {
  constructor(
    private scheduler: JobScheduler,
    private config: KasekiApiConfig
  ) {}

  addProgressInfo(response: StatusResponse, job: Job): void {
    if (job.status !== 'running') {
      return;
    }

    try {
      const progressFile = path.join(this.config.resultsDir, job.id, 'progress.jsonl');
      const lastFileEvent = readLastJsonlEvent(progressFile);
      if (lastFileEvent) {
        const structuredProgress = toStructuredProgress(lastFileEvent);
        if (structuredProgress) {
          this.refreshEstimatedProgressTimestamp(structuredProgress, lastFileEvent);
          response.progress = structuredProgress;
        }
        return;
      }

      if (typeof this.scheduler.getLiveProgressEvents === 'function') {
        const liveEvents = this.scheduler.getLiveProgressEvents(job.id, 100);
        const lastEvent = liveEvents[liveEvents.length - 1];
        if (lastEvent) {
          const structuredProgress = toStructuredProgress(lastEvent, 'running');
          if (structuredProgress) {
            this.refreshEstimatedProgressTimestamp(structuredProgress, lastEvent);
            response.progress = structuredProgress;
          }
        }
      }

      if (!response.progress && typeof this.scheduler.getLiveDockerLogTail === 'function') {
        const dockerEvents = progressEventsFromDockerLogTail(
          this.scheduler.getLiveDockerLogTail(job.id, 300) ?? undefined,
          job.startedAt?.toISOString()
        );
        const lastEvent = dockerEvents[dockerEvents.length - 1];
        if (lastEvent) {
          const structuredProgress = toStructuredProgress(lastEvent, 'running');
          if (structuredProgress) {
            this.refreshEstimatedProgressTimestamp(structuredProgress, lastEvent);
            response.progress = structuredProgress;
          }
        }
      }
    } catch {
      // Ignore progress file errors; status remains resilient
    }
  }

  private refreshEstimatedProgressTimestamp(
    progress: NonNullable<StatusResponse['progress']>,
    rawEvent: Record<string, unknown>,
  ): void {
    if (rawEvent.timestampEstimated === true) {
      progress.updatedAt = new Date().toISOString();
    }
  }
}
