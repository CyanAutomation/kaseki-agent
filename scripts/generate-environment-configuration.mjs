#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillDir = path.join(repoRoot, '.agents/skills/environment-configuration');
const metadataPath = path.join(skillDir, 'environment-variables.json');
const skillPath = path.join(skillDir, 'SKILL.md');
const startMarker = '<!-- BEGIN GENERATED PUBLIC ENVIRONMENT VARIABLES -->';
const endMarker = '<!-- END GENERATED PUBLIC ENVIRONMENT VARIABLES -->';

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
      skill: fs.readFileSync(skillPath, 'utf8'),
    };
  } catch (error) {
    console.error(`Failed to read required files: ${error.message}`);
    process.exit(1);
  }
}

const { metadata, skill } = readRequiredFiles();
const generated = renderPublicEnvironmentVariables(metadata);
const markerPattern = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);

if (!markerPattern.test(skill)) {
  throw new Error(`Generated environment-variable markers are missing from ${skillPath}`);
}

const nextSkill = skill.replace(markerPattern, generated);
if (process.argv.includes('--check')) {
  if (nextSkill !== skill) {
    console.error('Environment configuration skill is out of date; run npm run generate:environment-docs.');
    process.exitCode = 1;
  }
} else {
  fs.writeFileSync(skillPath, nextSkill);
}
