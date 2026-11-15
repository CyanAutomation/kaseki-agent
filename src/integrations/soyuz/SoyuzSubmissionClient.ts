import type { SoyuzAdapterConfig } from './config';
import type { SoyuzRunStatus, SoyuzWorkerRun } from './contracts';
import { readSoyuzResponseData } from './soyuz-http';

export interface SoyuzSubmittedRun {
  id: string;
  status: SoyuzRunStatus;
  createdAt: string;
  correlationId?: string;
  requestId?: string;
  origin?: { type: 'api_client' | 'kaseki' | 'mcp'; id: string };
  retryOf?: string | null;
}

export class SoyuzSubmissionClient {
  constructor(
    private readonly config: SoyuzAdapterConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!config.submissionEnabled || !config.submissionApiToken) {
      throw new Error('Soyuz submission client requires SOYUZ_SUBMISSION_ENABLED and its scoped API token');
    }
  }

  createRun(request: Record<string, unknown>, idempotencyKey: string): Promise<SoyuzSubmittedRun> {
    return this.request<SoyuzSubmittedRun>('/v1/runs', 'POST', request, idempotencyKey);
  }

  retryRun(runId: string, idempotencyKey: string): Promise<SoyuzSubmittedRun> {
    return this.request<SoyuzSubmittedRun>(`/v1/runs/${encodeURIComponent(runId)}/retry`, 'POST', {}, idempotencyKey);
  }

  cancelRun(runId: string): Promise<SoyuzSubmittedRun> {
    return this.request<SoyuzSubmittedRun>(`/v1/runs/${encodeURIComponent(runId)}/cancel`, 'POST', {});
  }

  getWorkerRun(runId: string): Promise<SoyuzWorkerRun> {
    return this.request<SoyuzWorkerRun>(`/v1/worker/runs/${encodeURIComponent(runId)}`, 'GET', undefined, undefined, true);
  }

  private async request<T>(
    path: string,
    method: 'GET' | 'POST',
    body?: Record<string, unknown>,
    idempotencyKey?: string,
    workerCredential = false,
  ): Promise<T> {
    const token = workerCredential ? this.config.workerApiToken : this.config.submissionApiToken;
    if (!token) throw new Error(workerCredential ? 'Soyuz worker read credential is not configured' : 'Soyuz submission credential is not configured');
    const response = await this.fetchImpl(`${this.config.apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      ...(body ? { body: JSON.stringify({ ...body, ...(idempotencyKey ? { idempotencyKey } : {}) }) } : {}),
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
    });
    return readSoyuzResponseData<T>(response);
  }
}

export function normalizeSoyuzRunStatus(status: SoyuzRunStatus): 'queued' | 'running' | 'completed' | 'failed' {
  switch (status) {
  case 'admitting':
  case 'queued':
    return 'queued';
  case 'claimed':
  case 'running':
  case 'cancel_requested':
    return 'running';
  case 'completed':
    return 'completed';
  case 'failed':
  case 'cancelled':
  case 'admission_failed':
    return 'failed';
  }
}
