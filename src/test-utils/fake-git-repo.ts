/**
 * Fake git repository utilities for testing
 *
 * Helpers to create and initialize fake git repositories with minimal overhead.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface FakeRepoConfig {
  packageJson?: Record<string, unknown>;
  packageLock?: Record<string, unknown>;
  additionalFiles?: Record<string, string>; // filename -> content
}

/**
 * Create a minimal fake git repository
 *
 * @param repoDir Directory to create the repository in
 * @param config Configuration for the repository
 * @returns Path to the created repository
 */
export function createFakeGitRepo(repoDir: string, config: FakeRepoConfig = {}): string {
  fs.mkdirSync(repoDir, { recursive: true });

  const { packageJson, packageLock, additionalFiles = {} } = config;

  // Create package.json
  const defaultPackageJson = {
    name: 'fake-repo',
    version: '1.0.0',
    private: true,
    scripts: { check: 'exit 0' },
    dependencies: { 'fake-dep': 'file:deps/fake-dep' },
  };

  const finalPackageJson = packageJson ? { ...defaultPackageJson, ...packageJson } : defaultPackageJson;
  fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify(finalPackageJson));

  // Create package-lock.json
  const defaultPackageLock = {
    name: finalPackageJson.name,
    version: finalPackageJson.version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { ...finalPackageJson },
      'deps/fake-dep': { version: '1.0.0' },
      'node_modules/fake-dep': { resolved: 'deps/fake-dep', link: true },
    },
  };

  const finalPackageLock = packageLock ? { ...defaultPackageLock, ...packageLock } : defaultPackageLock;
  fs.writeFileSync(path.join(repoDir, 'package-lock.json'), JSON.stringify(finalPackageLock));

  // Create fake dependency
  fs.mkdirSync(path.join(repoDir, 'deps', 'fake-dep'), { recursive: true });
  fs.writeFileSync(
    path.join(repoDir, 'deps', 'fake-dep', 'package.json'),
    JSON.stringify({ name: 'fake-dep', version: '1.0.0', private: true })
  );

  // Create additional files
  for (const [filename, content] of Object.entries(additionalFiles)) {
    const filepath = path.join(repoDir, filename);
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, content);
  }

  // Initialize git repository (minimal: just init, don't commit)
  // This is faster than full init + add + commit sequence
  execFileSync('git', ['-C', repoDir, 'init', '-q', '-b', 'main']);

  return repoDir;
}

/**
 * Create a fake git repository and commit initial files
 * (slower than createFakeGitRepo but needed if code reads git history)
 *
 * @param repoDir Directory to create the repository in
 * @param config Configuration for the repository
 * @returns Path to the created repository
 */
export function createFakeGitRepoWithCommit(repoDir: string, config: FakeRepoConfig = {}): string {
  createFakeGitRepo(repoDir, config);

  // Stage and commit files
  execFileSync('git', ['-C', repoDir, 'add', 'package.json', 'package-lock.json', 'deps/fake-dep/package.json']);
  execFileSync('git', [
    '-C',
    repoDir,
    '-c',
    'user.email=kaseki-test@example.invalid',
    '-c',
    'user.name=Kaseki Test',
    'commit',
    '-q',
    '-m',
    'initial',
  ]);

  return repoDir;
}
