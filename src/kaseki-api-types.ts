import { z } from 'zod';

/**
 * Webhook event types.
 */
export enum WebhookEventType {
  JOB_SUBMITTED = 'job.submitted',
  JOB_STARTED = 'job.started',
  JOB_PROGRESS = 'job.progress',
  JOB_COMPLETED = 'job.completed',
  JOB_FAILED = 'job.failed',
  JOB_CANCELLED = 'job.cancelled',
}

/**
 * Webhook configuration for a run.
 */
export const WebhookConfigSchema = z.object({
  url: z.string().url('Webhook URL must be valid'),
  secret: z.string().min(16).optional().describe('HMAC secret for signature verification'),
  events: z.array(z.nativeEnum(WebhookEventType)).optional().describe('Event types to deliver'),
  retryPolicy: z.object({
    maxAttempts: z.number().int().min(1).max(10).default(5),
    initialDelayMs: z.number().int().min(100).max(5000).default(1000),
    maxDelayMs: z.number().int().min(1000).max(60000).default(30000),
  }).optional(),
});

export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;

/**
 * Webhook payload event.
 */
export interface WebhookPayload {
  eventType: WebhookEventType;
  jobId: string;
  timestamp: string; // ISO 8601
  data: {
    status?: 'queued' | 'running' | 'completed' | 'failed';
    stage?: string;
    elapsed?: number; // seconds
    timeoutRiskPercent?: number;
    exitCode?: number;
    failureClass?: string;
    error?: string;
  };
}

/**
 * Request tracing info.
 */
export const RequestTracingSchema = z.object({
  correlationId: z.string().uuid().optional().describe('Correlation ID for tracking'),
  requestId: z.string().uuid().optional().describe('Unique request ID'),
});

export type RequestTracing = z.infer<typeof RequestTracingSchema>;

/**
 * Request to trigger a new kaseki run.
 */
export const RunRequestSchema = z.object({
  repoUrl: z.string().url('Repository URL must be valid').describe('Git repository URL'),
  ref: z.string().min(1).default('main').describe('Git branch/tag/commit'),
  taskPrompt: z.string().min(10).optional().describe('Task prompt for Pi agent'),
  changedFilesAllowlist: z.array(z.string()).optional().describe('Space-separated file patterns'),
  maxDiffBytes: z.number().int().positive().optional().describe('Max diff size in bytes'),
  validationCommands: z.array(z.string()).optional().describe('Validation commands to run'),
  taskMode: z.enum(['patch', 'inspect']).optional().describe('Task mode: patch or inspect'),
  webhookConfig: WebhookConfigSchema.optional().describe('Webhook configuration for job events'),
  tracing: RequestTracingSchema.optional().describe('Request tracing identifiers'),
  idempotencyKey: z.string().uuid().optional().describe('Idempotency key for safe retries'),
});

export type RunRequest = z.infer<typeof RunRequestSchema>;

/**
 * Response after triggering a run.
 */
export interface RunResponse {
  id: string; // kaseki-N instance ID
  status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: string; // ISO 8601
  correlationId?: string; // Request correlation ID
  requestId?: string; // Unique request ID
  error?: string;
}

/**
 * Status poll response.
 */
export interface StatusResponse {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress?: string;
  elapsedSeconds?: number;
  timeoutRiskPercent?: number;
  exitCode?: number;
  failureClass?: string;
  error?: string;
  resultDir?: string;
  correlationId?: string; // Request correlation ID
  requestId?: string; // Unique request ID
  artifacts?: {
    metadataJson: boolean;
    resultSummaryMd: boolean;
    failureJson: boolean;
    stderrLog: boolean;
    availableFiles: string[];
  };
  diagnosticEntryPoint?: 'failure.json' | 'result-summary.md';
}

/**
 * Pre-flight validation check result.
 */
export interface ValidationCheck {
  name: string; // e.g., 'repo-reachable', 'ref-exists', 'repo-size'
  status: 'pass' | 'fail' | 'warning';
  message: string;
  detail?: string;
}

/**
 * Pre-flight validation response.
 */
export interface ValidationResponse {
  isValid: boolean;
  checks: ValidationCheck[];
  warnings: string[];
  errors: string[];
  estimatedDurationSeconds?: number;
}

/**
 * Log retrieval response.
 */
export interface LogResponse {
  logType: 'stdout' | 'stderr' | 'validation' | 'progress' | 'quality' | 'secret-scan';
  content: string;
  size: number;
}

/**
 * Artifact download response.
 */
export interface ArtifactResponse {
  file: string;
  contentType: string;
  size: number;
  content?: string; // For text artifacts
  url?: string; // For large artifacts, provide signed URL
}

export interface RunArtifactFileMetadata {
  name: string;
  size: number;
  contentType: string;
  available: boolean;
}

export interface RunArtifactsResponse {
  id: string;
  runStatus: 'queued' | 'running' | 'completed' | 'failed';
  exitCode?: number;
  artifacts: RunArtifactFileMetadata[];
  recommended: string[];
}

/**
 * Run analysis response (comprehensive summary).
 */
export interface AnalysisResponse {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
  elapsedSeconds?: number;
  exitCode?: number;
  failureClass?: string;
  metadata?: {
    model?: string;
    instance?: string;
    repo?: string;
    ref?: string;
  };
  changes?: {
    changedFiles: string[];
    diffSize: number;
  };
  validation?: {
    passed: boolean;
    commandResults: Array<{
      command: string;
      exitCode: number;
      elapsed: number;
    }>;
  };
  errors?: string[];
}

/**
 * List runs response.
 */
export interface RunsListResponse {
  runs: Array<{
    id: string;
    status: 'queued' | 'running' | 'completed' | 'failed';
    createdAt: string;
    completedAt?: string;
    resultDir?: string;
  }>;
  total: number;
}

export interface PreflightCheck {
  name: string;
  ok: boolean;
  detail?: string;
  remediation?: string;
}

export interface PreflightResponse {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  checks: PreflightCheck[];
  image?: string;
  templateDir?: string;
  resultsDir: string;
}

/**
 * Error response (RFC 7807 Problem Details).
 */
export interface ErrorResponse {
  type: string; // e.g., 'https://api.kaseki.local/errors#unauthorized'
  title: string; // e.g., 'Unauthorized'
  status: number;
  detail: string;
  instance?: string; // Run ID if applicable
}

/**
 * Internal job representation.
 */
export interface Job {
  id: string; // kaseki-N instance ID
  status: 'queued' | 'running' | 'completed' | 'failed';
  request: RunRequest;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  exitCode?: number;
  failureClass?: string;
  error?: string;
  resultDir?: string;
  processId?: number;
  timeout?: NodeJS.Timeout;
  finalized?: boolean;
  webhookConfig?: WebhookConfig; // Webhook delivery config
  correlationId?: string; // Request correlation ID
  requestId?: string; // Unique request ID
  currentStage?: string; // Current job stage for progress tracking
  idempotencyKey?: string; // Idempotency key for deduplication
}
