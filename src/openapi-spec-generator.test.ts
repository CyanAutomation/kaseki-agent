/**
 * Unit tests for OpenAPI spec generator.
 *
 * These tests intentionally avoid existence-only assertions. The focused
 * contracts below should fail when generated client behavior, endpoint auth,
 * response semantics, or schema constraints drift.
 */

import { z } from 'zod';
import { generateOpenAPISpec } from '../src/openapi-spec-generator';
import {
  forEachPathOperation,
  assertAllPathsHaveOperations,
} from './__test-utils/api-client-assertions';

type OpenApiSpec = Record<string, unknown>;
type PathItem = Record<string, Operation>;
type Operation = Record<string, unknown>;
type Schema = Record<string, unknown>;

type EndpointContract = {
  path: string;
  method: string;
  operationId: string;
  auth: 'public' | 'protected';
  successCodes: string[];
  errorCodes?: string[];
  pathParams?: string[];
};

type SchemaContract = {
  schemaName: string;
  required: string[];
  properties: Record<string, Partial<Schema>>;
};

type PropertyConstraint = {
  label: string;
  schemaName: string;
  propertyPath: string[];
  expected: Partial<Schema>;
};

const httpMethods = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as const;
const expectedEndpoints: EndpointContract[] = [
  {
    path: '/health',
    method: 'get',
    operationId: 'getHealth',
    auth: 'public',
    successCodes: ['200'],
  },
  {
    path: '/ready',
    method: 'get',
    operationId: 'getReady',
    auth: 'public',
    successCodes: ['200'],
    errorCodes: ['503'],
  },
  {
    path: '/api/metrics',
    method: 'get',
    operationId: 'getMetrics',
    auth: 'protected',
    successCodes: ['200'],
    errorCodes: ['401'],
  },
  {
    path: '/api/preflight',
    method: 'get',
    operationId: 'getPreFlight',
    auth: 'protected',
    successCodes: ['200'],
    errorCodes: ['401'],
  },
  {
    path: '/api/startup-health',
    method: 'get',
    operationId: 'getStartupHealth',
    auth: 'protected',
    successCodes: ['200'],
    errorCodes: ['404', '500', '401'],
  },
  {
    path: '/api/gateway-test',
    method: 'get',
    operationId: 'testGateway',
    auth: 'protected',
    successCodes: ['200'],
    errorCodes: ['401'],
  },
  {
    path: '/api/github-issues',
    method: 'post',
    operationId: 'listGitHubIssues',
    auth: 'protected',
    successCodes: ['200'],
    errorCodes: ['400', '404', '401'],
  },
  {
    path: '/api/validate',
    method: 'post',
    operationId: 'validateTask',
    auth: 'protected',
    successCodes: ['200'],
    errorCodes: ['400', '401'],
  },
  {
    path: '/api/runs',
    method: 'post',
    operationId: 'triggerRun',
    auth: 'protected',
    successCodes: ['202', '200'],
    errorCodes: ['400', '401'],
  },
  {
    path: '/api/runs',
    method: 'get',
    operationId: 'listRuns',
    auth: 'protected',
    successCodes: ['200'],
    errorCodes: ['401'],
  },
  {
    path: '/api/runs/{id}/status',
    method: 'get',
    operationId: 'getRunStatus',
    auth: 'protected',
    successCodes: ['200'],
    errorCodes: ['404', '401'],
    pathParams: ['id'],
  },
  {
    path: '/api/runs/{id}/cancel',
    method: 'post',
    operationId: 'cancelRun',
    auth: 'protected',
    successCodes: ['200'],
    errorCodes: ['404', '401'],
    pathParams: ['id'],
  },
  {
    path: '/api/runs/{id}/progress',
    method: 'get',
    operationId: 'getRunProgress',
    auth: 'protected',
    successCodes: ['200'],
    errorCodes: ['404', '401'],
    pathParams: ['id'],
  },
  {
    path: '/api/runs/{id}/events',
    method: 'get',
    operationId: 'getRunEvents',
    auth: 'protected',
    successCodes: ['200'],
    errorCodes: ['404', '401'],
    pathParams: ['id'],
  },
  {
    path: '/api/runs/{id}/events/stream',
    method: 'get',
    operationId: 'streamRunEvents',
    auth: 'protected',
    successCodes: ['200'],
    errorCodes: ['404', '401'],
    pathParams: ['id'],
  },
  {
    path: '/api/runs/{id}/logs/{logtype}',
    method: 'get',
    operationId: 'getRunLog',
    auth: 'protected',
    successCodes: ['200'],
    errorCodes: ['404', '401'],
    pathParams: ['id', 'logtype'],
  },
  {
    path: '/api/runs/{id}/artifacts',
    method: 'get',
    operationId: 'getRunArtifacts',
    auth: 'protected',
    successCodes: ['200'],
    errorCodes: ['404', '401'],
    pathParams: ['id'],
  },
  {
    path: '/api/results/{id}/{file}',
    method: 'get',
    operationId: 'downloadArtifact',
    auth: 'protected',
    successCodes: ['200'],
    errorCodes: ['422', '404', '401'],
    pathParams: ['id', 'file'],
  },
  {
    path: '/api/runs/{id}/analysis',
    method: 'get',
    operationId: 'getRunAnalysis',
    auth: 'protected',
    successCodes: ['200'],
    errorCodes: ['404', '401'],
    pathParams: ['id'],
  },
  {
    path: '/api/improvements',
    method: 'get',
    operationId: 'getRunImprovements',
    auth: 'protected',
    successCodes: ['200'],
    errorCodes: ['401'],
  },
  {
    path: '/api/webhooks/test',
    method: 'post',
    operationId: 'testWebhook',
    auth: 'protected',
    successCodes: ['200'],
    errorCodes: ['400', '401'],
  },
];

const expectedSchemas: SchemaContract[] = [
  {
    schemaName: 'RunRequest',
    required: ['repoUrl'],
    properties: {
      repoUrl: { type: 'string', format: 'uri' },
      timeoutSeconds: { type: 'integer', minimum: 60, maximum: 10800 },
      changedFilesAllowlist: { type: 'array' },
      validationCommands: { type: 'array' },
      autoLintCleanup: { type: 'object' },
      idempotencyKey: { type: 'string', format: 'uuid' },
      startupCheck: { type: 'boolean' },
    },
  },
  {
    schemaName: 'RunResponse',
    required: ['id', 'status', 'createdAt'],
    properties: {
      id: { type: 'string' },
      status: { type: 'string', enum: ['queued', 'running', 'completed', 'failed'] },
      createdAt: { type: 'string', format: 'date-time' },
      completedAt: { type: 'string', format: 'date-time' },
      exitCode: { type: 'integer' },
      error: { type: 'string' },
    },
  },
  {
    schemaName: 'StatusResponse',
    required: ['id', 'status', 'elapsedSeconds', 'timeoutRiskPercent'],
    properties: {
      id: { type: 'string' },
      status: { type: 'string', enum: ['queued', 'running', 'completed', 'failed'] },
      elapsedSeconds: { type: 'number' },
      timeoutRiskPercent: { type: 'number' },
    },
  },
  {
    schemaName: 'ErrorResponse',
    required: ['error'],
    properties: {
      error: { type: 'string' },
      requestId: { type: 'string' },
    },
  },
  {
    schemaName: 'WebhookConfig',
    required: [],
    properties: {
      url: { type: 'string', format: 'uri' },
      events: { type: 'array' },
    },
  },
  {
    schemaName: 'RequestTracing',
    required: [],
    properties: {
      correlationId: { type: 'string', format: 'uuid' },
      requestId: { type: 'string', format: 'uuid' },
    },
  },
];

const enumConstraints: PropertyConstraint[] = [
  {
    label: 'RunRequest.taskMode',
    schemaName: 'RunRequest',
    propertyPath: ['taskMode'],
    expected: { type: 'string', enum: ['patch', 'inspect'] },
  },
  {
    label: 'RunRequest.publishMode',
    schemaName: 'RunRequest',
    propertyPath: ['publishMode'],
    expected: { type: 'string', enum: ['auto', 'none', 'branch', 'pr', 'draft_pr'] },
  },
  {
    label: 'RunRequest.startupCheckMode',
    schemaName: 'RunRequest',
    propertyPath: ['startupCheckMode'],
    expected: { type: 'string', enum: ['boot', 'baseline-validation'] },
  },
  {
    label: 'RunResponse.status',
    schemaName: 'RunResponse',
    propertyPath: ['status'],
    expected: { type: 'string', enum: ['queued', 'running', 'completed', 'failed'] },
  },
  {
    label: 'StatusResponse.progress.percentComplete',
    schemaName: 'StatusResponse',
    propertyPath: ['progress', 'percentComplete'],
    expected: { type: 'integer', minimum: 0, maximum: 100 },
  },
];

const openApiStructuralSchema = z.object({
  openapi: z.literal('3.1.0'),
  info: z.object({
    title: z.literal('Kaseki Agent API'),
    version: z.string().min(1),
    description: z.string().min(1),
  }).passthrough(),
  servers: z.array(z.object({
    url: z.string().min(1),
    description: z.string().min(1),
  }).passthrough()).min(1),
  paths: z.record(z.string().startsWith('/'), z.record(z.unknown())),
  components: z.object({
    schemas: z.record(z.record(z.unknown())),
    securitySchemes: z.object({
      BearerAuth: z.object({
        type: z.literal('http'),
        scheme: z.literal('bearer'),
      }).passthrough(),
    }).passthrough(),
  }).passthrough(),
  tags: z.array(z.object({
    name: z.string().min(1),
    description: z.string().min(1),
  }).passthrough()).min(1),
});

function getPaths(spec: OpenApiSpec): Record<string, PathItem> {
  return spec.paths as Record<string, PathItem>;
}

function getSchemas(spec: OpenApiSpec): Record<string, Schema> {
  return (spec.components as Record<string, Record<string, Schema>>).schemas;
}

function getOperation(spec: OpenApiSpec, path: string, method: string): Operation {
  return getPaths(spec)[path][method];
}

function getResponses(operation: Operation): Record<string, Record<string, unknown>> {
  return operation.responses as Record<string, Record<string, unknown>>;
}

function getResponseCodes(operation: Operation): string[] {
  return Object.keys(getResponses(operation));
}

function getJsonResponseSchema(operation: Operation, statusCode: string): Schema | undefined {
  const response = getResponses(operation)[statusCode];
  if (!response) return undefined;

  const content = response.content as Record<string, Record<string, unknown>> | undefined;
  return content?.['application/json']?.schema as Schema | undefined;
}

function getProperty(schema: Schema, propertyPath: string[]): Schema {
  let current: Schema | undefined = schema;

  for (const segment of propertyPath) {
    const properties = current?.properties as Record<string, Schema> | undefined;
    current = properties?.[segment];

    if (!current) {
      throw new Error(`Expected schema property path "${propertyPath.join('.')}" to include "${segment}".`);
    }
  }

  return current;
}

function expectErrorResponseSchema(schema: Schema | undefined): void {
  expect(schema).toMatchObject({
    type: 'object',
    required: ['error'],
    properties: expect.objectContaining({
      error: expect.objectContaining({ type: 'string' }),
    }),
  });
}

describe('OpenAPI Spec Generator', () => {
  let spec: OpenApiSpec;

  beforeAll(() => {
    spec = generateOpenAPISpec();
  });

  describe('OpenAPI structural validation', () => {
    test('generates a structurally valid OpenAPI 3.1 document', () => {
      const parsedSpec = openApiStructuralSchema.parse(spec);
      const paths = parsedSpec.paths as Record<string, Record<string, unknown>>;

      assertAllPathsHaveOperations(paths);
      forEachPathOperation(paths, (path, method, operation) => {
        if (!httpMethods.includes(method as (typeof httpMethods)[number])) {
          return;
        }

        expect(path).toMatch(/^\//);
        expect(operation).toMatchObject({
          operationId: expect.any(String),
          description: expect.any(String),
          responses: expect.any(Object),
        });
        expect(Object.keys(operation.responses as Record<string, unknown>)).toEqual(
          expect.arrayContaining([expect.stringMatching(/^(?:[1-5]\d{2}|default)$/)]),
        );
      });
    });
  });

  describe('Endpoint contracts', () => {
    test.each(expectedEndpoints)('$method $path has expected operation, auth, and response semantics', (contract) => {
      const operation = getOperation(spec, contract.path, contract.method);
      const responseCodes = getResponseCodes(operation);
      const security = operation.security as Array<Record<string, unknown>> | undefined;

      expect(operation.operationId).toBe(contract.operationId);
      expect(responseCodes).toEqual(expect.arrayContaining(contract.successCodes));

      if (contract.auth === 'public') {
        expect(security ?? []).toHaveLength(0);
        expect(responseCodes).not.toContain('401');
      } else {
        expect(security).toEqual([{ BearerAuth: [] }]);
        expect(responseCodes).toContain('401');
      }

      (contract.errorCodes ?? []).forEach((statusCode) => {
        expect(responseCodes).toContain(statusCode);
        expectErrorResponseSchema(getJsonResponseSchema(operation, statusCode));
      });

      const documentedPathParams = ((operation.parameters as Array<Record<string, unknown>> | undefined) ?? [])
        .filter((parameter) => parameter.in === 'path')
        .map((parameter) => parameter.name);
      const templatedPathParams = (contract.path.match(/\{([^}]+)\}/g) ?? []).map((parameter) => parameter.slice(1, -1));
      expect(documentedPathParams).toEqual(contract.pathParams ?? templatedPathParams);
    });

    test('operationIds are unique and only documented path/method pairs are emitted', () => {
      const paths = getPaths(spec);
      const expectedPairs = new Set(expectedEndpoints.map(({ path, method }) => `${method.toUpperCase()} ${path}`));
      const seenOperationIds = new Map<string, string>();
      const duplicateOperationIds: string[] = [];
      const emittedPairs: string[] = [];

      forEachPathOperation(paths, (path, method, operation) => {
        if (!httpMethods.includes(method as (typeof httpMethods)[number])) {
          return;
        }

        const pair = `${method.toUpperCase()} ${path}`;
        const operationId = operation.operationId as string;
        emittedPairs.push(pair);

        if (seenOperationIds.has(operationId)) {
          duplicateOperationIds.push(`${operationId}: ${seenOperationIds.get(operationId)} and ${pair}`);
        }
        seenOperationIds.set(operationId, pair);
      });

      expect(duplicateOperationIds).toEqual([]);
      expect(emittedPairs.sort()).toEqual([...expectedPairs].sort());
    });

    test('path templates and documented path parameters stay consistent for every operation', () => {
      forEachPathOperation(getPaths(spec), (path, method, operation) => {
        if (!httpMethods.includes(method as (typeof httpMethods)[number])) {
          return;
        }

        const templatedPathParams = (path.match(/\{([^}]+)\}/g) ?? []).map((parameter) => parameter.slice(1, -1));
        const documentedPathParams = ((operation.parameters as Array<Record<string, unknown>> | undefined) ?? [])
          .filter((parameter) => parameter.in === 'path')
          .map((parameter) => parameter.name);

        expect(documentedPathParams.sort()).toEqual(templatedPathParams.sort());
      });
    });
  });

  describe('Schema contracts', () => {
    test.each(expectedSchemas)('$schemaName defines required fields and high-value properties', (contract) => {
      const schema = getSchemas(spec)[contract.schemaName];
      const properties = schema.properties as Record<string, Schema>;

      expect(schema.type).toBe('object');
      expect(schema.required ?? []).toEqual(contract.required);

      Object.entries(contract.properties).forEach(([propertyName, expected]) => {
        expect(properties[propertyName]).toMatchObject(expected);
      });
    });

    test.each(enumConstraints)('$label enforces expected enum/range constraints', (contract) => {
      const schema = getSchemas(spec)[contract.schemaName];
      expect(getProperty(schema, contract.propertyPath)).toMatchObject(contract.expected);
    });

    test('array schemas preserve item types for generated clients', () => {
      const runRequest = getSchemas(spec).RunRequest;
      expect(getProperty(runRequest, ['changedFilesAllowlist']).items).toMatchObject({ type: 'string' });
      expect(getProperty(runRequest, ['validationCommands']).items).toMatchObject({ type: 'string' });
      expect(getProperty(runRequest, ['autoLintCleanup', 'commands']).items).toMatchObject({ type: 'string' });

      const webhookConfig = getSchemas(spec).WebhookConfig;
      expect(getProperty(webhookConfig, ['events']).items).toMatchObject({ type: 'string' });
    });

    test('all required schema fields are present in their schema properties', () => {
      Object.entries(getSchemas(spec)).forEach(([schemaName, schema]) => {
        const required = (schema.required as string[] | undefined) ?? [];
        const properties = (schema.properties as Record<string, unknown> | undefined) ?? {};
        const missingRequiredFields = required.filter((field) => !(field in properties));

        expect({ schemaName, missingRequiredFields }).toEqual({
          schemaName,
          missingRequiredFields: [],
        });
      });
    });
  });

  describe('Request and response payload semantics', () => {
    test.each([
      ['/api/runs', 'post', 'RunRequest'],
      ['/api/validate', 'post', 'RunRequest'],
      ['/api/webhooks/test', 'post', undefined],
    ] as Array<[string, string, string | undefined]>)('%s %s request body contract is JSON and required', (path, method, schemaName) => {
      const operation = getOperation(spec, path, method);
      const requestBody = operation.requestBody as Record<string, unknown>;
      const content = requestBody.content as Record<string, Record<string, unknown>>;
      const jsonSchema = content['application/json'].schema as Schema;

      expect(requestBody.required).toBe(true);
      if (schemaName) {
        expect(jsonSchema).toEqual(getSchemas(spec)[schemaName]);
      } else {
        expect(jsonSchema).toMatchObject({ type: 'object', required: ['url'] });
        expect(getProperty(jsonSchema, ['url'])).toMatchObject({ type: 'string', format: 'uri' });
      }
    });

    test('protected error responses use the shared ErrorResponse contract', () => {
      expectedEndpoints
        .filter((contract) => contract.auth === 'protected')
        .forEach((contract) => {
          const operation = getOperation(spec, contract.path, contract.method);
          (contract.errorCodes ?? ['401']).forEach((statusCode) => {
            expectErrorResponseSchema(getJsonResponseSchema(operation, statusCode));
          });
        });
    });

    test('response schemas preserve public API status enums', () => {
      const runArtifacts = getJsonResponseSchema(getOperation(spec, '/api/runs/{id}/artifacts', 'get'), '200');
      expect(getProperty(runArtifacts as Schema, ['runStatus'])).toMatchObject({
        type: 'string',
        enum: ['queued', 'running', 'completed', 'failed'],
      });

      const runAnalysis = getJsonResponseSchema(getOperation(spec, '/api/runs/{id}/analysis', 'get'), '200');
      expect(getProperty(runAnalysis as Schema, ['status'])).toMatchObject({
        type: 'string',
        enum: ['queued', 'running', 'completed', 'failed'],
      });
    });
  });
});
