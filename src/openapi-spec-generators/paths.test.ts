/**
 * Tests for OpenAPI Path Builders
 */

import { buildAllPaths } from './paths';
import { buildErrorResponseSchema, buildRunRequestSchema, buildRunResponseSchema } from './schemas';

type RouteContract = {
  path: string;
  method: string;
  operationId: string;
  requiresAuth: boolean;
  statuses: string[];
  tags: string[];
  requiredResponseSchemas?: (schemas: {
    errorSchema: Record<string, unknown>;
    responseSchema: Record<string, unknown>;
  }) => Array<{ status: string; mediaType: string; schema: unknown }>;
};

describe('OpenAPI Path Builders', () => {
  const routeContracts: RouteContract[] = [
    {
      path: '/health',
      method: 'get',
      operationId: 'getHealth',
      requiresAuth: false,
      statuses: ['200'],
      tags: ['Health & Status']
    },
    {
      path: '/ready',
      method: 'get',
      operationId: 'getReady',
      requiresAuth: false,
      statuses: ['200', '503'],
      tags: ['Health & Status']
    },
    {
      path: '/api/metrics',
      method: 'get',
      operationId: 'getMetrics',
      requiresAuth: true,
      statuses: ['200', '401'],
      tags: ['Service Info']
    },
    {
      path: '/api/preflight',
      method: 'get',
      operationId: 'getPreFlight',
      requiresAuth: true,
      statuses: ['200', '401'],
      tags: ['Service Info']
    },
    {
      path: '/api/startup-health',
      method: 'get',
      operationId: 'getStartupHealth',
      requiresAuth: true,
      statuses: ['200', '401', '404', '500'],
      tags: ['Service Info']
    },
    {
      path: '/api/gateway-test',
      method: 'get',
      operationId: 'testGateway',
      requiresAuth: true,
      statuses: ['200', '401', '503'],
      tags: ['Gateway Diagnostics']
    },
    {
      path: '/api/github-issues',
      method: 'post',
      operationId: 'listGitHubIssues',
      requiresAuth: true,
      statuses: ['200', '400', '401', '404'],
      tags: ['GitHub Issues']
    },
    {
      path: '/api/validate',
      method: 'post',
      operationId: 'validateTask',
      requiresAuth: true,
      statuses: ['200', '400', '401'],
      tags: ['Service Info'],
      requiredResponseSchemas: ({ errorSchema }) => [
        { status: '400', mediaType: 'application/json', schema: errorSchema },
        { status: '401', mediaType: 'application/json', schema: errorSchema }
      ]
    },
    {
      path: '/api/runs',
      method: 'get',
      operationId: 'listRuns',
      requiresAuth: true,
      statuses: ['200', '401'],
      tags: ['Run Management']
    },
    {
      path: '/api/runs',
      method: 'post',
      operationId: 'triggerRun',
      requiresAuth: true,
      statuses: ['200', '202', '400', '401'],
      tags: ['Run Management'],
      requiredResponseSchemas: ({ errorSchema, responseSchema }) => [
        { status: '200', mediaType: 'application/json', schema: responseSchema },
        { status: '202', mediaType: 'application/json', schema: responseSchema },
        { status: '400', mediaType: 'application/json', schema: errorSchema },
        { status: '401', mediaType: 'application/json', schema: errorSchema }
      ]
    },
    {
      path: '/api/runs/{id}/status',
      method: 'get',
      operationId: 'getRunStatus',
      requiresAuth: true,
      statuses: ['200', '401', '404'],
      tags: ['Run Management'],
      requiredResponseSchemas: ({ errorSchema }) => [
        { status: '200', mediaType: 'application/json', schema: { $ref: '#/components/schemas/StatusResponse' } },
        { status: '404', mediaType: 'application/json', schema: errorSchema }
      ]
    },
    {
      path: '/api/runs/{id}/cancel',
      method: 'post',
      operationId: 'cancelRun',
      requiresAuth: true,
      statuses: ['200', '401', '404'],
      tags: ['Run Management']
    },
    {
      path: '/api/runs/{id}/events',
      method: 'get',
      operationId: 'getRunEvents',
      requiresAuth: true,
      statuses: ['200', '401', '404'],
      tags: ['Run Logs & Progress']
    },
    {
      path: '/api/runs/{id}/events/stream',
      method: 'get',
      operationId: 'streamRunEvents',
      requiresAuth: true,
      statuses: ['200', '401', '404'],
      tags: ['Run Logs & Progress']
    },
    {
      path: '/api/runs/{id}/progress',
      method: 'get',
      operationId: 'getRunProgress',
      requiresAuth: true,
      statuses: ['200', '401', '404'],
      tags: ['Run Logs & Progress']
    },
    {
      path: '/api/runs/{id}/logs/{logtype}',
      method: 'get',
      operationId: 'getRunLog',
      requiresAuth: true,
      statuses: ['200', '401', '404'],
      tags: ['Run Logs & Progress']
    },
    {
      path: '/api/runs/{id}/artifacts',
      method: 'get',
      operationId: 'getRunArtifacts',
      requiresAuth: true,
      statuses: ['200', '401', '404'],
      tags: ['Artifacts']
    },
    {
      path: '/api/results/{id}/{file}',
      method: 'get',
      operationId: 'downloadArtifact',
      requiresAuth: true,
      statuses: ['200', '401', '404', '422'],
      tags: ['Artifacts']
    },
    {
      path: '/api/runs/{id}/analysis',
      method: 'get',
      operationId: 'getRunAnalysis',
      requiresAuth: true,
      statuses: ['200', '401', '404'],
      tags: ['Run Details']
    },
    {
      path: '/api/improvements',
      method: 'get',
      operationId: 'getRunImprovements',
      requiresAuth: true,
      statuses: ['200', '401'],
      tags: ['Run Details']
    },
    {
      path: '/api/webhooks/test',
      method: 'post',
      operationId: 'testWebhook',
      requiresAuth: true,
      statuses: ['200', '400', '401'],
      tags: ['Webhooks'],
      requiredResponseSchemas: ({ errorSchema }) => [
        { status: '400', mediaType: 'application/json', schema: errorSchema }
      ]
    }
  ];
  let errorSchema: Record<string, unknown>;
  let requestSchema: Record<string, unknown>;
  let responseSchema: Record<string, unknown>;

  beforeEach(() => {
    errorSchema = buildErrorResponseSchema();
    requestSchema = buildRunRequestSchema();
    responseSchema = buildRunResponseSchema();
  });

  describe('buildAllPaths', () => {
    it.each(routeContracts)(
      'should define route contract for $method $path',
      ({ path, method, operationId, requiresAuth, statuses, tags, requiredResponseSchemas }) => {
        const paths = buildAllPaths(errorSchema, requestSchema, responseSchema);
        const pathDef = paths[path] as Record<string, any>;
        const operation = pathDef?.[method];

        expect(pathDef).toBeDefined();
        expect(operation).toBeDefined();
        expect(operation.operationId).toBe(operationId);
        expect(operation.tags).toEqual(tags);
        if (requiresAuth) {
          expect(operation.security).toEqual([{ BearerAuth: [] }]);
        } else {
          expect(operation.security).toBeUndefined();
        }
        expect(operation.responses).toBeDefined();
        expect(typeof operation.responses).toBe('object');
        expect(Object.keys(operation.responses).sort()).toEqual([...statuses].sort());
        requiredResponseSchemas?.({ errorSchema, responseSchema }).forEach(({ status, mediaType, schema }) => {
          expect(operation.responses[status].content[mediaType].schema).toEqual(schema);
        });
      }
    );

    it('should not expose routes missing route contracts', () => {
      const paths = buildAllPaths(errorSchema, requestSchema, responseSchema);
      const expectedOperations = routeContracts.map(({ path, method }) => `${method.toUpperCase()} ${path}`).sort();
      const actualOperations = Object.entries(paths)
        .flatMap(([path, pathDef]) =>
          Object.keys(pathDef as Record<string, unknown>).map((method) => `${method.toUpperCase()} ${path}`)
        )
        .sort();

      expect(actualOperations).toEqual(expectedOperations);
    });

    it('request body routes should define precise required JSON contracts', () => {
      const paths = buildAllPaths(errorSchema, requestSchema, responseSchema);
      const validatePath = paths['/api/validate'] as Record<string, any>;
      const runsPath = paths['/api/runs'] as Record<string, any>;
      const webhookTestPath = paths['/api/webhooks/test'] as Record<string, any>;
      const expectedRunRequestBody = {
        required: true,
        content: {
          'application/json': {
            schema: requestSchema
          }
        }
      };

      expect(validatePath.post.operationId).toBe('validateTask');
      expect(validatePath.post.requestBody).toEqual(expectedRunRequestBody);
      expect(runsPath.post.operationId).toBe('triggerRun');
      expect(runsPath.post.requestBody).toEqual(expectedRunRequestBody);
      expect(webhookTestPath.post.operationId).toBe('testWebhook');
      expect(webhookTestPath.post.requestBody).toEqual({
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
      });
    });

    it('POST /api/runs should define the trigger run responses', () => {
      const paths = buildAllPaths(errorSchema, requestSchema, responseSchema);
      const runsPath = paths['/api/runs'] as Record<string, any>;

      expect(Object.keys(runsPath)).toEqual(expect.arrayContaining(['post']));
      expect(runsPath.post.operationId).toBe('triggerRun');
      expect(runsPath.post.responses).toEqual(
        expect.objectContaining({
          '202': expect.objectContaining({
            content: {
              'application/json': {
                schema: responseSchema
              }
            }
          }),
          '200': expect.objectContaining({
            content: {
              'application/json': {
                schema: responseSchema
              }
            }
          }),
          '400': expect.objectContaining({
            content: {
              'application/json': {
                schema: errorSchema
              }
            }
          }),
          '401': expect.objectContaining({
            content: {
              'application/json': {
                schema: errorSchema
              }
            }
          })
        })
      );
    });

    it('GET /api/runs/{id}/status should define required id parameter and status responses', () => {
      const paths = buildAllPaths(errorSchema, requestSchema, responseSchema);
      const runStatusPath = paths['/api/runs/{id}/status'] as Record<string, any>;

      expect(runStatusPath.get.operationId).toBe('getRunStatus');
      expect(runStatusPath.get.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'id',
            in: 'path',
            required: true
          })
        ])
      );
      expect(runStatusPath.get.responses['200'].content['application/json'].schema).toEqual({
        $ref: '#/components/schemas/StatusResponse'
      });
      expect(runStatusPath.get.responses).toEqual(
        expect.objectContaining({
          '200': expect.objectContaining({
            content: expect.objectContaining({
              'application/json': expect.any(Object)
            })
          }),
          '404': expect.objectContaining({
            content: {
              'application/json': {
                schema: errorSchema
              }
            }
          })
        })
      );
    });

    it('POST /api/webhooks/test should define required payload and key status codes', () => {
      const paths = buildAllPaths(errorSchema, requestSchema, responseSchema);
      const webhookTestPath = paths['/api/webhooks/test'] as Record<string, any>;

      expect(webhookTestPath.post.operationId).toBe('testWebhook');
      expect(webhookTestPath.post.requestBody.required).toBe(true);
      expect(webhookTestPath.post.requestBody.content).toEqual(
        expect.objectContaining({
          'application/json': expect.objectContaining({
            schema: expect.objectContaining({
              type: 'object',
              required: ['url']
            })
          })
        })
      );
      expect(webhookTestPath.post.responses).toEqual(
        expect.objectContaining({
          '200': expect.any(Object),
          '400': expect.objectContaining({
            content: {
              'application/json': {
                schema: errorSchema
              }
            }
          })
        })
      );
    });

    it('should have summary and description for endpoints', () => {
      const paths = buildAllPaths(errorSchema, requestSchema, responseSchema);
      const methods = ['get', 'post', 'put', 'delete', 'patch'];
      const placeholderPattern = /^(summary|description|endpoint|api endpoint|todo|tbd|n\/a|none)$/i;
      const expectedSummaryTermsByOperationId: Record<string, string[]> = {
        cancelRun: ['cancel', 'run'],
        downloadArtifact: ['download', 'artifact'],
        getHealth: ['health', 'check'],
        getMetrics: ['prometheus', 'metrics'],
        getPreFlight: ['pre-flight', 'validation'],
        getReady: ['readiness', 'probe'],
        getStartupHealth: ['cached', 'startup', 'health'],
        getRunAnalysis: ['run', 'analysis'],
        getRunArtifacts: ['list', 'artifacts'],
        getRunImprovements: ['improvement', 'findings'],
        getRunLog: ['log', 'file'],
        getRunEvents: ['structured', 'event', 'snapshot'],
        getRunProgress: ['legacy', 'progress', 'event'],
        streamRunEvents: ['stream', 'run', 'events'],
        getRunStatus: ['run', 'status'],
        listGitHubIssues: ['repository', 'issues', 'task'],
        listRuns: ['list', 'runs'],
        testGateway: ['gateway', 'inference', 'adapter'],
        testWebhook: ['test', 'webhook'],
        triggerRun: ['trigger', 'run'],
        validateTask: ['validate', 'task']
      };
      const criticalDescriptionExpectations = [
        {
          operationId: 'getReady',
          terms: ['ready', 'queue', 'scheduler']
        },
        {
          operationId: 'getPreFlight',
          terms: ['controller', 'docker', 'github app']
        },
        {
          operationId: 'getStartupHealth',
          terms: ['cached', 'boot-time', 'current readiness', '/api/preflight']
        },
        {
          operationId: 'validateTask',
          terms: ['task configuration', 'pre-flight', 'prompt', 'constraints']
        },
        {
          operationId: 'triggerRun',
          terms: ['queue', '202 accepted', 'id', 'poll status']
        },
        {
          operationId: 'getRunStatus',
          terms: ['current status', 'progress', 'elapsed time', 'timeout risk']
        },
        {
          operationId: 'getRunEvents',
          terms: ['canonical', 'structured event snapshot', 'progress.jsonl', 'live docker progress']
        },
        {
          operationId: 'streamRunEvents',
          terms: ['server-sent events', 'sse']
        },
        {
          operationId: 'getRunProgress',
          terms: ['deprecated', '/api/runs/{id}/events', 'stream=sse', '/api/runs/{id}/events/stream']
        },
        {
          operationId: 'getRunLog',
          terms: ['stdout', 'stderr', 'validation', 'large logs', 'truncated']
        },
        {
          operationId: 'downloadArtifact',
          terms: ['specific artifact file', 'metadata.json', '/api/runs/{id}/artifacts']
        },
        {
          operationId: 'getRunAnalysis',
          terms: ['post-run analysis', 'metadata', 'validation results', 'failure details']
        },
        {
          operationId: 'getRunImprovements',
          terms: ['run-evaluation artifacts', 'stage timings', 'dashboards']
        },
        {
          operationId: 'testGateway',
          terms: ['gateway connectivity', 'inference', 'pi adapter']
        },
        {
          operationId: 'listGitHubIssues',
          terms: ['repository issues', 'task creation']
        }
      ];
      const operations = Object.entries(paths).flatMap(([route, pathDef]) => {
        const def = pathDef as Record<string, any>;

        return methods
          .filter((method) => Boolean(def[method]))
          .map((method) => ({
            method,
            route,
            operation: def[method]
          }));
      });
      const operationsById = Object.fromEntries(operations.map(({ operation }) => [operation.operationId, operation]));

      expect(Object.keys(operationsById).sort()).toEqual(Object.keys(expectedSummaryTermsByOperationId).sort());

      operations.forEach(({ operation }) => {
        const summary = operation.summary?.trim();
        const expectedSummaryTerms = expectedSummaryTermsByOperationId[operation.operationId];

        expect(summary).toEqual(expect.any(String));
        expect(summary.length).toBeGreaterThanOrEqual(8);
        expect(summary).not.toMatch(placeholderPattern);
        expect(summary).not.toMatch(/todo|fixme|placeholder/i);
        expect(expectedSummaryTerms).toBeDefined();
        expectedSummaryTerms.forEach((term) => {
          expect(summary.toLowerCase()).toContain(term);
        });
      });

      criticalDescriptionExpectations.forEach(({ operationId, terms }) => {
        const operation = operationsById[operationId];
        const description = operation?.description?.trim();

        expect(operation).toBeDefined();
        expect(description).toEqual(expect.any(String));
        expect(description.length).toBeGreaterThanOrEqual(40);
        expect(description).not.toMatch(placeholderPattern);
        expect(description).not.toMatch(/todo|fixme|placeholder/i);
        terms.forEach((term) => {
          expect(description.toLowerCase()).toContain(term);
        });
      });
    });

    it('should expose only expected HTTP methods for stable public routes', () => {
      const paths = buildAllPaths(errorSchema, requestSchema, responseSchema);

      expect(Object.keys(paths['/api/runs'] as Record<string, unknown>).sort()).toEqual(['get', 'post']);
      expect(Object.keys(paths['/api/runs/{id}/status'] as Record<string, unknown>).sort()).toEqual(['get']);
      expect(Object.keys(paths['/api/webhooks/test'] as Record<string, unknown>).sort()).toEqual(['post']);
    });
  });

  describe('buildAllPaths with missing schemas', () => {
    it('should preserve error responses with empty error schema as an OpenAPI any-type fallback', () => {
      const emptyErrorSchema = {};
      const paths = buildAllPaths(emptyErrorSchema, requestSchema, responseSchema);
      const expectedErrorResponsesByOperation: Record<string, Record<string, string[]>> = {
        '/ready': { get: ['503'] },
        '/api/metrics': { get: ['401'] },
        '/api/preflight': { get: ['401'] },
        '/api/validate': { post: ['400', '401'] },
        '/api/runs': { get: ['401'], post: ['400', '401'] },
        '/api/runs/{id}/status': { get: ['401', '404'] },
        '/api/runs/{id}/cancel': { post: ['401', '404'] },
        '/api/runs/{id}/progress': { get: ['401', '404'] },
        '/api/runs/{id}/logs/{logtype}': { get: ['401', '404'] },
        '/api/runs/{id}/artifacts': { get: ['401', '404'] },
        '/api/results/{id}/{file}': { get: ['401', '404', '422'] },
        '/api/runs/{id}/analysis': { get: ['401', '404'] },
        '/api/improvements': { get: ['401'] },
        '/api/webhooks/test': { post: ['400', '401'] }
      };

      Object.entries(expectedErrorResponsesByOperation).forEach(([path, methods]) => {
        Object.entries(methods).forEach(([method, statuses]) => {
          const operation = (paths[path] as Record<string, any>)[method];

          const fallbackStatuses = Object.entries(operation.responses)
            .filter(([, response]: [string, any]) => {
              const jsonSchema = response.content?.['application/json']?.schema;
              return jsonSchema !== undefined && Object.keys(jsonSchema).length === 0;
            })
            .map(([status]) => status)
            .sort();

          expect(operation).toBeDefined();
          expect(fallbackStatuses).toEqual(statuses);
          statuses.forEach((status) => {
            expect(operation.responses[status].content).toEqual({
              'application/json': {
                schema: emptyErrorSchema
              }
            });
          });
        });
      });

      const publicRoutes = {
        '/health': { get: ['200'] },
        '/ready': { get: ['200', '503'] }
      };
      Object.entries(publicRoutes).forEach(([path, methods]) => {
        Object.entries(methods).forEach(([method, statuses]) => {
          const operation = (paths[path] as Record<string, any>)[method];

          expect(operation.security).toBeUndefined();
          expect(typeof operation.operationId).toBe('string');
          expect(operation.tags.length).toBeGreaterThan(0);
          expect(Object.keys(operation.responses).sort()).toEqual(statuses);
          statuses.forEach((status) => {
            const response = operation.responses[status];

            expect(typeof response.description).toBe('string');
            expect(response.content?.['application/json']?.schema).toBeDefined();
          });
        });
      });
    });

    it('should reject an empty request schema for routes requiring buildRunRequestSchema output', () => {
      expect(() => buildAllPaths(errorSchema, {}, responseSchema)).toThrow(
        'buildAllPaths requires runRequestSchema from buildRunRequestSchema()'
      );
    });

    it('should handle empty response schema', () => {
      const paths = buildAllPaths(errorSchema, requestSchema, {});
      expect(paths).toBeDefined();
      expect(Object.keys(paths).length).toBeGreaterThan(0);
    });
  });

  describe('Health Check Endpoints', () => {
    let paths: Record<string, unknown>;

    beforeEach(() => {
      paths = buildAllPaths(errorSchema, requestSchema, responseSchema);
    });

    it('GET /health should have correct operationId and no authentication', () => {
      const healthPath = (paths['/health'] as Record<string, any>).get;
      expect(healthPath.operationId).toBe('getHealth');
      expect(healthPath.security).toBeUndefined();
      expect(healthPath.tags).toEqual(['Health & Status']);
    });

    it('GET /health response should return ok status', () => {
      const healthPath = (paths['/health'] as Record<string, any>).get;
      const responseSchema = (healthPath.responses['200'].content['application/json'].schema as Record<string, any>)
        .properties.status;
      expect(responseSchema.type).toBe('string');
      expect(responseSchema.enum).toEqual(['ok']);
    });

    it('GET /ready should have readiness probe logic and 503 error response', () => {
      const readyPath = (paths['/ready'] as Record<string, any>).get;
      expect(readyPath.operationId).toBe('getReady');
      expect(readyPath.responses['503']).toBeDefined();
      expect(readyPath.responses['503'].description).toContain('not ready');
    });

    it('GET /ready should return boolean ready flag', () => {
      const readyPath = (paths['/ready'] as Record<string, any>).get;
      const responseSchema = (readyPath.responses['200'].content['application/json'].schema as Record<string, any>)
        .properties;
      expect(responseSchema.ready.type).toBe('boolean');
      expect(responseSchema.message.type).toBe('string');
    });
  });

  describe('Service Info Endpoints', () => {
    let paths: Record<string, unknown>;

    beforeEach(() => {
      paths = buildAllPaths(errorSchema, requestSchema, responseSchema);
    });

    it('GET /api/metrics should require authentication and return Prometheus format', () => {
      const metricsPath = (paths['/api/metrics'] as Record<string, any>).get;
      expect(metricsPath.operationId).toBe('getMetrics');
      expect(metricsPath.security).toEqual([{ BearerAuth: [] }]);
      expect(metricsPath.responses['200'].content['text/plain']).toBeDefined();
    });

    it('GET /api/preflight should validate controller configuration', () => {
      const preflightPath = (paths['/api/preflight'] as Record<string, any>).get;
      expect(preflightPath.operationId).toBe('getPreFlight');
      expect(preflightPath.security).toEqual([{ BearerAuth: [] }]);
      const responseProps = (preflightPath.responses['200'].content['application/json'].schema as Record<string, any>)
        .properties;
      expect(responseProps.isValid.type).toBe('boolean');
      expect(responseProps.checks.type).toBe('array');
      expect(responseProps.containerStartup.description).toContain('boot history');
      expect(responseProps.containerStartup.properties.scope.enum).toEqual(['startup']);
      expect(responseProps.containerStartup.properties.readinessImpact.enum).toEqual([
        'excluded-from-current-readiness'
      ]);
      expect(responseProps.containerStartup.properties.current.enum).toEqual([false]);
      expect(responseProps.containerStartup.properties.recommendedCurrentEndpoint.enum).toEqual(['/api/preflight']);
      expect(responseProps.containerStartup.properties.cachedAt.format).toBe('date-time');
    });

    it('POST /api/validate should accept RunRequest schema and return validation result', () => {
      const validatePath = (paths['/api/validate'] as Record<string, any>).post;
      expect(validatePath.operationId).toBe('validateTask');
      expect(validatePath.requestBody.required).toBe(true);
      expect(validatePath.requestBody.content['application/json'].schema).toBe(requestSchema);
      const responseProps = (validatePath.responses['200'].content['application/json'].schema as Record<string, any>)
        .properties;
      expect(responseProps.isValid.type).toBe('boolean');
      expect(responseProps.estimatedDurationSeconds.type).toBe('integer');
    });
  });

  describe('Run Management Endpoints', () => {
    let paths: Record<string, unknown>;

    beforeEach(() => {
      paths = buildAllPaths(errorSchema, requestSchema, responseSchema);
    });

    it('POST /api/runs should trigger a new run and return 202 Accepted', () => {
      const runsPath = (paths['/api/runs'] as Record<string, any>).post;
      expect(runsPath.operationId).toBe('triggerRun');
      expect(runsPath.responses['202']).toBeDefined();
      expect(runsPath.responses['202'].description).toContain('queued');
    });

    it('GET /api/runs should list runs with pagination parameters', () => {
      const runsPath = (paths['/api/runs'] as Record<string, any>).get;
      expect(runsPath.operationId).toBe('listRuns');
      const limitParam = runsPath.parameters.find((p: Record<string, any>) => p.name === 'limit');
      const offsetParam = runsPath.parameters.find((p: Record<string, any>) => p.name === 'offset');
      expect(limitParam.schema.type).toBe('integer');
      expect(limitParam.schema.default).toBe(50);
      expect(limitParam.schema.minimum).toBe(1);
      expect(limitParam.schema.maximum).toBe(500);
      expect(offsetParam.schema.default).toBe(0);
      expect(offsetParam.schema.minimum).toBe(0);
    });

    it('GET /api/runs/{id}/status should require kaseki-N pattern parameter', () => {
      const statusPath = (paths['/api/runs/{id}/status'] as Record<string, any>).get;
      expect(statusPath.operationId).toBe('getRunStatus');
      const idParam = statusPath.parameters.find((p: Record<string, any>) => p.name === 'id');
      expect(idParam.in).toBe('path');
      expect(idParam.required).toBe(true);
      expect(idParam.schema.pattern).toBe('^kaseki-\\d+$');
    });

    it('POST /api/runs/{id}/cancel should accept cancellation requests', () => {
      const cancelPath = (paths['/api/runs/{id}/cancel'] as Record<string, any>).post;
      expect(cancelPath.operationId).toBe('cancelRun');
      expect(cancelPath.responses['200'].description).toContain('accepted');
      const idParam = cancelPath.parameters.find((p: Record<string, any>) => p.name === 'id');
      expect(idParam.schema.pattern).toBe('^kaseki-\\d+$');
    });
  });

  describe('Logs & Progress Endpoints', () => {
    let paths: Record<string, unknown>;

    beforeEach(() => {
      paths = buildAllPaths(errorSchema, requestSchema, responseSchema);
    });

    it('GET /api/runs/{id}/events should be the canonical structured event snapshot', () => {
      const eventsPath = (paths['/api/runs/{id}/events'] as Record<string, any>).get;
      expect(eventsPath.operationId).toBe('getRunEvents');
      expect(eventsPath.responses['200'].content['application/json'].schema.required).toEqual([
        'id',
        'status',
        'events',
        'total',
        'sources'
      ]);
    });

    it('GET /api/runs/{id}/events/stream should support SSE streaming', () => {
      const streamPath = (paths['/api/runs/{id}/events/stream'] as Record<string, any>).get;
      expect(streamPath.operationId).toBe('streamRunEvents');
      expect(streamPath.responses['200'].content['text/event-stream']).toBeDefined();
    });

    it('GET /api/runs/{id}/progress should be a deprecated alias with the same snapshot schema', () => {
      const eventsPath = (paths['/api/runs/{id}/events'] as Record<string, any>).get;
      const progressPath = (paths['/api/runs/{id}/progress'] as Record<string, any>).get;
      expect(progressPath.operationId).toBe('getRunProgress');
      expect(progressPath.deprecated).toBe(true);
      expect(progressPath.responses['200'].content['application/json'].schema).toEqual(
        eventsPath.responses['200'].content['application/json'].schema
      );
      const streamParam = progressPath.parameters.find((p: Record<string, any>) => p.name === 'stream');
      expect(streamParam.schema.enum).toEqual(['sse']);
    });

    it('GET /api/runs/{id}/logs/{logtype} should support multiple log types', () => {
      const logsPath = (paths['/api/runs/{id}/logs/{logtype}'] as Record<string, any>).get;
      expect(logsPath.operationId).toBe('getRunLog');
      const logtypeParam = logsPath.parameters.find((p: Record<string, any>) => p.name === 'logtype');
      expect(logtypeParam.schema.enum).toContain('stdout');
      expect(logtypeParam.schema.enum).toContain('stderr');
      expect(logtypeParam.schema.enum).toContain('validation');
      expect(logtypeParam.schema.enum).toContain('combined');
    });

    it('GET /api/runs/{id}/logs/{logtype} should support tail parameter', () => {
      const logsPath = (paths['/api/runs/{id}/logs/{logtype}'] as Record<string, any>).get;
      const tailParam = logsPath.parameters.find((p: Record<string, any>) => p.name === 'tail');
      expect(tailParam.schema.type).toBe('integer');
      expect(tailParam.schema.minimum).toBe(1);
      expect(tailParam.schema.default).toBe(100);
    });
  });

  describe('Artifacts Endpoints', () => {
    let paths: Record<string, unknown>;

    beforeEach(() => {
      paths = buildAllPaths(errorSchema, requestSchema, responseSchema);
    });

    it('GET /api/runs/{id}/artifacts should list all available artifacts', () => {
      const artifactsPath = (paths['/api/runs/{id}/artifacts'] as Record<string, any>).get;
      expect(artifactsPath.operationId).toBe('getRunArtifacts');
      const responseProps = (artifactsPath.responses['200'].content['application/json'].schema as Record<string, any>)
        .properties;
      expect(responseProps.artifacts.type).toBe('array');
      expect(responseProps.recommended.type).toBe('array');
    });

    it('GET /api/results/{id}/{file} should support artifact download', () => {
      const downloadPath = (paths['/api/results/{id}/{file}'] as Record<string, any>).get;
      expect(downloadPath.operationId).toBe('downloadArtifact');
      const fileParam = downloadPath.parameters.find((p: Record<string, any>) => p.name === 'file');
      expect(fileParam.in).toBe('path');
      expect(fileParam.required).toBe(true);
      const formatParam = downloadPath.parameters.find((p: Record<string, any>) => p.name === 'format');
      expect(formatParam.in).toBe('query');
      expect(formatParam.required).toBe(false);
      expect(formatParam.schema.enum).toContain('rendered');
      expect(downloadPath.responses['422']).toBeDefined();
    });
  });

  describe('Run Analysis Endpoints', () => {
    let paths: Record<string, unknown>;

    beforeEach(() => {
      paths = buildAllPaths(errorSchema, requestSchema, responseSchema);
    });

    it('GET /api/runs/{id}/analysis should provide comprehensive run analysis', () => {
      const analysisPath = (paths['/api/runs/{id}/analysis'] as Record<string, any>).get;
      expect(analysisPath.operationId).toBe('getRunAnalysis');
      expect(analysisPath.security).toEqual([{ BearerAuth: [] }]);
    });
  });

  describe('Webhook Endpoints', () => {
    let paths: Record<string, unknown>;

    beforeEach(() => {
      paths = buildAllPaths(errorSchema, requestSchema, responseSchema);
    });

    it('POST /api/webhooks/test should test webhook delivery', () => {
      const webhookPath = (paths['/api/webhooks/test'] as Record<string, any>).post;
      expect(webhookPath.operationId).toBe('testWebhook');
      expect(webhookPath.requestBody.required).toBe(true);
      expect(webhookPath.responses['200']).toBeDefined();
      expect(webhookPath.responses['400']).toBeDefined();
    });
  });

  describe('Authentication and Security', () => {
    let paths: Record<string, unknown>;

    beforeEach(() => {
      paths = buildAllPaths(errorSchema, requestSchema, responseSchema);
    });

    it('public endpoints should not require authentication', () => {
      const healthPath = (paths['/health'] as Record<string, any>).get;
      const readyPath = (paths['/ready'] as Record<string, any>).get;
      expect(healthPath.security).toBeUndefined();
      expect(readyPath.security).toBeUndefined();
    });

    it('protected endpoints should require BearerAuth', () => {
      const metricsPath = (paths['/api/metrics'] as Record<string, any>).get;
      const runsPath = (paths['/api/runs'] as Record<string, any>).post;
      expect(metricsPath.security).toEqual([{ BearerAuth: [] }]);
      expect(runsPath.security).toEqual([{ BearerAuth: [] }]);
    });

    it('all protected endpoints should return 401 for unauthorized', () => {
      Object.entries(paths).forEach(([_, pathDef]) => {
        const def = pathDef as Record<string, any>;
        const methods = ['get', 'post', 'put', 'delete', 'patch'];

        methods.forEach((method) => {
          if (def[method]?.security?.length > 0) {
            expect(def[method].responses['401']).toBeDefined();
          }
        });
      });
    });
  });

  describe('Parameter Validation', () => {
    let paths: Record<string, unknown>;

    beforeEach(() => {
      paths = buildAllPaths(errorSchema, requestSchema, responseSchema);
    });

    it('id parameters should match kaseki-N pattern', () => {
      const pathsWithIdParam = [
        '/api/runs/{id}/status',
        '/api/runs/{id}/cancel',
        '/api/runs/{id}/progress',
        '/api/runs/{id}/logs/{logtype}',
        '/api/runs/{id}/artifacts',
        '/api/results/{id}/{file}',
        '/api/runs/{id}/analysis'
      ];

      pathsWithIdParam.forEach((pathKey) => {
        const pathDef = paths[pathKey] as Record<string, any>;
        const operations = ['get', 'post', 'put', 'delete', 'patch'];
        let found = false;

        operations.forEach((method) => {
          if (pathDef[method]?.parameters) {
            const idParam = pathDef[method].parameters.find((p: Record<string, any>) => p.name === 'id');
            if (idParam) {
              found = true;
              expect(idParam.schema.pattern).toBe('^kaseki-\\d+$');
              expect(idParam.required).toBe(true);
            }
          }
        });

        expect(found).toBe(true);
      });
    });

    it('query parameters should have appropriate constraints', () => {
      const listRunsPath = (paths['/api/runs'] as Record<string, any>).get;
      const limit = listRunsPath.parameters.find((p: Record<string, any>) => p.name === 'limit');
      const offset = listRunsPath.parameters.find((p: Record<string, any>) => p.name === 'offset');

      expect(limit.schema.minimum).toBe(1);
      expect(limit.schema.maximum).toBe(500);
      expect(offset.schema.minimum).toBe(0);
    });
  });

  describe('Response Status Codes', () => {
    let paths: Record<string, unknown>;

    beforeEach(() => {
      paths = buildAllPaths(errorSchema, requestSchema, responseSchema);
    });

    it('each GET operation should document its expected success status', () => {
      const expectedGetSuccessStatusByRoute: Record<string, string> = {
        '/api/gateway-test': '200',
        '/api/improvements': '200',
        '/api/metrics': '200',
        '/api/preflight': '200',
        '/api/startup-health': '200',
        '/api/results/{id}/{file}': '200',
        '/api/runs': '200',
        '/api/runs/{id}/analysis': '200',
        '/api/runs/{id}/artifacts': '200',
        '/api/runs/{id}/events': '200',
        '/api/runs/{id}/events/stream': '200',
        '/api/runs/{id}/logs/{logtype}': '200',
        '/api/runs/{id}/progress': '200',
        '/api/runs/{id}/status': '200',
        '/health': '200',
        '/ready': '200'
      };
      const getOperations = Object.entries(paths)
        .filter(([, pathDef]) => Boolean((pathDef as Record<string, any>).get))
        .map(([route, pathDef]) => ({
          route,
          operation: (pathDef as Record<string, any>).get
        }));

      expect(getOperations.map(({ route }) => route).sort()).toEqual(
        Object.keys(expectedGetSuccessStatusByRoute).sort()
      );
      getOperations.forEach(({ route, operation }) => {
        const expectedStatus = expectedGetSuccessStatusByRoute[route];

        expect(operation.responses[expectedStatus]).toBeDefined();
      });
    });

    it('POST requests that queue jobs should return 202 Accepted', () => {
      const triggerRunPath = (paths['/api/runs'] as Record<string, any>).post;
      expect(triggerRunPath.responses['202']).toBeDefined();
    });

    it('bad requests should return 400 with error schema', () => {
      const validatePath = (paths['/api/validate'] as Record<string, any>).post;
      expect(validatePath.responses['400']).toBeDefined();
      expect(validatePath.responses['400'].content['application/json'].schema).toBe(errorSchema);
    });

    it('not found errors should return 404', () => {
      const statusPath = (paths['/api/runs/{id}/status'] as Record<string, any>).get;
      expect(statusPath.responses['404']).toBeDefined();
    });

    it('service unavailable should return 503 for readiness probes', () => {
      const readyPath = (paths['/ready'] as Record<string, any>).get;
      expect(readyPath.responses['503']).toBeDefined();
    });
  });
});
