import * as path from 'path';
import * as fs from 'fs';
import { Job } from '../kaseki-api-types';
import { StatusResponse } from '../kaseki-api-types';
import { KasekiApiConfig } from '../kaseki-api-config';
import { JobScheduler } from '../job-scheduler';
import { isNonEmptyFile } from './file-helpers';
import { toStructuredProgress } from './progress-normalizer';

const STATUS_KEY_FILES = ['metadata.json', 'analysis.md', 'result-summary.md', 'failure.json', 'stderr.log'] as const;

/**
 * Builds StatusResponse objects with timing, progress, and artifact information.
 * Encapsulates complex response building logic from status routes.
 */
export class StatusResponseBuilder {
  constructor(
    private scheduler: JobScheduler,
    private config: KasekiApiConfig
  ) {}

  /**
   * Build a complete StatusResponse for a job.
   */
  buildStatus(job: Job): StatusResponse {
    const response: StatusResponse = {
      id: job.id,
      status: job.status,
      exitCode: job.exitCode,
      failureClass: job.failureClass,
      correlationId: job.correlationId,
      requestId: job.requestId,
      error: job.error,
      resultDir: job.resultDir,
    };

    this.addTimingInfo(response, job);
    this.addProgressInfo(response, job);
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
      if (fs.existsSync(progressFile)) {
        const lines = fs.readFileSync(progressFile, 'utf-8').trim().split('\n');
        if (lines.length > 0) {
          const lastEvent = JSON.parse(lines[lines.length - 1]);
          const structuredProgress = toStructuredProgress(lastEvent);
          if (structuredProgress) {
            response.progress = structuredProgress;
          }
        }
      } else if (typeof this.scheduler.getLiveProgressEvents === 'function') {
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
    const keyFileAvailability = STATUS_KEY_FILES.reduce(
      (acc, fileName) => {
        try {
          const filePath = path.join(runDir, fileName);
          acc[fileName] = isNonEmptyFile(filePath);
        } catch {
          acc[fileName] = false;
        }
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
}
