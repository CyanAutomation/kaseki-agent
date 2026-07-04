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
    if (retryCount > 0 || retryResult === 'failed' || providerError) {
      const exhausted = retryResult === 'failed';
      response.attempt = {
        phase: providerPhase,
        current: Math.max(1, retryCount),
        maximum: Math.max(2, retryCount),
        state: exhausted ? 'exhausted' : retryResult === 'success' ? 'succeeded' : 'retrying',
        provider,
        lastError: providerError || undefined,
      };
      response.diagnosis = {
        severity: exhausted ? 'error' : 'warning',
        phase: providerPhase,
        category: String(metadata?.provider_error_type ?? 'provider_error'),
        summary: providerError || (exhausted ? 'Provider retry budget exhausted.' : 'Provider request is being retried.'),
        retryCount,
        retryExhausted: exhausted,
        remediation: exhausted
          ? 'Inspect provider-attempts.jsonl, then retry with a healthy model or provider.'
          : 'Wait for the bounded retry to complete.',
        artifact: 'provider-attempts.jsonl',
      };
    }
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
            response.progress = structuredProgress;
          }
        }
      }

      if (!response.progress && typeof this.scheduler.getLiveDockerLogTail === 'function') {
        const dockerEvents = progressEventsFromDockerLogTail(this.scheduler.getLiveDockerLogTail(job.id, 300) ?? undefined);
        const lastEvent = dockerEvents[dockerEvents.length - 1];
        if (lastEvent) {
          const structuredProgress = toStructuredProgress(lastEvent, 'running');
          if (structuredProgress) {
            response.progress = structuredProgress;
          }
        }
      }
    } catch {
      // Ignore progress file errors; status remains resilient
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
