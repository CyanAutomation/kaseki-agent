import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const fixturesDir = path.resolve(process.cwd(), 'tests/fixtures/docker-package-metadata');
const toolchainManifestPath = path.resolve(process.cwd(), 'docker/image-toolchain/package.json');
const toolchainLockPath = path.resolve(process.cwd(), 'docker/image-toolchain/package-lock.json');

const fixture = (name: string) => JSON.parse(readFileSync(
  path.join(fixturesDir, `${name}.json`),
  'utf8',
));
const textFixture = (name: string) => readFileSync(
  path.join(fixturesDir, `${name}.txt`),
  'utf8',
);
const pin = { name: 'example', selector: 'example@1.2.3' };
const verifierModuleUrl = pathToFileURL(path.resolve(process.cwd(), 'scripts/verify-docker-npm-pin.mjs')).href;

function runVerifier(action: string, payload: unknown): string {
  const runner = `
import { extractImageToolchainSelectors, queryRegistryMetadata, verifyPackageMetadata } from ${JSON.stringify(verifierModuleUrl)};
const action = process.argv[1];
const payload = JSON.parse(process.argv[2]);
try {
  let result = null;
  if (action === 'extract') result = extractImageToolchainSelectors(payload.manifest);
  if (action === 'verify') result = verifyPackageMetadata(payload.pin, payload.metadata, { allowMissingNodeEngine: payload.allowMissingNodeEngine });
  if (action === 'query') result = queryRegistryMetadata(payload.selector, () => payload.output);
  if (action === 'queryError') {
    result = queryRegistryMetadata(payload.selector, () => {
      const err = new Error('command failed');
      err.stderr = Buffer.from(payload.stderr);
      throw err;
    });
  }
  process.stdout.write(JSON.stringify({ ok: true, result }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }));
}
`;
  return execFileSync('node', ['--input-type=module', '-e', runner, action, JSON.stringify(payload)], { encoding: 'utf8' }).trim();
}

describe('Docker global package registry verification', () => {
  test('extracts exact reviewed selectors from the lockfile-backed image toolchain', () => {
    const manifest = JSON.parse(readFileSync(toolchainManifestPath, 'utf8'));
    const response = JSON.parse(runVerifier('extract', { manifest })) as { ok: boolean; result: unknown };
    expect(response.ok).toBe(true);
    expect(response.result).toEqual([
      { name: 'npm', selector: 'npm@11.21.0' },
      { name: '@earendil-works/pi-coding-agent', selector: '@earendil-works/pi-coding-agent@0.86.0' },
      { name: '@earendil-works/pi-server', selector: '@earendil-works/pi-server@0.86.0' },
      { name: 'undici', selector: 'undici@8.10.2' },
      { name: 'undici-v6', selector: 'undici@6.28.1' },
      { name: 'undici-v7', selector: 'undici@7.29.1' },
      { name: 'brace-expansion', selector: 'brace-expansion@5.0.11' },
      { name: 'brace-expansion-v1', selector: 'brace-expansion@1.1.20' },
      { name: 'brace-expansion-v2', selector: 'brace-expansion@2.1.6' },
      { name: 'brace-expansion-v3', selector: 'brace-expansion@3.0.8' },
    ]);
    expect(manifest.overrides).toEqual({
      'brace-expansion': '5.0.11',
      npm: { 'brace-expansion': '5.0.11', undici: '6.28.1' },
      '@earendil-works/pi-coding-agent': { 'brace-expansion': '5.0.11', undici: '8.10.2' },
      '@earendil-works/pi-server': { 'brace-expansion': '5.0.11', undici: '8.10.2' },
    });
  });

  test('locks patched package sources for nested bundle replacement', () => {
    const lock = JSON.parse(readFileSync(toolchainLockPath, 'utf8')) as {
      packages: Record<string, { version?: string }>;
    };
    expect(lock.packages['node_modules/brace-expansion']?.version).toBe('5.0.11');
    expect(lock.packages['node_modules/undici']?.version).toBe('8.10.2');
    expect(lock.packages['node_modules/undici-v6']?.version).toBe('6.28.1');
    expect(lock.packages['node_modules/undici-v7']?.version).toBe('7.29.1');
    expect(lock.packages['node_modules/brace-expansion-v1']?.version).toBe('1.1.20');
    expect(lock.packages['node_modules/brace-expansion-v2']?.version).toBe('2.1.6');
    expect(lock.packages['node_modules/brace-expansion-v3']?.version).toBe('3.0.8');
  });

  test('accepts published metadata with an exact version and compatible engine', () => {
    const response = JSON.parse(runVerifier('verify', { pin, metadata: fixture('published') })) as { ok: boolean };
    expect(response.ok).toBe(true);
  });

  test('accepts exact registry metadata for legacy brace-expansion with no engine declaration', () => {
    const response = JSON.parse(runVerifier('verify', {
      pin: { name: 'brace-expansion-v1', selector: 'brace-expansion@1.1.20' },
      metadata: { version: '1.1.20' },
      allowMissingNodeEngine: true,
    })) as { ok: boolean };
    expect(response.ok).toBe(true);
  });

  test('normalizes npm metadata that only reports a version', () => {
    const response = JSON.parse(runVerifier('query', {
      selector: 'brace-expansion@1.1.20',
      output: JSON.stringify('1.1.20'),
    })) as { ok: boolean; result: unknown };
    expect(response).toEqual({ ok: true, result: { version: '1.1.20' } });
  });

  test('identifies a missing selector when npm reports ETARGET', () => {
    const response = JSON.parse(runVerifier('queryError', {
      selector: pin.selector,
      stderr: textFixture('etarget'),
    })) as { ok: boolean; message: string };
    expect(response.ok).toBe(false);
    expect(response.message).toMatch(/Registry metadata unavailable for example@1\.2\.3:.*ETARGET/s);
  });

  test('rejects a registry response for a different version', () => {
    const response = JSON.parse(runVerifier('verify', { pin, metadata: fixture('mismatched') })) as { ok: boolean; message: string };
    expect(response.ok).toBe(false);
    expect(response.message).toBe('Registry returned 1.2.4 for example@1.2.3; expected exactly 1.2.3');
  });

  test('rejects an incompatible Node engine range', () => {
    const response = JSON.parse(runVerifier('verify', { pin, metadata: fixture('incompatible-engine') })) as { ok: boolean; message: string };
    expect(response.ok).toBe(false);
    expect(response.message).toBe('example@1.2.3 is incompatible with Node 24 (engines.node=^22)');
  });
});
