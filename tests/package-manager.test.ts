import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolvePackageManager, packageScriptCommand, dependencyInputHash } from '../scripts/package-manager.cjs';

describe('target repository package manager', () => {
  test.each([
    [{}, ['package-lock.json'], 'npm', 'package-lock.json'],
    [{}, ['npm-shrinkwrap.json', 'package-lock.json'], 'npm', 'npm-shrinkwrap.json'],
    [{}, ['bun.lock'], 'bun', 'bun.lock'],
    [{ packageManager: 'bun@1.3.11' }, ['bun.lockb'], 'bun', 'bun.lockb'],
  ])('resolves %j with %j', (manifest, files, manager, lockfile) => {
    expect(resolvePackageManager(manifest, files)).toMatchObject({ manager, lockfile });
  });

  test.each([
    [{}, []],
    [{}, ['pnpm-lock.yaml']],
    [{ packageManager: 'pnpm@10.0.0' }, ['package-lock.json']],
    [{ packageManager: 'bun@1.3.11' }, ['package-lock.json']],
    [{}, ['bun.lock', 'package-lock.json']],
    [{}, ['bun.lock', 'bun.lockb']],
    [{ packageManager: 'bun@latest' }, ['bun.lock']],
  ])('rejects ambiguous or unsupported setup %j / %j', (manifest, files) => {
    expect(() => resolvePackageManager(manifest, files)).toThrow();
  });

  test('workspace and local dependency trees use package stores rather than partial tree restores', () => {
    expect(resolvePackageManager({ workspaces: ['packages/*'] }, ['bun.lock']).treeCacheSafe).toBe(false);
    expect(resolvePackageManager({ dependencies: { local: 'file:./local' } }, ['package-lock.json']).treeCacheSafe).toBe(false);
    expect(resolvePackageManager({}, ['bun.lock']).treeCacheSafe).toBe(true);
  });

  test('preview uses a declared manager without requiring a local checkout', () => {
    expect(resolvePackageManager({ packageManager: 'bun@1.3.11' }, [], false).manager).toBe('bun');
    expect(packageScriptCommand('bun', 'test')).toBe('bun run test');
    expect(packageScriptCommand('npm', 'test')).toBe('npm run test');
  });

  test('rejects an empty lockfile path before reading cache inputs', () => {
    expect(() => dependencyInputHash(os.tmpdir(), '')).toThrow(
      'dependencyInputHash requires a non-empty lockfile path',
    );
  });

  test('cache inputs include manifests and configuration, excluding installed packages', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-pm-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), '{}');
      fs.writeFileSync(path.join(dir, 'bun.lock'), '{}');
      const first = dependencyInputHash(dir, 'bun.lock');
      fs.writeFileSync(path.join(dir, 'bunfig.toml'), '[install]\nlinker="isolated"\n');
      expect(dependencyInputHash(dir, 'bun.lock')).not.toBe(first);
      fs.mkdirSync(path.join(dir, 'node_modules'));
      fs.writeFileSync(path.join(dir, 'node_modules', 'package.json'), '{}');
      const configured = dependencyInputHash(dir, 'bun.lock');
      fs.mkdirSync(path.join(dir, 'packages', 'child'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'packages', 'child', 'package.json'), '{}');
      expect(dependencyInputHash(dir, 'bun.lock')).not.toBe(configured);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
