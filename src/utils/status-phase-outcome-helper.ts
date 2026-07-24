import * as path from 'path';
import * as fs from 'fs';
import { Job } from '../kaseki-api-types';
import type { StatusResponse } from '../kaseki-api-types';
import { KasekiApiConfig } from '../kaseki-api-config';
import { JobScheduler } from '../job-scheduler';

type ExecutionStatus = {
  phase?: string;
  outcome?: string;
};

/**
 * Returns whether a phase/outcome pair represents active execution.
 *
 * An IN_PROGRESS outcome is only valid while the enclosing phase is RUNNING;
 * treating an inconsistent, terminal phase as active can leave clients polling
 * indefinitely.
 */
export function isExecutionInProgress(status: ExecutionStatus): boolean {
  return status.outcome === 'IN_PROGRESS' && status.phase === 'RUNNING';
}

export class StatusPhaseOutcomeHelper {
  private readonly runningOutcomeHighWater = new Map<string, NonNullable<StatusResponse['phaseOutcome']>>();

  constructor(
    private scheduler: JobScheduler,
    private config: KasekiApiConfig
  ) {}

  addPhaseOutcome(response: StatusResponse, job: Job, metadata: any): void {
    const failed = job.status === 'failed';
    // Estimated events recovered from an un-timestamped Docker tail are useful
    // for display, but must not advance durable phase state.  A buffered tail
    // can contain headings for later stages before those stages run.
    const events = this.readPhaseEvents(job).filter((event) => event.timestampEstimated !== true);
    const stage = String(response.progress?.stage ?? job.currentStage ?? '').toLowerCase();
    const goalSettingEvents = events.filter((event) => this.isGoalSettingStage(this.eventStage(event)));
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
    const scoutingFallbackReason = this.scoutingFallbackReason(job);
    const goalSettingFallbackReason = this.goalSettingFallbackReason(job);
    const goalSettingStartedAt = this.phaseStartedAt(goalSettingEvents);
    const goalSettingCompletedAt = this.phaseCompletedAt(goalSettingEvents);
    const goalSettingExitCode = Number(metadata?.goal_setting_exit_code);
    const goalSettingStarted = Boolean(
      goalSettingEvents.length ||
      this.isGoalSettingStage(stage) ||
      Number(metadata?.goal_setting_duration_seconds ?? 0) > 0 ||
      Number.isFinite(goalSettingExitCode) ||
      (typeof metadata?.goal_setting_actual_model === 'string' && metadata.goal_setting_actual_model !== 'unknown')
    );
    const goalSettingFailed = Number.isFinite(goalSettingExitCode) && goalSettingExitCode !== 0;

    const derived: NonNullable<StatusResponse['phaseOutcome']> = {
      goalSetting: this.resolveGoalSettingOutcome(
        goalSettingStarted,
        goalSettingFailed,
        Boolean(goalSettingFallbackReason),
        goalSettingCompletedAt,
        scoutingStarted,
        job.status,
      ),
      scouting: this.resolveScoutingOutcome(
        scoutingFailed,
        scoutingStarted,
        scoutingCompletedAt,
        weavingStarted,
        failed,
        Boolean(scoutingFallbackReason),
        job.request?.scouting?.enabled !== false,
        job.status,
      ),
      weaving: this.resolveWeavingOutcome(weavingFailed, weavingStarted, weavingCompletedAt, stage, job.status),
      ...(goalSettingFallbackReason ? { goalSettingFallback: true, goalSettingFallbackReason } : {}),
      ...(scoutingFallbackReason ? { scoutingFallback: true, scoutingFallbackReason } : {}),
      explanation: this.buildFailureExplanation(failed, metadata, response, scoutingFallbackReason),
      ...(scoutingStartedAt ? { scoutingStartedAt } : {}),
      ...(scoutingCompletedAt ? { scoutingCompletedAt } : {}),
      ...(goalSettingStartedAt ? { goalSettingStartedAt } : {}),
      ...(goalSettingCompletedAt ? { goalSettingCompletedAt } : {}),
      ...(weavingStartedAt ? { weavingStartedAt } : {}),
      ...(weavingCompletedAt ? { weavingCompletedAt } : {}),
    };
    response.phaseOutcome = this.monotonicPhaseOutcome(job, derived);
  }

  private monotonicPhaseOutcome(
    job: Job,
    next: NonNullable<StatusResponse['phaseOutcome']>,
  ): NonNullable<StatusResponse['phaseOutcome']> {
    if (job.status !== 'running') {
      this.runningOutcomeHighWater.delete(job.id);
      return next;
    }
    const previous = this.runningOutcomeHighWater.get(job.id);
    const merged = previous ? {
      ...next,
      goalSetting: this.moreAdvancedScouting(previous.goalSetting, next.goalSetting),
      scouting: this.moreAdvancedScouting(previous.scouting, next.scouting),
      weaving: this.moreAdvancedWeaving(previous.weaving, next.weaving),
      ...(previous.scoutingStartedAt && !next.scoutingStartedAt ? { scoutingStartedAt: previous.scoutingStartedAt } : {}),
      ...(previous.scoutingCompletedAt && !next.scoutingCompletedAt ? { scoutingCompletedAt: previous.scoutingCompletedAt } : {}),
      ...(previous.goalSettingStartedAt && !next.goalSettingStartedAt ? { goalSettingStartedAt: previous.goalSettingStartedAt } : {}),
      ...(previous.goalSettingCompletedAt && !next.goalSettingCompletedAt ? { goalSettingCompletedAt: previous.goalSettingCompletedAt } : {}),
      ...(previous.weavingStartedAt && !next.weavingStartedAt ? { weavingStartedAt: previous.weavingStartedAt } : {}),
      ...(previous.weavingCompletedAt && !next.weavingCompletedAt ? { weavingCompletedAt: previous.weavingCompletedAt } : {}),
    } : next;
    this.runningOutcomeHighWater.set(job.id, merged);
    return merged;
  }

  private moreAdvancedScouting(
    previous: NonNullable<StatusResponse['phaseOutcome']>['scouting'],
    next: NonNullable<StatusResponse['phaseOutcome']>['scouting'],
  ): NonNullable<StatusResponse['phaseOutcome']>['scouting'] {
    const rank = (value: string) => ({ not_reached: 0, running: 1, skipped: 2, completed: 2, completed_with_fallback: 2, failed: 3 }[value] ?? 0);
    return rank(previous) > rank(next) ? previous : next;
  }

  private moreAdvancedWeaving(
    previous: NonNullable<StatusResponse['phaseOutcome']>['weaving'],
    next: NonNullable<StatusResponse['phaseOutcome']>['weaving'],
  ): NonNullable<StatusResponse['phaseOutcome']>['weaving'] {
    const rank = (value: string) => ({ not_reached: 0, running: 1, skipped: 2, completed: 2, failed: 3 }[value] ?? 0);
    return rank(previous) > rank(next) ? previous : next;
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

  private isGoalSettingStage(stage: string): boolean {
    return /goal[-_ ]?setting/.test(stage);
  }

  private resolveGoalSettingOutcome(
    started: boolean,
    failed: boolean,
    fallback: boolean,
    completedAt: string | undefined,
    downstreamStarted: boolean,
    jobStatus: Job['status'],
  ): NonNullable<StatusResponse['phaseOutcome']>['goalSetting'] {
    if (!started) return 'not_reached';
    if (failed) return fallback ? 'completed_with_fallback' : 'failed';
    if (completedAt || downstreamStarted || jobStatus !== 'running') return 'completed';
    return 'running';
  }

  private isPreAgentValidationFailure(failedCommand: string): boolean {
    return /pre[-_ ]agent validation|pre[-_ ]validation/.test(failedCommand);
  }

  private isPreflightGithubOperations(stage: string): boolean {
    return /github operations.*(preflight|health check)|preflight.*github operations/.test(stage);
  }

  private isWeavingLikeStage(stage: string): boolean {
    // Goal-setting is pre-scouting planning, not weaving.  Weaving begins
    // only after scouting has handed off to coding or a post-coding phase.
    return /coding|weav|goal check|quality|secret scan|github operations|evaluation|final|collect (?:agent )?diff|changed files/.test(stage);
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
      (weavingStage && !this.isPreflightGithubOperations(stage) && /coding|weav|goal check|validation|quality|secret scan|github operations|evaluation|final|collect (?:agent )?diff|changed files/.test(stage))
    );
  }

  private resolveScoutingOutcome(
    scoutingFailed: boolean,
    scoutingStarted: boolean,
    scoutingCompletedAt: string | undefined,
    weavingStarted: boolean,
    failed: boolean,
    scoutingFallback: boolean,
    scoutingEnabled: boolean,
    jobStatus: Job['status'],
  ): NonNullable<StatusResponse['phaseOutcome']>['scouting'] {
    if (scoutingFailed) return 'failed';
    if (scoutingFallback) return 'completed_with_fallback';
    // Coding/weaving cannot start until the optional scouting stage has either
    // completed or been explicitly bypassed. Avoid showing the contradictory
    // "not reached" state once a downstream phase is already in progress.
    // Scouting is enabled by default. When coding starts after its durable
    // artifacts have been rotated or are not mounted yet, do not relabel an
    // executed/fallback scouting phase as "skipped" merely because its live
    // event fell outside the Docker log tail.
    if (!scoutingStarted) return weavingStarted ? (scoutingEnabled ? 'completed' : 'skipped') : 'not_reached';
    if (scoutingCompletedAt || weavingStarted || failed) return 'completed';
    return isExecutionInProgress({
      phase: jobStatus === 'running' ? 'RUNNING' : jobStatus.toUpperCase(),
      outcome: 'IN_PROGRESS',
    }) ? 'running' : 'completed';
  }

  private resolveWeavingOutcome(
    weavingFailed: boolean,
    weavingStarted: boolean,
    weavingCompletedAt: string | undefined,
    stage: string,
    jobStatus: Job['status'],
  ): NonNullable<StatusResponse['phaseOutcome']>['weaving'] {
    if (weavingFailed) return 'failed';
    if (!weavingStarted) return 'not_reached';
    // A failed scout must never imply that weaving completed.  Completion is
    // evidenced by a terminal weaving event; failure is handled above.
    // The worker does not emit a distinct "weaving completed" line before it
    // enters quality/goal-check/evaluation. Those later stages are durable
    // evidence that the coding phase returned, so do not leave the UI stuck
    // on "running" while finalization is underway.
    if (weavingCompletedAt || /quality|goal check|secret scan|evaluation|final/.test(stage)) return 'completed';
    return isExecutionInProgress({
      phase: jobStatus === 'running' ? 'RUNNING' : jobStatus.toUpperCase(),
      outcome: 'IN_PROGRESS',
    }) ? 'running' : 'completed';
  }

  private scoutingFallbackReason(job: Job): string | undefined {
    const file = path.join(this.config.resultsDir, job.id, 'scouting-validation-errors.jsonl');
    try {
      for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (entry.recovered === true && typeof entry.recovery_reason_code === 'string') return entry.recovery_reason_code;
        if (entry.recovered === true && typeof entry.reason_code === 'string' && entry.reason_code.includes('fallback')) return entry.reason_code;
      }
    } catch { /* fallback evidence is optional */ }
    return undefined;
  }

  private goalSettingFallbackReason(job: Job): string | undefined {
    const file = path.join(this.config.resultsDir, job.id, 'goal-setting-validation-errors.jsonl');
    try {
      for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (typeof entry.recovery === 'string' && entry.recovery) return entry.recovery;
        if (typeof entry.reason === 'string' && entry.reason) return entry.reason;
      }
    } catch { /* goal-setting fallback evidence is optional */ }
    return undefined;
  }

  private buildFailureExplanation(failed: boolean, metadata: any, response: StatusResponse, scoutingFallbackReason?: string): string | undefined {
    const fallback = scoutingFallbackReason
      ? ` Scouting continued with a validated fallback handoff (${scoutingFallbackReason}).`
      : '';
    return failed
      ? `Run failed at ${metadata?.failed_command || response.progress?.stage || 'an unknown stage'}; phase outcomes are derived from recorded lifecycle events.${fallback}`
      : (fallback || undefined);
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
