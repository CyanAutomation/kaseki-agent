import * as path from 'path';
import * as fs from 'fs';
import { Job } from '../kaseki-api-types';
import { StatusResponse } from '../kaseki-api-types';
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

const STATUS_KEY_FILES = ['metadata.json', 'analysis.md', 'result-summary.md', 'failure.json', 'stderr.log'] as const;
const GOAL_CHECK_DIAGNOSTIC_FILES = [
  'goal-check-validation-errors.jsonl',
  'goal-check-stderr.log',
  'goal-check.json',
  'goal-check-attempts.jsonl',
] as const;
const GOAL_CHECK_ARTIFACT_INVALID_REASON = 'goal_check_artifact_invalid';

type ProgressEventLike = {
  stage?: unknown;
  status?: unknown;
  detail?: unknown;
};

const BASE_ORCHESTRATOR_STAGES = [
  'clone repository',
  'agent setup',
  'pi coding agent',
  'collect agent diff',
  'quality checks',
  'validation',
  'secret scan',
  'complete',
] as const;

function normalizeStageName(stage: unknown): string | undefined {
  return typeof stage === 'string' && stage.trim().length > 0 ? stage.trim() : undefined;
}

function isFinishedProgressEvent(event: ProgressEventLike): boolean {
  return event.status === 'finished' || (typeof event.detail === 'string' && event.detail.includes('finished'));
}

function deriveOrchestratorStages(job: Job, config: KasekiApiConfig): string[] {
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
  if (preAgentValidation) {
    stages.push('pre-agent validation');
  }
  if (goalSettingEnabled) {
    stages.push('pi goal-setting agent');
  }
  if (scoutingEnabled) {
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
  constructor(
    private scheduler: JobScheduler,
    private config: KasekiApiConfig,
    private artifactCache?: Pick<ResultCache, 'getOrLoad'>
  ) {}

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
        const liveEvents = this.scheduler.getLiveProgressEvents(job.id, 1);
        const lastEvent = liveEvents[liveEvents.length - 1];
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
    const includeGoalCheckDiagnostics =
      job.status === 'failed' && response.goalCheckFailureReason === GOAL_CHECK_ARTIFACT_INVALID_REASON;
    const artifactFiles = includeGoalCheckDiagnostics
      ? [...STATUS_KEY_FILES, ...GOAL_CHECK_DIAGNOSTIC_FILES]
      : [...STATUS_KEY_FILES];
    const metadata = getRunArtifactMetadata(job.id, runDir, artifactFiles, true);
    const isAvailable = (fileName: string): boolean =>
      metadata[fileName]?.exists === true && metadata[fileName].size > 0;
    const keyFileAvailability = STATUS_KEY_FILES.reduce(
      (acc, fileName) => {
        acc[fileName] = isAvailable(fileName);
        return acc;
      },
      {} as Record<(typeof STATUS_KEY_FILES)[number], boolean>
    );
    const diagnosticFiles = includeGoalCheckDiagnostics
      ? GOAL_CHECK_DIAGNOSTIC_FILES.filter((fileName) => isAvailable(fileName))
      : [];

    response.artifacts = {
      metadataJson: keyFileAvailability['metadata.json'],
      analysisMd: keyFileAvailability['analysis.md'],
      resultSummaryMd: keyFileAvailability['result-summary.md'],
      failureJson: keyFileAvailability['failure.json'],
      stderrLog: keyFileAvailability['stderr.log'],
      availableFiles: artifactFiles.filter((fileName) => isAvailable(fileName)),
      ...(includeGoalCheckDiagnostics ? { diagnosticFiles } : {}),
    };

    // Inline diagnostic content for immediate access
    try {
      // Always try to load result-summary.md for terminal jobs
      const summaryPath = path.join(runDir, 'result-summary.md');
      const summaryContent = this.readSmallTerminalArtifact(summaryPath);
      if (summaryContent && summaryContent.length <= 65536) { // Max 64 KB inline
        response.resultSummaryContent = summaryContent;
      }

      // Load failure.json for failed jobs
      if (job.status === 'failed') {
        const failurePath = path.join(runDir, 'failure.json');
        const failureContent = this.readSmallTerminalArtifact(failurePath);
        if (failureContent && failureContent.length <= 65536) { // Max 64 KB inline
          try {
            response.failureJsonContent = JSON.parse(failureContent);
          } catch {
            // If JSON parse fails, skip inlining
          }
        }
      }
    } catch {
      // Silently skip inlining if any error occurs
    }

    if (job.status === 'failed') {
      if (keyFileAvailability['failure.json']) {
        response.diagnosticEntryPoint = 'failure.json';
      } else if (keyFileAvailability['analysis.md']) {
        response.diagnosticEntryPoint = 'analysis.md';
      } else if (keyFileAvailability['result-summary.md']) {
        response.diagnosticEntryPoint = 'result-summary.md';
      }
    }
  }

  private addTaskProgressInfo(response: StatusResponse, job: Job): void {
    if (job.status === 'queued') {
      return;
    }
    try {
      const runDir = job.resultDir || path.join(this.config.resultsDir, job.id);
      const metadata = this.readMetadata(runDir);
      const progressFile = path.join(runDir, 'progress.jsonl');
      const orchestratorStages = deriveOrchestratorStages(job, this.config);

      const { observedStages, finishedStages, currentStage } = this.processProgressEvents(progressFile, job, response);

      const { denominatorStages, totalStages } = this.determineStageDenominator(metadata, orchestratorStages);

      if (totalStages <= 0) {
        response.taskProgressPercent = undefined;
        return;
      }

      const completedStages = this.calculateCompletedStages(
        finishedStages,
        denominatorStages,
        currentStage,
        observedStages,
        orchestratorStages,
        metadata,
        totalStages
      );

      response.taskProgressPercent = this.normalizeProgressPercent(completedStages, totalStages, job.id);
    } catch (error) {
      // If any error occurs, skip task progress calculation.
      if (process.env.KASEKI_DEBUG_PROGRESS === '1') {
        console.error(`[TaskProgressInfo] Error calculating progress for ${job.id}:`, error);
      }
      response.taskProgressPercent = undefined;
    }
  }

  /**
   * Process progress events from file or live scheduler.
   * Returns observed and finished stages plus current stage.
   */
  private processProgressEvents(
    progressFile: string,
    job: Job,
    response: StatusResponse
  ): { observedStages: Set<string>; finishedStages: Set<string>; currentStage: string | undefined } {
    const observedStages = new Set<string>();
    const finishedStages = new Set<string>();
    let currentStage: string | undefined = normalizeStageName(job.currentStage) ?? normalizeStageName(response.progress?.stage);

    const ingestEvent = (event: ProgressEventLike): void => {
      const stage = normalizeStageName(event.stage);
      if (!stage) {
        return;
      }
      observedStages.add(stage);
      currentStage = stage;
      if (isFinishedProgressEvent(event)) {
        finishedStages.add(stage);
      }
    };

    if (fs.existsSync(progressFile)) {
      try {
        const content = fs.readFileSync(progressFile, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());
        for (const line of lines) {
          try {
            ingestEvent(JSON.parse(line) as ProgressEventLike);
          } catch {
            // Skip malformed JSON lines
          }
        }
      } catch {
        // If reading progress.jsonl fails, continue with live progress fallback
      }
    } else if (typeof this.scheduler.getLiveProgressEvents === 'function') {
      try {
        const liveEvents = this.scheduler.getLiveProgressEvents(job.id, 1);
        const lastEvent = liveEvents[liveEvents.length - 1] as ProgressEventLike | undefined;
        if (lastEvent) {
          ingestEvent(lastEvent);
        }
      } catch {
        // Ignore live progress errors; status remains resilient
      }
    }

    return { observedStages, finishedStages, currentStage };
  }

  /**
   * Determine the authoritative list of stages (denominator) and total count.
   */
  private determineStageDenominator(
    metadata: any,
    orchestratorStages: string[]
  ): { denominatorStages: string[]; totalStages: number } {
    const hasMetadataStages = metadata && Array.isArray(metadata.stages) && metadata.stages.length > 0;
    if (hasMetadataStages) {
      const denominatorStages = metadata.stages
        .map(normalizeStageName)
        .filter((stage: string | undefined): stage is string => Boolean(stage));
      return { denominatorStages, totalStages: metadata.stages.length };
    }

    // Fallback to orchestrator stages
    return { denominatorStages: orchestratorStages, totalStages: orchestratorStages.length };
  }

  /**
   * Calculate how many stages have been completed based on observed and finished stages.
   */
  private calculateCompletedStages(
    finishedStages: Set<string>,
    denominatorStages: string[],
    currentStage: string | undefined,
    observedStages: Set<string>,
    orchestratorStages: string[],
    metadata: any,
    totalStages: number
  ): number {
    let completedStages = Array.from(finishedStages).filter(stage => denominatorStages.includes(stage)).length;

    const currentStageIndex = currentStage && denominatorStages.length > 0 ? denominatorStages.indexOf(currentStage) : -1;
    if (currentStageIndex >= 0) {
      completedStages = Math.max(completedStages, currentStageIndex);
      if (currentStage && finishedStages.has(currentStage)) {
        completedStages = Math.max(completedStages, currentStageIndex + 1);
      }
    } else if (!metadata.stages && observedStages.size > 0) {
      const orchestratorStageSet = new Set(orchestratorStages);
      const knownObservedStageCount = Array.from(observedStages).filter(stage => orchestratorStageSet.has(stage)).length;
      completedStages = Math.max(completedStages, Math.min(knownObservedStageCount, totalStages - 1));
    }

    // Clamp to not exceed totalStages
    if (completedStages > totalStages) {
      if (process.env.KASEKI_DEBUG_PROGRESS === '1') {
        console.warn(`[TaskProgressInfo] Warning: completedStages (${completedStages}) > totalStages (${totalStages}). Clamping.`);
      }
      completedStages = totalStages;
    }

    return completedStages;
  }

  /**
   * Normalize completed/total stages into a percentage (0-100).
   */
  private normalizeProgressPercent(completedStages: number, totalStages: number, jobId: string): number {
    const rawPercent = totalStages > 0 ? (completedStages / totalStages) * 100 : 0;
    const normalized = Math.min(100, Math.max(0, Math.round(rawPercent)));

    if (process.env.KASEKI_DEBUG_PROGRESS === '1') {
      console.log(`[TaskProgressInfo] ${jobId}: ${completedStages}/${totalStages} stages = ${normalized}%`);
    }

    return normalized;
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
}
