import { describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

type PackageLock = {
  packages: Record<string, PackageManifest>;
};

const repoRoot = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as PackageManifest;
const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8')) as PackageLock;

describe('tree-sitter package and probe contracts', () => {
  it('keeps the CLI out of root dependencies while retaining parser grammars', () => {
    expect(manifest.dependencies?.['tree-sitter-cli']).toBeUndefined();
    expect(manifest.devDependencies?.['tree-sitter-cli']).toBeUndefined();
    expect(lock.packages['']?.dependencies?.['tree-sitter-cli']).toBeUndefined();
    expect(lock.packages['']?.devDependencies?.['tree-sitter-cli']).toBeUndefined();
    expect(lock.packages['node_modules/tree-sitter-cli']).toBeUndefined();

    expect(manifest.devDependencies?.['tree-sitter-go']).toBe('^0.21.2');
    expect(manifest.devDependencies?.['tree-sitter-typescript']).toBe('^0.21.2');
  });

  it('routes the opt-in CLI probe through its prerequisite-checking wrapper', () => {
    expect(manifest.scripts?.['test:tree-sitter:environment-probe']).toBe(
      'bash scripts/run-tree-sitter-environment-probe.sh',
    );
  });
});
