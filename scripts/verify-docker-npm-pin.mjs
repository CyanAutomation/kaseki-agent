#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import semver from 'semver';

const REQUIRED_PACKAGES = ['npm', '@earendil-works/pi-coding-agent', 'undici'];
const NODE_VERSION = '24.0.0';

export function extractDockerPackageSelectors(dockerfile) {
  const npmVersion = dockerfile.match(/^ARG NPM_VERSION=([^\s]+)$/m)?.[1];
  if (!npmVersion || npmVersion.includes('$')) {
    throw new Error('Dockerfile must contain an exact ARG NPM_VERSION pin');
  }

  const selectors = new Map([['npm', `npm@${npmVersion}`]]);
  const globalInstalls = dockerfile.match(/^RUN npm install -g[^\n]*/gm) ?? [];
  for (const command of globalInstalls) {
    for (const name of REQUIRED_PACKAGES.slice(1)) {
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = command.match(new RegExp(`(?:^|\\s)(${escapedName}@[^\\s\\\\"']+)`));
      if (match) selectors.set(name, match[1]);
    }
  }

  for (const name of REQUIRED_PACKAGES) {
    const selector = selectors.get(name);
    if (!selector || selector === name || selector.endsWith('@latest')) {
      throw new Error(`Dockerfile must install ${name} with an exact version selector`);
    }
    const version = selector.slice(name.length + 1);
    if (!semver.valid(version)) {
      throw new Error(`Dockerfile package selector ${selector} is not an exact version`);
    }
  }

  return REQUIRED_PACKAGES.map((name) => ({ name, selector: selectors.get(name) }));
}

export function queryRegistryMetadata(selector, exec = execFileSync) {
  try {
    const output = exec('npm', ['view', selector, 'version', 'engines', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(output);
  } catch (error) {
    const detail = error?.stderr?.toString().trim() || error?.message || 'unknown registry error';
    throw new Error(`Registry metadata unavailable for ${selector}: ${detail}`, { cause: error });
  }
}

export function verifyPackageMetadata({ name, selector }, metadata) {
  const pinnedVersion = selector.slice(name.length + 1);
  if (metadata.version !== pinnedVersion) {
    throw new Error(
      `Registry returned ${metadata.version ?? 'no version'} for ${selector}; expected exactly ${pinnedVersion}`,
    );
  }

  const nodeRange = metadata.engines?.node;
  if (!nodeRange || !semver.satisfies(NODE_VERSION, nodeRange)) {
    throw new Error(
      `${selector} is incompatible with Node 24 (engines.node=${nodeRange ?? 'missing'})`,
    );
  }
}

export function verifyDockerPackagePins(dockerfile, query = queryRegistryMetadata) {
  const packages = extractDockerPackageSelectors(dockerfile);
  for (const packagePin of packages) {
    const metadata = query(packagePin.selector);
    verifyPackageMetadata(packagePin, metadata);
    console.log(
      `${packagePin.selector} is published and supports Node 24 (${metadata.engines.node}).`,
    );
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  verifyDockerPackagePins(dockerfile);
}
