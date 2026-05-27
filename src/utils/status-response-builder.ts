import * as path from 'path';
import * as fs from 'fs';
import { Job } from '../kaseki-api-types';
import { StatusResponse } from '../kaseki-api-types';
import { KasekiApiConfig } from '../kaseki-api-config';
import { JobScheduler } from '../job-scheduler';
import { getRunArtifactMetadata } from '../run-artifact-metadata-cache';
import { resolveInstanceExitCode, extractValidationFailureReason, extractQualityFailureReason, extractGoalCheckFailureReason } from '../instance-state-derivation';
import { toStructuredProgress } from './progress-normalizer';
import { readLastJsonlEvent } from './file-helpers';
import type { ResultCache } from '../result-cache';

const STATUS_KEY_FILES = ['metadata.json', 'analysis.md', 'result-summary.md', 'failure.json', 'stderr.log'] as const;

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
    const qualityReason = extractQualityFailureReason(metadata);
    const goalCheckReason = extractGoalCheckFailureReason(metadata);
    const response: StatusResponse = {
      id: job.id,
      status: job.status,
      exitCode: exitCode ?? undefined,
      failureClass: job.failureClass,
      validationFailureReason: validationReason ?? undefined,
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
    const metadata = getRunArtifactMetadata(job.id, runDir, STATUS_KEY_FILES, true);
    const keyFileAvailability = STATUS_KEY_FILES.reduce(
      (acc, fileName) => {
        acc[fileName] = metadata[fileName]?.exists === true && metadata[fileName].size > 0;
        return acc;
      },
      {} as Record<(typeof STATUS_KEY_FILES)[number], boolean>
    );

    response.artifacts = {
      metadataJson: keyFileAvailability['metadata.json'],
      analysisMd: keyFileAvailability['analysis.md'],
      resultSummaryMd: keyFileAvailability['result-summary.md'],
      failureJson: keyFileAvailability['failure.json'],
      stderrLog: keyFileAvailability['stderr.log'],
      availableFiles: STATUS_KEY_FILES.filter((fileName) => keyFileAvailability[fileName]),
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
    try {
      const runDir = job.resultDir || path.join(this.config.resultsDir, job.id);
      const metadata = this.readMetadata(runDir);
      const progressFile = path.join(runDir, 'progress.jsonl');

      // Read progress events to identify stages and their completion status
      let allStages = new Set<string>();
      const finishedStages = new Set<string>();

      if (fs.existsSync(progressFile)) {
        try {
          const content = fs.readFileSync(progressFile, 'utf-8');
          const lines = content.split('\n').filter(line => line.trim());

          for (const line of lines) {
            try {
              const event = JSON.parse(line);
              if (event.stage && typeof event.stage === 'string') {
                allStages.add(event.stage);
                // Count a stage as completed if we see any "finished" status for it
                if ((event.status === 'finished' || event.detail?.includes('finished')) && !finishedStages.has(event.stage)) {
                  finishedStages.add(event.stage);
                }
              }
            } catch {
              // Skip malformed JSON lines
            }
          }
        } catch {
          // If reading progress.jsonl fails, continue with allStages set
          // We'll use metadata.stages if available
        }
      }

      // Use stages from metadata if available (preferred for terminal states)
      let totalStages = 0;
      if (metadata && Array.isArray(metadata.stages) && metadata.stages.length > 0) {
        totalStages = metadata.stages.length;
      } else if (allStages.size > 0) {
        // Fallback: use stages observed in progress.jsonl (for running state)
        totalStages = allStages.size;
      } else {
        // No stages found anywhere
        response.taskProgressPercent = undefined;
        return;
      }

      let completedStages = finishedStages.size;

      // Validate: completedStages should never exceed totalStages
      // This prevents edge cases where the calculation could exceed 100%
      if (completedStages > totalStages) {
        if (process.env.KASEKI_DEBUG_PROGRESS === '1') {
          console.warn(
            `[TaskProgressInfo] Warning: completedStages (${completedStages}) > totalStages (${totalStages}) for ${job.id}. Clamping to totalStages.`
          );
        }
        completedStages = totalStages;
      }

      // Calculate percentage: completed / total, with explicit bounds (0-100)
      const rawPercent = totalStages > 0 ? (completedStages / totalStages) * 100 : 0;
      response.taskProgressPercent = Math.min(100, Math.max(0, Math.round(rawPercent)));

      if (process.env.KASEKI_DEBUG_PROGRESS === '1') {
        console.log(
          `[TaskProgressInfo] ${job.id}: ${completedStages}/${totalStages} stages = ${response.taskProgressPercent}%`
        );
      }
    } catch (error) {
      // If any error occurs, skip task progress calculation
      // Log the error for debugging 1000% issues
      if (process.env.KASEKI_DEBUG_PROGRESS === '1') {
        console.error(`[TaskProgressInfo] Error calculating progress for ${job.id}:`, error);
      }
      response.taskProgressPercent = undefined;
    }
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
