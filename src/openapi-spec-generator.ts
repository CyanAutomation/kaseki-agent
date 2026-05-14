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
import {
  buildComponents,
  buildInfo,
  buildServers,
  buildTags,
} from './openapi-spec-generators/components';

/**
 * Generate a complete OpenAPI 3.1 specification for the Kaseki Agent API.
 * This spec is generated from route definitions and request/response types.
 */
export function generateOpenAPISpec(): Record<string, unknown> {
  // Build schemas using schema builders
  const errorResponseSchema = buildErrorResponseSchema();
  const runRequestSchema = buildRunRequestSchema();
  const runResponseSchema = buildRunResponseSchema();
  const allSchemas = buildAllSchemas();

  // Build paths/endpoints using path builders
  const paths = buildAllPaths(errorResponseSchema, runRequestSchema, runResponseSchema);

  // Build components, info, servers, and tags using component builders
  const components = buildComponents(allSchemas);
  const info = buildInfo();
  const servers = buildServers();
  const tags = buildTags();

  // Assemble complete OpenAPI specification
  return {
    openapi: '3.1.0',
    info,
    servers,
    paths,
    components,
    tags,
  };
}

export default generateOpenAPISpec;

