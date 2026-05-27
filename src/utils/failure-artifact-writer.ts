import * as fs from 'fs';
import * as path from 'path';
import { StringDecoder } from 'node:string_decoder';
import { Job } from '../kaseki-api-types';
import { writeIfEmptyAtomic, logWriteError } from './file-helpers';

export type CleanupResult = {
  attempted: boolean;
  ok?: boolean;
  detail?: string;
};

/**
 * Handles writing failure artifacts (failure.json, analysis.md, result-summary.md, etc.)
 * when a job fails before complete diagnostics are available.
 */
export class FailureArtifactWriter {
  constructor(private resultsDir: string) {}

  /**
   * Write API finalization artifacts when job fails before container diagnostics.
   */
  writeFailureArtifacts(
    job: Job,
    cleanup: CleanupResult,
    options?: { stdoutTail?: Buffer<ArrayBufferLike>; stderrTail?: Buffer<ArrayBufferLike>; lastStage?: string }
  ): void {
    if (job.status !== 'failed' && !job.failureClass) {
      return;
    }

    const resultDir = path.join(this.resultsDir, job.id);
    const now = (job.completedAt || new Date()).toISOString();
    try {
      fs.mkdirSync(resultDir, { recursive: true });

      this.writeFailureJson(resultDir, job, now, cleanup);
      this.writeResultSummary(resultDir, job, now);
      this.writeAnalysis(resultDir, job, now, cleanup, options?.lastStage);
      this.writeMetadata(resultDir, job, now);
      this.writeStderrLog(resultDir, job, options?.stdoutTail, options?.stderrTail);
    } catch {
      // Best effort diagnostics; never mask the primary job failure.
    }
  }

  private writeFailureJson(resultDir: string, job: Job, now: string, cleanup: CleanupResult): void {
    const failurePath = path.join(resultDir, 'failure.json');
    const payload = {
      failureClass: job.failureClass || 'api_finalized',
      error: job.error || 'Job failed before runner failure metadata was written',
      exitCode: job.exitCode,
      cancelledAt: job.failureClass === 'cancelled' ? now : undefined,
      completedAt: now,
      apiFinalized: true,
      cleanup,
    };
    const content = `${JSON.stringify(payload, null, 2)}\n`;
    
    try {
      const written = writeIfEmptyAtomic(failurePath, content, { mode: 0o600 });
      if (!written) {
        logWriteError('write failure.json', failurePath, 'File already exists and is non-empty', job.id);
      }
    } catch (error) {
      logWriteError('write failure.json', failurePath, error, job.id);
    }
  }

  private writeResultSummary(resultDir: string, job: Job, now: string): void {
    const summaryPath = path.join(resultDir, 'result-summary.md');
    const content = [
      `# ${job.id} failed`,
      '',
      `Failure class: ${job.failureClass || 'unknown'}`,
      `Exit code: ${job.exitCode ?? 'unknown'}`,
      `Error: ${job.error || 'unknown'}`,
      `Completed at: ${now}`,
      '',
    ].join('\n');
    
    try {
      const written = writeIfEmptyAtomic(summaryPath, content);
      if (!written) {
        logWriteError('write result-summary.md', summaryPath, 'File already exists and is non-empty', job.id);
      }
    } catch (error) {
      logWriteError('write result-summary.md', summaryPath, error, job.id);
    }
  }

  private writeAnalysis(resultDir: string, job: Job, now: string, cleanup: CleanupResult, lastStage?: string): void {
    const analysisPath = path.join(resultDir, 'analysis.md');
    const content = [
      `# Failure analysis for ${job.id}`,
      '',
      '## Completed work',
      `- Job lifecycle entered: ${job.startedAt ? 'running' : 'queued'}`,
      '- API finalization fallback written: yes',
      '',
      '## Failure classification',
      `- Failure class: ${job.failureClass || 'unknown'}`,
      `- Exit code: ${job.exitCode ?? 'unknown'}`,
      `- Error: ${job.error || 'unknown'}`,
      `- Last stage: ${lastStage || 'unknown'}`,
      '',
      '## Known warnings',
      `- Container cleanup attempted: ${cleanup.attempted ? 'yes' : 'no'}`,
      `- Container cleanup ok: ${cleanup.ok ? 'yes' : 'no'}`,
      `- Cleanup detail: ${cleanup.detail || 'none'}`,
      '',
      `Completed at: ${now}`,
      '',
    ].join('\n');
    
    try {
      const written = writeIfEmptyAtomic(analysisPath, content);
      if (!written) {
        logWriteError('write analysis.md', analysisPath, 'File already exists and is non-empty', job.id);
      }
    } catch (error) {
      logWriteError('write analysis.md', analysisPath, error, job.id);
    }
  }

  private writeMetadata(resultDir: string, job: Job, now: string): void {
    const metadataPath = path.join(resultDir, 'metadata.json');
    const startedAt = job.startedAt?.toISOString();
    const completedAt = job.completedAt?.toISOString() || now;
    const durationSeconds =
      job.startedAt && (job.completedAt || now)
        ? Math.max(0, Math.round((new Date(completedAt).getTime() - job.startedAt.getTime()) / 1000))
        : undefined;
    const payload = {
      id: job.id,
      status: job.status,
      timestamps: {
        createdAt: job.createdAt.toISOString(),
        startedAt,
        completedAt,
      },
      durations: {
        totalSeconds: durationSeconds,
      },
      runtime: {
        timeoutSeconds: job.effectiveTimeoutSeconds,
        pid: job.processId,
        nodeVersion: process.version,
        platform: process.platform,
      },
      env: {
        taskMode: job.request.taskMode,
        startupCheck: !!job.request.startupCheck,
      },
      failure: {
        failureClass: job.failureClass || 'api_finalized',
        error: job.error || 'Job failed before runner failure metadata was written',
        exitCode: job.exitCode,
        },
      };
    const content = `${JSON.stringify(payload, null, 2)}\n`;
    
    try {
      const written = writeIfEmptyAtomic(metadataPath, content, { mode: 0o600 });
      if (!written) {
        logWriteError('write metadata.json', metadataPath, 'File already exists and is non-empty', job.id);
      }
    } catch (error) {
      logWriteError('write metadata.json', metadataPath, error, job.id);
    }
  }

  private writeStderrLog(
    resultDir: string,
    job: Job,
    stdoutTail?: Buffer<ArrayBufferLike>,
    stderrTail?: Buffer<ArrayBufferLike>
  ): void {
    const stderrPath = path.join(resultDir, 'stderr.log');
    const decodedStderr = stderrTail ? this.decodeUtf8Tail(stderrTail) : '';
    const decodedStdout = stdoutTail ? this.decodeUtf8Tail(stdoutTail) : '';
    const content = [
      'stderr fallback generated by API finalization',
      `failureClass=${job.failureClass || 'unknown'} exitCode=${job.exitCode ?? 'unknown'}`,
      `error=${job.error || 'unknown'}`,
      '',
      decodedStderr ? '--- captured stderr tail ---' : '',
      decodedStderr,
      decodedStdout ? '--- captured stdout tail ---' : '',
      decodedStdout,
    ]
      .filter(Boolean)
      .join('\n');
    
    try {
      const written = writeIfEmptyAtomic(stderrPath, `${content}\n`);
      if (!written) {
        logWriteError('write stderr.log', stderrPath, 'File already exists and is non-empty', job.id);
      }
    } catch (error) {
      logWriteError('write stderr.log', stderrPath, error, job.id);
    }
  }

  private decodeUtf8Tail(tail: Buffer<ArrayBufferLike>): string {
    const decoder = new StringDecoder('utf8');
    return decoder.end(tail);
  }
}
