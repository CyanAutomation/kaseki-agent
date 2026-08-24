import { z } from 'zod';
import { RunRequest, StatusResponse, ValidationResponse, type ScorecardResponse, type ScorecardsListResponse } from './kaseki-api-types';
import {
  RunScorecardCompletenessSchema,
  RunScorecardLifecycleStatusSchema,
  RunScorecardSchema,
} from './types/run-scorecard';

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
  displayName: z.string().optional(),
  percentComplete: z.number().optional(),
  message: z.string().optional(),
  updatedAt: z.string().optional(),
  source: z.enum(['progress.jsonl', 'docker-logs']).optional(),
  timestampEstimated: z.boolean().optional(),
});

const CriticalChangeContractSchema = z.object({
  source: z.unknown().optional(),
  expectedFiles: z.array(z.string()),
  downgradedFiles: z.array(z.string()),
  changedFiles: z.array(z.string()).optional(),
  retryCount: z.number(),
});

const StatusResponseSchema = z.object({
  id: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  failureClass: z.string().optional(),
  failedCommand: z.string().optional(),
  criticalChangeContract: CriticalChangeContractSchema.optional(),
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
  runEvaluation: z.object({
    status: z.enum(['passed', 'warning']),
    warning: z.string().optional(),
    exitCode: z.number().optional(),
  }).optional(),
  artifacts: z.object({
    metadataJson: z.boolean(),
    analysisMd: z.boolean(),
    resultSummaryMd: z.boolean(),
    failureJson: z.boolean(),
    stderrLog: z.boolean(),
    stdoutLog: z.boolean().default(false),
    availableFiles: z.array(z.string()),
    diagnosticFiles: z.array(z.string()).optional(),
  }).optional(),
  diagnosticEntryPoint: z.enum([
    'failure.json',
    'analysis.md',
    'result-summary.md',
    'stderr.log',
    'stdout.log',
    '.gateway-diagnostics.jsonl',
    'pi-agent-diagnostics.jsonl',
    'pi-events.jsonl',
    'pi-summary.json',
    'progress-stream-diagnostics.log',
    'goal-setting-validation-errors.jsonl',
    'goal-setting-stderr.log',
    'scouting-validation-errors.jsonl',
    'scouting-contract-diagnostics.jsonl',
    'scouting-retry-diagnostics.jsonl',
    'scouting-stderr.log',
    'goal-check-validation-errors.jsonl',
    'goal-check-stderr.log',
  ]).optional(),
});
const ScorecardResponseSchema = RunScorecardSchema;
const ScorecardSummarySchema = z.object({
  runId: z.string(),
  lifecycleStatus: RunScorecardLifecycleStatusSchema,
  overallScore: z.number().min(0).max(100),
  grade: z.enum(['A', 'B', 'C', 'D', 'F']),
  rubricVersion: z.string(),
  completeness: RunScorecardCompletenessSchema,
  confidence: z.number().min(0).max(100),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  scoredAt: z.string().datetime(),
  model: z.string().optional(),
  repository: z.string().optional(),
});
const ScorecardsListResponseSchema = z.object({
  scorecards: z.array(ScorecardSummarySchema),
  pagination: z.object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }),
  filters: z.object({
    lifecycleStatus: z.string().optional(),
    grade: z.string().optional(),
    rubricVersion: z.string().optional(),
    model: z.string().optional(),
    repository: z.string().optional(),
    startedAfter: z.string().optional(),
    startedBefore: z.string().optional(),
  }),
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
        // Drain the response body if it wasn't JSON to prevent handle leaks
        await res.text().catch(() => {});
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
      // Drain the response body to release the HTTP connection
      await res.text().catch(() => {});
      throw new Error(`Run not found: ${runId}`);
    }

    if (!res.ok) {
      // Drain the response body to release the HTTP connection
      await res.text().catch(() => {});
      throw new Error(`Failed to get status: ${res.status}`);
    }

    const data = await res.json();
    return StatusResponseSchema.parse(data);
  }

  async getScorecard(runId: string): Promise<ScorecardResponse> {
    const res = await fetch(`${this.baseUrl}/api/runs/${encodeURIComponent(runId)}/scorecard`, { headers: this.baseHeaders });
    if (!res.ok) { await res.text().catch(() => {}); throw new Error(`Failed to get scorecard: ${res.status}`); }
    return ScorecardResponseSchema.parse(await res.json());
  }

  async listScorecards(query: Record<string, string | number> = {}): Promise<ScorecardsListResponse> {
    const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
    const res = await fetch(`${this.baseUrl}/api/scorecards${params.size ? `?${params}` : ''}`, { headers: this.baseHeaders });
    if (!res.ok) { await res.text().catch(() => {}); throw new Error(`Failed to list scorecards: ${res.status}`); }
    return ScorecardsListResponseSchema.parse(await res.json());
  }

}
