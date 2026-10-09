import type { SoyuzAdapterConfig } from './config';
import type { SoyuzWorkerRun } from './contracts';

export class SoyuzApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SoyuzApiError';
  }
}

export class SoyuzApiClient {
  constructor(
    private readonly config: SoyuzAdapterConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  getRun(runId: string): Promise<SoyuzWorkerRun> {
    return this.request<SoyuzWorkerRun>(`/v1/worker/runs/${encodeURIComponent(runId)}`, 'GET');
  }

  claim(runId: string, callbackId: string, workerId: string): Promise<unknown> {
    return this.callback(runId, 'claim', { callbackId, workerId, leaseSeconds: 120 });
  }

  started(runId: string, callbackId: string, workerId: string, startedAt: string): Promise<unknown> {
    return this.callback(runId, 'started', { callbackId, workerId, startedAt });
  }

  event(runId: string, eventId: string, workerId: string, type: string, data: Record<string, unknown>): Promise<unknown> {
    return this.callback(runId, 'events', { eventId, workerId, type, ...data });
  }

  completed(runId: string, payload: Record<string, unknown>): Promise<unknown> {
    return this.callback(runId, 'completed', payload);
  }

  failed(runId: string, payload: Record<string, unknown>): Promise<unknown> {
    return this.callback(runId, 'failed', payload);
  }

  cancelled(runId: string, payload: Record<string, unknown>): Promise<unknown> {
    return this.callback(runId, 'cancelled', payload);
  }

  private callback(runId: string, action: string, payload: Record<string, unknown>): Promise<unknown> {
    return this.request(`/v1/worker/runs/${encodeURIComponent(runId)}/${action}`, 'POST', {
      contractVersion: '1',
      ...payload,
    });
  }

  private async request<T>(path: string, method: 'GET' | 'POST', body?: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(`${this.config.apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.config.workerApiToken}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
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
    if (!parsed.data || typeof parsed.data !== 'object') {
      throw new Error('Soyuz response did not contain a data object');
    }
    return parsed.data as T;
  }
}
