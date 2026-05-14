import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { RunRequest, RunResponse, StatusResponse, AnalysisResponse, RunsListResponse, ValidationResponse } from './kaseki-api-types';

/**
 * Zod schemas for response validation.
 * Replaces manual type-checking with declarative schema validation.
 */
const HealthResponseSchema = z.object({
  status: z.string(),
  errors: z.array(z.string()).optional(),
});

const ValidationResponseSchema = z.object({
  isValid: z.boolean(),
  checks: z.array(z.any()),
  warnings: z.array(z.any()),
  errors: z.array(z.any()),
});

const StructuredProgressSchema = z.object({
  stage: z.string(),
  percentComplete: z.number().optional(),
  message: z.string().optional(),
  updatedAt: z.string().optional(),
});

const StatusResponseSchema = z.object({
  id: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  failureClass: z.string().optional(),
  error: z.string().optional(),
  exitCode: z.number().optional(),
  elapsedSeconds: z.number().optional(),
  timeoutRiskPercent: z.number().optional(),
  correlationId: z.string().optional(),
  requestId: z.string().optional(),
  resultDir: z.string().optional(),
  progress: StructuredProgressSchema.optional(),
  artifacts: z.object({
    metadataJson: z.boolean(),
    analysisMd: z.boolean(),
    resultSummaryMd: z.boolean(),
    failureJson: z.boolean(),
    stderrLog: z.boolean(),
    availableFiles: z.array(z.string()),
  }).optional(),
  diagnosticEntryPoint: z.enum(['failure.json', 'analysis.md', 'result-summary.md']).optional(),
});

const RunResponseSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  error: z.string().optional(),
});

const ProgressResponseSchema = z.object({
  events: z.array(z.record(z.unknown())),
});

const AnalysisResponseSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  completedAt: z.string().optional(),
  elapsedSeconds: z.number().optional(),
  exitCode: z.number().optional(),
  failureClass: z.string().optional(),
  metadata: z.object({
    model: z.string().optional(),
    instance: z.string().optional(),
    repo: z.string().optional(),
    ref: z.string().optional(),
  }).optional(),
  changes: z.object({
    changedFiles: z.array(z.string()),
    diffSize: z.number(),
  }).optional(),
  validation: z.object({
    passed: z.boolean(),
    commandResults: z.array(z.object({
      command: z.string(),
      exitCode: z.number(),
      elapsed: z.number(),
    })),
  }).optional(),
  errors: z.array(z.string()).optional(),
});

const LogResponseSchema = z.object({
  content: z.string(),
});

const ArtifactResponseSchema = z.object({
  content: z.string(),
});

const RunsListResponseSchema = z.object({
  runs: z.array(z.object({
    id: z.string(),
    status: z.enum(['queued', 'running', 'completed', 'failed']),
    createdAt: z.string(),
    completedAt: z.string().optional(),
    resultDir: z.string().optional(),
    exitCode: z.number().optional(),
    failureClass: z.string().optional(),
    error: z.string().optional(),
  })),
  total: z.number(),
  retention: z.object({
    terminalJobIndexMaxEntries: z.number(),
    note: z.string(),
  }).optional(),
});

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
  private retryConfig = {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 8000,
  };

  constructor(baseUrl: string, apiKey: string, retryConfig?: Partial<typeof KasekiApiClient.prototype.retryConfig>) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.baseHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
    if (retryConfig) {
      this.retryConfig = { ...this.retryConfig, ...retryConfig };
    }
  }

  private parseErrorDetail(value: unknown): string | undefined {
    try {
      const parsed = z.object({ detail: z.string() }).safeParse(value);
      return parsed.success ? parsed.data.detail : undefined;
    } catch {
      return undefined;
    }
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

    const data = await res.json();
    return HealthResponseSchema.parse(data);
  }

  /**
   * Retry helper with exponential backoff.
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    description: string = 'Operation'
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.retryConfig.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on 4xx errors (except 429 Too Many Requests)
        if (
          lastError.message.includes('400') ||
          lastError.message.includes('401') ||
          lastError.message.includes('403') ||
          lastError.message.includes('404')
        ) {
          throw lastError;
        }

        // If this is the last attempt, throw
        if (attempt === this.retryConfig.maxAttempts - 1) {
          throw lastError;
        }

        // Calculate backoff
        const delayMs = Math.min(
          this.retryConfig.initialDelayMs * Math.pow(2, attempt),
          this.retryConfig.maxDelayMs
        );

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError || new Error(`${description} failed after ${this.retryConfig.maxAttempts} attempts`);
  }

  /**
   * Validate a job request before submission.
   */
  async validate(request: RunRequest): Promise<ValidationResponse> {
    const res = await fetch(`${this.baseUrl}/api/validate`, {
      method: 'POST',
      headers: this.baseHeaders,
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      let errorDetail: string | undefined;
      try {
        const errorData = await res.json();
        errorDetail = this.parseErrorDetail(errorData);
      } catch {
        // Ignore
      }
      throw new Error(`Validation failed: ${errorDetail ?? res.statusText}`);
    }

    const data = await res.json();
    return ValidationResponseSchema.parse(data);
  }

  /**
   * Submit a new kaseki run with automatic retry and idempotency support.
   */
  async submit(request: RunRequest): Promise<RunResponse> {
    // Auto-generate idempotency key if not provided
    const idempotencyKey = request.idempotencyKey || randomUUID();
    const requestWithIdempotency = { ...request, idempotencyKey };

    // Perform submission with retry logic
    return this.retryWithBackoff(async () => {
      const res = await fetch(`${this.baseUrl}/api/runs`, {
        method: 'POST',
        headers: this.baseHeaders,
        body: JSON.stringify(requestWithIdempotency),
      });

      if (!res.ok) {
        let errorDetail: string | undefined;
        try {
          const errorData = await res.json();
          errorDetail = this.parseErrorDetail(errorData);
        } catch {
          // Ignore non-JSON error payloads and fall back to statusText.
        }
        throw new Error(`Failed to submit run: ${errorDetail ?? res.statusText}`);
      }

      const data = await res.json();
      return RunResponseSchema.parse(data);
    }, 'Run submission');
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

    const data = await res.json();
    return StatusResponseSchema.parse(data);
  }

  /**
   * Cancel a queued or running run.
   */
  async cancel(runId: string): Promise<StatusResponse> {
    const res = await fetch(`${this.baseUrl}/api/runs/${runId}/cancel`, {
      method: 'POST',
      headers: this.baseHeaders,
    });

    if (res.status === 404) {
      throw new Error(`Run not found: ${runId}`);
    }

    if (!res.ok) {
      throw new Error(`Failed to cancel run: ${res.status}`);
    }

    const data = await res.json();
    return StatusResponseSchema.parse(data);
  }

  /**
   * Get sanitized progress events for a run.
   */
  async getProgress(runId: string, tail?: number): Promise<Array<Record<string, unknown>>> {
    const suffix = typeof tail === 'number' ? `?tail=${encodeURIComponent(String(tail))}` : '';
    const res = await fetch(`${this.baseUrl}/api/runs/${runId}/progress${suffix}`, {
      method: 'GET',
      headers: this.baseHeaders,
    });

    if (res.status === 404) {
      throw new Error(`Progress not found: ${runId}`);
    }

    if (!res.ok) {
      throw new Error(`Failed to get progress: ${res.status}`);
    }

    const data = await res.json();
    const parsed = ProgressResponseSchema.parse(data);
    return parsed.events;
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

    const data = await res.json();
    return AnalysisResponseSchema.parse(data);
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
    const parsed = LogResponseSchema.parse(data);
    return parsed.content;
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
    const parsed = ArtifactResponseSchema.parse(data);
    return parsed.content;
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

    const data = await res.json();
    return RunsListResponseSchema.parse(data);
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
    const timeoutMs = options?.timeout || 95 * 60 * 1000; // 95 min default
    const intervalMs = options?.interval || 5000; // 5 sec default
    const startTime = Date.now();

    // Polling loop: condition checked inside; no syntax for "guaranteed exit" loops in JS
    // Pattern is safe: explicit break/return condition; timeout guard prevents infinite loop

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
