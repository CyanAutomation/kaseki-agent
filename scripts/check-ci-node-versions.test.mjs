import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('workflow Node version check ignores unrelated step-scoped VERSION values', () => {
  const output = execFileSync(process.execPath, ['scripts/check-ci-node-versions.mjs'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.match(output, /OK \.github\/workflows\/publish-npm\.yml: Node 24 satisfies/);
});
