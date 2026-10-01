import { readFileSync } from 'node:fs';

// The production verifier remains directly executable by Node in the workflow.
// @ts-expect-error TypeScript does not emit declarations for this CLI module.
import {
  extractDockerPackageSelectors,
  queryRegistryMetadata,
  verifyPackageMetadata,
} from '../scripts/verify-docker-npm-pin.mjs';

const fixture = (name: string) => JSON.parse(readFileSync(
  new URL(`./fixtures/docker-package-metadata/${name}.json`, import.meta.url),
  'utf8',
));
const textFixture = (name: string) => readFileSync(
  new URL(`./fixtures/docker-package-metadata/${name}.txt`, import.meta.url),
  'utf8',
);
const pin = { name: 'example', selector: 'example@1.2.3' };

describe('Docker global package registry verification', () => {
  test('extracts all exact reviewed selectors from the Dockerfile', () => {
    const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
    expect(extractDockerPackageSelectors(dockerfile)).toEqual([
      { name: 'npm', selector: 'npm@11.19.1' },
      { name: '@earendil-works/pi-coding-agent', selector: '@earendil-works/pi-coding-agent@0.85.0' },
      { name: 'undici', selector: 'undici@8.10.2' },
    ]);
  });

  test('accepts published metadata with an exact version and compatible engine', () => {
    expect(() => verifyPackageMetadata(pin, fixture('published'))).not.toThrow();
  });

  test('identifies a missing selector when npm reports ETARGET', () => {
    const missing = Object.assign(new Error('command failed'), {
      stderr: Buffer.from(textFixture('etarget')),
    });
    expect(() => queryRegistryMetadata(pin.selector, () => { throw missing; }))
      .toThrow(/Registry metadata unavailable for example@1\.2\.3:.*ETARGET/s);
  });

  test('rejects a registry response for a different version', () => {
    expect(() => verifyPackageMetadata(pin, fixture('mismatched')))
      .toThrow('Registry returned 1.2.4 for example@1.2.3; expected exactly 1.2.3');
  });

  test('rejects an incompatible Node engine range', () => {
    expect(() => verifyPackageMetadata(pin, fixture('incompatible-engine')))
      .toThrow('example@1.2.3 is incompatible with Node 24 (engines.node=^22)');
  });
});
