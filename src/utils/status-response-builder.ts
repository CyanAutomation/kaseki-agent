import * as path from 'path';
import * as fs from 'fs';
import { Job } from '../kaseki-api-types';
import type { StatusResponse } from '../kaseki-api-types';
import { KasekiApiConfig } from '../kaseki-api-config';
import { JobScheduler } from '../job-scheduler';
import {
  extractValidationFailureReason,
  extractValidationAllowlistFailureReason,
  extractQualityFailureReason,
  extractGoalCheckFailureReason,
} from '../instance-state-derivation';
import { toStructuredProgress } from './progress-normalizer';
import { readLastJsonlEvent } from './file-helpers';
import type { ResultCache } from '../result-cache';
import { progressEventsFromDockerLogTail } from './docker-log-progress-events';
import { TaskProgressCalculator } from './task-progress-calculator';
import { DiagnosticExtractor } from './diagnostic-extractor';
import { ArtifactContentLoader } from './artifact-content-loader';
import { StatusMetadataHelper } from './status-response-metadata-helper';
import { StatusArtifactHelper } from './status-response-artifact-helper';

/**
 * Builds StatusResponse objects with timing, progress, and artifact information.
 * Encapsulates complex response building logic from status routes.
 */
export class StatusResponseBuilder {
  private taskProgressCalculator: TaskProgressCalculator;
  private diagnosticExtractor: DiagnosticExtractor;
  private artifactContentLoader: ArtifactContentLoader;
  private metadataHelper: StatusMetadataHelper;
  private artifactHelper: StatusArtifactHelper;
  private readonly progressHighWater = new Map<string, number>();

  constructor(
    private scheduler: JobScheduler,
    private config: KasekiApiConfig,
    private artifactCache?: Pick<ResultCache, 'getOrLoad'>
  ) {
    this.taskProgressCalculator = new TaskProgressCalculator(scheduler, config);
    this.diagnosticExtractor = new DiagnosticExtractor();
    this.artifactContentLoader = new ArtifactContentLoader(artifactCache);
    this.metadataHelper = new StatusMetadataHelper();

    // Create artifact helper with bound methods
    this.artifactHelper = new StatusArtifactHelper(
      config,
      this.taskProgressCalculator,
      this.diagnosticExtractor,
      this.artifactContentLoader,
      (filePath: string) => this.readSmallTerminalArtifact(filePath),
      (runDir: string) => this.metadataHelper.readMetadata(runDir),
      this.progressHighWater,
      (record: Record<string, unknown>, key: string) => this.metadataHelper.stringField(record, key),
      (value: unknown) => this.metadataHelper.isRecord(value)
    );
  }

  /**
   * Build a complete StatusResponse for a job.
   */
  buildStatus(job: Job): StatusResponse {
    const runDir = job.resultDir || path.join(this.config.resultsDir, job.id);
    const exitCode = this.metadataHelper.resolveExitCode(job, runDir);
    const metadata = this.metadataHelper.readMetadata(runDir);
    const validationReason = extractValidationFailureReason(metadata);
    const validationAllowlistReason = extractValidationAllowlistFailureReason(metadata);
    const qualityReason = extractQualityFailureReason(metadata);
    const goalCheckReason = extractGoalCheckFailureReason(metadata);
    const response: StatusResponse = {
      id: job.id,
      status: job.status,
      completedAt: this.metadataHelper.resolveCompletedAt(job, metadata),
      exitCode: exitCode ?? undefined,
      failureClass: job.failureClass,
      validationFailureReason: validationReason ?? undefined,
      validationAllowlistFailureReason: validationAllowlistReason ?? undefined,
      qualityFailureReason: qualityReason ?? undefined,
      goalCheckFailureReason: goalCheckReason ?? undefined,
      correlationId: job.correlationId,
      requestId: job.requestId,
      error: job.error,
      resultDir: job.resultDir,
    };

    this.addTimingInfo(response, job);
    this.addProgressInfo(response, job);
    this.addLifecycleInfo(response, job, metadata);
    this.addPhaseOutcome(response, job, metadata);
    this.addTaskProgressInfo(response, job);
    this.addArtifactInfo(response, job);
    this.addDiagnosticSummary(response, job);

    if (job.status === 'failed' && !response.error && response.diagnosticSummary?.primaryReason) {
      response.error = response.diagnosticSummary.primaryReason;
    }

    return response;
  }

  private addLifecycleInfo(response: StatusResponse, job: Job, metadata: any): void {
    const terminal = job.status === 'completed' || job.status === 'failed';
    response.cancellable = job.status === 'queued' || job.status === 'running';
    if (terminal) {
      response.lifecyclePhase = 'terminal';
    } else if (job.status === 'queued') {
      response.lifecyclePhase = 'queued';
    } else {
      const stage = String(response.progress?.stage ?? job.currentStage ?? '').toLowerCase();
      const progressMessage = String(response.progress?.message ?? '').toLowerCase();
      response.lifecyclePhase = /run evaluation|artifact|report|consolidat|finaliz/.test(`${stage} ${progressMessage}`)
        ? 'finalizing'
        : 'executing';
    }

    const retryCount = Number(metadata?.provider_error_retry_attempt_count ?? 0);
    const scoutingAttempts = Number(metadata?.scouting_attempts ?? 0);
    const retryResult = String(metadata?.provider_error_retry_result ?? '');
    const providerError = String(metadata?.provider_error_message ?? '');
    const providerPhase = String(metadata?.provider_error_phase ?? '').trim() || undefined;
    const provider = String(metadata?.provider_error_provider ?? '').trim() || undefined;
    const liveRetryMessage = String(response.progress?.message ?? '');
    const liveRetry = /provider retry (scheduled|started|succeeded|exhausted).*attempt\s+(\d+)\/(\d+)/i.exec(liveRetryMessage);
    if (liveRetry && retryCount === 0) {
      const liveState = liveRetry[1].toLowerCase();
      const exhausted = liveState === 'exhausted';
      response.attempt = {
        phase: response.progress?.stage,
        current: Number(liveRetry[2]),
        maximum: Number(liveRetry[3]),
        state: exhausted ? 'exhausted' : liveState === 'succeeded' ? 'succeeded' : 'retrying',
      };
      const retryDelay = /\bin\s+(\d+)s\b/i.exec(liveRetryMessage);
      if (liveState === 'scheduled' && retryDelay) {
        const updatedAtMs = Date.parse(String(response.progress?.updatedAt ?? ''));
        const elapsedSeconds = Number.isFinite(updatedAtMs) ? Math.floor((Date.now() - updatedAtMs) / 1000) : 0;
        response.attempt.nextRetryInSeconds = Math.max(0, Number(retryDelay[1]) - elapsedSeconds);
      }
      response.diagnosis = {
        severity: exhausted ? 'error' : 'warning',
        phase: response.progress?.stage,
        category: 'provider_error',
        summary: liveRetryMessage,
        retryCount: Math.max(0, Number(liveRetry[2]) - 1),
        retryExhausted: exhausted,
        remediation: exhausted
          ? 'The run is finalizing diagnostics; inspect provider-attempts.jsonl when available.'
          : 'Wait for the bounded retry to complete.',
        artifact: 'provider-attempts.jsonl',
      };
    }
    const failedCommand = String(metadata?.failed_command ?? '').toLowerCase();
    const scoutingArtifactFailure = job.status === 'failed'
      && /scout|scouting/.test(failedCommand)
      && scoutingAttempts > 0;
    if (scoutingArtifactFailure) {
      const contractFailure = this.readPrimaryScoutingContractFailure(
        job.resultDir || path.join(this.config.resultsDir, job.id)
      );
      const rootCause = contractFailure?.detail || providerError || 'Scouting did not produce a valid handoff artifact.';
      response.attempt = {
        phase: 'scouting', current: scoutingAttempts, maximum: Math.max(2, scoutingAttempts),
        state: 'exhausted', provider, lastError: rootCause,
      };
      response.diagnosis = {
        severity: 'error', phase: 'scouting', category: 'artifact_contract',
        summary: rootCause,
        retryCount: Math.max(0, scoutingAttempts - 1), retryExhausted: true,
        remediation: contractFailure?.suggestion || 'Inspect scouting-validation-errors.jsonl and scouting-attempt-*-events.jsonl; verify the agent can write the required candidate artifact.',
        artifact: 'scouting-validation-errors.jsonl',
      };
    } else if (retryCount > 0 || retryResult === 'failed' || providerError) {
      const exhausted = retryResult === 'failed';
      const terminalRetryState = job.status === 'failed'
        ? 'exhausted'
        : job.status === 'completed' && retryResult === 'success' ? 'succeeded' : undefined;
      response.attempt = {
        phase: providerPhase,
        current: Math.max(1, retryCount),
        maximum: Math.max(2, retryCount),
        state: terminalRetryState || (exhausted ? 'exhausted' : retryResult === 'success' ? 'succeeded' : 'retrying'),
        provider,
        lastError: providerError || undefined,
      };
      response.diagnosis = {
        severity: terminalRetryState === 'exhausted' || exhausted ? 'error' : 'warning',
        phase: providerPhase,
        category: String(metadata?.provider_error_type ?? 'provider_error'),
        summary: providerError || (exhausted ? 'Provider retry budget exhausted.' : 'Provider request is being retried.'),
        retryCount,
        retryExhausted: terminalRetryState === 'exhausted' || exhausted,
        remediation: terminalRetryState === 'exhausted' || exhausted
          ? 'Inspect provider-attempts.jsonl, then retry with a healthy model or provider.'
          : 'Wait for the bounded retry to complete.',
        artifact: 'provider-attempts.jsonl',
      };
    }

    if (response.attempt && response.progress) {
      const phase = String(response.attempt.phase ?? response.progress.stage ?? 'provider');
      const label = phase.toLowerCase().includes('coding') ? 'Coding' : phase;
      const state = response.attempt.state === 'retrying'
        ? 'retrying'
        : response.attempt.state === 'exhausted' ? 'exhausted' : response.attempt.state;
      response.progress.displayName = `${label} attempt ${response.attempt.current}/${response.attempt.maximum} — ${state}`;
    }

    const updatedAt = Date.parse(String(response.progress?.updatedAt ?? ''));
    if ((job.status === 'running' || job.status === 'queued') && Number.isFinite(updatedAt)) {
      const staleSeconds = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));
      response.progressHeartbeat = {
        updatedAt: response.progress?.updatedAt,
        ageSeconds: staleSeconds,
        stale: staleSeconds >= 120,
      };
      if (staleSeconds >= 120 && !response.diagnosis) {
        response.diagnosis = {
          severity: 'warning',
          phase: response.progress?.stage,
          category: 'stale_progress',
          summary: `No progress update received for ${staleSeconds}s while stage "${response.progress?.stage ?? 'unknown'}" is active.`,
          remediation: 'Inspect the live validation/agent log; the run will be terminated when its bounded stage timeout is reached.',
        };
      }
    }
  }

  private addPhaseOutcome(response: StatusResponse, job: Job, metadata: any): void {
    const stage = String(response.progress?.stage ?? job.currentStage ?? '').toLowerCase();
    const failed = job.status === 'failed';
    const events = this.readPhaseEvents(job);
    const scoutingEvents = events.filter((event) => /scout|scouting/.test(this.eventStage(event)));
    // Validation is not sufficient evidence that weaving started: pre-agent
    // validation runs before scouting and must leave weaving as not_reached.
    // The old broad `validation` match made a run report weaving=running while
    // it was still failing its pre-agent checks.
    const failedCommand = String(metadata?.failed_command ?? stage).toLowerCase();
    const preAgentValidation = /pre[-_ ]agent validation|pre[-_ ]validation/.test(failedCommand);
    const weavingEvents = events.filter((event) => {
      const eventStage = this.eventStage(event);
      // GitHub operations are used for repository/preflight health checks
      // before Pi begins.  They are not evidence that the coding/weaving
      // phase has started.
      if (/github operations.*(preflight|health check)|preflight.*github operations/.test(eventStage)) return false;
      if (preAgentValidation && /pre[-_ ]agent|pre[-_ ]validation/.test(eventStage)) return false;
      if (preAgentValidation && /validation/.test(eventStage) && !/goal check|quality|post[-_ ]agent/.test(eventStage)) return false;
      return /coding|weav|goal check|quality|github operations|evaluation|final/.test(eventStage);
    });
    // `scouting_attempts` is initialised to 1 for metadata schema stability,
    // even when pre-agent validation exits before Pi starts.  Only concrete
    // timing/model/artifact evidence, lifecycle events, or the current stage
    // may mark scouting as started.
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
      weaving: weavingFailed ? 'failed' : weavingStarted ? (weavingCompletedAt || failed ? 'completed' : 'running') : 'not_reached',
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

  /**
   * Return the first critical scouting-contract issue, not the last JSONL
   * entry. Informational schema-normalization entries are often appended after
   * the actual missing-file/schema error and must not become the terminal
   * diagnosis.
   */
  private readPrimaryScoutingContractFailure(runDir: string): { detail: string; suggestion?: string } | undefined {
    const file = path.join(runDir, 'scouting-validation-errors.jsonl');
    try {
      const entries = fs.readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line) => {
          try { return line.trim() ? [JSON.parse(line) as Record<string, unknown>] : []; } catch { return []; }
        });
      const critical = entries.find((entry) => entry.severity === 'critical')
        || entries.find((entry) => ['missing_file', 'malformed_json', 'schema_mismatch', 'schema_validation_failed'].includes(String(entry.reason_code ?? '')));
      if (!critical) return undefined;
      const field = String(critical.field ?? 'scouting artifact');
      const actual = String(critical.actual ?? critical.details ?? critical.reason_code ?? 'contract validation failed');
      const suggestion = typeof critical.suggestion === 'string' ? critical.suggestion : undefined;
      return { detail: `${field}: ${actual}`, suggestion };
    } catch {
      return undefined;
    }
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

  private addTimingInfo(response: StatusResponse, job: Job): void {
    if (job.startedAt) {
      const elapsed = (job.completedAt || new Date()).getTime() - job.startedAt.getTime();
      response.elapsedSeconds = Math.round(elapsed / 1000);

      const timeoutSeconds = job.effectiveTimeoutSeconds ?? this.config.agentTimeoutSeconds;
      const timeoutMs = timeoutSeconds * 1000;
      response.timeoutRiskPercent = Math.round((elapsed / timeoutMs) * 100);
    }
  }

  private addProgressInfo(response: StatusResponse, job: Job): void {
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

  /**
   * Docker log recovery often has no per-line timestamp. Do not expose the
   * worker start time as if it were a live heartbeat; that makes healthy work
   * look stalled and prevents clients from detecting real stalls.
   */
  private refreshEstimatedProgressTimestamp(
    progress: NonNullable<StatusResponse['progress']>,
    rawEvent: Record<string, unknown>,
  ): void {
    if (rawEvent.timestampEstimated === true) {
      progress.updatedAt = new Date().toISOString();
    }
  }

  private readSmallTerminalArtifact(filePath: string): string | null {
    if (this.artifactCache) {
      return this.artifactCache.getOrLoad(filePath);
    }

    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  // Wrapper methods for backward compatibility with existing tests
  private addArtifactInfo(response: StatusResponse, job: Job): void {
    return this.artifactHelper.addArtifactInfo(response, job);
  }

  private addTaskProgressInfo(response: StatusResponse, job: Job): void {
    return this.artifactHelper.addTaskProgressInfo(response, job);
  }

  private addDiagnosticSummary(response: StatusResponse, job: Job): void {
    return this.artifactHelper.addDiagnosticSummary(response, job);
  }
}
