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
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

type OpenAPISpecGeneratorModule = {
  generateOpenAPISpec: () => Record<string, unknown>;
};

let generateOpenAPISpec: () => Record<string, unknown>;
try {
  const require = createRequire(import.meta.url);
  const module = require('../dist/openapi-spec-generator.js') as Partial<OpenAPISpecGeneratorModule>;

  if (typeof module.generateOpenAPISpec !== 'function') {
    throw new Error('openapi-spec-generator module does not export generateOpenAPISpec()');
  }

  generateOpenAPISpec = module.generateOpenAPISpec;
} catch (error) {
  console.error('✗ Failed to load openapi-spec-generator module:');
  console.error('  Make sure to run the build process first (npm run build)');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve output file path (default to repo root)
const outputFile = process.env.OUTPUT_FILE || path.resolve(__dirname, '..', 'kaseki-openapi.json');

try {
  console.log('Generating OpenAPI 3.1 specification...');

  // Generate the spec
  const spec = generateOpenAPISpec() as Record<string, unknown>;

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
  console.log(`  Schemas: ${Object.keys((spec.components as Record<string, unknown>)?.schemas || {}).length}`);
} catch (error) {
  console.error('✗ Failed to generate OpenAPI spec:');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
