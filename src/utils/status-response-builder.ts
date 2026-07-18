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
import type { ResultCache } from '../result-cache';
import { TaskProgressCalculator } from './task-progress-calculator';
import { DiagnosticExtractor } from './diagnostic-extractor';
import { ArtifactContentLoader } from './artifact-content-loader';
import { StatusMetadataHelper } from './status-response-metadata-helper';
import { StatusArtifactHelper } from './status-response-artifact-helper';
import { StatusLifecycleHelper } from './status-lifecycle-helper';
import { StatusPhaseOutcomeHelper } from './status-phase-outcome-helper';
import { StatusProgressHelper } from './status-progress-helper';

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
  private lifecycleHelper: StatusLifecycleHelper;
  private phaseOutcomeHelper: StatusPhaseOutcomeHelper;
  private progressHelper: StatusProgressHelper;
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
    this.lifecycleHelper = new StatusLifecycleHelper(config);
    this.phaseOutcomeHelper = new StatusPhaseOutcomeHelper(scheduler, config);
    this.progressHelper = new StatusProgressHelper(scheduler, config);

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

  private addTimingInfo(response: StatusResponse, job: Job): void {
    if (job.startedAt) {
      const elapsed = (job.completedAt || new Date()).getTime() - job.startedAt.getTime();
      response.elapsedSeconds = Math.round(elapsed / 1000);

      const timeoutSeconds = job.effectiveTimeoutSeconds ?? this.config.agentTimeoutSeconds;
      const timeoutMs = timeoutSeconds * 1000;
      response.timeoutRiskPercent = Math.round((elapsed / timeoutMs) * 100);
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
  private addProgressInfo(response: StatusResponse, job: Job): void {
    return this.progressHelper.addProgressInfo(response, job);
  }

  private addLifecycleInfo(response: StatusResponse, job: Job, metadata: any): void {
    return this.lifecycleHelper.addLifecycleInfo(response, job, metadata);
  }

  private addPhaseOutcome(response: StatusResponse, job: Job, metadata: any): void {
    return this.phaseOutcomeHelper.addPhaseOutcome(response, job, metadata);
  }

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
