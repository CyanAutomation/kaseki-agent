import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const fixturesDir = path.resolve(process.cwd(), 'tests/fixtures/docker-package-metadata');

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
import { extractDockerPackageSelectors, queryRegistryMetadata, verifyPackageMetadata } from ${JSON.stringify(verifierModuleUrl)};
const action = process.argv[1];
const payload = JSON.parse(process.argv[2]);
try {
  let result = null;
  if (action === 'extract') result = extractDockerPackageSelectors(payload.dockerfile);
  if (action === 'verify') result = verifyPackageMetadata(payload.pin, payload.metadata);
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
  test('extracts all exact reviewed selectors from the Dockerfile', () => {
    const dockerfile = readFileSync(path.resolve(process.cwd(), 'Dockerfile'), 'utf8');
    const response = JSON.parse(runVerifier('extract', { dockerfile })) as { ok: boolean; result: unknown };
    expect(response.ok).toBe(true);
    expect(response.result).toEqual([
      { name: 'npm', selector: 'npm@11.19.1' },
      { name: '@earendil-works/pi-coding-agent', selector: '@earendil-works/pi-coding-agent@0.85.0' },
      { name: 'undici', selector: 'undici@8.10.2' },
    ]);
  });

  test('accepts published metadata with an exact version and compatible engine', () => {
    const response = JSON.parse(runVerifier('verify', { pin, metadata: fixture('published') })) as { ok: boolean };
    expect(response.ok).toBe(true);
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
