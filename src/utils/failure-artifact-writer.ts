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
 * Handles writing failure artifacts (failure.json, metadata.json, stderr.log, etc.)
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
      this.writeMetadata(resultDir, job, now, options?.lastStage);
      this.writeStderrLog(resultDir, job, options?.stdoutTail, options?.stderrTail);
      this.writeResultSummary(resultDir, job, options?.lastStage);
    } catch (error) {
      // Best effort diagnostics; never mask the primary job failure.
      logWriteError('write failure artifacts', resultDir, error, job.id);
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
      const written = writeIfEmptyAtomic(failurePath, content, { mode: 0o600 }, { jobId: job.id });
      if (!written) {
        logWriteError(
          'write failure.json',
          failurePath,
          'File already exists, is non-empty, or another writer won the artifact race',
          job.id
        );
      }
    } catch (error) {
      logWriteError('write failure.json', failurePath, error, job.id);
    }
  }

  private writeMetadata(resultDir: string, job: Job, now: string, lastStage?: string): void {
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
      lifecycle: {
        lastStage: lastStage || 'unknown',
        phaseOutcome: derivePhaseOutcome(lastStage),
        diagnosticSource: 'api_finalization',
      },
    };
    const content = `${JSON.stringify(payload, null, 2)}\n`;

    try {
      const written = writeIfEmptyAtomic(metadataPath, content, { mode: 0o600 }, { jobId: job.id });
      if (!written) {
        logWriteError(
          'write metadata.json',
          metadataPath,
          'File already exists, is non-empty, or another writer won the artifact race',
          job.id
        );
      }
    } catch (error) {
      logWriteError('write metadata.json', metadataPath, error, job.id);
    }
  }

  private writeResultSummary(resultDir: string, job: Job, lastStage?: string): void {
    const summaryPath = path.join(resultDir, 'result-summary.md');
    const phase = derivePhaseOutcome(lastStage);
    const content = [
      '# Kaseki Agent Run Summary',
      '',
      `- Status: Failed (${job.failureClass || 'api_finalized'})`,
      `- Exit Code: ${job.exitCode ?? 'unknown'}`,
      `- Last Stage: ${lastStage || 'unknown'}`,
      `- Scouting: ${phase.scouting}`,
      `- Weaving: ${phase.weaving}`,
      `- Failure Detail: ${job.error || 'Job failed before runner diagnostics were written.'}`,
      '',
    ].join('\n');
    try {
      writeIfEmptyAtomic(summaryPath, content, {}, { jobId: job.id });
    } catch (error) {
      logWriteError('write result-summary.md', summaryPath, error, job.id);
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
      const written = writeIfEmptyAtomic(stderrPath, `${content}\n`, {}, { jobId: job.id });
      if (!written) {
        logWriteError(
          'write stderr.log',
          stderrPath,
          'File already exists, is non-empty, or another writer won the artifact race',
          job.id
        );
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

function derivePhaseOutcome(lastStage?: string): { scouting: string; weaving: string; explanation: string } {
  const stage = String(lastStage || '').toLowerCase();
  if (!stage) {
    return { scouting: 'unknown', weaving: 'unknown', explanation: 'No lifecycle stage was captured.' };
  }
  const scouting = /scout|goal-setting/.test(stage)
    ? 'running'
    : /coding|weav|goal check|validation|quality|github|evaluation|final/.test(stage)
      ? 'completed'
      : 'not_reached';
  const weaving = /coding|weav|goal check|validation|quality|github|evaluation|final/.test(stage)
    ? 'running'
    : 'not_reached';
  return {
    scouting,
    weaving,
    explanation: `Derived from the last recorded stage: ${lastStage}.`,
  };
}
