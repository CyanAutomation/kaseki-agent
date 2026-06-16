import * as path from 'path';
import * as fs from 'fs';
import { Job } from '../kaseki-api-types';
import type { DiagnosticEntryPoint, StatusResponse } from '../kaseki-api-types';
import { KasekiApiConfig } from '../kaseki-api-config';
import { JobScheduler } from '../job-scheduler';
import { getRunArtifactMetadata } from '../run-artifact-metadata-cache';
import {
  resolveInstanceExitCode,
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

const STATUS_KEY_FILES = ['metadata.json', 'analysis.md', 'result-summary.md', 'failure.json', 'stderr.log', 'stdout.log'] as const;
const GOAL_CHECK_DIAGNOSTIC_FILES = [
  'goal-check-validation-errors.jsonl',
  'goal-check-stderr.log',
  'goal-check.json',
  'goal-check-attempts.jsonl',
] as const;
const GOAL_SETTING_DIAGNOSTIC_FILES = [
  'goal-setting-validation-errors.jsonl',
  'goal-setting-stderr.log',
  'goal-setting.json',
] as const;
const SCOUTING_DIAGNOSTIC_FILES = [
  'scouting-validation-errors.jsonl',
  'scouting-stderr.log',
  'scouting.json',
] as const;
const GOAL_CHECK_ARTIFACT_INVALID_REASON = 'goal_check_artifact_invalid';
const INLINE_ARTIFACT_LIMIT_BYTES = 65536;

const BASE_ORCHESTRATOR_STAGES = [
  'clone repository',
  'prepare node dependencies',
  'agent setup',
  'TypeScript pre-check',
  'pi coding agent',
  'collect agent diff',
  'quality checks',
  'validation',
  'secret scan',
  'complete',
] as const;

export function deriveOrchestratorStages(job: Job, config: KasekiApiConfig): string[] {
  const request = job.request ?? ({} as Job['request']);
  const taskMode = request.taskMode || config.defaultTaskMode;
  const publishMode = request.publishMode || 'pr';
  const startupCheck = request.startupCheck === true;
  const dryRun = startupCheck;
  const githubAppEnabled = publishMode !== 'none';
  const preAgentValidation = taskMode === 'inspect' ? false : true;
  const goalSettingEnabled = taskMode === 'inspect' ? request.goalSetting?.enabled === true : request.goalSetting?.enabled ?? true;
  const scoutingEnabled = taskMode === 'inspect' ? false : true;
  const goalCheckEnabled = taskMode === 'inspect'
    ? request.goalCheck?.enabled === true
    : request.goalCheck?.enabled ?? scoutingEnabled;
  const defaultRunEvaluation = (publishMode === 'pr' || publishMode === 'draft_pr') && taskMode !== 'inspect' && !startupCheck;
  const runEvaluationEnabled = taskMode === 'inspect'
    ? request.runEvaluation?.enabled === true
    : request.runEvaluation?.enabled ?? defaultRunEvaluation;
  const autoLintCleanup = request.autoLintCleanup ?? request.validation?.autoLintCleanup;
  const autoLintCleanupEnabled = taskMode === 'inspect' && autoLintCleanup?.enabled === undefined
    ? false
    : autoLintCleanup?.enabled ?? true;

  const stages: string[] = [];
  stages.push('clone repository');
  stages.push('prepare node dependencies');
  if (preAgentValidation) {
    if ((request.validationCommands ?? request.validation?.commands)?.length) {
      stages.push('baseline validation');
    }
    stages.push('pre-agent validation');
  }
  stages.push('TypeScript pre-check');
  if (goalSettingEnabled) {
    stages.push('pi goal-setting agent');
  }
  if (scoutingEnabled) {
    stages.push('scouting prerequisites check');
    stages.push('pi scouting agent', 'derive allowlist from scouting');
  }
  if (goalCheckEnabled) {
    stages.push('goal check');
  }
  if (runEvaluationEnabled) {
    stages.push('run evaluation');
  }
  stages.push('agent setup', 'pi coding agent');
  if (autoLintCleanupEnabled && !dryRun) {
    stages.push('auto lint cleanup');
  }
  stages.push('collect agent diff', 'quality checks', 'validation', 'secret scan');
  if (!dryRun && githubAppEnabled) {
    stages.push('github operations');
  }
  stages.push('complete');

  return stages.length > 0 ? stages : [...BASE_ORCHESTRATOR_STAGES];
}

/**
 * Builds StatusResponse objects with timing, progress, and artifact information.
 * Encapsulates complex response building logic from status routes.
 */
export class StatusResponseBuilder {
  private taskProgressCalculator: TaskProgressCalculator;
  private diagnosticExtractor: DiagnosticExtractor;
  private artifactContentLoader: ArtifactContentLoader;

  constructor(
    private scheduler: JobScheduler,
    private config: KasekiApiConfig,
    private artifactCache?: Pick<ResultCache, 'getOrLoad'>
  ) {
    this.taskProgressCalculator = new TaskProgressCalculator(scheduler, config);
    this.diagnosticExtractor = new DiagnosticExtractor();
    this.artifactContentLoader = new ArtifactContentLoader(artifactCache);
  }

  /**
   * Build a complete StatusResponse for a job.
   */
  buildStatus(job: Job): StatusResponse {
    const runDir = job.resultDir || path.join(this.config.resultsDir, job.id);
    const exitCode = this.resolveExitCode(job, runDir);
    const metadata = this.readMetadata(runDir);
    const validationReason = extractValidationFailureReason(metadata);
    const validationAllowlistReason = extractValidationAllowlistFailureReason(metadata);
    const qualityReason = extractQualityFailureReason(metadata);
    const goalCheckReason = extractGoalCheckFailureReason(metadata);
    const response: StatusResponse = {
      id: job.id,
      status: job.status,
      completedAt: this.resolveCompletedAt(job, metadata),
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
    this.addTaskProgressInfo(response, job);
    this.addArtifactInfo(response, job);
    this.addDiagnosticSummary(response, job);

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

  private addArtifactInfo(response: StatusResponse, job: Job): void {
    if (!(job.status === 'completed' || job.status === 'failed')) {
      return;
    }

    const runDir = job.resultDir || path.join(this.config.resultsDir, job.id);
    const metadata = this.readMetadata(runDir);
    const includeGoalCheckDiagnostics =
      job.status === 'failed' && response.goalCheckFailureReason === GOAL_CHECK_ARTIFACT_INVALID_REASON;
    const includeGoalSettingDiagnostics = job.status === 'failed' && this.shouldIncludePhaseDiagnostics(
      metadata,
      'goal-setting',
      GOAL_SETTING_DIAGNOSTIC_FILES,
      runDir
    );
    const includeScoutingDiagnostics = job.status === 'failed' && this.shouldIncludePhaseDiagnostics(
      metadata,
      'scouting',
      SCOUTING_DIAGNOSTIC_FILES,
      runDir
    );
    const artifactFiles = [
      ...STATUS_KEY_FILES,
      ...(includeGoalSettingDiagnostics ? GOAL_SETTING_DIAGNOSTIC_FILES : []),
      ...(includeScoutingDiagnostics ? SCOUTING_DIAGNOSTIC_FILES : []),
      ...(includeGoalCheckDiagnostics ? GOAL_CHECK_DIAGNOSTIC_FILES : []),
    ];
    const artifactMetadata = getRunArtifactMetadata(job.id, runDir, artifactFiles, true);
    const isAvailable = (fileName: string): boolean =>
      artifactMetadata[fileName]?.exists === true && artifactMetadata[fileName].size > 0;
    const isSmallAvailable = (fileName: string): boolean =>
      isAvailable(fileName) && artifactMetadata[fileName].size <= INLINE_ARTIFACT_LIMIT_BYTES;
    const keyFileAvailability = STATUS_KEY_FILES.reduce(
      (acc, fileName) => {
        acc[fileName] = isAvailable(fileName);
        return acc;
      },
      {} as Record<(typeof STATUS_KEY_FILES)[number], boolean>
    );
    const diagnosticFiles = [
      ...(includeGoalSettingDiagnostics ? GOAL_SETTING_DIAGNOSTIC_FILES : []),
      ...(includeScoutingDiagnostics ? SCOUTING_DIAGNOSTIC_FILES : []),
      ...(includeGoalCheckDiagnostics ? GOAL_CHECK_DIAGNOSTIC_FILES : []),
    ].filter((fileName) => isAvailable(fileName));

    response.artifacts = {
      metadataJson: keyFileAvailability['metadata.json'],
      analysisMd: keyFileAvailability['analysis.md'],
      resultSummaryMd: keyFileAvailability['result-summary.md'],
      failureJson: keyFileAvailability['failure.json'],
      stderrLog: keyFileAvailability['stderr.log'],
      stdoutLog: keyFileAvailability['stdout.log'],
      availableFiles: artifactFiles.filter((fileName) => isAvailable(fileName)),
      ...(diagnosticFiles.length > 0 ? { diagnosticFiles } : {}),
    };

    // Inline diagnostic content for immediate access
    try {
      // Always try to load result-summary.md for terminal jobs
      const summaryPath = path.join(runDir, 'result-summary.md');
      const summaryContent = this.readSmallTerminalArtifact(summaryPath);
      if (summaryContent && summaryContent.length <= INLINE_ARTIFACT_LIMIT_BYTES) { // Max 64 KB inline
        response.resultSummaryContent = summaryContent;
      }

      // Load failure.json for failed jobs
      if (job.status === 'failed') {
        const failurePath = path.join(runDir, 'failure.json');
        const failureContent = this.readSmallTerminalArtifact(failurePath);
        if (failureContent && failureContent.length <= INLINE_ARTIFACT_LIMIT_BYTES) { // Max 64 KB inline
          try {
            response.failureJsonContent = JSON.parse(failureContent);
          } catch {
            // If JSON parse fails, skip inlining
          }
        }

        if (includeGoalSettingDiagnostics) {
          this.artifactContentLoader.addValidationErrorsContent(response, runDir, 'goal-setting-validation-errors.jsonl', 'goalSetting', isSmallAvailable);
        }
        if (includeScoutingDiagnostics) {
          this.artifactContentLoader.addValidationErrorsContent(response, runDir, 'scouting-validation-errors.jsonl', 'scouting', isSmallAvailable);
        }
        if (includeGoalCheckDiagnostics) {
          this.artifactContentLoader.addValidationErrorsContent(response, runDir, 'goal-check-validation-errors.jsonl', 'goalCheck', isSmallAvailable);
        }
      }
    } catch {
      // Silently skip inlining if any error occurs
    }

    if (job.status === 'failed') {
      const phaseDiagnosticEntryPoints: DiagnosticEntryPoint[] = [
        ...(includeGoalSettingDiagnostics ? [
          'goal-setting-validation-errors.jsonl',
          'goal-setting-stderr.log',
        ] as DiagnosticEntryPoint[] : []),
        ...(includeScoutingDiagnostics ? [
          'scouting-validation-errors.jsonl',
          'scouting-stderr.log',
        ] as DiagnosticEntryPoint[] : []),
        ...(includeGoalCheckDiagnostics ? [
          'goal-check-validation-errors.jsonl',
          'goal-check-stderr.log',
        ] as DiagnosticEntryPoint[] : []),
      ];
      const diagnosticEntryPointCandidates: DiagnosticEntryPoint[] = [
        ...phaseDiagnosticEntryPoints,
        'failure.json',
        'analysis.md',
        'result-summary.md',
        'stderr.log',
        'stdout.log',
      ];

      response.diagnosticEntryPoint = diagnosticEntryPointCandidates.find((fileName) => isAvailable(fileName));
    }
  }

  private shouldIncludePhaseDiagnostics(
    metadata: any,
    phase: 'goal-setting' | 'scouting',
    files: readonly string[],
    runDir: string
  ): boolean {
    const failedCommand = String(metadata?.failed_command ?? '');
    if (failedCommand.includes(`pi ${phase} agent`)) {
      return true;
    }
    const phaseExitCode = metadata?.[phase === 'goal-setting' ? 'goal_setting_exit_code' : 'scouting_exit_code'];
    if (Number(phaseExitCode) === 86) {
      return true;
    }
    if (phase === 'scouting') {
      return this.hasUnrecoveredCriticalScoutingDiagnostics(runDir);
    }
    return files.some((fileName) => fs.existsSync(path.join(runDir, fileName)));
  }

  private hasUnrecoveredCriticalScoutingDiagnostics(runDir: string): boolean {
    const validationErrorsContent = this.readSmallTerminalArtifact(path.join(runDir, 'scouting-validation-errors.jsonl'));
    if (!validationErrorsContent || validationErrorsContent.length > INLINE_ARTIFACT_LIMIT_BYTES) {
      return false;
    }

    const errors = this.parseValidationErrorsJsonl(validationErrorsContent);
    if (errors.length === 0) {
      return false;
    }

    const hasRecoveryMarker = errors.some((error) => this.isScoutingRecoveredDiagnostic(error));
    return errors.some((error) => this.isUnrecoveredCriticalScoutingDiagnostic(error, hasRecoveryMarker));
  }

  private parseValidationErrorsJsonl(content: string): Array<Record<string, unknown>> {
    try {
      return content
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as unknown)
        .filter(this.isRecord);
    } catch {
      return [];
    }
  }

  private isScoutingRecoveryDiagnostic(error: Record<string, unknown>): boolean {
    const reason = this.stringField(error, 'reason_code') ?? this.stringField(error, 'reason');
    if (!reason) {
      return false;
    }
    return reason === 'patch_fallback'
      || reason === 'inspect_fallback'
      || this.isRecoveredReason(reason);
  }

  private isScoutingRecoveredDiagnostic(error: Record<string, unknown>): boolean {
    const reason = this.stringField(error, 'reason_code') ?? this.stringField(error, 'reason');
    return reason ? this.isRecoveredReason(reason) : false;
  }

  private isRecoveredReason(reason: string): boolean {
    return reason === 'patch_fallback_recovered'
      || reason === 'inspect_fallback_recovered'
      || reason.endsWith('_recovered');
  }

  private isUnrecoveredCriticalScoutingDiagnostic(error: Record<string, unknown>, hasRecoveryMarker: boolean): boolean {
    const severity = this.stringField(error, 'severity')?.toLowerCase();
    if (severity !== 'critical') {
      return false;
    }
    if (this.isScoutingRecoveryDiagnostic(error)) {
      return false;
    }
    return !hasRecoveryMarker;
  }

  private addTaskProgressInfo(response: StatusResponse, job: Job): void {
    const runDir = job.resultDir || path.join(this.config.resultsDir, job.id);
    const metadata = this.readMetadata(runDir);
    response.taskProgressPercent = this.taskProgressCalculator.calculateProgressPercent(
      response,
      job,
      runDir,
      metadata
    );
  }

  private addDiagnosticSummary(response: StatusResponse, job: Job): void {
    const runDir = job.resultDir || path.join(this.config.resultsDir, job.id);
    this.diagnosticExtractor.extractDiagnosticSummary(response, runDir, (filePath: string) => this.readSmallTerminalArtifact(filePath));
  }

  private readMetadata(runDir: string): any {
    try {
      const metadataPath = path.join(runDir, 'metadata.json');
      if (fs.existsSync(metadataPath)) {
        return JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      }
    } catch {
      // Ignore metadata read errors
    }
    return {};
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

  private resolveExitCode(job: Job, runDir: string): number | null {
    if (job.exitCode !== undefined && job.exitCode !== null) {
      return job.exitCode;
    }
    if (!(job.status === 'completed' || job.status === 'failed')) {
      return null;
    }
    try {
      const metadataPath = path.join(runDir, 'metadata.json');
      const metadata = fs.existsSync(metadataPath)
        ? JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
        : {};
      return resolveInstanceExitCode(runDir, metadata);
    } catch {
      return null;
    }
  }

  private resolveCompletedAt(job: Job, metadata: any): string | undefined {
    if (job.completedAt) {
      return job.completedAt.toISOString();
    }
    if (!(job.status === 'completed' || job.status === 'failed')) {
      return undefined;
    }
    const rawEndedAt = metadata?.ended_at ?? metadata?.completedAt ?? metadata?.completed_at;
    if (typeof rawEndedAt !== 'string' || rawEndedAt.trim().length === 0) {
      return undefined;
    }
    const normalized = /^\d{4}-\d{2}-\d{2}T.*Z$/.test(rawEndedAt)
      ? rawEndedAt
      : rawEndedAt.replace(' ', 'T');
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private stringField(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === 'string' ? value : undefined;
  }
}
