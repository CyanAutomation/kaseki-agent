#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const match = dockerfile.match(/^ARG NPM_VERSION=([^\s]+)$/m);

if (!match) {
  throw new Error('Dockerfile must contain an exact ARG NPM_VERSION pin');
}

const pinnedVersion = match[1];
const output = execFileSync(
  'npm',
  ['view', `npm@${pinnedVersion}`, 'version', 'engines', '--json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
);
const metadata = JSON.parse(output);
const { default: semver } = await import('semver');

if (metadata.version !== pinnedVersion) {
  throw new Error(`npm registry returned ${metadata.version ?? 'no version'} for npm@${pinnedVersion}`);
}

if (!metadata.engines?.node || !semver.satisfies('24.0.0', metadata.engines.node)) {
  throw new Error(
    `npm@${pinnedVersion} does not declare Node 24 support (engines.node=${metadata.engines?.node ?? 'missing'})`,
  );
}

console.log(`npm@${pinnedVersion} is published and supports Node 24 (${metadata.engines.node}).`);
