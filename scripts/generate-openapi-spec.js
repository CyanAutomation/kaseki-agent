#!/usr/bin/env node

/**
 * Generate OpenAPI 3.1 specification for Kaseki Agent API
 *
 * This script is called by the build process to generate the OpenAPI spec
 * from Zod schemas. The spec is written to kaseki-openapi.json at the
 * repository root.
 *
 * Usage:
 *   node dist/generate-openapi-spec.js
 *
 * Environment variables:
 *   OUTPUT_FILE - Where to write the spec (default: kaseki-openapi.json)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { generateOpenAPISpec } from '../dist/openapi-spec-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve output file path (default to repo root)
const outputFile = process.env.OUTPUT_FILE || path.resolve(__dirname, '..', 'kaseki-openapi.json');

try {
  console.log('Generating OpenAPI 3.1 specification...');

  // Generate the spec
  const spec = generateOpenAPISpec();

  // Validate basic structure
  if (!spec.openapi || spec.openapi !== '3.1.0') {
    throw new Error('Invalid OpenAPI version in generated spec');
  }

  if (!spec.info || !spec.paths || !spec.components) {
    throw new Error('Missing required OpenAPI components (info, paths, or components)');
  }

  // Write to file with formatting
  const jsonContent = JSON.stringify(spec, null, 2);
  fs.writeFileSync(outputFile, jsonContent, 'utf-8');

  console.log('✓ OpenAPI spec generated successfully');
  console.log(`  Output: ${outputFile}`);
  console.log(`  Size: ${(jsonContent.length / 1024).toFixed(2)} KB`);
  console.log(`  Endpoints: ${Object.keys(spec.paths || {}).length}`);
  console.log(`  Schemas: ${Object.keys((spec.components?.schemas || {})).length}`);
} catch (error) {
  console.error('✗ Failed to generate OpenAPI spec:');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
