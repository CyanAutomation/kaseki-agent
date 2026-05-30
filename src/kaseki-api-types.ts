import { z } from 'zod';

/**
 * Artifact availability classification.
 */
export enum ArtifactAvailability {
  ALWAYS = 'always',
  ON_FAILURE = 'on-failure',
  ON_SUCCESS = 'on-success',
  CONDITIONAL = 'conditional', // Depends on job state (e.g., changes exist)
}

/**
 * Comprehensive artifact metadata with discovery hints.
 */
export interface ArtifactMetadataDefinition {
  name: string;
  contentType: string;
  description: string;
  availability: ArtifactAvailability;
  triageOrder?: number; // Lower = higher priority for triage
  sizeHint?: 'small' | 'medium' | 'large'; // Help clients decide whether to inline
}

/**
 * Webhook event types.
 */
export enum WebhookEventType {
  JOB_SUBMITTED = 'job.submitted',
  JOB_STARTED = 'job.started',
  JOB_COMPLETED = 'job.completed',
  JOB_FAILED = 'job.failed',
  JOB_CANCELLED = 'job.cancelled',
}

/**
 * Webhook configuration for a run.
 */
const WebhookConfigSchema = z.object({
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
const RequestTracingSchema = z.object({
  correlationId: z.string().uuid().optional().describe('Correlation ID for tracking'),
  requestId: z.string().uuid().optional().describe('Unique request ID'),
});

export type RequestTracing = z.infer<typeof RequestTracingSchema>;

/**
 * Request to trigger a new kaseki run.
 */
const RunRequestShape = z.object({
  repoUrl: z.string().url('Repository URL must be valid').describe('Git repository URL'),
  ref: z.string().min(1).default('main').describe('Git branch/tag/commit'),
  taskPrompt: z.string().min(10).optional().describe('Task prompt for Pi agent'),
  changedFilesAllowlist: z.array(z.string()).optional().describe('Space-separated file patterns'),
  allowlist: z
    .object({
      include: z.array(z.string()).optional().describe('Alias for changedFilesAllowlist'),
    })
    .optional()
    .describe('Controller-friendly allowlist alias'),
  maxDiffBytes: z.number().int().positive().optional().describe('Max diff size in bytes'),
  validationCommands: z.array(z.string()).optional().describe('Validation commands to run'),
  validation: z
    .object({
      commands: z.array(z.string()).optional().describe('Alias for validationCommands'),
    })
    .optional()
    .describe('Controller-friendly validation alias'),
  scouting: z
    .object({
      enabled: z.boolean().optional().describe('Enable the pre-coding Pi scouting phase'),
      model: z.string().min(1).optional().describe('Optional Pi model override for scouting'),
      timeoutSeconds: z.number().int().min(60).max(10800).optional().describe('Optional scouting timeout in seconds'),
    })
    .optional()
    .describe('Pre-coding Pi scouting controls'),
  goalSetting: z
    .object({
      enabled: z.boolean().optional().describe('Enable the pre-scouting goal-setting Pi agent (default: enabled, set to false to disable)'),
      model: z.string().min(1).optional().describe('Optional Pi model override for goal-setting'),
      timeoutSeconds: z.number().int().min(60).max(10800).optional().describe('Optional goal-setting timeout in seconds'),
    })
    .optional()
    .describe('Pre-scouting goal-setting agent controls'),
  goalCheck: z
    .object({
      enabled: z.boolean().optional().describe('Enable the post-validation goal-check Pi evaluator'),
      maxRetries: z.number().int().min(0).max(5).optional().describe('Maximum coding-agent retries after goal-check misses'),
      model: z.string().min(1).optional().describe('Optional Pi model override for goal checking'),
      timeoutSeconds: z.number().int().min(60).max(10800).optional().describe('Optional goal-check timeout in seconds'),
    })
    .optional()
    .describe('Post-coding goal-check evaluator controls'),
  runEvaluation: z
    .object({
      enabled: z.boolean().optional().describe('Enable the final task-agnostic run evaluator'),
      model: z.string().min(1).optional().describe('Optional Pi model override for run evaluation'),
      timeoutSeconds: z.number().int().min(60).max(10800).optional().describe('Optional run evaluation timeout in seconds'),
    })
    .optional()
    .describe('Final run evaluation controls'),
  taskMode: z.enum(['patch', 'inspect']).optional().describe('Task mode: patch (default, requires code changes) or inspect (read-only analysis, skips pre-agent validation)'),
  publishMode: z.enum(['auto', 'none', 'branch', 'pr', 'draft_pr']).optional().describe('Publishing mode after validation: pr creates a normal pull request (controller default when omitted), draft_pr creates a draft pull request, branch pushes only, auto publishes when credentials are available and skips if missing, none skips publishing'),
  startupCheck: z.boolean().optional().describe('Start a worker container and exit after boot/runtime checks'),
  startupCheckMode: z
    .enum(['boot', 'baseline-validation'])
    .optional()
    .describe('Startup check depth: boot-only container smoke test or baseline validation dry-run'),
  webhookConfig: WebhookConfigSchema.optional().describe('Webhook configuration for job events'),
  tracing: RequestTracingSchema.optional().describe('Request tracing identifiers'),
  idempotencyKey: z.string().uuid().optional().describe('Idempotency key for safe retries'),
  timeoutSeconds: z.number().int().min(60).max(10800).optional().describe('Per-run timeout in seconds'),
});

function normalizeRunRequestAliases(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input;
  }

  const request = { ...(input as Record<string, unknown>) };
  const aliases: Array<[string, string]> = [
    ['repo_url', 'repoUrl'],
    ['git_ref', 'ref'],
    ['task_prompt', 'taskPrompt'],
    ['changed_files_allowlist', 'changedFilesAllowlist'],
    ['max_diff_bytes', 'maxDiffBytes'],
    ['validation_commands', 'validationCommands'],
    ['scouting_config', 'scouting'],
    ['goal_setting', 'goalSetting'],
    ['goal_check', 'goalCheck'],
    ['run_evaluation', 'runEvaluation'],
    ['task_mode', 'taskMode'],
    ['publish_mode', 'publishMode'],
    ['startup_check', 'startupCheck'],
    ['startup_check_mode', 'startupCheckMode'],
    ['webhook_config', 'webhookConfig'],
    ['idempotency_key', 'idempotencyKey'],
    ['timeout_seconds', 'timeoutSeconds'],
  ];

  for (const [snakeCase, camelCase] of aliases) {
    if (request[camelCase] === undefined && request[snakeCase] !== undefined) {
      request[camelCase] = request[snakeCase];
    }
  }

  // Reject skipPreAgentValidation - it's been deprecated in favor of taskMode='inspect'
  if ((request as Record<string, unknown>).skipPreAgentValidation !== undefined) {
    throw new Error(
      'skipPreAgentValidation field has been deprecated. Use taskMode="inspect" instead for read-only analysis that skips pre-validation.'
    );
  }

  return request;
}

export const RunRequestSchema = z.preprocess(normalizeRunRequestAliases, RunRequestShape);

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
  cached?: boolean; // True when returned from an idempotency replay
  completedAt?: string; // ISO 8601 when replaying a terminal run
  exitCode?: number;
  failureClass?: string;
  error?: string;
}

/**
 * Structured progress information for a run.
 */
export interface StructuredProgress {
  stage: string; // Required: current stage name
  percentComplete?: number; // Optional: 0-100
  message?: string; // Optional: detailed message
  updatedAt?: string; // Optional: ISO 8601 timestamp
}

/**
 * Status poll response.
 */
export interface StatusResponse {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress?: StructuredProgress;
  elapsedSeconds?: number;
  timeoutRiskPercent?: number;
  taskProgressPercent?: number;
  goalCheckFailureReason?: string;
  exitCode?: number;
  failureClass?: string;
  validationFailureReason?: string; // e.g., "validation_command_failed: npm run test (exit 1)"
  qualityFailureReason?: string; // e.g., "max_diff_bytes: 250KB exceeds limit of 200KB"
  error?: string;
  resultDir?: string;
  correlationId?: string; // Request correlation ID
  requestId?: string; // Unique request ID
  // Inline diagnostic content (always available for terminal jobs)
  resultSummaryContent?: string; // Human-readable markdown summary
  failureJsonContent?: Record<string, any>; // Structured failure info (only if failed)
  artifacts?: {
    metadataJson: boolean;
    analysisMd: boolean;
    resultSummaryMd: boolean;
    failureJson: boolean;
    stderrLog: boolean;
    availableFiles: string[];
  };
  diagnosticEntryPoint?: 'failure.json' | 'analysis.md' | 'result-summary.md';
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

export interface RunEvaluationRenderedResponse {
  format: 'rendered';
  file: 'run-evaluation.json';
  sections: {
    overall?: Record<string, unknown>;
    summary: string[];
    problem: string[];
    solution: string[];
    humanReview: string[];
    stages: Array<Record<string, unknown>>;
    efficiency: Array<Record<string, unknown>>;
    validation: Array<Record<string, unknown>>;
    opportunities: Array<Record<string, unknown>>;
    warnings: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
  };
  markdown?: string;
  raw: Record<string, unknown>;
}

export interface RunArtifactFileMetadata {
  name: string;
  size: number;
  contentType: string;
  available: boolean;
  description?: string;
  availability?: ArtifactAvailability;
  triageOrder?: number;
}

export interface RunArtifactsResponse {
  id: string;
  runStatus: 'queued' | 'running' | 'completed' | 'failed';
  exitCode?: number;
  artifacts: RunArtifactFileMetadata[];
  recommended: string[];
  artifactCount: number; // Total number of available artifacts
  downloadBaseUrl?: string; // Base URL for artifact downloads
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
    exitCode?: number;
    failureClass?: string;
    error?: string;
  }>;
  total: number;
  retention?: {
    terminalJobIndexMaxEntries: number;
    note: string;
  };
}

export interface PreflightCheck {
  name: string;
  ok: boolean;
  detail?: string;
  remediation?: string;
  templatePath?: string;
  checkoutRef?: string;
  localRef?: string;
  remoteRef?: string;
  remoteUrl?: string;
  doctorCommand?: string;
  doctorStderrTail?: string;
}

export interface PreflightResponse {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  checks: PreflightCheck[];
  containerStartup?: {
    timestamp: string;
    checks: PreflightCheck[];
  };
  image?: string;
  imageDigest?: string;
  templateImage?: string;
  templateImageDigest?: string;
  templateDir?: string;
  templateRef?: string;
  resultsDir: string;
  runtime?: {
    nodeVersion: string;
    uid?: number;
    gid?: number;
    groups?: number[];
  };
  docker?: {
    version?: string;
    clientVersion?: string;
    serverVersion?: string;
  };
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
  effectiveTimeoutSeconds?: number; // Resolved timeout applied to this job
}
