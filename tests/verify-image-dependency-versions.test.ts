import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const verifier = path.resolve(process.cwd(), 'scripts/verify-image-dependency-versions.mjs');

function createPackage(root: string, relativePath: string, name: string, version: string) {
  const packagePath = path.join(root, relativePath);
  mkdirSync(packagePath, { recursive: true });
  writeFileSync(path.join(packagePath, 'package.json'), JSON.stringify({ name, version }));
}

function withTemporaryTree(callback: (root: string) => void) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'kaseki-toolchain-'));
  try {
    callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runVerifier(root: string) {
  try {
    const stdout = execFileSync('node', [verifier, root], { encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { status?: number; stdout?: Buffer; stderr?: Buffer };
    return {
      status: failure.status ?? 1,
      stdout: failure.stdout?.toString() ?? '',
      stderr: failure.stderr?.toString() ?? '',
    };
  }
}

describe('image dependency version verification', () => {
  test('accepts patched package copies in the image module tree', () => {
    withTemporaryTree((root) => {
      createPackage(root, 'npm', 'npm', '11.21.0');
      createPackage(root, 'npm/node_modules/brace-expansion', 'brace-expansion', '5.0.11');
      createPackage(root, 'npm/node_modules/undici', 'undici', '6.28.1');
      createPackage(root, '@earendil-works/pi-coding-agent', '@earendil-works/pi-coding-agent', '0.87.1');
      createPackage(root, '@earendil-works/pi-coding-agent/node_modules/brace-expansion', 'brace-expansion', '5.0.11');
      createPackage(root, '@earendil-works/pi-coding-agent/node_modules/undici', 'undici', '8.10.2');

      const result = runVerifier(root);
      expect(result.status).toBe(0);
    });
  });

  test('rejects vulnerable nested copies and reports their image paths', () => {
    withTemporaryTree((root) => {
      createPackage(root, 'npm/node_modules/brace-expansion', 'brace-expansion', '5.0.9');
      createPackage(root, 'npm/node_modules/undici', 'undici', '6.28.0');
      createPackage(root, '@earendil-works/pi-coding-agent/node_modules/undici', 'undici', '8.9.0');
      createPackage(root, 'brace-expansion-v3', 'brace-expansion', '3.0.8');
      createPackage(root, 'legacy-v4/node_modules/brace-expansion', 'brace-expansion', '4.0.1');

      const result = runVerifier(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('npm/node_modules/brace-expansion/package.json: 5.0.9');
      expect(result.stderr).toContain('npm/node_modules/undici/package.json: 6.28.0');
      expect(result.stderr).toContain('@earendil-works/pi-coding-agent/node_modules/undici/package.json: 8.9.0');
      expect(result.stderr).toContain('brace-expansion-v3/package.json: 3.0.8 (fixed in 5.0.7)');
      expect(result.stderr).toContain('legacy-v4/node_modules/brace-expansion/package.json: 4.0.1 (fixed in 5.0.7)');
    });
  });
});
