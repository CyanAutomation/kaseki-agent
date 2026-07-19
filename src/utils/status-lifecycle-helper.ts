import * as path from 'path';
import * as fs from 'fs';
import { Job } from '../kaseki-api-types';
import type { StatusResponse } from '../kaseki-api-types';
import { KasekiApiConfig } from '../kaseki-api-config';

type ProviderRetryMetadata = {
  retryCount: number;
  scoutingAttempts: number;
  scoutingMaximum: number;
  retryResult: string;
  providerError: string;
  providerPhase?: string;
  provider?: string;
};

export class StatusLifecycleHelper {
  constructor(private config: KasekiApiConfig) {}

  addLifecycleInfo(response: StatusResponse, job: Job, metadata: any): void {
    response.cancellable = job.status === 'queued' || job.status === 'running';
    response.lifecyclePhase = this.resolveLifecyclePhase(response, job);

    const retryMetadata = this.resolveProviderRetryMetadata(metadata);

    this.addLiveRetryInfo(response, retryMetadata.retryCount);

    const failedCommand = String(metadata?.failed_command ?? '').toLowerCase();
    if (this.isScoutingArtifactFailure(job, failedCommand, retryMetadata.scoutingAttempts)) {
      this.addScoutingArtifactFailureInfo(response, job, retryMetadata);
    } else if (this.hasProviderRetryInfo(retryMetadata)) {
      this.addProviderRetryInfo(response, job, metadata, retryMetadata);
    }

    this.addAttemptDisplayName(response);
    this.addProgressHeartbeat(response, job);
  }

  private resolveLifecyclePhase(response: StatusResponse, job: Job): StatusResponse['lifecyclePhase'] {
    if (job.status === 'completed' || job.status === 'failed') return 'terminal';
    if (job.status === 'queued') return 'queued';
    const stage = String(response.progress?.stage ?? job.currentStage ?? '').toLowerCase();
    const progressMessage = String(response.progress?.message ?? '').toLowerCase();
    return /run evaluation|artifact|report|consolidat|finaliz/.test(`${stage} ${progressMessage}`)
      ? 'finalizing'
      : 'executing';
  }

  private resolveScoutingMaximum(metadata: any, scoutingAttempts: number): number {
    const configuredScoutingMaximum = Number(metadata?.scouting_max_attempts ?? 2);
    return Number.isFinite(configuredScoutingMaximum) && configuredScoutingMaximum > 0
      ? Math.max(scoutingAttempts, configuredScoutingMaximum)
      : Math.max(1, scoutingAttempts);
  }

  private resolveProviderRetryMetadata(metadata: any): ProviderRetryMetadata {
    const retryCount = Number(metadata?.provider_error_retry_attempt_count ?? 0);
    const scoutingAttempts = Number(metadata?.scouting_attempts ?? 0);
    return {
      retryCount,
      scoutingAttempts,
      scoutingMaximum: this.resolveScoutingMaximum(metadata, scoutingAttempts),
      retryResult: String(metadata?.provider_error_retry_result ?? ''),
      providerError: String(metadata?.provider_error_message ?? ''),
      providerPhase: String(metadata?.provider_error_phase ?? '').trim() || undefined,
      provider: String(metadata?.provider_error_provider ?? '').trim() || undefined,
    };
  }

  private hasProviderRetryInfo(metadata: ProviderRetryMetadata): boolean {
    return metadata.retryCount > 0 || metadata.retryResult === 'failed' || metadata.providerError.length > 0;
  }

  private addLiveRetryInfo(response: StatusResponse, retryCount: number): void {
    const liveRetryMessage = String(response.progress?.message ?? '');
    const liveRetry = /provider retry (scheduled|started|succeeded|exhausted).*attempt\s+(\d+)\/(\d+)/i.exec(liveRetryMessage);
    if (!liveRetry || retryCount !== 0) return;

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

  private isScoutingArtifactFailure(job: Job, failedCommand: string, scoutingAttempts: number): boolean {
    return job.status === 'failed' && /scout|scouting/.test(failedCommand) && scoutingAttempts > 0;
  }

  private addScoutingArtifactFailureInfo(
    response: StatusResponse,
    job: Job,
    metadata: ProviderRetryMetadata,
  ): void {
    const contractFailure = this.readPrimaryScoutingContractFailure(
      job.resultDir || path.join(this.config.resultsDir, job.id)
    );
    const rootCause = contractFailure?.detail || metadata.providerError || 'Scouting did not produce a valid handoff artifact.';
    response.attempt = {
      phase: 'scouting', current: metadata.scoutingAttempts, maximum: metadata.scoutingMaximum,
      state: metadata.scoutingAttempts >= metadata.scoutingMaximum ? 'exhausted' : 'failed',
      provider: metadata.provider,
      lastError: rootCause,
    };
    response.diagnosis = {
      severity: 'error', phase: 'scouting', category: 'artifact_contract',
      summary: rootCause,
      retryCount: Math.max(0, metadata.scoutingAttempts - 1),
      retryExhausted: metadata.scoutingAttempts >= metadata.scoutingMaximum,
      remediation: contractFailure?.suggestion || 'Inspect scouting-validation-errors.jsonl and scouting-attempt-*-events.jsonl; verify the agent can write the required candidate artifact.',
      artifact: 'scouting-validation-errors.jsonl',
    };
  }

  private addProviderRetryInfo(
    response: StatusResponse,
    job: Job,
    metadata: any,
    retryMetadata: ProviderRetryMetadata,
  ): void {
    const exhausted = retryMetadata.retryResult === 'failed';
    const terminalRetryState = job.status === 'failed'
      ? 'exhausted'
      : job.status === 'completed' && retryMetadata.retryResult === 'success' ? 'succeeded' : undefined;
    response.attempt = {
      phase: retryMetadata.providerPhase,
      current: Math.max(1, retryMetadata.retryCount),
      maximum: Math.max(2, retryMetadata.retryCount),
      state: terminalRetryState || (exhausted ? 'exhausted' : retryMetadata.retryResult === 'success' ? 'succeeded' : 'retrying'),
      provider: retryMetadata.provider,
      lastError: retryMetadata.providerError || undefined,
    };
    response.diagnosis = {
      severity: terminalRetryState === 'exhausted' || exhausted ? 'error' : 'warning',
      phase: retryMetadata.providerPhase,
      category: String(metadata?.provider_error_type ?? 'provider_error'),
      summary: retryMetadata.providerError || (exhausted ? 'Provider retry budget exhausted.' : 'Provider request is being retried.'),
      retryCount: retryMetadata.retryCount,
      retryExhausted: terminalRetryState === 'exhausted' || exhausted,
      remediation: terminalRetryState === 'exhausted' || exhausted
        ? 'Inspect provider-attempts.jsonl, then retry with a healthy model or provider.'
        : 'Wait for the bounded retry to complete.',
      artifact: 'provider-attempts.jsonl',
    };
  }

  private addAttemptDisplayName(response: StatusResponse): void {
    if (!response.attempt || !response.progress) return;

    const phase = String(response.attempt.phase ?? response.progress.stage ?? 'provider');
    const label = phase.toLowerCase().includes('coding') ? 'Coding' : phase;
    const state = response.attempt.state === 'retrying'
      ? 'retrying'
      : response.attempt.state === 'exhausted' ? 'exhausted' : response.attempt.state;
    response.progress.displayName = `${label} attempt ${response.attempt.current}/${response.attempt.maximum} — ${state}`;
  }

  private addProgressHeartbeat(response: StatusResponse, job: Job): void {
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
}
