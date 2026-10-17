import type { SoyuzAdapterConfig } from './config';
import { SoyuzApiError } from './SoyuzApiClient';
import type { SoyuzRunStatus, SoyuzWorkerRun } from './contracts';

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
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > 128 * 1024) {
      throw new Error('Soyuz response exceeded the 128 KB client limit');
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`Soyuz returned invalid JSON (${response.status})`);
    }
    if (!response.ok) {
      const error = parsed.error && typeof parsed.error === 'object'
        ? parsed.error as Record<string, unknown>
        : {};
      throw new SoyuzApiError(
        response.status,
        typeof error.code === 'string' ? error.code : 'SOYUZ_REQUEST_FAILED',
        typeof error.message === 'string' ? error.message : `Soyuz request failed (${response.status})`,
      );
    }
    if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
      throw new Error('Soyuz response did not contain a data object');
    }
    return parsed.data as T;
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
