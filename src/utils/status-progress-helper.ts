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
      const candidates: NonNullable<StatusResponse['progress']>[] = [];
      const lastFileEvent = readLastJsonlEvent(progressFile);
      if (lastFileEvent) {
        const structuredProgress = toStructuredProgress(lastFileEvent);
        if (structuredProgress) {
          candidates.push(structuredProgress);
        }
      }

      if (typeof this.scheduler.getLiveProgressEvents === 'function') {
        const liveEvents = this.scheduler.getLiveProgressEvents(job.id, 100);
        const lastEvent = Array.isArray(liveEvents) ? liveEvents[liveEvents.length - 1] : undefined;
        if (lastEvent) {
          const structuredProgress = toStructuredProgress(lastEvent, 'running');
          if (structuredProgress) {
            candidates.push(structuredProgress);
          }
        }
      }

      if (typeof this.scheduler.getLiveDockerLogTail === 'function') {
        const dockerEvents = progressEventsFromDockerLogTail(
          this.scheduler.getLiveDockerLogTail(job.id, 300) ?? undefined,
          // Docker's in-memory tail often has no per-line timestamp. In that
          // case this is the time the API observed the active stage, not the
          // time the job was originally queued.
          new Date().toISOString()
        );
        const lastEvent = dockerEvents[dockerEvents.length - 1];
        if (lastEvent) {
          const structuredProgress = toStructuredProgress(lastEvent, 'running');
          if (structuredProgress) {
            candidates.push(structuredProgress);
          }
        }
      }
      // progress.jsonl can lag behind the live Docker stream during long Pi
      // phases.  Prefer the freshest timestamp instead of returning early on
      // a stale persisted event, which otherwise produces false stale-heartbeat
      // warnings and hides a newly reached stage.
      response.progress = candidates.sort((left, right) => {
        const leftTime = Date.parse(left.updatedAt || '');
        const rightTime = Date.parse(right.updatedAt || '');
        return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
      })[0];
    } catch {
      // Ignore progress file errors; status remains resilient
    }
  }

}
