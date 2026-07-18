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
    const scoutingEvents = events.filter((event) => this.isScoutingStage(this.eventStage(event)));
    const failedCommand = String(metadata?.failed_command ?? stage).toLowerCase();
    const preAgentValidation = this.isPreAgentValidationFailure(failedCommand);
    const weavingEvents = events.filter((event) => this.isWeavingEvent(event, preAgentValidation));
    const scoutingStarted = this.hasScoutingStarted(stage, job, metadata, scoutingEvents);
    const weavingStarted = this.hasWeavingStarted(stage, preAgentValidation, weavingEvents);
    const scoutingFailed = failed && this.isScoutingStage(failedCommand);
    const weavingFailed = failed && !scoutingFailed && weavingStarted;
    const scoutingCompletedAt = this.phaseCompletedAt(scoutingEvents);
    const weavingCompletedAt = this.phaseCompletedAt(weavingEvents);
    const scoutingStartedAt = this.phaseStartedAt(scoutingEvents);
    const weavingStartedAt = this.phaseStartedAt(weavingEvents);

    response.phaseOutcome = {
      scouting: this.resolveScoutingOutcome(scoutingFailed, scoutingStarted, scoutingCompletedAt, weavingStarted, failed),
      weaving: this.resolveWeavingOutcome(weavingFailed, weavingStarted, weavingCompletedAt, scoutingStarted, failed),
      explanation: this.buildFailureExplanation(failed, metadata, response),
      ...(scoutingStartedAt ? { scoutingStartedAt } : {}),
      ...(scoutingCompletedAt ? { scoutingCompletedAt } : {}),
      ...(weavingStartedAt ? { weavingStartedAt } : {}),
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

  private isScoutingStage(stage: string): boolean {
    return /scout|scouting/.test(stage);
  }

  private isPreAgentValidationFailure(failedCommand: string): boolean {
    return /pre[-_ ]agent validation|pre[-_ ]validation/.test(failedCommand);
  }

  private isPreflightGithubOperations(stage: string): boolean {
    return /github operations.*(preflight|health check)|preflight.*github operations/.test(stage);
  }

  private isWeavingLikeStage(stage: string): boolean {
    return /coding|weav|goal[-_ ]setting|goal check|quality|github operations|evaluation|final/.test(stage);
  }

  private isWeavingEvent(event: Record<string, unknown>, preAgentValidation: boolean): boolean {
    const stage = this.eventStage(event);
    if (this.isPreflightGithubOperations(stage)) return false;
    if (preAgentValidation && /pre[-_ ]agent|pre[-_ ]validation/.test(stage)) return false;
    if (preAgentValidation && /validation/.test(stage) && !/goal check|quality|post[-_ ]agent/.test(stage)) return false;
    return this.isWeavingLikeStage(stage);
  }

  private hasScoutingStarted(
    stage: string,
    job: Job,
    metadata: any,
    scoutingEvents: Array<Record<string, unknown>>,
  ): boolean {
    const scoutingArtifactExists = fs.existsSync(path.join(this.config.resultsDir, job.id, 'scouting.json'));
    const scoutingDuration = Number(metadata?.scouting_duration_seconds ?? 0);
    const scoutingExitCode = Number(metadata?.scouting_exit_code ?? 0);
    const scoutingModel = String(metadata?.scouting_actual_model ?? '').trim();
    return Boolean(
      scoutingEvents.length ||
      this.isScoutingStage(stage) ||
      scoutingArtifactExists ||
      scoutingDuration > 0 ||
      scoutingExitCode !== 0 ||
      (scoutingModel && scoutingModel !== 'unknown')
    );
  }

  private hasWeavingStarted(
    stage: string,
    preAgentValidation: boolean,
    weavingEvents: Array<Record<string, unknown>>,
  ): boolean {
    const weavingStage = !preAgentValidation || !/pre[-_ ]agent|pre[-_ ]validation|validation/.test(stage);
    return Boolean(
      weavingEvents.length ||
      (weavingStage && !this.isPreflightGithubOperations(stage) && /coding|weav|goal check|validation|quality|github operations|evaluation|final/.test(stage))
    );
  }

  private resolveScoutingOutcome(
    scoutingFailed: boolean,
    scoutingStarted: boolean,
    scoutingCompletedAt: string | undefined,
    weavingStarted: boolean,
    failed: boolean,
  ): NonNullable<StatusResponse['phaseOutcome']>['scouting'] {
    if (scoutingFailed) return 'failed';
    if (!scoutingStarted) return 'not_reached';
    return scoutingCompletedAt || weavingStarted || failed ? 'completed' : 'running';
  }

  private resolveWeavingOutcome(
    weavingFailed: boolean,
    weavingStarted: boolean,
    weavingCompletedAt: string | undefined,
    scoutingStarted: boolean,
    failed: boolean,
  ): NonNullable<StatusResponse['phaseOutcome']>['weaving'] {
    if (weavingFailed) return 'failed';
    if (!weavingStarted) return 'not_reached';
    return weavingCompletedAt || scoutingStarted || failed ? 'completed' : 'running';
  }

  private buildFailureExplanation(failed: boolean, metadata: any, response: StatusResponse): string | undefined {
    return failed
      ? `Run failed at ${metadata?.failed_command || response.progress?.stage || 'an unknown stage'}; phase outcomes are derived from recorded lifecycle events.`
      : undefined;
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
