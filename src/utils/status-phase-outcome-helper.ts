import * as path from 'path';
import * as fs from 'fs';
import { Job } from '../kaseki-api-types';
import type { StatusResponse } from '../kaseki-api-types';
import { KasekiApiConfig } from '../kaseki-api-config';
import { JobScheduler } from '../job-scheduler';

export class StatusPhaseOutcomeHelper {
  constructor(
    private scheduler: JobScheduler,
    private config: KasekiApiConfig
  ) {}

  addPhaseOutcome(response: StatusResponse, job: Job, metadata: any): void {
    const stage = String(response.progress?.stage ?? job.currentStage ?? '').toLowerCase();
    const failed = job.status === 'failed';
    const events = this.readPhaseEvents(job);
    const scoutingEvents = events.filter((event) => /scout|scouting/.test(this.eventStage(event)));
    const failedCommand = String(metadata?.failed_command ?? stage).toLowerCase();
    const preAgentValidation = /pre[-_ ]agent validation|pre[-_ ]validation/.test(failedCommand);
    const weavingEvents = events.filter((event) => {
      const eventStage = this.eventStage(event);
      if (/github operations.*(preflight|health check)|preflight.*github operations/.test(eventStage)) return false;
      if (preAgentValidation && /pre[-_ ]agent|pre[-_ ]validation/.test(eventStage)) return false;
      if (preAgentValidation && /validation/.test(eventStage) && !/goal check|quality|post[-_ ]agent/.test(eventStage)) return false;
      return /coding|weav|goal[-_ ]setting|goal check|quality|github operations|evaluation|final/.test(eventStage);
    });
    const scoutingArtifactExists = fs.existsSync(path.join(this.config.resultsDir, job.id, 'scouting.json'));
    const scoutingDuration = Number(metadata?.scouting_duration_seconds ?? 0);
    const scoutingExitCode = Number(metadata?.scouting_exit_code ?? 0);
    const scoutingModel = String(metadata?.scouting_actual_model ?? '').trim();
    const scoutingStarted = Boolean(
      scoutingEvents.length || /scout|scouting/.test(stage) || scoutingArtifactExists ||
      scoutingDuration > 0 || scoutingExitCode !== 0 || (scoutingModel && scoutingModel !== 'unknown')
    );
    const weavingStage = !preAgentValidation || !/pre[-_ ]agent|pre[-_ ]validation|validation/.test(stage);
    const preflightGithubOperations = /github operations.*(preflight|health check)|preflight.*github operations/.test(stage);
    const weavingStarted = Boolean(weavingEvents.length || (weavingStage && !preflightGithubOperations && /coding|weav|goal check|validation|quality|github operations|evaluation|final/.test(stage)));
    const scoutingFailed = failed && /scout|scouting/.test(failedCommand);
    const weavingFailed = failed && !scoutingFailed && weavingStarted;
    const scoutingCompletedAt = this.phaseCompletedAt(scoutingEvents);
    const weavingCompletedAt = this.phaseCompletedAt(weavingEvents);
    response.phaseOutcome = {
      scouting: scoutingFailed ? 'failed' : scoutingStarted ? (scoutingCompletedAt || weavingStarted || failed ? 'completed' : 'running') : 'not_reached',
      weaving: weavingFailed ? 'failed' : weavingStarted ? (weavingCompletedAt || scoutingStarted || failed ? 'completed' : 'running') : 'not_reached',
      explanation: failed
        ? `Run failed at ${metadata?.failed_command || response.progress?.stage || 'an unknown stage'}; phase outcomes are derived from recorded lifecycle events.`
        : undefined,
      ...(this.phaseStartedAt(scoutingEvents) ? { scoutingStartedAt: this.phaseStartedAt(scoutingEvents) } : {}),
      ...(scoutingCompletedAt ? { scoutingCompletedAt } : {}),
      ...(this.phaseStartedAt(weavingEvents) ? { weavingStartedAt: this.phaseStartedAt(weavingEvents) } : {}),
      ...(weavingCompletedAt ? { weavingCompletedAt } : {}),
    };
  }

  private readPhaseEvents(job: Job): Array<Record<string, unknown>> {
    const events: Array<Record<string, unknown>> = [];
    const progressFile = path.join(this.config.resultsDir, job.id, 'progress.jsonl');
    if (fs.existsSync(progressFile)) {
      try {
        for (const line of fs.readFileSync(progressFile, 'utf8').split('\n')) {
          try { if (line.trim()) events.push(JSON.parse(line)); } catch { /* tolerate partial tails */ }
        }
      } catch { /* status must remain resilient */ }
    }
    if (typeof this.scheduler.getLiveProgressEvents === 'function') {
      const liveEvents = this.scheduler.getLiveProgressEvents(job.id, 200);
      if (Array.isArray(liveEvents)) events.push(...liveEvents);
    }
    return events;
  }

  private eventStage(event: Record<string, unknown>): string {
    return String(event.stage ?? event.message ?? '').toLowerCase();
  }

  private phaseStartedAt(events: Array<Record<string, unknown>>): string | undefined {
    const event = events.find((item) => typeof item.timestamp === 'string' || typeof item.updatedAt === 'string');
    return event ? String(event.timestamp ?? event.updatedAt) : undefined;
  }

  private phaseCompletedAt(events: Array<Record<string, unknown>>): string | undefined {
    const event = [...events].reverse().find((item) => /finished|completed|failed|exited|success/i.test(String(item.status ?? item.message ?? item.detail ?? '')) && (typeof item.timestamp === 'string' || typeof item.updatedAt === 'string'));
    return event ? String(event.timestamp ?? event.updatedAt) : undefined;
  }
}
