/**
 * Tests for OpenAPI Schema Builders
 */

import {
  buildRunRequestSchema,
  buildRunResponseSchema,
  buildErrorResponseSchema,
  buildAllSchemas,
} from './schemas';

type JsonSchemaObject = {
  type?: string;
  format?: string;
  enum?: string[];
  required?: string[];
  properties?: Record<string, JsonSchemaObject>;
  example?: string;
};

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
    it('should include RunRequest schema with required client-facing request fields', () => {
      const schemas = buildAllSchemas();
      const runRequest = schemas.RunRequest as JsonSchemaObject;
      const properties = runRequest.properties;

      expect(runRequest.required).toEqual(['repoUrl']);
      expect(properties?.repoUrl).toMatchObject({
        type: 'string',
        format: 'uri',
      });
      expect(properties?.taskPrompt).toMatchObject({
        type: 'string',
      });
      expect(properties?.taskMode).toMatchObject({
        type: 'string',
        enum: ['patch', 'inspect'],
      });
      expect(properties?.publishMode).toMatchObject({
        type: 'string',
        enum: ['auto', 'none', 'branch', 'pr', 'draft_pr'],
      });
    });

    it('should include RunResponse schema with required client-facing response fields', () => {
      const schemas = buildAllSchemas();
      const runResponse = schemas.RunResponse as JsonSchemaObject;
      const properties = runResponse.properties;

      expect(runResponse.required).toEqual(['id', 'status', 'createdAt']);
      expect(properties?.id).toMatchObject({
        type: 'string',
        example: 'kaseki-42',
      });
      expect(properties?.status).toMatchObject({
        type: 'string',
        enum: ['queued', 'running', 'completed', 'failed'],
      });
      expect(properties?.createdAt).toMatchObject({
        type: 'string',
        format: 'date-time',
      });
    });

    it('should include ErrorResponse schema with required client-facing error fields', () => {
      const schemas = buildAllSchemas();
      const errorResponse = schemas.ErrorResponse as JsonSchemaObject;
      const properties = errorResponse.properties;

      expect(errorResponse.required).toEqual(['error']);
      expect(properties?.error).toMatchObject({
        type: 'string',
      });
      expect(properties?.requestId).toMatchObject({
        type: 'string',
      });
    });

    it('should match snapshot', () => {
      const schemas = buildAllSchemas();
      expect(schemas).toMatchSnapshot();
    });
  });
});
