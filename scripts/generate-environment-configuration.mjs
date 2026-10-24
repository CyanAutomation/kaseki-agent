#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillDir = path.join(repoRoot, '.agents/skills/environment-configuration');
const metadataPath = path.join(skillDir, 'environment-variables.json');
const catalogPath = path.join(skillDir, 'PUBLIC_ENVIRONMENT_VARIABLES.md');
const startMarker = '<!-- BEGIN GENERATED PUBLIC ENVIRONMENT VARIABLES -->';
const endMarker = '<!-- END GENERATED PUBLIC ENVIRONMENT VARIABLES -->';
const catalogHeader = [
  '# Public Environment Variables',
  '',
  'Generated from `environment-variables.json`. This is a published quick lookup, not a complete runtime manifest.',
  'Use the [canonical environment reference](../../../docs/ENV_VARS.md) for supported settings, defaults, and behavior.',
  '',
].join('\n');

export function renderPublicEnvironmentVariables(metadata) {
  const rows = metadata.map(({ name, default: defaultValue, description, acceptedValues }) =>
    `| \`${name}\` | \`${defaultValue}\` | ${description} | ${acceptedValues} |`,
  );

  return [
    startMarker,
    '| Variable | Default | Description | Accepted values |',
    '|---|---|---|---|',
    ...rows,
    endMarker,
  ].join('\n');
}

function readRequiredFiles() {
  try {
    return {
      metadata: JSON.parse(fs.readFileSync(metadataPath, 'utf8')),
      catalog: fs.existsSync(catalogPath) ? fs.readFileSync(catalogPath, 'utf8') : '',
    };
  } catch (error) {
    console.error(`Failed to read required files: ${error.message}`);
    process.exit(1);
  }
}

const { metadata, catalog } = readRequiredFiles();
const generated = `${catalogHeader}${renderPublicEnvironmentVariables(metadata)}\n`;
if (process.argv.includes('--check')) {
  if (generated !== catalog) {
    console.error('Public environment-variable catalog is out of date; run npm run generate:environment-docs.');
    process.exitCode = 1;
  }
} else {
  fs.writeFileSync(catalogPath, generated);
}
