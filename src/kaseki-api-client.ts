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
  private apiKey: string;
  private baseHeaders: Record<string, string>;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = apiKey;
    this.baseHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
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

    return res.json();
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
      const error = await res.json();
      throw new Error(`Failed to submit run: ${error.detail || res.statusText}`);
    }

    return res.json();
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

    return res.json();
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

    return res.json();
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

    const data = await res.json();
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

    const data = await res.json();
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

    return res.json();
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
