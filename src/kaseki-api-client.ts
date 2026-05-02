import { RunRequest, RunResponse, StatusResponse, AnalysisResponse, RunsListResponse } from './kaseki-api-types';

/**
 * Kaseki API client for TypeScript/Node.js applications.
 * Simplifies integration with the Kaseki API service.
 *
 * Example:
 * ```typescript
 * const client = new KasekiApiClient('http://localhost:8080', 'sk-api-key');
 *
 * const run = await client.submit({
 *   repoUrl: 'https://github.com/org/repo',
 *   taskPrompt: 'Fix the bug'
 * });
 *
 * console.log(`Run started: ${run.id}`);
 *
 * // Monitor
 * const status = await client.getStatus(run.id);
 * console.log(`Status: ${status.status}, elapsed: ${status.elapsedSeconds}s`);
 * ```
 */
export class KasekiApiClient {
  private baseUrl: string;
  private baseHeaders: Record<string, string>;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.baseHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private parseErrorDetail(value: unknown): string | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const detail = value.detail;
    return typeof detail === 'string' ? detail : undefined;
  }

  private parseHealthResponse(value: unknown): { status: string; errors?: string[] } {
    if (!this.isRecord(value) || typeof value.status !== 'string') {
      throw new Error('Invalid health response payload');
    }

    if (value.errors !== undefined) {
      if (!Array.isArray(value.errors) || !value.errors.every((item) => typeof item === 'string')) {
        throw new Error('Invalid health response errors payload');
      }
      return { status: value.status as string, errors: value.errors as string[] };
    }

    return { status: value.status as string };
  }

  /**
   * Check API health.
   */
  async getHealth(): Promise<{ status: string; errors?: string[] }> {
    const res = await fetch(`${this.baseUrl}/api/health`, {
      method: 'GET',
      headers: {},
    });

    if (!res.ok) {
      throw new Error(`Health check failed: ${res.status}`);
    }

    const data: unknown = await res.json();
    return this.parseHealthResponse(data);
  }

  /**
   * Submit a new kaseki run.
   */
  async submit(request: RunRequest): Promise<RunResponse> {
    const res = await fetch(`${this.baseUrl}/api/runs`, {
      method: 'POST',
      headers: this.baseHeaders,
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      const errorData: unknown = await res.json();
      const errorDetail = this.parseErrorDetail(errorData);
      throw new Error(`Failed to submit run: ${errorDetail ?? res.statusText}`);
    }

    const data: unknown = await res.json();
    return this.parseRunResponse(data);
  }

  /**
   * Get the status of a run.
   */
  async getStatus(runId: string): Promise<StatusResponse> {
    const res = await fetch(`${this.baseUrl}/api/runs/${runId}/status`, {
      method: 'GET',
      headers: this.baseHeaders,
    });

    if (res.status === 404) {
      throw new Error(`Run not found: ${runId}`);
    }

    if (!res.ok) {
      throw new Error(`Failed to get status: ${res.status}`);
    }

    const data: unknown = await res.json();
    return this.parseStatusResponse(data);
  }

  /**
   * Get comprehensive analysis of a run.
   */
  async getAnalysis(runId: string): Promise<AnalysisResponse> {
    const res = await fetch(`${this.baseUrl}/api/runs/${runId}/analysis`, {
      method: 'GET',
      headers: this.baseHeaders,
    });

    if (res.status === 404) {
      throw new Error(`Run not found: ${runId}`);
    }

    if (!res.ok) {
      throw new Error(`Failed to get analysis: ${res.status}`);
    }

    const data: unknown = await res.json();
    return this.parseAnalysisResponse(data);
  }

  /**
   * Get a log from a run.
   */
  async getLog(
    runId: string,
    logType: 'stdout' | 'stderr' | 'validation' | 'progress' | 'quality' | 'secret-scan'
  ): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/runs/${runId}/logs/${logType}`, {
      method: 'GET',
      headers: this.baseHeaders,
    });

    if (res.status === 404) {
      throw new Error(`Log not found: ${runId}/${logType}`);
    }

    if (!res.ok) {
      throw new Error(`Failed to get log: ${res.status}`);
    }

    const data: unknown = await res.json();
    if (!this.isRecord(data) || typeof data.content !== 'string') {
      throw new Error(`Invalid log payload: ${runId}/${logType}`);
    }
    return data.content;
  }

  /**
   * Get an artifact (diff, metadata, etc.).
   */
  async getArtifact(
    runId: string,
    file: 'git.diff' | 'metadata.json' | 'result-summary.md' | 'pi-events.jsonl' | 'pi-summary.json'
  ): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/results/${runId}/${file}`, {
      method: 'GET',
      headers: this.baseHeaders,
    });

    if (res.status === 404) {
      throw new Error(`Artifact not found: ${runId}/${file}`);
    }

    if (!res.ok) {
      throw new Error(`Failed to get artifact: ${res.status}`);
    }

    const data: unknown = await res.json();
    if (!this.isRecord(data) || typeof data.content !== 'string') {
      throw new Error(`Invalid artifact payload: ${runId}/${file}`);
    }
    return data.content;
  }

  /**
   * List all recent runs.
   */
  async listRuns(): Promise<RunsListResponse> {
    const res = await fetch(`${this.baseUrl}/api/runs`, {
      method: 'GET',
      headers: this.baseHeaders,
    });

    if (!res.ok) {
      throw new Error(`Failed to list runs: ${res.status}`);
    }

    const data: unknown = await res.json();
    return this.parseRunsListResponse(data);
  }

  /**
   * Poll a run until completion.
   * Useful for automated workflows.
   */
  async waitForCompletion(
    runId: string,
    options?: {
      timeout?: number; // Max time to wait (ms)
      interval?: number; // Poll interval (ms)
      onProgress?: (status: StatusResponse) => void; // Progress callback
    }
  ): Promise<StatusResponse> {
    const timeoutMs = options?.timeout || 30 * 60 * 1000; // 30 min default
    const intervalMs = options?.interval || 5000; // 5 sec default
    const startTime = Date.now();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const status = await this.getStatus(runId);

      if (options?.onProgress) {
        options.onProgress(status);
      }

      if (status.status !== 'running' && status.status !== 'queued') {
        return status;
      }

      const elapsed = Date.now() - startTime;
      if (elapsed > timeoutMs) {
        throw new Error(`Timeout waiting for run: ${runId}`);
      }

      // Sleep before next poll
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  private parseRunResponse(data: unknown): RunResponse {
    if (!this.isRecord(data)) throw new Error('Invalid run response payload');
    if (typeof data.id !== 'string' || typeof data.createdAt !== 'string') {
      throw new Error('Invalid run response payload');
    }
    if (!['queued', 'running', 'completed', 'failed'].includes(String(data.status))) {
      throw new Error('Invalid run response status');
    }
    if (data.error !== undefined && typeof data.error !== 'string') {
      throw new Error('Invalid run response error');
    }

    return {
      id: data.id,
      status: data.status as RunResponse['status'],
      createdAt: data.createdAt,
      ...(data.error !== undefined ? { error: data.error } : {}),
    };
  }

  private parseStatusResponse(data: unknown): StatusResponse {
    if (!this.isRecord(data)) throw new Error('Invalid status response payload');
    if (typeof data.id !== 'string') throw new Error('Invalid status response payload');
    if (!['queued', 'running', 'completed', 'failed'].includes(String(data.status))) {
      throw new Error('Invalid status response status');
    }

    const optionalStringFields: Array<keyof Pick<StatusResponse, 'progress' | 'failureClass' | 'error'>> = [
      'progress',
      'failureClass',
      'error',
    ];
    for (const field of optionalStringFields) {
      if (data[field] !== undefined && typeof data[field] !== 'string') {
        throw new Error(`Invalid status response ${field}`);
      }
    }

    const optionalNumberFields: Array<keyof Pick<StatusResponse, 'elapsedSeconds' | 'timeoutRiskPercent' | 'exitCode'>> = [
      'elapsedSeconds',
      'timeoutRiskPercent',
      'exitCode',
    ];
    for (const field of optionalNumberFields) {
      if (data[field] !== undefined && typeof data[field] !== 'number') {
        throw new Error(`Invalid status response ${field}`);
      }
    }

    return {
      id: data.id,
      status: data.status as StatusResponse['status'],
      ...(typeof data.progress === 'string' ? { progress: data.progress } : {}),
      ...(typeof data.elapsedSeconds === 'number' ? { elapsedSeconds: data.elapsedSeconds } : {}),
      ...(typeof data.timeoutRiskPercent === 'number' ? { timeoutRiskPercent: data.timeoutRiskPercent } : {}),
      ...(typeof data.exitCode === 'number' ? { exitCode: data.exitCode } : {}),
      ...(typeof data.failureClass === 'string' ? { failureClass: data.failureClass } : {}),
      ...(typeof data.error === 'string' ? { error: data.error } : {}),
    };
  }

  private parseAnalysisResponse(data: unknown): AnalysisResponse {
    if (!this.isRecord(data)) throw new Error('Invalid analysis response payload');
    if (typeof data.id !== 'string' || typeof data.createdAt !== 'string') {
      throw new Error('Invalid analysis response payload');
    }
    if (!['queued', 'running', 'completed', 'failed'].includes(String(data.status))) {
      throw new Error('Invalid analysis response status');
    }
    return {
      id: data.id,
      status: data.status as AnalysisResponse['status'],
      createdAt: data.createdAt,
      ...(typeof data.completedAt === 'string' ? { completedAt: data.completedAt } : {}),
      ...(typeof data.elapsedSeconds === 'number' ? { elapsedSeconds: data.elapsedSeconds } : {}),
      ...(typeof data.exitCode === 'number' ? { exitCode: data.exitCode } : {}),
      ...(typeof data.failureClass === 'string' ? { failureClass: data.failureClass } : {}),
      ...(this.isRecord(data.metadata) ? { metadata: data.metadata as AnalysisResponse['metadata'] } : {}),
      ...(this.isRecord(data.changes) ? { changes: data.changes as AnalysisResponse['changes'] } : {}),
      ...(this.isRecord(data.validation) ? { validation: data.validation as AnalysisResponse['validation'] } : {}),
      ...(Array.isArray(data.errors) && data.errors.every((item) => typeof item === 'string') ? { errors: data.errors } : {}),
    };
  }

  private parseRunsListResponse(data: unknown): RunsListResponse {
    if (!this.isRecord(data) || !Array.isArray(data.runs) || typeof data.total !== 'number') {
      throw new Error('Invalid runs list response payload');
    }
    const runs = data.runs
      .filter((run): run is Record<string, unknown> => this.isRecord(run))
      .filter(
        (run) =>
          typeof run.id === 'string' &&
          typeof run.createdAt === 'string' &&
          ['queued', 'running', 'completed', 'failed'].includes(String(run.status)) &&
          (run.completedAt === undefined || typeof run.completedAt === 'string')
      )
      .map((run) => ({
        id: run.id as string,
        status: run.status as RunsListResponse['runs'][number]['status'],
        createdAt: run.createdAt as string,
        ...(typeof run.completedAt === 'string' ? { completedAt: run.completedAt as string } : {}),
      }));

    if (runs.length !== data.runs.length) {
      throw new Error('Invalid runs list entries');
    }

    return { runs, total: data.total };
  }
}

/**
 * Helper to create a client with sensible defaults.
 */
export function createKasekiClient(baseUrl?: string, apiKey?: string): KasekiApiClient {
  const url = baseUrl || process.env.KASEKI_API_URL || 'http://localhost:8080';
  const key = apiKey || process.env.KASEKI_API_KEY;

  if (!key) {
    throw new Error('KASEKI_API_KEY environment variable is required');
  }

  return new KasekiApiClient(url, key);
}
