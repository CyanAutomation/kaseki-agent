/**
 * OpenAPI Spec Generator for Kaseki Agent API
 *
 * This module constructs an OpenAPI 3.1 specification for the Kaseki Agent API.
 * The spec is generated at build time and served dynamically at runtime.
 */

import {
  buildAllSchemas,
  buildErrorResponseSchema,
  buildRunRequestSchema,
  buildRunResponseSchema,
} from './openapi-spec-generators/schemas';
import { buildAllPaths } from './openapi-spec-generators/paths';

/**
 * Generate a complete OpenAPI 3.1 specification for the Kaseki Agent API.
 * This spec is generated from route definitions and request/response types.
 */
export function generateOpenAPISpec(): Record<string, unknown> {
  // Build all schemas using schema builders
  const errorResponseSchema = buildErrorResponseSchema();
  const runRequestSchema = buildRunRequestSchema();
  const runResponseSchema = buildRunResponseSchema();
  const allSchemas = buildAllSchemas();

  // Build all paths/endpoints using path builders
  const paths = buildAllPaths(errorResponseSchema, runRequestSchema, runResponseSchema);

  return {
    openapi: '3.1.0',
    info: {
      title: 'Kaseki Agent API',
      version: '1.13.0',
      description:
        'Ephemeral coding-agent runner: orchestrates Pi CLI via Docker for automated code modifications with validation and deployment',
      contact: {
        name: 'CyanAutomation',
        url: 'https://github.com/CyanAutomation/kaseki-agent',
      },
      license: {
        name: 'MIT',
        url: 'https://github.com/CyanAutomation/kaseki-agent/blob/main/LICENSE',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Local development server',
      },
      {
        url: 'https://kaseki.example.com',
        description: 'Production server (configure as needed)',
      },
    ],
    paths,
    components: {
      schemas: allSchemas,
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'token',
          description:
            'Bearer token authentication. Provide your API key (from KASEKI_API_KEYS environment variable) as the bearer token.',
        },
      },
    },
    tags: [
      {
        name: 'Health & Status',
        description: 'Unauthenticated health and readiness checks',
      },
      {
        name: 'Service Info',
        description: 'Service metadata, metrics, and pre-flight validation',
      },
      {
        name: 'Run Management',
        description: 'Create, list, and manage kaseki runs',
      },
      {
        name: 'Run Logs & Progress',
        description: 'Retrieve progress events and logs for runs',
      },
      {
        name: 'Artifacts',
        description: 'List and download run artifacts',
      },
      {
        name: 'Run Details',
        description: 'Comprehensive run analysis and diagnostics',
      },
      {
        name: 'Webhooks',
        description: 'Webhook configuration and testing',
      },
    ],
  };
}

export default generateOpenAPISpec;
