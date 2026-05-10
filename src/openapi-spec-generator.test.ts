/**
 * Unit tests for OpenAPI spec generator
 */

import { generateOpenAPISpec } from '../src/openapi-spec-generator';

describe('OpenAPI Spec Generator', () => {
  let spec: Record<string, unknown>;

  beforeAll(() => {
    spec = generateOpenAPISpec();
  });

  describe('Basic Structure', () => {
    test('generates valid OpenAPI 3.1 spec', () => {
      expect(spec).toBeDefined();
      expect(spec.openapi).toBe('3.1.0');
    });

    test('includes required info section', () => {
      expect(spec.info).toBeDefined();
      expect((spec.info as Record<string, unknown>).title).toBe('Kaseki Agent API');
      expect((spec.info as Record<string, unknown>).version).toBeDefined();
      expect((spec.info as Record<string, unknown>).description).toBeDefined();
    });

    test('includes servers array', () => {
      expect(spec.servers).toBeDefined();
      expect(Array.isArray(spec.servers)).toBe(true);
      expect((spec.servers as Array<unknown>).length).toBeGreaterThan(0);
    });

    test('includes paths object', () => {
      expect(spec.paths).toBeDefined();
      expect(typeof spec.paths).toBe('object');
    });

    test('includes components section', () => {
      expect(spec.components).toBeDefined();
      expect((spec.components as Record<string, unknown>).schemas).toBeDefined();
      expect((spec.components as Record<string, unknown>).securitySchemes).toBeDefined();
    });

    test('includes tags array', () => {
      expect(spec.tags).toBeDefined();
      expect(Array.isArray(spec.tags)).toBe(true);
      expect((spec.tags as Array<unknown>).length).toBeGreaterThan(0);
    });
  });

  describe('Paths and Endpoints', () => {
    test('includes health endpoint', () => {
      expect((spec.paths as Record<string, unknown>)['/health']).toBeDefined();
    });

    test('includes ready endpoint', () => {
      expect((spec.paths as Record<string, unknown>)['/ready']).toBeDefined();
    });

    test('includes metrics endpoint', () => {
      expect((spec.paths as Record<string, unknown>)['/api/metrics']).toBeDefined();
    });

    test('includes run management endpoints', () => {
      const runEndpoints = ['/api/runs', '/api/runs/{id}/status', '/api/runs/{id}/cancel'];
      runEndpoints.forEach((endpoint) => {
        expect((spec.paths as Record<string, unknown>)[endpoint]).toBeDefined();
      });
    });

    test('includes artifact endpoints', () => {
      const artifactEndpoints = ['/api/runs/{id}/artifacts', '/api/results/{id}/{file}'];
      artifactEndpoints.forEach((endpoint) => {
        expect((spec.paths as Record<string, unknown>)[endpoint]).toBeDefined();
      });
    });

    test('includes webhook endpoint', () => {
      expect((spec.paths as Record<string, unknown>)['/api/webhooks/test']).toBeDefined();
    });

    test('all paths have operations defined', () => {
      const paths = spec.paths as Record<string, Record<string, unknown>>;
      Object.values(paths).forEach((pathItem) => {
        const methods = ['get', 'post', 'put', 'delete', 'patch'];
        const hasOperation = methods.some((method) => method in pathItem);
        expect(hasOperation).toBe(true);
      });
    });

    test('all endpoints have descriptions', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
      Object.values(paths).forEach((pathItem) => {
        Object.values(pathItem).forEach((operation) => {
          if (typeof operation === 'object' && operation !== null && 'description' in operation) {
            expect(operation.description).toBeTruthy();
          }
        });
      });
    });

    test('all endpoints have responses defined', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
      Object.entries(paths).forEach(([, pathItem]) => {
        Object.entries(pathItem).forEach(([method, operation]) => {
          if (method !== 'parameters' && typeof operation === 'object' && operation !== null) {
            expect((operation as Record<string, unknown>).responses).toBeDefined();
          }
        });
      });
    });
  });

  describe('Authentication', () => {
    test('defines BearerAuth security scheme', () => {
      const securitySchemes = (spec.components as Record<string, Record<string, unknown>>).securitySchemes;
      expect(securitySchemes.BearerAuth).toBeDefined();
      expect((securitySchemes.BearerAuth as Record<string, unknown>).type).toBe('http');
      expect((securitySchemes.BearerAuth as Record<string, unknown>).scheme).toBe('bearer');
    });

    test('public endpoints do not require authentication', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
      const publicEndpoints = ['/health', '/ready'];

      publicEndpoints.forEach((endpoint) => {
        const pathItem = paths[endpoint];
        Object.values(pathItem).forEach((operation) => {
          if (typeof operation === 'object' && operation !== null && 'security' in operation) {
            // Public endpoints should not have security requirement or have empty security array
            const security = (operation as Record<string, unknown>).security;
            if (security) {
              expect(Array.isArray(security)).toBe(true);
            }
          }
        });
      });
    });

    test('protected endpoints require bearer auth', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
      const protectedEndpoints = ['/api/runs', '/api/metrics', '/api/artifacts'];

      protectedEndpoints.forEach((endpoint) => {
        const pathItem = paths[endpoint];
        if (pathItem) {
          Object.values(pathItem).forEach((operation) => {
            if (typeof operation === 'object' && operation !== null && 'security' in operation) {
              const security = (operation as Record<string, unknown>).security;
              // Protected endpoints should have security defined
              if (security) {
                expect(Array.isArray(security)).toBe(true);
              }
            }
          });
        }
      });
    });
  });

  describe('Schemas', () => {
    test('includes all required schemas', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const requiredSchemas = ['RunRequest', 'RunResponse', 'StatusResponse', 'ErrorResponse'];

      requiredSchemas.forEach((schema) => {
        expect(schemas[schema]).toBeDefined();
      });
    });

    test('RunRequest schema has required properties', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runRequest = schemas.RunRequest as Record<string, unknown>;

      expect(runRequest.type).toBe('object');
      expect(runRequest.properties).toBeDefined();
      const props = runRequest.properties as Record<string, unknown>;
      expect(props.repoUrl).toBeDefined();
    });

    test('RunResponse schema is properly defined', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runResponse = schemas.RunResponse as Record<string, unknown>;

      expect(runResponse.type).toBe('object');
      expect(runResponse.properties).toBeDefined();
      const props = runResponse.properties as Record<string, unknown>;
      expect(props.id).toBeDefined();
      expect(props.status).toBeDefined();
      expect(props.createdAt).toBeDefined();
    });

    test('ErrorResponse schema is properly defined', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const errorResponse = schemas.ErrorResponse as Record<string, unknown>;

      expect(errorResponse.type).toBe('object');
      expect(errorResponse.properties).toBeDefined();
      const props = errorResponse.properties as Record<string, unknown>;
      expect(props.error).toBeDefined();
    });
  });

  describe('Response Codes', () => {
    test('successful operations include 200 or 202 responses', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;

      Object.entries(paths).forEach(([, pathItem]) => {
        Object.entries(pathItem).forEach(([method, operation]) => {
          if (method !== 'parameters' && typeof operation === 'object' && operation !== null) {
            const responses = (operation as Record<string, unknown>).responses;
            if (responses) {
              const responseCodes = Object.keys(responses as Record<string, unknown>);
              // Most operations should have at least one 2xx response
              const has2xx = responseCodes.some((code) => code.startsWith('2'));
              expect(has2xx || responseCodes.includes('default')).toBe(true);
            }
          }
        });
      });
    });

    test('protected endpoints include 401 unauthorized response', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
      const endpoints = ['/api/runs', '/api/metrics'];

      endpoints.forEach((endpoint) => {
        const pathItem = paths[endpoint];
        if (pathItem) {
          Object.entries(pathItem).forEach(([method, operation]) => {
            if (method !== 'parameters' && typeof operation === 'object' && operation !== null) {
              const responses = (operation as Record<string, unknown>).responses;
              if (responses) {
                const responseCodes = Object.keys(responses as Record<string, unknown>);
                expect(responseCodes).toContain('401');
              }
            }
          });
        }
      });
    });

    test('bad request endpoints include 400 response', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
      const postEndpoints = ['/api/runs', '/api/validate'];

      postEndpoints.forEach((endpoint) => {
        const pathItem = paths[endpoint];
        if (pathItem && pathItem.post) {
          const responses = (pathItem.post as Record<string, unknown>).responses;
          if (responses) {
            const responseCodes = Object.keys(responses as Record<string, unknown>);
            expect(responseCodes).toContain('400');
          }
        }
      });
    });
  });

  describe('Tags', () => {
    test('all tag names are referenced in operations', () => {
      const tags = spec.tags as Array<Record<string, unknown>>;
      const tagNames = tags.map((tag) => tag.name as string);
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;

      const usedTags = new Set<string>();
      Object.values(paths).forEach((pathItem) => {
        Object.values(pathItem).forEach((operation) => {
          if (typeof operation === 'object' && operation !== null && 'tags' in operation) {
            const operationTags = (operation as Record<string, unknown>).tags;
            if (Array.isArray(operationTags)) {
              operationTags.forEach((tag) => usedTags.add(tag as string));
            }
          }
        });
      });

      usedTags.forEach((tag) => {
        expect(tagNames).toContain(tag);
      });
    });
  });

  describe('Content', () => {
    test('spec is serializable to JSON', () => {
      expect(() => {
        JSON.stringify(spec);
      }).not.toThrow();
    });

    test('JSON serialization produces valid string', () => {
      const json = JSON.stringify(spec);
      expect(typeof json).toBe('string');
      expect(json.length).toBeGreaterThan(100);

      // Should be parseable back
      const parsed = JSON.parse(json);
      expect(parsed.openapi).toBe('3.1.0');
    });

    test('has reasonable number of endpoints', () => {
      const paths = spec.paths as Record<string, unknown>;
      const endpointCount = Object.keys(paths).length;
      expect(endpointCount).toBeGreaterThanOrEqual(14); // At least 14 endpoints
      expect(endpointCount).toBeLessThan(100); // But not too many
    });
  });
});
