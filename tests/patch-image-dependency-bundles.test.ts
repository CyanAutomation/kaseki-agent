import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const patcher = path.resolve(process.cwd(), 'scripts/patch-image-dependency-bundles.mjs');

function createPackage(root: string, relativePath: string, name: string, version: string, marker?: string) {
  const packagePath = path.join(root, relativePath);
  mkdirSync(packagePath, { recursive: true });
  writeFileSync(path.join(packagePath, 'package.json'), JSON.stringify({ name, version }));
  if (marker) writeFileSync(path.join(packagePath, 'replacement.txt'), marker);
}

describe('image bundled dependency patching', () => {
  test('replaces affected copies with pinned packages and leaves fixed copies alone', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'kaseki-bundle-patch-'));
    const sources = path.join(root, 'sources');
    const targets = path.join(root, 'targets');

    try {
      createPackage(sources, 'brace-expansion', 'brace-expansion', '5.0.11', 'brace-fixed');
      createPackage(sources, 'undici-v6', 'undici', '6.28.1', 'undici-six-fixed');
      createPackage(sources, 'undici-v7', 'undici', '7.29.1', 'undici-seven-fixed');
      createPackage(sources, 'undici', 'undici', '8.10.2', 'undici-eight-fixed');

      createPackage(targets, 'npm/node_modules/brace-expansion', 'brace-expansion', '5.0.9', 'old-brace');
      createPackage(targets, 'npm/node_modules/undici', 'undici', '6.28.0', 'old-undici-six');
      createPackage(targets, '@earendil-works/pi-coding-agent/node_modules/brace-expansion', 'brace-expansion', '5.0.9');
      createPackage(targets, '@earendil-works/pi-coding-agent/node_modules/undici', 'undici', '8.9.0', 'old-undici-eight');
      createPackage(targets, 'already-safe/node_modules/undici', 'undici', '7.29.1', 'keep-safe');

      execFileSync('node', [patcher, sources, targets], { encoding: 'utf8' });

      expect(JSON.parse(readFileSync(path.join(targets, 'npm/node_modules/brace-expansion/package.json'), 'utf8')).version).toBe('5.0.11');
      expect(readFileSync(path.join(targets, 'npm/node_modules/brace-expansion/replacement.txt'), 'utf8')).toBe('brace-fixed');
      expect(JSON.parse(readFileSync(path.join(targets, 'npm/node_modules/undici/package.json'), 'utf8')).version).toBe('6.28.1');
      expect(readFileSync(path.join(targets, 'npm/node_modules/undici/replacement.txt'), 'utf8')).toBe('undici-six-fixed');
      expect(JSON.parse(readFileSync(path.join(targets, '@earendil-works/pi-coding-agent/node_modules/undici/package.json'), 'utf8')).version).toBe('8.10.2');
      expect(readFileSync(path.join(targets, '@earendil-works/pi-coding-agent/node_modules/undici/replacement.txt'), 'utf8')).toBe('undici-eight-fixed');
      expect(JSON.parse(readFileSync(path.join(targets, 'already-safe/node_modules/undici/package.json'), 'utf8')).version).toBe('7.29.1');
      expect(readFileSync(path.join(targets, 'already-safe/node_modules/undici/replacement.txt'), 'utf8')).toBe('keep-safe');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('fails closed when a vulnerable brace-expansion 3.x copy has no same-major fix', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'kaseki-bundle-patch-'));
    const sources = path.join(root, 'sources');
    const targets = path.join(root, 'targets');

    try {
      createPackage(sources, 'brace-expansion', 'brace-expansion', '5.0.11');
      createPackage(targets, 'legacy/node_modules/brace-expansion', 'brace-expansion', '3.0.8');

      let error: NodeJS.ErrnoException & { stderr?: Buffer } | undefined;
      try {
        execFileSync('node', [patcher, sources, targets], { encoding: 'utf8' });
      } catch (caught) {
        error = caught as NodeJS.ErrnoException & { stderr?: Buffer };
      }

      expect(error?.stderr?.toString()).toContain('brace-expansion@3.0.8 has no patched 3.x source');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
