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
                    status: { type: 'string', enum: ['ok'] }
                  }
                }
              }
            }
          }
        }
      }
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
                    message: { type: 'string' }
                  }
                }
              }
            }
          },
          '503': {
            description: 'Service is not ready',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }
    }
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
                  type: 'string'
                }
              }
            }
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }
    },

    '/api/preflight': {
      get: {
        operationId: 'getPreFlight',
        summary: 'Pre-flight validation',
        description:
          'Validates that the controller (Docker, image, GitHub App) is configured correctly. Set agentCapability=true to also run the token-consuming Pi provider adapter smoke used by coding runs.',
        tags: ['Service Info'],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'agentCapability',
            in: 'query',
            required: false,
            schema: { type: 'boolean' },
            description: 'Run the Pi provider adapter smoke used by coding runs. This consumes inference tokens.'
          }
        ],
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
                          remediation: { type: 'string' }
                        }
                      }
                    },
                    containerStartup: {
                      type: 'object',
                      description:
                        'Cached startup diagnostics retained as boot history only; excluded from current readiness.',
                      properties: {
                        scope: { type: 'string', enum: ['startup'] },
                        readinessImpact: {
                          type: 'string',
                          enum: ['excluded-from-current-readiness']
                        },
                        current: { type: 'boolean', enum: [false] },
                        recommendedCurrentEndpoint: {
                          type: 'string',
                          enum: ['/api/preflight']
                        },
                        timestamp: { type: 'string', format: 'date-time' },
                        cachedAt: { type: 'string', format: 'date-time' },
                        checks: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              name: { type: 'string' },
                              ok: { type: 'boolean' },
                              detail: { type: 'string' },
                              remediation: { type: 'string' }
                            }
                          }
                        }
                      }
                    },
                    warnings: { type: 'array', items: { type: 'string' } },
                    errors: { type: 'array', items: { type: 'string' } }
                  }
                }
              }
            }
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }
    },

    '/api/startup-health': {
      get: {
        operationId: 'getStartupHealth',
        summary: 'Cached startup health report',
        description:
          'Returns cached boot-time diagnostics generated during API initialization. This is historical startup scope only (`scope: startup`, `current: false`); call /api/preflight for current readiness diagnostics.',
        tags: ['Service Info'],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'format',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['markdown'] },
            description: 'Return the startup report as Markdown instead of JSON.'
          }
        ],
        responses: {
          '200': {
            description: 'Cached startup diagnostics',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    scope: { type: 'string', enum: ['startup'] },
                    current: { type: 'boolean', enum: [false] },
                    recommendedCurrentEndpoint: { type: 'string', enum: ['/api/preflight'] },
                    timestamp: { type: 'string', format: 'date-time' },
                    status: { type: 'string', enum: ['ok', 'degraded', 'error'] },
                    summary: { type: 'object' },
                    timing: { type: 'object' },
                    components: { type: 'object' },
                    preflight: { type: 'object' },
                    issues: { type: 'array', items: { type: 'object' } }
                  }
                }
              },
              'text/markdown': {
                schema: { type: 'string' }
              }
            }
          },
          '404': {
            description: 'Startup report is not available yet',
            content: {
              'application/json': { schema: errorResponseSchema },
              'text/markdown': { schema: { type: 'string' } }
            }
          },
          '500': {
            description: 'Failed to retrieve startup report',
            content: {
              'application/json': { schema: errorResponseSchema },
              'text/markdown': { schema: { type: 'string' } }
            }
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: errorResponseSchema }
            }
          }
        }
      }
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
              schema: runRequestSchema
            }
          }
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
                    estimatedDurationSeconds: { type: 'integer' }
                  }
                }
              }
            }
          },
          '400': {
            description: 'Invalid request',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }
    }
  };
}

function buildInteractiveConsolePaths(errorResponseSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    '/api/gateway-test': {
      get: {
        operationId: 'testGateway',
        summary: 'Test gateway connectivity, inference, and Pi adapter support',
        description: 'Stage 1 validates gateway connectivity without inference tokens. Stage 2 can run real inference and an optional Pi adapter provider smoke test.',
        tags: ['Gateway Diagnostics'],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'stage', in: 'query', required: false, schema: { type: 'string', enum: ['1', '2'] }, description: 'Run connectivity (1) or inference (2) diagnostics.' },
          { name: 'responseSmoke', in: 'query', required: false, schema: { type: 'boolean' }, description: 'Run the inference response smoke test.' },
          { name: 'piProvider', in: 'query', required: false, schema: { type: 'boolean' }, description: 'Run the Pi provider adapter smoke test.' },
        ],
        responses: {
          '200': { description: 'Gateway diagnostic completed', content: { 'application/json': { schema: { type: 'object' } } } },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
          '503': { description: 'Gateway diagnostic failed', content: { 'application/json': { schema: { type: 'object' } } } },
        },
      },
    },
    '/api/github-issues': {
      post: {
        operationId: 'listGitHubIssues',
        summary: 'Fetch repository issues for task creation',
        description: 'Fetches repository issues through the configured GitHub App for task creation in the console.',
        tags: ['GitHub Issues'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['repoUrl'],
                properties: {
                  repoUrl: { type: 'string', description: 'GitHub repository URL or owner/repo' },
                  label: { type: 'string' },
                  labels: { type: 'array', items: { type: 'string' } },
                  limit: { type: 'integer', minimum: 1, maximum: 100 },
                  state: { type: 'string', enum: ['open', 'closed', 'all'] },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Repository issues',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      number: { type: 'integer' },
                      title: { type: 'string' },
                      body: { type: ['string', 'null'] },
                      url: { type: 'string', format: 'uri' },
                      created_at: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid repository request', content: { 'application/json': { schema: errorResponseSchema } } },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
          '404': { description: 'Repository not found', content: { 'application/json': { schema: errorResponseSchema } } },
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
              schema: runRequestSchema
            }
          }
        },
        responses: {
          '202': {
            description: 'Job accepted and queued',
            content: {
              'application/json': {
                schema: runResponseSchema
              }
            }
          },
          '200': {
            description: 'Idempotency replay: job already exists with same configuration',
            content: {
              'application/json': {
                schema: runResponseSchema
              }
            }
          },
          '400': {
            description: 'Invalid request',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      },

      get: {
        operationId: 'listRuns',
        summary: 'List all runs',
        description: 'Returns paginated list of all kaseki runs, newest first. Includes basic metadata for each run.',
        tags: ['Run Management'],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 50, minimum: 1, maximum: 500 },
            description: 'Maximum number of runs to return'
          },
          {
            name: 'offset',
            in: 'query',
            schema: { type: 'integer', default: 0, minimum: 0 },
            description: 'Offset for pagination'
          }
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
                      items: runResponseSchema
                    },
                    total: {
                      type: 'integer',
                      description: 'Total number of runs available'
                    }
                  }
                }
              }
            }
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }
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
            description: 'Kaseki instance ID (e.g., kaseki-42)'
          }
        ],
        security: [{ BearerAuth: [] }],
        responses: {
          '200': {
            description: 'Current run status',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/StatusResponse' }
              }
            }
          },
          '404': {
            description: 'Run not found',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }
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
            description: 'Kaseki instance ID'
          }
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
                    message: { type: 'string' }
                  }
                }
              }
            }
          },
          '404': {
            description: 'Run not found',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }
    }
  };
}

/**
 * Build logs and progress endpoints.
 * These endpoints provide access to run progress events and log files.
 */
function buildLogsProgressPaths(errorResponseSchema: Record<string, unknown>): Record<string, unknown> {
  const idParameter = {
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string', pattern: '^kaseki-\\d+$' },
    description: 'Kaseki instance ID'
  };
  const tailParameter = {
    name: 'tail',
    in: 'query',
    schema: { type: 'integer', minimum: 0, default: 50 },
    description: 'Maximum number of recent events to return'
  };
  const eventSnapshotSchema = {
    type: 'object',
    required: ['id', 'status', 'events', 'total', 'sources'],
    properties: {
      id: { type: 'string' },
      status: { type: 'string' },
      events: { type: 'array', items: { type: 'object', additionalProperties: true } },
      total: { type: 'integer', description: 'Total number of parseable events before tail filtering' },
      sources: { type: 'array', items: { type: 'string', enum: ['progress.jsonl', 'docker-logs'] } }
    }
  };
  const snapshotResponses = {
    '200': {
      description: 'Structured run event snapshot',
      content: { 'application/json': { schema: eventSnapshotSchema } }
    },
    '404': {
      description: 'Run not found',
      content: { 'application/json': { schema: errorResponseSchema } }
    },
    '401': {
      description: 'Unauthorized',
      content: { 'application/json': { schema: errorResponseSchema } }
    }
  };

  return {
    '/api/runs/{id}/events': {
      get: {
        operationId: 'getRunEvents',
        summary: 'Get structured event snapshot',
        description:
          'Canonical structured event snapshot for a run. Returns normalized progress.jsonl events plus live Docker progress for active runs.',
        tags: ['Run Logs & Progress'],
        parameters: [idParameter, tailParameter],
        security: [{ BearerAuth: [] }],
        responses: snapshotResponses
      }
    },

    '/api/runs/{id}/events/stream': {
      get: {
        operationId: 'streamRunEvents',
        summary: 'Stream run events',
        description: 'Streams run progress updates as Server-Sent Events (SSE).',
        tags: ['Run Logs & Progress'],
        parameters: [idParameter],
        security: [{ BearerAuth: [] }],
        responses: {
          '200': {
            description: 'Server-Sent Events stream of progress updates',
            content: {
              'text/event-stream': {
                schema: { type: 'string', description: 'Server-Sent Events formatted progress updates' }
              }
            }
          },
          '404': snapshotResponses['404'],
          '401': snapshotResponses['401']
        }
      }
    },

    '/api/runs/{id}/progress': {
      get: {
        operationId: 'getRunProgress',
        summary: 'Get legacy progress event snapshot',
        description:
          'Deprecated legacy alias for GET /api/runs/{id}/events. Non-streaming responses return the same structured event snapshot schema. Legacy clients may still request SSE with ?stream=sse, but new clients should use GET /api/runs/{id}/events/stream.',
        deprecated: true,
        tags: ['Run Logs & Progress'],
        parameters: [
          idParameter,
          tailParameter,
          {
            name: 'stream',
            in: 'query',
            schema: { type: 'string', enum: ['sse'] },
            description: 'Deprecated. Use GET /api/runs/{id}/events/stream for Server-Sent Events.'
          }
        ],
        security: [{ BearerAuth: [] }],
        responses: {
          ...snapshotResponses,
          '200': {
            description: 'Structured run event snapshot, or SSE when using deprecated stream=sse',
            content: {
              'application/json': { schema: eventSnapshotSchema },
              'text/event-stream': {
                schema: { type: 'string', description: 'Deprecated Server-Sent Events format when stream=sse' }
              }
            }
          }
        }
      }
    },

    '/api/runs/{id}/logs/{logtype}': {
      get: {
        operationId: 'getRunLog',
        summary: 'Get specific log file',
        description:
          'Returns a specific log file (stdout, stderr, validation, progress, quality, secret-scan, or combined). Large logs are truncated.',
        tags: ['Run Logs & Progress'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', pattern: '^kaseki-\\d+$' },
            description: 'Kaseki instance ID'
          },
          {
            name: 'logtype',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
              enum: ['stdout', 'stderr', 'validation', 'progress', 'quality', 'secret-scan', 'combined']
            },
            description: 'Log type to retrieve'
          },
          {
            name: 'tail',
            in: 'query',
            schema: { type: 'integer', minimum: 1, default: 100 },
            description: 'Number of lines to tail (default: 100)'
          }
        ],
        security: [{ BearerAuth: [] }],
        responses: {
          '200': {
            description: 'Log content',
            content: {
              'text/plain': {
                schema: { type: 'string' }
              }
            }
          },
          '404': {
            description: 'Run or log not found',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }
    }
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
            description: 'Kaseki instance ID'
          }
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
                      enum: ['queued', 'running', 'completed', 'failed']
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
                          description: { type: 'string' }
                        }
                      }
                    },
                    recommended: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Recommended artifacts to review first'
                    },
                    artifactCount: { type: 'integer' }
                  }
                }
              }
            }
          },
          '404': {
            description: 'Run not found',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }
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
            description: 'Kaseki instance ID'
          },
          {
            name: 'file',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Artifact filename (e.g., git.diff, metadata.json)'
          },
          {
            name: 'format',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['rendered'] },
            description:
              'Optional response mode. `rendered` is only supported for `run-evaluation.json`; default (omitted) returns raw artifact content.'
          },
          {
            name: 'markdown',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['true', 'false', '1', '0'] },
            description: 'When format=rendered for run-evaluation.json, include optional markdown summary.'
          }
        ],
        security: [{ BearerAuth: [] }],
        responses: {
          '200': {
            description: 'Artifact file content',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    {
                      type: 'object',
                      required: ['file', 'contentType', 'size', 'content'],
                      properties: {
                        file: { type: 'string' },
                        contentType: { type: 'string' },
                        size: { type: 'integer' },
                        content: { type: 'string' }
                      }
                    },
                    {
                      type: 'object',
                      required: ['format', 'file', 'sections', 'raw'],
                      properties: {
                        format: { type: 'string', enum: ['rendered'] },
                        file: { type: 'string', enum: ['run-evaluation.json'] },
                        sections: {
                          type: 'object',
                          required: [
                            'summary',
                            'problem',
                            'solution',
                            'humanReview',
                            'stages',
                            'efficiency',
                            'validation',
                            'opportunities',
                            'warnings'
                          ],
                          properties: {
                            overall: { type: 'object', additionalProperties: true },
                            summary: { type: 'array', items: { type: 'string' } },
                            problem: { type: 'array', items: { type: 'string' } },
                            solution: { type: 'array', items: { type: 'string' } },
                            humanReview: { type: 'array', items: { type: 'string' } },
                            stages: { type: 'array', items: { type: 'object', additionalProperties: true } },
                            efficiency: { type: 'array', items: { type: 'object', additionalProperties: true } },
                            validation: { type: 'array', items: { type: 'object', additionalProperties: true } },
                            opportunities: { type: 'array', items: { type: 'object', additionalProperties: true } },
                            warnings: { type: 'array', items: { type: 'object', additionalProperties: true } },
                            metadata: { type: 'object', additionalProperties: true }
                          }
                        },
                        markdown: { type: 'string' },
                        raw: { type: 'object', additionalProperties: true }
                      }
                    }
                  ]
                }
              }
            }
          },
          '422': {
            description: 'Invalid artifact content for requested format',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          },
          '404': {
            description: 'Artifact not found',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }
    }
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
            description: 'Kaseki instance ID'
          }
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
                      enum: ['queued', 'running', 'completed', 'failed']
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
                        diffSize: { type: 'integer' }
                      }
                    },
                    validation: {
                      type: 'object',
                      properties: {
                        passed: { type: 'boolean' },
                        commandResults: { type: 'array', items: { type: 'object' } }
                      }
                    },
                    analysisWarnings: {
                      type: 'array',
                      description: 'Optional artifacts that could not be parsed; remaining analysis is still returned.',
                      items: { type: 'string' }
                    },
                    errors: { type: 'array', items: { type: 'string' } }
                  }
                }
              }
            }
          },
          '404': {
            description: 'Run not found',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }
    }
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
                  secret: { type: 'string' }
                }
              }
            }
          }
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
                    message: { type: 'string' }
                  }
                }
              }
            }
          },
          '400': {
            description: 'Invalid webhook configuration',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }
    }
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
            description: 'Maximum number of recent terminal runs to aggregate'
          }
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
                    runs: { type: 'array', items: { type: 'object' } }
                  }
                }
              }
            }
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }
    }
  };
}

function assertRunRequestSchema(runRequestSchema: Record<string, unknown>): void {
  const properties = runRequestSchema.properties as Record<string, unknown> | undefined;
  const repoUrl = properties?.repoUrl as Record<string, unknown> | undefined;
  const required = runRequestSchema.required;

  if (
    runRequestSchema.type !== 'object' ||
    !Array.isArray(required) ||
    !required.includes('repoUrl') ||
    !properties ||
    repoUrl?.type !== 'string' ||
    repoUrl?.format !== 'uri'
  ) {
    throw new Error('buildAllPaths requires runRequestSchema from buildRunRequestSchema()');
  }
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
  assertRunRequestSchema(runRequestSchema);

  return {
    ...buildHealthCheckPaths(errorResponseSchema),
    ...buildServiceInfoPaths(errorResponseSchema, runRequestSchema),
    ...buildInteractiveConsolePaths(errorResponseSchema),
    ...buildRunManagementPaths(errorResponseSchema, runRequestSchema, runResponseSchema),
    ...buildLogsProgressPaths(errorResponseSchema),
    ...buildArtifactPaths(errorResponseSchema),
    ...buildRunAnalysisPaths(errorResponseSchema),
    ...buildImprovementPaths(errorResponseSchema),
    ...buildWebhookPaths(errorResponseSchema)
  };
}
