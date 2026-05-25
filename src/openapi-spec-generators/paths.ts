/**
 * OpenAPI Path Builders for Kaseki Agent API
 *
 * This module contains builder functions for constructing endpoint definitions
 * used in the OpenAPI specification. Paths are organized by feature area:
 * - Health & Status
 * - Service Info
 * - Run Management
 * - Logs & Progress
 * - Artifacts
 * - Run Details
 * - Webhooks
 */

/**
 * Build health and status check endpoints.
 * These are unauthenticated endpoints for service health verification.
 */
function buildHealthCheckPaths(errorResponseSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    '/health': {
      get: {
        operationId: 'getHealth',
        summary: 'Health check endpoint',
        description: 'Returns 200 OK if the service is running. No authentication required.',
        tags: ['Health & Status'],
        responses: {
          '200': {
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['ok'] },
                  },
                },
              },
            },
          },
        },
      },
    },

    '/ready': {
      get: {
        operationId: 'getReady',
        summary: 'Readiness probe',
        description:
          'Returns 200 OK when the service is ready to accept requests. Checks queue and scheduler dependencies. No authentication required.',
        tags: ['Health & Status'],
        responses: {
          '200': {
            description: 'Service is ready',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ready: { type: 'boolean' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
          '503': {
            description: 'Service is not ready',
            content: {
              'application/json': {
                schema: errorResponseSchema,
              },
            },
          },
        },
      },
    },
  };
}

/**
 * Build service info endpoints.
 * These endpoints provide service metadata, metrics, and configuration validation.
 */
function buildServiceInfoPaths(
  errorResponseSchema: Record<string, unknown>,
  runRequestSchema: Record<string, unknown>
): Record<string, unknown> {
  return {
    '/api/metrics': {
      get: {
        operationId: 'getMetrics',
        summary: 'Prometheus metrics',
        description: 'Returns Prometheus-formatted metrics (artifact cache + queue stats)',
        tags: ['Service Info'],
        security: [{ BearerAuth: [] }],
        responses: {
          '200': {
            description: 'Metrics in Prometheus text format',
            content: {
              'text/plain': {
                schema: {
                  type: 'string',
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema,
              },
            },
          },
        },
      },
    },

    '/api/preflight': {
      get: {
        operationId: 'getPreFlight',
        summary: 'Pre-flight validation',
        description:
          'Validates that the controller (Docker, image, GitHub App) is configured correctly. Returns checks for all dependencies.',
        tags: ['Service Info'],
        security: [{ BearerAuth: [] }],
        responses: {
          '200': {
            description: 'Pre-flight checks complete',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['isValid', 'checks'],
                  properties: {
                    isValid: { type: 'boolean' },
                    checks: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          ok: { type: 'boolean' },
                          detail: { type: 'string' },
                          remediation: { type: 'string' },
                        },
                      },
                    },
                    warnings: { type: 'array', items: { type: 'string' } },
                    errors: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema,
              },
            },
          },
        },
      },
    },

    '/api/validate': {
      post: {
        operationId: 'validateTask',
        summary: 'Validate task configuration',
        description:
          'Validates the task configuration before submitting a run. Performs pre-flight checks on the task prompt and constraints.',
        tags: ['Service Info'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: runRequestSchema,
            },
          },
        },
        responses: {
          '200': {
            description: 'Validation result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    isValid: { type: 'boolean' },
                    checks: { type: 'array', items: { type: 'object' } },
                    warnings: { type: 'array', items: { type: 'string' } },
                    errors: { type: 'array', items: { type: 'string' } },
                    estimatedDurationSeconds: { type: 'integer' },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Invalid request',
            content: {
              'application/json': {
                schema: errorResponseSchema,
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema,
              },
            },
          },
        },
      },
    },
  };
}

/**
 * Build run management endpoints.
 * These endpoints allow triggering, listing, and controlling kaseki runs.
 */
function buildRunManagementPaths(
  errorResponseSchema: Record<string, unknown>,
  runRequestSchema: Record<string, unknown>,
  runResponseSchema: Record<string, unknown>
): Record<string, unknown> {
  return {
    '/api/runs': {
      post: {
        operationId: 'triggerRun',
        summary: 'Trigger a new kaseki run',
        description:
          'Submits a new job to the queue. Returns 202 Accepted with job metadata. Use the ID to poll status.',
        tags: ['Run Management'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: runRequestSchema,
            },
          },
        },
        responses: {
          '202': {
            description: 'Job accepted and queued',
            content: {
              'application/json': {
                schema: runResponseSchema,
              },
            },
          },
          '200': {
            description: 'Idempotency replay: job already exists with same configuration',
            content: {
              'application/json': {
                schema: runResponseSchema,
              },
            },
          },
          '400': {
            description: 'Invalid request',
            content: {
              'application/json': {
                schema: errorResponseSchema,
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema,
              },
            },
          },
        },
      },

      get: {
        operationId: 'listRuns',
        summary: 'List all runs',
        description:
          'Returns paginated list of all kaseki runs, newest first. Includes basic metadata for each run.',
        tags: ['Run Management'],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 50, minimum: 1, maximum: 500 },
            description: 'Maximum number of runs to return',
          },
          {
            name: 'offset',
            in: 'query',
            schema: { type: 'integer', default: 0, minimum: 0 },
            description: 'Offset for pagination',
          },
        ],
        responses: {
          '200': {
            description: 'List of runs',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['runs', 'total'],
                  properties: {
                    runs: {
                      type: 'array',
                      items: runResponseSchema,
                    },
                    total: {
                      type: 'integer',
                      description: 'Total number of runs available',
                    },
                  },
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema,
              },
            },
          },
        },
      },
    },

    '/api/runs/{id}/status': {
      get: {
        operationId: 'getRunStatus',
        summary: 'Poll run status',
        description:
          'Returns current status of a kaseki run, including progress, elapsed time, and timeout risk percentage.',
        tags: ['Run Management'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', pattern: '^kaseki-\\d+$' },
            description: 'Kaseki instance ID (e.g., kaseki-42)',
          },
        ],
        security: [{ BearerAuth: [] }],
        responses: {
          '200': {
            description: 'Current run status',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/StatusResponse' },
              },
            },
          },
          '404': {
            description: 'Run not found',
            content: {
              'application/json': {
                schema: errorResponseSchema,
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema,
              },
            },
          },
        },
      },
    },

    '/api/runs/{id}/cancel': {
      post: {
        operationId: 'cancelRun',
        summary: 'Cancel a run',
        description:
          'Cancels a queued or running kaseki job. Returns 200 if cancellation was accepted; operation may complete asynchronously.',
        tags: ['Run Management'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', pattern: '^kaseki-\\d+$' },
            description: 'Kaseki instance ID',
          },
        ],
        security: [{ BearerAuth: [] }],
        responses: {
          '200': {
            description: 'Cancellation accepted',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    status: { type: 'string' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
          '404': {
            description: 'Run not found',
            content: {
              'application/json': {
                schema: errorResponseSchema,
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema,
              },
            },
          },
        },
      },
    },
  };
}

/**
 * Build logs and progress endpoints.
 * These endpoints provide access to run progress events and log files.
 */
function buildLogsProgressPaths(errorResponseSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    '/api/runs/{id}/progress': {
      get: {
        operationId: 'getRunProgress',
        summary: 'Get progress events',
        description:
          'Returns progress events for a run. Supports Server-Sent Events (SSE) streaming via `?stream=sse` query parameter.',
        tags: ['Run Logs & Progress'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', pattern: '^kaseki-\\d+$' },
            description: 'Kaseki instance ID',
          },
          {
            name: 'stream',
            in: 'query',
            schema: { type: 'string', enum: ['sse'] },
            description: 'Set to "sse" to enable Server-Sent Events streaming',
          },
        ],
        security: [{ BearerAuth: [] }],
        responses: {
          '200': {
            description: 'Progress events (JSONL or SSE format)',
            content: {
              'application/x-ndjson': {
                schema: {
                  type: 'object',
                  description: 'Each line is a JSON progress event',
                },
              },
              'text/event-stream': {
                schema: {
                  type: 'object',
                  description: 'Server-Sent Events format (when stream=sse)',
                },
              },
            },
          },
          '404': {
            description: 'Run not found',
            content: {
              'application/json': {
                schema: errorResponseSchema,
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema,
              },
            },
          },
        },
      },
    },

    '/api/runs/{id}/logs/{logtype}': {
      get: {
        operationId: 'getRunLog',
        summary: 'Get specific log file',
        description:
          'Returns a specific log file (stdout, stderr, validation, progress, quality, or secret-scan). Large logs are truncated.',
        tags: ['Run Logs & Progress'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', pattern: '^kaseki-\\d+$' },
            description: 'Kaseki instance ID',
          },
          {
            name: 'logtype',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
              enum: ['stdout', 'stderr', 'validation', 'progress', 'quality', 'secret-scan'],
            },
            description: 'Log type to retrieve',
          },
          {
            name: 'tail',
            in: 'query',
            schema: { type: 'integer', minimum: 1, default: 100 },
            description: 'Number of lines to tail (default: 100)',
          },
        ],
        security: [{ BearerAuth: [] }],
        responses: {
          '200': {
            description: 'Log content',
            content: {
              'text/plain': {
                schema: { type: 'string' },
              },
            },
          },
          '404': {
            description: 'Run or log not found',
            content: {
              'application/json': {
                schema: errorResponseSchema,
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema,
              },
            },
          },
        },
      },
    },
  };
}

/**
 * Build artifact endpoints.
 * These endpoints provide access to run artifacts and their metadata.
 */
function buildArtifactPaths(errorResponseSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    '/api/runs/{id}/artifacts': {
      get: {
        operationId: 'getRunArtifacts',
        summary: 'List artifacts',
        description:
          'Returns metadata for all available artifacts from a run (metadata.json, git.diff, validation.log, etc.)',
        tags: ['Artifacts'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', pattern: '^kaseki-\\d+$' },
            description: 'Kaseki instance ID',
          },
        ],
        security: [{ BearerAuth: [] }],
        responses: {
          '200': {
            description: 'Artifacts list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id', 'artifacts', 'artifactCount'],
                  properties: {
                    id: { type: 'string' },
                    runStatus: {
                      type: 'string',
                      enum: ['queued', 'running', 'completed', 'failed'],
                    },
                    exitCode: { type: 'integer' },
                    artifacts: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          size: { type: 'integer' },
                          contentType: { type: 'string' },
                          available: { type: 'boolean' },
                          description: { type: 'string' },
                        },
                      },
                    },
                    recommended: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Recommended artifacts to review first',
                    },
                    artifactCount: { type: 'integer' },
                  },
                },
              },
            },
          },
          '404': {
            description: 'Run not found',
            content: {
              'application/json': {
                schema: errorResponseSchema,
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema,
              },
            },
          },
        },
      },
    },

    '/api/results/{id}/{file}': {
      get: {
        operationId: 'downloadArtifact',
        summary: 'Download artifact file',
        description:
          'Downloads a specific artifact file (e.g., git.diff, metadata.json, result-summary.md). Use `/api/runs/{id}/artifacts` to list available files.',
        tags: ['Artifacts'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', pattern: '^kaseki-\\d+$' },
            description: 'Kaseki instance ID',
          },
          {
            name: 'file',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Artifact filename (e.g., git.diff, metadata.json)',
          },
        ],
        security: [{ BearerAuth: [] }],
        responses: {
          '200': {
            description: 'Artifact file content',
            content: {
              '*/*': {
                schema: { type: 'string', format: 'binary' },
              },
            },
          },
          '404': {
            description: 'Artifact not found',
            content: {
              'application/json': {
                schema: errorResponseSchema,
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema,
              },
            },
          },
        },
      },
    },
  };
}

/**
 * Build run analysis and details endpoints.
 * These endpoints provide comprehensive run analysis and diagnostics.
 */
function buildRunAnalysisPaths(errorResponseSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    '/api/runs/{id}/analysis': {
      get: {
        operationId: 'getRunAnalysis',
        summary: 'Get comprehensive run analysis',
        description:
          'Returns a comprehensive post-run analysis including metadata, changes, validation results, and failure details.',
        tags: ['Run Details'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', pattern: '^kaseki-\\d+$' },
            description: 'Kaseki instance ID',
          },
        ],
        security: [{ BearerAuth: [] }],
        responses: {
          '200': {
            description: 'Run analysis',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id', 'status'],
                  properties: {
                    id: { type: 'string' },
                    status: {
                      type: 'string',
                      enum: ['queued', 'running', 'completed', 'failed'],
                    },
                    createdAt: { type: 'string', format: 'date-time' },
                    completedAt: { type: 'string', format: 'date-time' },
                    elapsedSeconds: { type: 'number' },
                    exitCode: { type: 'integer' },
                    failureClass: { type: 'string' },
                    metadata: { type: 'object' },
                    changes: {
                      type: 'object',
                      properties: {
                        changedFiles: { type: 'array', items: { type: 'string' } },
                        diffSize: { type: 'integer' },
                      },
                    },
                    validation: {
                      type: 'object',
                      properties: {
                        passed: { type: 'boolean' },
                        commandResults: { type: 'array', items: { type: 'object' } },
                      },
                    },
                    errors: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
          '404': {
            description: 'Run not found',
            content: {
              'application/json': {
                schema: errorResponseSchema,
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema,
              },
            },
          },
        },
      },
    },
  };
}

/**
 * Build webhook endpoints.
 * These endpoints provide webhook configuration and testing.
 */
function buildWebhookPaths(errorResponseSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    '/api/webhooks/test': {
      post: {
        operationId: 'testWebhook',
        summary: 'Test webhook configuration',
        description: 'Tests a webhook configuration by sending a test event to the specified URL.',
        tags: ['Webhooks'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['url'],
                properties: {
                  url: { type: 'string', format: 'uri' },
                  secret: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Webhook test successful',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    statusCode: { type: 'integer' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Invalid webhook configuration',
            content: {
              'application/json': {
                schema: errorResponseSchema,
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema,
              },
            },
          },
        },
      },
    },
  };
}

function buildImprovementPaths(errorResponseSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    '/api/improvements': {
      get: {
        operationId: 'getRunImprovements',
        summary: 'Aggregate run improvement findings',
        description:
          'Aggregates recent terminal run-evaluation artifacts, stage timings, and compact run entries for continual improvement dashboards.',
        tags: ['Run Details'],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
            description: 'Maximum number of recent terminal runs to aggregate',
          },
        ],
        responses: {
          '200': {
            description: 'Aggregated run improvement summary',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    limit: { type: 'integer' },
                    totalRuns: { type: 'integer' },
                    counts: { type: 'object' },
                    evaluator: { type: 'object' },
                    topImprovementOpportunities: { type: 'array', items: { type: 'object' } },
                    slowestStages: { type: 'array', items: { type: 'object' } },
                    runs: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema,
              },
            },
          },
        },
      },
    },
  };
}

/**
 * Build all paths/endpoints for the OpenAPI spec.
 * Aggregates all endpoint builders organized by feature area.
 */
export function buildAllPaths(
  errorResponseSchema: Record<string, unknown>,
  runRequestSchema: Record<string, unknown>,
  runResponseSchema: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...buildHealthCheckPaths(errorResponseSchema),
    ...buildServiceInfoPaths(errorResponseSchema, runRequestSchema),
    ...buildRunManagementPaths(errorResponseSchema, runRequestSchema, runResponseSchema),
    ...buildLogsProgressPaths(errorResponseSchema),
    ...buildArtifactPaths(errorResponseSchema),
    ...buildRunAnalysisPaths(errorResponseSchema),
    ...buildImprovementPaths(errorResponseSchema),
    ...buildWebhookPaths(errorResponseSchema),
  };
}
