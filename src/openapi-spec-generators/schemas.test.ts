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
  minimum?: number;
  maximum?: number;
  properties?: Record<string, JsonSchemaObject>;
  items?: JsonSchemaObject;
  example?: string;
  default?: string;
};

describe('OpenAPI Schema Builders', () => {
  describe('buildRunRequestSchema', () => {
    it('defines required and optional client-visible fields with expected constraints', () => {
      const schema = buildRunRequestSchema() as JsonSchemaObject;
      const properties = schema.properties as Record<string, JsonSchemaObject>;

      expect(schema.type).toBe('object');
      expect(schema.required).toEqual(['repoUrl']);

      expect(properties.repoUrl).toMatchObject({ type: 'string', format: 'uri' });
      expect(properties.ref).toMatchObject({ type: 'string', default: 'main' });
      expect(properties.taskPrompt).toMatchObject({ type: 'string' });
      expect(properties.changedFilesAllowlist).toMatchObject({
        type: 'array',
        items: { type: 'string' },
      });
      expect(properties.maxDiffBytes).toMatchObject({ type: 'integer' });
      expect(properties.validationCommands).toMatchObject({
        type: 'array',
        items: { type: 'string' },
      });
      expect(properties.taskMode).toMatchObject({
        type: 'string',
        enum: ['patch', 'inspect'],
      });
      expect(properties.publishMode).toMatchObject({
        type: 'string',
        enum: ['auto', 'none', 'branch', 'pr', 'draft_pr'],
      });
      expect(properties.startupCheck).toMatchObject({ type: 'boolean' });
      expect(properties.startupCheckMode).toMatchObject({
        type: 'string',
        enum: ['boot', 'baseline-validation'],
      });
      expect(properties.idempotencyKey).toMatchObject({ type: 'string', format: 'uuid' });
      expect(properties.timeoutSeconds).toMatchObject({
        type: 'integer',
        minimum: 60,
        maximum: 10800,
      });


      expect(schema.required).not.toContain('taskPrompt');
      expect(schema.required).not.toContain('taskPrompt');
      expect(schema.required).not.toContain('taskMode');
      expect(schema.required).not.toContain('publishMode');
    });
  });

  describe('buildRunResponseSchema', () => {
    it('defines required fields and exact documented enum/type constraints', () => {
      const schema = buildRunResponseSchema() as JsonSchemaObject;
      const properties = schema.properties as Record<string, JsonSchemaObject>;

      expect(schema.type).toBe('object');
      expect(schema.required).toEqual(['id', 'status', 'createdAt']);
      expect(properties.id).toMatchObject({ type: 'string', example: 'kaseki-42' });
      expect(properties.status).toMatchObject({
        type: 'string',
        enum: ['queued', 'running', 'completed', 'failed'],
      });
      expect(properties.createdAt).toMatchObject({ type: 'string', format: 'date-time' });

      expect(properties.completedAt).toMatchObject({ type: 'string', format: 'date-time' });
      expect(properties.cached).toMatchObject({ type: 'boolean' });
      expect(properties.exitCode).toMatchObject({ type: 'integer' });
      expect(properties.failureClass).toMatchObject({ type: 'string' });
      expect(properties.error).toMatchObject({ type: 'string' });

      expect(schema.required).not.toContain('correlationId');
      expect(schema.required).not.toContain('requestId');
      expect(schema.required).not.toContain('cached');
      expect(schema.required).not.toContain('completedAt');
      expect(schema.required).not.toContain('exitCode');
      expect(schema.required).not.toContain('failureClass');
      expect(schema.required).not.toContain('error');
    });
  });

  describe('buildErrorResponseSchema', () => {
    it('defines required error field and optional debugging identifiers', () => {
      const schema = buildErrorResponseSchema() as JsonSchemaObject;
      const properties = schema.properties as Record<string, JsonSchemaObject>;

      expect(schema.type).toBe('object');
      expect(schema.required).toEqual(['error']);
      expect(properties.error).toMatchObject({ type: 'string' });
      expect(properties.requestId).toMatchObject({ type: 'string' });
      expect(schema.required).not.toContain('requestId');
    });
  });

  describe('buildAllSchemas', () => {
    it('returns the expected schema registry and reuses per-schema semantic contracts', () => {
      const schemas = buildAllSchemas();

      expect(Object.keys(schemas).sort()).toEqual([
        'ErrorResponse',
        'RequestTracing',
        'RunRequest',
        'RunResponse',
        'StatusResponse',
        'WebhookConfig',
      ]);

      const runRequest = schemas.RunRequest as JsonSchemaObject;
      const runResponse = schemas.RunResponse as JsonSchemaObject;
      const errorResponse = schemas.ErrorResponse as JsonSchemaObject;

      expect(runRequest.required).toEqual(['repoUrl']);
      expect(runRequest.properties?.taskMode?.enum).toEqual(['patch', 'inspect']);
      expect(runRequest.properties?.publishMode?.enum).toEqual(['auto', 'none', 'branch', 'pr', 'draft_pr']);
      expect(runRequest.properties?.timeoutSeconds).toMatchObject({
        type: 'integer',
        minimum: 60,
        maximum: 10800,
      });

      expect(runResponse.required).toEqual(['id', 'status', 'createdAt']);
      expect(runResponse.properties?.status?.enum).toEqual(['queued', 'running', 'completed', 'failed']);
      expect(runResponse.properties?.createdAt).toMatchObject({ type: 'string', format: 'date-time' });

      expect(errorResponse.required).toEqual(['error']);
      expect(errorResponse.properties?.requestId).toMatchObject({ type: 'string' });

      // Compact stable snapshot for the externally documented status enum only.
      expect(runResponse.properties?.status).toMatchInlineSnapshot(`
        {
          "description": "Current job status",
          "enum": [
            "queued",
            "running",
            "completed",
            "failed",
          ],
          "type": "string",
        }
      `);
    });
  });
});
