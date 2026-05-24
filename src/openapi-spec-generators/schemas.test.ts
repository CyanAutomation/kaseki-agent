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
      expect(properties.scouting).toMatchObject({
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          model: { type: 'string' },
          timeoutSeconds: { type: 'integer', minimum: 60, maximum: 10800 },
        },
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

      // Additional semantic checks for timeoutSeconds constraints
      const timeoutSchema = properties.timeoutSeconds as JsonSchemaObject;
      expect(timeoutSchema.minimum).toBe(60);
      expect(timeoutSchema.maximum).toBe(10800);
      expect(timeoutSchema.type).toBe('integer');

      expect(schema.required).not.toContain('taskPrompt');
      expect(schema.required).not.toContain('taskMode');
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

      // Additional semantic checks for exact enum values and constraints
      const taskModeSchema = runRequest.properties?.taskMode as JsonSchemaObject;
      expect(taskModeSchema.type).toBe('string');
      expect(taskModeSchema.enum).toHaveLength(2);
      expect(taskModeSchema.enum).toContain('patch');
      expect(taskModeSchema.enum).toContain('inspect');

      const publishModeSchema = runRequest.properties?.publishMode as JsonSchemaObject;
      expect(publishModeSchema.type).toBe('string');
      expect(publishModeSchema.enum).toHaveLength(5);
      expect(publishModeSchema.enum).toContain('auto');
      expect(publishModeSchema.enum).toContain('none');
      expect(publishModeSchema.enum).toContain('branch');
      expect(publishModeSchema.enum).toContain('pr');
      expect(publishModeSchema.enum).toContain('draft_pr');
      expect(runRequest.properties?.timeoutSeconds).toMatchObject({
        type: 'integer',
        minimum: 60,
        maximum: 10800,
      });

      expect(runResponse.required).toEqual(['id', 'status', 'createdAt']);
      expect(runResponse.properties?.status?.enum).toEqual(['queued', 'running', 'completed', 'failed']);

      // Additional semantic checks for status field constraints
      expect(runResponse.properties?.status).toHaveProperty('type', 'string');
      expect(runResponse.properties?.createdAt).toMatchObject({ type: 'string', format: 'date-time' });

      expect(errorResponse.required).toEqual(['error']);
      expect(errorResponse.properties?.requestId).toMatchObject({ type: 'string' });

      // Semantic checks for documented status enum with exact constraints
      expect(runResponse.properties?.status).toEqual({
        type: 'string',
        description: 'Current job status',
        enum: ['queued', 'running', 'completed', 'failed'],
      });
    });
  });

  describe('WebhookConfig Schema', () => {
    it('should define webhook URL, secret, events, and retry policy', () => {
      const schemas = buildAllSchemas();
      const webhookConfig = schemas.WebhookConfig as JsonSchemaObject;
      const properties = webhookConfig.properties as Record<string, JsonSchemaObject>;

      expect(webhookConfig.type).toBe('object');
      expect(properties.url).toMatchObject({ type: 'string', format: 'uri' });
      expect(properties.secret).toMatchObject({ type: 'string' });
      expect(properties.events).toMatchObject({
        type: 'array',
        items: { type: 'string' },
      });
      expect(properties.retryPolicy).toMatchObject({ type: 'object' });
    });
  });

  describe('RequestTracing Schema', () => {
    it('should define correlation and request ID fields', () => {
      const schemas = buildAllSchemas();
      const tracing = schemas.RequestTracing as JsonSchemaObject;
      const properties = tracing.properties as Record<string, JsonSchemaObject>;

      expect(tracing.type).toBe('object');
      expect(properties.correlationId).toMatchObject({ type: 'string', format: 'uuid' });
      expect(properties.requestId).toMatchObject({ type: 'string', format: 'uuid' });
    });
  });

  describe('StatusResponse Schema', () => {
    it('should define run status with progress tracking', () => {
      const schemas = buildAllSchemas();
      const statusResponse = schemas.StatusResponse as JsonSchemaObject;
      const properties = statusResponse.properties as Record<string, JsonSchemaObject>;

      expect(statusResponse.type).toBe('object');
      expect(properties.id).toMatchObject({ type: 'string' });
      expect(properties.status).toMatchObject({
        type: 'string',
        enum: ['queued', 'running', 'completed', 'failed'],
      });
    });
  });

  describe('Schema Field Type Validation', () => {
    it('RunRequest should have correct field types for all properties', () => {
      const schema = buildRunRequestSchema() as JsonSchemaObject;
      const properties = schema.properties as Record<string, JsonSchemaObject>;

      // String fields
      expect(properties.repoUrl.type).toBe('string');
      expect(properties.ref.type).toBe('string');
      expect(properties.taskPrompt.type).toBe('string');

      // Array fields
      expect(properties.changedFilesAllowlist.type).toBe('array');
      expect(properties.validationCommands.type).toBe('array');

      // Integer fields
      expect(properties.maxDiffBytes.type).toBe('integer');
      expect(properties.timeoutSeconds.type).toBe('integer');

      // Object fields
      expect(properties.scouting.type).toBe('object');
      expect(properties.webhookConfig.type).toBe('object');
      expect(properties.tracing.type).toBe('object');
    });

    it('RunResponse should have correct field types', () => {
      const schema = buildRunResponseSchema() as JsonSchemaObject;
      const properties = schema.properties as Record<string, JsonSchemaObject>;

      expect(properties.id.type).toBe('string');
      expect(properties.status.type).toBe('string');
      expect(properties.createdAt.type).toBe('string');
      expect(properties.createdAt.format).toBe('date-time');
      expect(properties.cached.type).toBe('boolean');
      expect(properties.exitCode.type).toBe('integer');
    });
  });

  describe('Enum Validation', () => {
    it('taskMode should only contain patch and inspect', () => {
      const schema = buildRunRequestSchema() as JsonSchemaObject;
      const taskMode = (schema.properties?.taskMode as JsonSchemaObject).enum;

      expect(taskMode).toHaveLength(2);
      expect(taskMode).toContain('patch');
      expect(taskMode).toContain('inspect');
      expect(taskMode).not.toContain('refactor');
      expect(taskMode).not.toContain('full-rewrite');
    });

    it('publishMode should contain exactly the defined values', () => {
      const schema = buildRunRequestSchema() as JsonSchemaObject;
      const publishMode = (schema.properties?.publishMode as JsonSchemaObject).enum;

      expect(publishMode).toHaveLength(5);
      const expectedValues = ['auto', 'none', 'branch', 'pr', 'draft_pr'];
      expectedValues.forEach((value) => {
        expect(publishMode).toContain(value);
      });
    });

    it('status enum should define all run states', () => {
      const schema = buildRunResponseSchema() as JsonSchemaObject;
      const status = (schema.properties?.status as JsonSchemaObject).enum;

      expect(status).toHaveLength(4);
      expect(status).toContain('queued');
      expect(status).toContain('running');
      expect(status).toContain('completed');
      expect(status).toContain('failed');
    });

    it('startupCheckMode should define boot and baseline-validation', () => {
      const schema = buildRunRequestSchema() as JsonSchemaObject;
      const checkMode = (schema.properties?.startupCheckMode as JsonSchemaObject).enum;

      expect(checkMode).toContain('boot');
      expect(checkMode).toContain('baseline-validation');
    });
  });

  describe('Numeric Constraint Validation', () => {
    it('timeoutSeconds should enforce 60-10800 second range', () => {
      const schema = buildRunRequestSchema() as JsonSchemaObject;
      const timeoutSeconds = schema.properties?.timeoutSeconds as JsonSchemaObject;

      expect(timeoutSeconds.minimum).toBe(60);
      expect(timeoutSeconds.maximum).toBe(10800);
      expect(timeoutSeconds.type).toBe('integer');
    });

    it('scouting timeoutSeconds should also enforce 60-10800 range', () => {
      const schema = buildRunRequestSchema() as JsonSchemaObject;
      const scouting = schema.properties?.scouting as JsonSchemaObject;
      const scoutingTimeout = scouting.properties?.timeoutSeconds as JsonSchemaObject;

      expect(scoutingTimeout.minimum).toBe(60);
      expect(scoutingTimeout.maximum).toBe(10800);
    });
  });

  describe('Required vs Optional Fields', () => {
    it('RunRequest should only require repoUrl', () => {
      const schema = buildRunRequestSchema() as JsonSchemaObject;
      expect(schema.required).toEqual(['repoUrl']);
    });

    it('RunResponse should require id, status, and createdAt', () => {
      const schema = buildRunResponseSchema() as JsonSchemaObject;
      expect(schema.required).toEqual(['id', 'status', 'createdAt']);
    });

    it('ErrorResponse should only require error', () => {
      const schema = buildErrorResponseSchema() as JsonSchemaObject;
      expect(schema.required).toEqual(['error']);
    });

    it('optional RunRequest fields should not be in required array', () => {
      const schema = buildRunRequestSchema() as JsonSchemaObject;
      const optionalFields = [
        'ref',
        'taskPrompt',
        'changedFilesAllowlist',
        'maxDiffBytes',
        'validationCommands',
        'scouting',
        'taskMode',
        'publishMode',
        'startupCheck',
        'webhookConfig',
        'tracing',
        'idempotencyKey',
        'timeoutSeconds',
      ];

      optionalFields.forEach((field) => {
        expect(schema.required).not.toContain(field);
      });
    });
  });

  describe('URI Format Validation', () => {
    it('repoUrl should have uri format', () => {
      const schema = buildRunRequestSchema() as JsonSchemaObject;
      const repoUrl = schema.properties?.repoUrl as JsonSchemaObject;
      expect(repoUrl.format).toBe('uri');
    });

    it('webhook URL should have uri format', () => {
      const schemas = buildAllSchemas();
      const webhookConfig = schemas.WebhookConfig as JsonSchemaObject;
      const url = webhookConfig.properties?.url as JsonSchemaObject;
      expect(url.format).toBe('uri');
    });
  });

  describe('UUID Format Validation', () => {
    it('idempotencyKey should have uuid format', () => {
      const schema = buildRunRequestSchema() as JsonSchemaObject;
      const idempotencyKey = schema.properties?.idempotencyKey as JsonSchemaObject;
      expect(idempotencyKey.format).toBe('uuid');
    });

    it('tracing fields should have uuid format', () => {
      const schemas = buildAllSchemas();
      const tracing = schemas.RequestTracing as JsonSchemaObject;
      const correlationId = tracing.properties?.correlationId as JsonSchemaObject;
      const requestId = tracing.properties?.requestId as JsonSchemaObject;
      expect(correlationId.format).toBe('uuid');
      expect(requestId.format).toBe('uuid');
    });
  });

  describe('DateTime Format Validation', () => {
    it('createdAt should have date-time format', () => {
      const schema = buildRunResponseSchema() as JsonSchemaObject;
      const createdAt = schema.properties?.createdAt as JsonSchemaObject;
      expect(createdAt.format).toBe('date-time');
    });

    it('completedAt should have date-time format', () => {
      const schema = buildRunResponseSchema() as JsonSchemaObject;
      const completedAt = schema.properties?.completedAt as JsonSchemaObject;
      expect(completedAt.format).toBe('date-time');
    });
  });

  describe('Array Item Type Validation', () => {
    it('changedFilesAllowlist items should be strings', () => {
      const schema = buildRunRequestSchema() as JsonSchemaObject;
      const allowlist = schema.properties?.changedFilesAllowlist as JsonSchemaObject;
      expect(allowlist.items?.type).toBe('string');
    });

    it('validationCommands items should be strings', () => {
      const schema = buildRunRequestSchema() as JsonSchemaObject;
      const commands = schema.properties?.validationCommands as JsonSchemaObject;
      expect(commands.items?.type).toBe('string');
    });

    it('webhook events items should be strings', () => {
      const schemas = buildAllSchemas();
      const webhookConfig = schemas.WebhookConfig as JsonSchemaObject;
      const events = webhookConfig.properties?.events as JsonSchemaObject;
      expect(events.items?.type).toBe('string');
    });
  });

  describe('Nested Object Structure', () => {
    it('scouting object should have enabled, model, and timeoutSeconds properties', () => {
      const schema = buildRunRequestSchema() as JsonSchemaObject;
      const scouting = schema.properties?.scouting as JsonSchemaObject;
      const scoutingProps = scouting.properties as Record<string, JsonSchemaObject>;

      expect(scoutingProps.enabled).toMatchObject({ type: 'boolean' });
      expect(scoutingProps.model).toMatchObject({ type: 'string' });
      expect(scoutingProps.timeoutSeconds).toMatchObject({
        type: 'integer',
        minimum: 60,
        maximum: 10800,
      });
    });
  });

  describe('Default Values', () => {
    it('ref should default to main', () => {
      const schema = buildRunRequestSchema() as JsonSchemaObject;
      const ref = schema.properties?.ref as JsonSchemaObject;
      expect(ref.default).toBe('main');
    });
  });

  describe('Example Values', () => {
    it('id should have example value kaseki-42', () => {
      const schema = buildRunResponseSchema() as JsonSchemaObject;
      const id = schema.properties?.id as JsonSchemaObject;
      expect(id.example).toBe('kaseki-42');
    });
  });
});
