import type { SoyuzAdapterConfig } from './config';
import type { SoyuzWorkerRun } from './contracts';
import type { SoyuzArtifactFile } from './soyuz-artifacts';
import { MAX_PUBLICATION_REQUEST_BYTES } from './publication-manifest';
import { readSoyuzResponseData } from './soyuz-http';

export { SoyuzApiError } from './soyuz-http';

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

  started(runId: string, callbackId: string, workerId: string, startedAt: string, claimCallbackId?: string): Promise<unknown> {
    return this.callback(runId, 'started', { callbackId, workerId, startedAt, ...(claimCallbackId ? { claimCallbackId } : {}) });
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

  async uploadArtifact(
    runId: string,
    workerId: string,
    claimCallbackId: string,
    artifact: SoyuzArtifactFile,
  ): Promise<void> {
    const response = await this.fetchImpl(
      `${this.config.apiUrl}/v1/worker/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifact.artifactId)}`,
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${this.config.workerApiToken}`,
          'content-type': artifact.contentType,
          'content-length': String(artifact.body.byteLength),
          'x-artifact-name': artifact.name,
          'x-artifact-kind': artifact.kind,
          'x-soyuz-worker-id': workerId,
          'x-soyuz-claim-callback-id': claimCallbackId,
        },
        body: Uint8Array.from(artifact.body),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      },
    );
    await readSoyuzResponseData<Record<string, unknown>>(response, true);
  }

  async uploadPublicationManifest(
    runId: string,
    workerId: string,
    claimCallbackId: string,
    artifactId: string,
    body: Buffer,
  ): Promise<void> {
    if (body.byteLength < 1 || body.byteLength > MAX_PUBLICATION_REQUEST_BYTES) {
      throw new Error('Kirisame publication manifest exceeds the 9 MiB upload limit');
    }
    const response = await this.fetchImpl(
      `${this.config.apiUrl}/v1/worker/runs/${encodeURIComponent(runId)}/publication-manifests/${encodeURIComponent(artifactId)}`,
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${this.config.workerApiToken}`,
          'content-type': 'application/json; charset=utf-8',
          'content-length': String(body.byteLength),
          'x-soyuz-worker-id': workerId,
          'x-soyuz-claim-callback-id': claimCallbackId,
        },
        body: Uint8Array.from(body),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      },
    );
    await readSoyuzResponseData<Record<string, unknown>>(response, true);
  }

  registerPublicationIntent(
    runId: string,
    workerId: string,
    claimCallbackId: string,
    intent: { artifactId: string; artifactDigest: string; mode: 'branch' | 'pr'; title?: string; body?: string },
  ): Promise<unknown> {
    return this.request(`/v1/worker/runs/${encodeURIComponent(runId)}/publication-intents`, 'POST', {
      contractVersion: '1',
      ...intent,
    }, {
      'x-soyuz-worker-id': workerId,
      'x-soyuz-claim-callback-id': claimCallbackId,
    });
  }

  private callback(runId: string, action: string, payload: Record<string, unknown>): Promise<unknown> {
    return this.request(`/v1/worker/runs/${encodeURIComponent(runId)}/${action}`, 'POST', {
      contractVersion: '1',
      ...payload,
    });
  }

  private async request<T>(
    path: string,
    method: 'GET' | 'POST',
    body?: Record<string, unknown>,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.config.apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.config.workerApiToken}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...extraHeaders,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
    });
    return readSoyuzResponseData<T>(response, true);
  }
}
