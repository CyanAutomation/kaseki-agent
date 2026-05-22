/**
 * OpenAPI Component Builders for Kaseki Agent API
 *
 * This module contains builder functions for constructing component definitions
 * used in the OpenAPI specification:
 * - Security schemes (authentication methods)
 * - Tags (endpoint groupings and documentation)
 * - API info metadata
 * - Server definitions
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Build security scheme definitions.
 * Currently defines Bearer token authentication for API key validation.
 */
export function buildSecuritySchemes(): Record<string, Record<string, unknown>> {
  return {
    BearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'token',
      description:
        'Bearer token authentication. Provide your API key (from KASEKI_API_KEYS environment variable) as the bearer token.',
    },
  };
}

/**
 * Build tag definitions for endpoint grouping and documentation.
 * Tags organize endpoints by feature area and provide descriptions for API documentation.
 */
export function buildTags(): Array<Record<string, unknown>> {
  return [
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
  ];
}

/**
 * Build API info metadata.
 * Includes title, version, description, contact info, and license.
 */
function getPackageVersion(): string {
  const executableDir = path.dirname(process.argv[1] || process.cwd());
  const candidates = [
    path.join(process.cwd(), 'package.json'),
    path.join(executableDir, '..', 'package.json'),
    path.join(executableDir, '..', '..', 'package.json'),
    '/app/package.json',
  ];

  for (const packageJsonPath of candidates) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as { version?: unknown };
      if (typeof packageJson.version === 'string') {
        return packageJson.version;
      }
    } catch {
      // Try the next common runtime layout.
    }
  }

  return '0.0.0';
}

export function buildInfo(): Record<string, unknown> {
  return {
    title: 'Kaseki Agent API',
    version: getPackageVersion(),
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
  };
}

/**
 * Build server definitions.
 * Includes local development and production server configurations.
 */
export function buildServers(): Array<Record<string, unknown>> {
  return [
    {
      url: 'http://localhost:3000',
      description: 'Local development server',
    },
    {
      url: 'https://kaseki.example.com',
      description: 'Production server (configure as needed)',
    },
  ];
}

/**
 * Build complete components object with all security schemes.
 * Assembles security scheme definitions for use in the OpenAPI spec.
 */
export function buildComponents(schemas: Record<string, Record<string, unknown>>): Record<string, unknown> {
  return {
    schemas,
    securitySchemes: buildSecuritySchemes(),
  };
}
