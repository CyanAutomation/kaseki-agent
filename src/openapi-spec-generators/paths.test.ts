/**
 * Tests for OpenAPI Path Builders
 */

import { buildAllPaths } from './paths';
import { buildErrorResponseSchema, buildRunRequestSchema, buildRunResponseSchema } from './schemas';

describe('OpenAPI Path Builders', () => {
  let errorSchema: Record<string, unknown>;
  let requestSchema: Record<string, unknown>;
  let responseSchema: Record<string, unknown>;

  beforeEach(() => {
    errorSchema = buildErrorResponseSchema();
    requestSchema = buildRunRequestSchema();
    responseSchema = buildRunResponseSchema();
  });

  describe('buildAllPaths', () => {
    it('should include health check endpoints', () => {
      const paths = buildAllPaths(errorSchema, requestSchema, responseSchema);

      expect(paths['/health']).toBeDefined();
      expect(paths['/ready']).toBeDefined();
    });

    it('should include service info endpoints', () => {
      const paths = buildAllPaths(errorSchema, requestSchema, responseSchema);

      expect(paths['/api/metrics']).toBeDefined();
      expect(paths['/api/preflight']).toBeDefined();
    });

    it('should include run management endpoints', () => {
      const paths = buildAllPaths(errorSchema, requestSchema, responseSchema);

      expect(paths['/api/runs']).toBeDefined();
      expect(paths['/api/runs/{id}/status']).toBeDefined();
      expect(paths['/api/runs/{id}/cancel']).toBeDefined();
    });

    it('should include logs and progress endpoints', () => {
      const paths = buildAllPaths(errorSchema, requestSchema, responseSchema);

      expect(paths['/api/runs/{id}/logs/{logtype}']).toBeDefined();
      expect(paths['/api/runs/{id}/progress']).toBeDefined();
    });

    it('should include artifacts endpoints', () => {
      const paths = buildAllPaths(errorSchema, requestSchema, responseSchema);

      expect(paths['/api/runs/{id}/artifacts']).toBeDefined();
    });

    it('should include run analysis endpoints', () => {
      const paths = buildAllPaths(errorSchema, requestSchema, responseSchema);

      expect(paths['/api/runs/{id}/analysis']).toBeDefined();
    });

    it('should include webhook endpoints', () => {
      const paths = buildAllPaths(errorSchema, requestSchema, responseSchema);

      expect(paths['/api/webhooks/test']).toBeDefined();
    });

    it('should have at least 14 endpoints', () => {
      const paths = buildAllPaths(errorSchema, requestSchema, responseSchema);
      const pathKeys = Object.keys(paths);

      expect(pathKeys.length).toBeGreaterThanOrEqual(14);
    });

    it('each endpoint should have at least one operation (GET, POST, etc)', () => {
      const paths = buildAllPaths(errorSchema, requestSchema, responseSchema);

      Object.entries(paths).forEach(([_, pathDef]) => {
        const def = pathDef as Record<string, unknown>;
        const hasOperation =
          def.get !== undefined ||
          def.post !== undefined ||
          def.put !== undefined ||
          def.delete !== undefined ||
          def.patch !== undefined;

        expect(hasOperation).toBe(true);
      });
    });

    it('each operation should have operationId', () => {
      const paths = buildAllPaths(errorSchema, requestSchema, responseSchema);

      Object.entries(paths).forEach(([_, pathDef]) => {
        const def = pathDef as Record<string, any>;
        const methods = ['get', 'post', 'put', 'delete', 'patch'];

        methods.forEach((method) => {
          if (def[method]) {
            expect(def[method].operationId).toBeDefined();
            expect(typeof def[method].operationId).toBe('string');
          }
        });
      });
    });

    it('each operation should have tags', () => {
      const paths = buildAllPaths(errorSchema, requestSchema, responseSchema);

      Object.entries(paths).forEach(([_, pathDef]) => {
        const def = pathDef as Record<string, any>;
        const methods = ['get', 'post', 'put', 'delete', 'patch'];

        methods.forEach((method) => {
          if (def[method]) {
            expect(def[method].tags).toBeDefined();
            expect(Array.isArray(def[method].tags)).toBe(true);
            expect(def[method].tags.length).toBeGreaterThan(0);
          }
        });
      });
    });

    it('each operation should have responses defined', () => {
      const paths = buildAllPaths(errorSchema, requestSchema, responseSchema);

      Object.entries(paths).forEach(([_, pathDef]) => {
        const def = pathDef as Record<string, any>;
        const methods = ['get', 'post', 'put', 'delete', 'patch'];

        methods.forEach((method) => {
          if (def[method]) {
            expect(def[method].responses).toBeDefined();
            expect(typeof def[method].responses).toBe('object');
            const responseKeys = Object.keys(def[method].responses);
            expect(responseKeys.length).toBeGreaterThan(0);
          }
        });
      });
    });

    it('POST /api/runs should define the trigger run contract', () => {
      const paths = buildAllPaths(errorSchema, requestSchema, responseSchema);
      const runsPath = paths['/api/runs'] as Record<string, any>;

      expect(Object.keys(runsPath)).toEqual(expect.arrayContaining(['post']));
      expect(runsPath.post.operationId).toBe('triggerRun');
      expect(runsPath.post.requestBody).toEqual({
        required: true,
        content: {
          'application/json': {
            schema: requestSchema,
          },
        },
      });
      expect(runsPath.post.responses).toEqual(
        expect.objectContaining({
          '202': expect.objectContaining({
            content: {
              'application/json': {
                schema: responseSchema,
              },
            },
          }),
          '200': expect.objectContaining({
            content: {
              'application/json': {
                schema: responseSchema,
              },
            },
          }),
          '400': expect.objectContaining({
            content: {
              'application/json': {
                schema: errorSchema,
              },
            },
          }),
          '401': expect.objectContaining({
            content: {
              'application/json': {
                schema: errorSchema,
              },
            },
          }),
        })
      );
    });

    it('should have summary and description for endpoints', () => {
      const paths = buildAllPaths(errorSchema, requestSchema, responseSchema);

      Object.entries(paths).forEach(([_, pathDef]) => {
        const def = pathDef as Record<string, any>;
        const methods = ['get', 'post', 'put', 'delete', 'patch'];

        methods.forEach((method) => {
          if (def[method]) {
            expect(def[method].summary || def[method].description).toBeDefined();
          }
        });
      });
    });

    it('should match snapshot', () => {
      const paths = buildAllPaths(errorSchema, requestSchema, responseSchema);
      expect(paths).toMatchSnapshot();
    });
  });

  describe('buildAllPaths with missing schemas', () => {
    it('should handle empty error schema', () => {
      const paths = buildAllPaths({}, requestSchema, responseSchema);
      expect(paths).toBeDefined();
      expect(Object.keys(paths).length).toBeGreaterThan(0);
    });

    it('should handle empty request schema', () => {
      const paths = buildAllPaths(errorSchema, {}, responseSchema);
      expect(paths).toBeDefined();
      expect(Object.keys(paths).length).toBeGreaterThan(0);
    });

    it('should handle empty response schema', () => {
      const paths = buildAllPaths(errorSchema, requestSchema, {});
      expect(paths).toBeDefined();
      expect(Object.keys(paths).length).toBeGreaterThan(0);
    });
  });
});
