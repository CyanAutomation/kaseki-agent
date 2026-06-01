import { z } from 'zod';
import { RunRequest, StatusResponse, ValidationResponse } from './kaseki-api-types';

/**
 * Zod schemas for response validation.
 * Replaces manual type-checking with declarative schema validation.
 */
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
  validationFailureReason: z.string().optional(),
  validationAllowlistFailureReason: z.string().optional(),
  qualityFailureReason: z.string().optional(),
  goalCheckFailureReason: z.string().optional(),
  error: z.string().optional(),
  exitCode: z.number().optional(),
  elapsedSeconds: z.number().optional(),
  timeoutRiskPercent: z.number().optional(),
  taskProgressPercent: z.number().optional(),
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
    diagnosticFiles: z.array(z.string()).optional(),
  }).optional(),
  diagnosticEntryPoint: z.enum([
    'failure.json',
    'analysis.md',
    'result-summary.md',
    'goal-check-validation-errors.jsonl',
    'goal-check-stderr.log',
  ]).optional(),
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
  private readonly baseUrl: string;
  private readonly baseHeaders: Record<string, string>;
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

}
