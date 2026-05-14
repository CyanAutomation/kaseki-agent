/**
 * Tests for OpenAPI Schema Builders
 */

import {
  buildRunRequestSchema,
  buildRunResponseSchema,
  buildErrorResponseSchema,
  buildAllSchemas,
} from './schemas';

describe('OpenAPI Schema Builders', () => {
  describe('buildRunRequestSchema', () => {
    it('should have repoUrl as required property', () => {
      const schema = buildRunRequestSchema();

      expect(schema).toBeDefined();
      expect(typeof schema).toBe('object');
      expect(schema.type).toBe('object');
      expect(schema.required).toBeDefined();
      expect(Array.isArray(schema.required)).toBe(true);
      expect(schema.required).toContain('repoUrl');
    });

    it('should define all expected properties', () => {
      const schema = buildRunRequestSchema();
      const properties = schema.properties as Record<string, unknown>;

      expect(properties.repoUrl).toBeDefined();
      expect(properties.ref).toBeDefined();
      expect(properties.taskPrompt).toBeDefined();
      expect(properties.changedFilesAllowlist).toBeDefined();
      expect(properties.maxDiffBytes).toBeDefined();
      expect(properties.validationCommands).toBeDefined();
      expect(properties.taskMode).toBeDefined();
    });

    it('should have repoUrl as URI format', () => {
      const schema = buildRunRequestSchema();
      const properties = schema.properties as Record<string, any>;

      expect(properties.repoUrl.type).toBe('string');
      expect(properties.repoUrl.format).toBe('uri');
    });

    it('should include descriptions for properties', () => {
      const schema = buildRunRequestSchema();
      const properties = schema.properties as Record<string, any>;

      expect(properties.repoUrl.description).toBeDefined();
      expect(typeof properties.repoUrl.description).toBe('string');
    });

    it('should match snapshot', () => {
      const schema = buildRunRequestSchema();
      expect(schema).toMatchSnapshot();
    });
  });

  describe('buildRunResponseSchema', () => {
    it('should have exact required properties', () => {
      const schema = buildRunResponseSchema();

      expect(schema.required).toEqual(['id', 'status', 'createdAt']);
    });

    it('should define semantic types for required client-visible properties', () => {
      const schema = buildRunResponseSchema();
      const properties = schema.properties as Record<string, any>;

      expect(properties.id).toMatchObject({
        type: 'string',
        example: 'kaseki-42',
      });
      expect(properties.status).toMatchObject({
        type: 'string',
        enum: ['queued', 'running', 'completed', 'failed'],
      });
      expect(properties.createdAt).toMatchObject({
        type: 'string',
        format: 'date-time',
      });
    });

    it('should define semantic types for optional client-visible tracing properties', () => {
      const schema = buildRunResponseSchema();
      const properties = schema.properties as Record<string, any>;

      expect(properties.correlationId).toMatchObject({
        type: 'string',
      });
      expect(properties.requestId).toMatchObject({
        type: 'string',
      });
      expect(schema.required).not.toContain('correlationId');
      expect(schema.required).not.toContain('requestId');
    });

    it('should match snapshot', () => {
      const schema = buildRunResponseSchema();
      expect(schema).toMatchSnapshot();
    });
  });

  describe('buildErrorResponseSchema', () => {
    it('should build valid error response schema', () => {
      const schema = buildErrorResponseSchema();

      expect(schema).toBeDefined();
      expect(typeof schema).toBe('object');
      expect(schema.type).toBe('object');
    });

    it('should have error property', () => {
      const schema = buildErrorResponseSchema();
      const properties = schema.properties as Record<string, unknown>;

      expect(properties.error).toBeDefined();
    });

    it('should have error as string type', () => {
      const schema = buildErrorResponseSchema();
      const properties = schema.properties as Record<string, any>;

      expect(properties.error.type).toBe('string');
    });

    it('should include requestId for debugging', () => {
      const schema = buildErrorResponseSchema();
      const properties = schema.properties as Record<string, unknown>;

      expect(properties.requestId).toBeDefined();
    });

    it('should match snapshot', () => {
      const schema = buildErrorResponseSchema();
      expect(schema).toMatchSnapshot();
    });
  });

  describe('buildAllSchemas', () => {
    it('should return object of all schemas', () => {
      const schemas = buildAllSchemas();

      expect(schemas).toBeDefined();
      expect(typeof schemas).toBe('object');
    });

    it('should include RunRequest schema', () => {
      const schemas = buildAllSchemas();

      expect(schemas.RunRequest).toBeDefined();
      expect(schemas.RunRequest.type).toBe('object');
    });

    it('should include RunResponse schema', () => {
      const schemas = buildAllSchemas();

      expect(schemas.RunResponse).toBeDefined();
      expect(schemas.RunResponse.type).toBe('object');
    });

    it('should include ErrorResponse schema', () => {
      const schemas = buildAllSchemas();

      expect(schemas.ErrorResponse).toBeDefined();
      expect(schemas.ErrorResponse.type).toBe('object');
    });

    it('should include at least 3 schemas', () => {
      const schemas = buildAllSchemas();
      const keys = Object.keys(schemas);

      expect(keys.length).toBeGreaterThanOrEqual(3);
    });

    it('each schema should be a valid object', () => {
      const schemas = buildAllSchemas();

      Object.entries(schemas).forEach(([name, schema]) => {
        expect(typeof schema).toBe('object');
        expect(schema.type).toBeDefined();
        expect(typeof name).toBe('string');
      });
    });

    it('should match snapshot', () => {
      const schemas = buildAllSchemas();
      expect(schemas).toMatchSnapshot();
    });
  });
});
