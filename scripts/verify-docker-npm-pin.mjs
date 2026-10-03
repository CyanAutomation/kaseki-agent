#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import semver from 'semver';

const REQUIRED_PACKAGES = [
  { name: 'npm', dependency: 'npm', registryName: 'npm' },
  { name: '@earendil-works/pi-coding-agent', dependency: '@earendil-works/pi-coding-agent', registryName: '@earendil-works/pi-coding-agent' },
  { name: '@earendil-works/pi-server', dependency: '@earendil-works/pi-server', registryName: '@earendil-works/pi-server' },
  { name: 'undici', dependency: 'undici', registryName: 'undici' },
  { name: 'undici-v6', dependency: 'undici-v6', registryName: 'undici' },
  { name: 'undici-v7', dependency: 'undici-v7', registryName: 'undici' },
  { name: 'brace-expansion', dependency: 'brace-expansion', registryName: 'brace-expansion' },
  { name: 'brace-expansion-v1', dependency: 'brace-expansion-v1', registryName: 'brace-expansion' },
  { name: 'brace-expansion-v2', dependency: 'brace-expansion-v2', registryName: 'brace-expansion' },
];
const NODE_VERSION = '24.0.0';

export function extractImageToolchainSelectors(manifest) {
  const selectors = new Map();
  for (const { name, dependency, registryName } of REQUIRED_PACKAGES) {
    const selectedVersion = manifest.dependencies?.[dependency];
    if (typeof selectedVersion !== 'string') throw new Error(`Image toolchain manifest must pin ${dependency}`);
    const aliasPrefix = `npm:${registryName}@`;
    const selector = selectedVersion.startsWith(aliasPrefix)
      ? `${registryName}@${selectedVersion.slice(aliasPrefix.length)}`
      : `${registryName}@${selectedVersion}`;
    const selectorVersion = selector.slice(selector.lastIndexOf('@') + 1);
    if (!semver.valid(selectorVersion)) {
      throw new Error(`Image toolchain selector ${selector} is not an exact version`);
    }
    selectors.set(name, selector);
  }

  const requiredOverrides = {
    'brace-expansion': '5.0.11',
    npm: { 'brace-expansion': '5.0.11', undici: '6.28.1' },
    '@earendil-works/pi-coding-agent': { 'brace-expansion': '5.0.11', undici: '8.10.2' },
    '@earendil-works/pi-server': { 'brace-expansion': '5.0.11', undici: '8.10.2' },
  };
  for (const [parent, required] of Object.entries(requiredOverrides)) {
    if (typeof required === 'string') {
      if (manifest.overrides?.[parent] !== required) {
        throw new Error(`Image toolchain override for ${parent} must pin to ${required}`);
      }
      continue;
    }
    for (const [name, version] of Object.entries(required)) {
      if (manifest.overrides?.[parent]?.[name] !== version) {
        throw new Error(`Image toolchain override for ${parent} must pin ${name} to ${version}`);
      }
    }
  }

  return REQUIRED_PACKAGES.map(({ name }) => ({ name, selector: selectors.get(name) }));
}

export function queryRegistryMetadata(selector, exec = execFileSync) {
  try {
    const output = exec('npm', ['view', selector, 'version', 'engines', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const metadata = JSON.parse(output);
    return typeof metadata === 'string' ? { version: metadata } : metadata;
  } catch (error) {
    const detail = error?.stderr?.toString().trim() || error?.message || 'unknown registry error';
    throw new Error(`Registry metadata unavailable for ${selector}: ${detail}`, { cause: error });
  }
}

export function verifyPackageMetadata({ selector }, metadata, { allowMissingNodeEngine = false } = {}) {
  const pinnedVersion = selector.slice(selector.lastIndexOf('@') + 1);
  if (metadata.version !== pinnedVersion) {
    throw new Error(
      `Registry returned ${metadata.version ?? 'no version'} for ${selector}; expected exactly ${pinnedVersion}`,
    );
  }

  const nodeRange = metadata.engines?.node;
  if (!nodeRange && allowMissingNodeEngine) return;
  if (!nodeRange || !semver.satisfies(NODE_VERSION, nodeRange)) {
    throw new Error(
      `${selector} is incompatible with Node 24 (engines.node=${nodeRange ?? 'missing'})`,
    );
  }
}

export function verifyDockerPackagePins(manifest, query = queryRegistryMetadata) {
  const packages = extractImageToolchainSelectors(manifest);
  for (const packagePin of packages) {
    const metadata = query(packagePin.selector);
    const allowMissingNodeEngine = ['brace-expansion-v1', 'brace-expansion-v2'].includes(packagePin.name);
    verifyPackageMetadata(packagePin, metadata, { allowMissingNodeEngine });
    console.log(
      metadata.engines?.node
        ? `${packagePin.selector} is published and supports Node 24 (${metadata.engines.node}).`
        : `${packagePin.selector} is published and has no Node engine restriction.`,
    );
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const manifest = JSON.parse(readFileSync(new URL('../docker/image-toolchain/package.json', import.meta.url), 'utf8'));
  verifyDockerPackagePins(manifest);
}
