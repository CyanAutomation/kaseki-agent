import * as fs from 'fs';
import * as path from 'path';
import { Job } from '../kaseki-api-types';
import type { StatusResponse } from '../kaseki-api-types';
import { KasekiApiConfig } from '../kaseki-api-config';
import { JobScheduler } from '../job-scheduler';
import { toStructuredProgress } from './progress-normalizer';
import { readLastJsonlEvent, readTailLines } from './file-helpers';
import { progressEventsFromDockerLogTail } from './docker-log-progress-events';

type ProgressRecord = Record<string, unknown>;
type ProgressCandidate = NonNullable<StatusResponse['progress']>;

function timestampMs(event: ProgressCandidate): number {
  const value = Date.parse(event.updatedAt || '');
  return Number.isFinite(value) ? value : 0;
}

function latestProgress(events: ProgressCandidate[]): ProgressCandidate | undefined {
  return events.sort((left, right) => timestampMs(right) - timestampMs(left))[0];
}

function isValidationHeartbeat(event: ProgressCandidate): boolean {
  return /^running validation command:/i.test(event.message || '');
}

function isSubstantive(event: ProgressCandidate): boolean {
  return event.timestampEstimated !== true && !isValidationHeartbeat(event);
}

function readRecentProgressRecords(progressFile: string): ProgressRecord[] {
  try {
    // A bounded tail includes command start/finish records without making each
    // status poll load a potentially large, long-running progress file.
    return readTailLines(fs.readFileSync(progressFile, 'utf-8'), 300)
      .split(/\r?\n/)
      .flatMap((line) => {
        try {
          const parsed = JSON.parse(line) as unknown;
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? [parsed as ProgressRecord]
            : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function validationCommandSummary(events: ProgressRecord[]): NonNullable<StatusResponse['validationCommands']> {
  const commands = new Map<string, NonNullable<StatusResponse['validationCommands']>[number]>();
  for (const event of events) {
    const eventType = String(event.event_type ?? '');
    if (!/^validation_command_(started|finished|skipped)$/.test(eventType)) continue;

    const stage = typeof event.stage === 'string' ? event.stage : 'validation';
    const command = typeof event.command === 'string' ? event.command : '';
    if (!command) continue;

    const key = `${stage}\u0000${command}`;
    const existing = commands.get(key) || { stage, command, status: 'running' as const };
    const timestamp = typeof event.timestamp === 'string'
      ? event.timestamp
      : typeof event.updatedAt === 'string' ? event.updatedAt : undefined;

    if (eventType === 'validation_command_started') {
      commands.set(key, { ...existing, status: 'running', startedAt: timestamp || existing.startedAt });
      continue;
    }

    if (eventType === 'validation_command_skipped') {
      commands.set(key, { ...existing, status: 'skipped', startedAt: existing.startedAt || timestamp, finishedAt: timestamp });
      continue;
    }

    const exitCode = Number(event.exit_code);
    const durationSeconds = Number(event.duration_seconds);
    commands.set(key, {
      ...existing,
      status: exitCode === 0 ? 'passed' : 'failed',
      finishedAt: timestamp,
      ...(Number.isFinite(durationSeconds) ? { durationSeconds } : {}),
    });
  }
  return Array.from(commands.values()).slice(-8);
}

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
      const candidates: ProgressCandidate[] = [];
      const fileEvents = readRecentProgressRecords(progressFile).map((event) => ({ ...event, source: 'progress.jsonl' }));
      const fileCandidates = fileEvents
        .map((event) => toStructuredProgress(event))
        .filter((event): event is ProgressCandidate => event !== null);
      candidates.push(...fileCandidates);

      const validationCommands = validationCommandSummary(fileEvents);
      if (validationCommands.length > 0) {
        response.validationCommands = validationCommands;
      }

      const lastFileEvent = readLastJsonlEvent(progressFile);
      if (lastFileEvent) {
        const structuredProgress = toStructuredProgress({ ...lastFileEvent, source: 'progress.jsonl' });
        if (structuredProgress) {
          candidates.push(structuredProgress);
        }
      }

      if (typeof this.scheduler.getLiveProgressEvents === 'function') {
        const liveEvents = this.scheduler.getLiveProgressEvents(job.id, 100);
        const normalizedLiveEvents = Array.isArray(liveEvents)
          ? liveEvents.map((event) => ({ ...event, source: event.source === 'progress.jsonl' ? 'progress.jsonl' : 'docker-logs' }))
          : [];
        for (const event of normalizedLiveEvents) {
          const structuredProgress = toStructuredProgress(event, 'running');
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
        for (const event of dockerEvents) {
          const structuredProgress = toStructuredProgress(event, 'running');
          if (structuredProgress) {
            candidates.push(structuredProgress);
          }
        }
      }
      // A timestamp-less Docker tail is an observation, not a fresh lifecycle
      // event. Prefer actual timestamps so repeated status polls cannot make a
      // stalled run look healthy merely because the same log tail is observed.
      const actualCandidates = candidates.filter((event) => event.timestampEstimated !== true);
      response.progress = latestProgress(actualCandidates.length > 0 ? actualCandidates : candidates);

      const substantiveProgress = latestProgress(candidates.filter(isSubstantive));
      if (substantiveProgress?.updatedAt) {
        const updatedAtMs = timestampMs(substantiveProgress);
        if (updatedAtMs > 0) {
          const ageSeconds = Math.max(0, Math.floor((Date.now() - updatedAtMs) / 1000));
          response.progressHeartbeat = {
            updatedAt: substantiveProgress.updatedAt,
            ageSeconds,
            stale: ageSeconds >= 120,
            source: substantiveProgress.source,
          };
        }
      }
    } catch {
      // Ignore progress file errors; status remains resilient
    }
  }

}
