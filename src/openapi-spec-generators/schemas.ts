/**
 * OpenAPI Schema Builders for Kaseki Agent API
 *
 * This module contains builder functions for constructing
 * request/response schemas used in the OpenAPI specification.
 * Each builder creates a complete schema definition for a specific
 * API contract.
 */

/**
 * Build the RunRequest schema.
 * Defines the shape of a request to trigger a new kaseki run.
 */
export function buildRunRequestSchema(): Record<string, unknown> {
  return {
    type: 'object',
    required: ['repoUrl'],
    properties: {
      repoUrl: {
        type: 'string',
        format: 'uri',
        description: 'Git repository URL',
      },
      ref: {
        type: 'string',
        default: 'main',
        description: 'Git branch/tag/commit',
      },
      taskPrompt: {
        type: 'string',
        description: 'Task prompt for Pi agent',
      },
      changedFilesAllowlist: {
        type: 'array',
        items: { type: 'string' },
        description: 'File patterns to allow changes in',
      },
      maxDiffBytes: {
        type: 'integer',
        description: 'Max diff size in bytes',
      },
      validationCommands: {
        type: 'array',
        items: { type: 'string' },
        description: 'Validation commands to run',
      },
      autoLintCleanup: {
        type: 'object',
        description: 'Automatic lint cleanup controls',
        properties: {
          enabled: {
            type: 'boolean',
            description: 'Enable automatic lint cleanup before final quality checks',
          },
          commands: {
            type: 'array',
            items: { type: 'string' },
            description: 'Cleanup commands to run before final quality checks',
          },
        },
      },
      validation: {
        type: 'object',
        description: 'Controller-friendly validation aliases',
        properties: {
          commands: {
            type: 'array',
            items: { type: 'string' },
            description: 'Alias for validationCommands',
          },
          autoLintCleanup: {
            type: 'object',
            description: 'Alias for autoLintCleanup',
            properties: {
              enabled: { type: 'boolean' },
              commands: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      scouting: {
        type: 'object',
        description: 'Pre-coding Pi scouting controls',
        properties: {
          enabled: { type: 'boolean', description: 'Enable the pre-coding Pi scouting phase' },
          model: { type: 'string', description: 'Optional Pi model override for scouting' },
          timeoutSeconds: {
            type: 'integer',
            minimum: 60,
            maximum: 10800,
            description: 'Optional scouting timeout in seconds',
          },
        },
      },
      goalCheck: {
        type: 'object',
        description: 'Post-coding goal-check evaluator controls',
        properties: {
          enabled: { type: 'boolean', description: 'Enable the post-validation goal-check Pi evaluator' },
          maxRetries: {
            type: 'integer',
            minimum: 0,
            maximum: 5,
            description: 'Maximum coding-agent retries after goal-check misses',
          },
          model: { type: 'string', description: 'Optional Pi model override for goal checking' },
          timeoutSeconds: {
            type: 'integer',
            minimum: 60,
            maximum: 10800,
            description: 'Optional goal-check timeout in seconds',
          },
        },
      },
      runEvaluation: {
        type: 'object',
        description: 'Final task-agnostic run evaluation controls',
        properties: {
          enabled: { type: 'boolean', description: 'Enable the final run evaluation phase' },
          model: { type: 'string', description: 'Optional Pi model override for run evaluation' },
          timeoutSeconds: {
            type: 'integer',
            minimum: 60,
            maximum: 10800,
            description: 'Optional run evaluation timeout in seconds',
          },
        },
      },
      taskMode: {
        type: 'string',
        enum: ['patch', 'inspect'],
        description: 'Task mode',
      },
      publishMode: {
        type: 'string',
        enum: ['auto', 'none', 'branch', 'pr', 'draft_pr'],
        description:
          'Publishing mode after validation: pr creates a normal pull request (controller default when omitted), draft_pr creates a draft pull request, branch pushes only, auto publishes when credentials are available and skips if missing, none skips publishing',
      },
      startupCheck: {
        type: 'boolean',
        description: 'Start a worker container and exit after boot checks',
      },
      startupCheckMode: {
        type: 'string',
        enum: ['boot', 'baseline-validation'],
        description: 'Startup check depth: boot-only container smoke test or baseline validation dry-run',
      },
      webhookConfig: {
        type: 'object',
        description: 'Webhook configuration for job events',
      },
      tracing: {
        type: 'object',
        description: 'Request tracing identifiers',
      },
      idempotencyKey: {
        type: 'string',
        format: 'uuid',
        description: 'Idempotency key for safe retries',
      },
      timeoutSeconds: {
        type: 'integer',
        minimum: 60,
        maximum: 10800,
        description: 'Per-run timeout in seconds',
      },
    },
  };
}

/**
 * Build the WebhookConfig schema.
 * Defines the configuration structure for webhook delivery.
 */
function buildWebhookConfigSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        format: 'uri',
        description: 'Webhook URL',
      },
      secret: {
        type: 'string',
        description: 'HMAC secret for signature verification',
      },
      events: {
        type: 'array',
        items: { type: 'string' },
        description: 'Event types to deliver',
      },
      retryPolicy: {
        type: 'object',
        description: 'Retry configuration',
      },
    },
  };
}

/**
 * Build the RequestTracing schema.
 * Defines correlation and request ID tracking fields.
 */
function buildRequestTracingSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      correlationId: {
        type: 'string',
        format: 'uuid',
        description: 'Correlation ID for tracking',
      },
      requestId: {
        type: 'string',
        format: 'uuid',
        description: 'Unique request ID',
      },
    },
  };
}

/**
 * Build the RunResponse schema.
 * Defines the response structure when a run is created or retrieved.
 */
export function buildRunResponseSchema(): Record<string, unknown> {
  return {
    type: 'object',
    required: ['id', 'status', 'createdAt'],
    properties: {
      id: {
        type: 'string',
        description: 'Unique kaseki instance ID (kaseki-N)',
        example: 'kaseki-42',
      },
      status: {
        type: 'string',
        enum: ['queued', 'running', 'completed', 'failed'],
        description: 'Current job status',
      },
      createdAt: {
        type: 'string',
        format: 'date-time',
        description: 'ISO 8601 timestamp when the job was created',
      },
      correlationId: {
        type: 'string',
        description: 'Request correlation ID for tracing',
      },
      requestId: {
        type: 'string',
        description: 'Unique request ID',
      },
      cached: {
        type: 'boolean',
        description: 'True when returned from idempotency replay',
      },
      completedAt: {
        type: 'string',
        format: 'date-time',
        description: 'ISO 8601 timestamp when the job completed',
      },
      exitCode: {
        type: 'integer',
        description: 'Exit code from kaseki execution',
      },
      failureClass: {
        type: 'string',
        description: 'Classification of failure (e.g., validation_failed, timeout)',
      },
      error: {
        type: 'string',
        description: 'Error message if the job failed',
      },
    },
  };
}

/**
 * Build the StatusResponse schema.
 * Defines the structure of status polling responses, including progress and timeout metrics.
 */
function buildStatusResponseSchema(): Record<string, unknown> {
  return {
    type: 'object',
    required: ['id', 'status', 'elapsedSeconds', 'timeoutRiskPercent'],
    properties: {
      id: {
        type: 'string',
        description: 'Kaseki instance ID',
      },
      status: {
        type: 'string',
        enum: ['queued', 'running', 'completed', 'failed'],
      },
      progress: {
        type: 'object',
        properties: {
          stage: { type: 'string', description: 'Current stage name' },
          percentComplete: {
            type: 'integer',
            minimum: 0,
            maximum: 100,
            description: 'Progress percentage (0-100)',
          },
          message: { type: 'string', description: 'Detailed progress message' },
          updatedAt: {
            type: 'string',
            format: 'date-time',
            description: 'ISO 8601 timestamp of last update',
          },
        },
      },
      elapsedSeconds: {
        type: 'number',
        description: 'Elapsed time since job start in seconds',
      },
      timeoutRiskPercent: {
        type: 'number',
        description: 'Percentage of timeout used (0-100+); values >85 indicate imminent timeout',
      },
      taskProgressPercent: {
        type: 'number',
        description: 'Overall orchestrator phase progress percentage, 0-100',
      },
      exitCode: {
        type: 'integer',
        description: 'Exit code (only if completed)',
      },
      failureClass: {
        type: 'string',
        description: 'Failure classification (only if failed)',
      },
      validationFailureReason: {
        type: 'string',
        description: 'Validation-related failure reason, including validation allowlist gates when present',
      },
      validationAllowlistFailureReason: {
        type: 'string',
        description: 'Dedicated reason when files changed during validation are outside KASEKI_VALIDATION_ALLOWLIST',
      },
      qualityFailureReason: {
        type: 'string',
        description: 'Quality gate failure reason (retained for compatibility)',
      },
      error: {
        type: 'string',
        description: 'Error message (only if failed)',
      },
      resultDir: {
        type: 'string',
        description: 'Path to results directory on server',
      },
      resultSummaryContent: {
        type: 'string',
        description: 'Human-readable markdown summary (truncated to 64KB)',
      },
      failureJsonContent: {
        type: 'object',
        description: 'Structured failure information (only if failed)',
      },
      artifacts: {
        type: 'object',
        properties: {
          metadataJson: { type: 'boolean' },
          analysisMd: { type: 'boolean' },
          resultSummaryMd: { type: 'boolean' },
          failureJson: { type: 'boolean' },
          stderrLog: { type: 'boolean' },
          availableFiles: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of available artifact files',
          },
        },
      },
    },
  };
}

/**
 * Build the ErrorResponse schema.
 * Defines the standard error response structure used across all error responses (4xx/5xx).
 */
export function buildErrorResponseSchema(): Record<string, unknown> {
  return {
    type: 'object',
    required: ['error'],
    properties: {
      error: {
        type: 'string',
        description: 'Error message',
      },
      requestId: {
        type: 'string',
        description: 'Request ID for debugging',
      },
    },
  };
}

/**
 * Build all schemas as a single object.
 * This aggregates all individual schema builders for use in the components section.
 */
export function buildAllSchemas(): Record<string, Record<string, unknown>> {
  return {
    RunRequest: buildRunRequestSchema(),
    RunResponse: buildRunResponseSchema(),
    StatusResponse: buildStatusResponseSchema(),
    ErrorResponse: buildErrorResponseSchema(),
    WebhookConfig: buildWebhookConfigSchema(),
    RequestTracing: buildRequestTracingSchema(),
  };
}
