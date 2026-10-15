import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyRuntimeFailure, expandValidationCommands, smokeWorkerd } from './validation-runtime.mjs';

test('classifies native address-space startup failure independently of exit 1 or timeout', () => {
  const fatal = 'MmapAligned() failed - unable to allocate with tag\nTCMalloc assumes a 48-bit virtual address space size\nFATAL ERROR: Out of memory trying to allocate internal tcmalloc data';
  assert.equal(classifyRuntimeFailure(fatal), 'workerd_address_space_incompatible');
  assert.equal(classifyRuntimeFailure('Error: [vitest-pool]: Failed to start cloudflare-pool worker\nCaused by: Error: write EPIPE'), 'workerd_startup_failed');
  assert.equal(classifyRuntimeFailure('✔ handles EPIPE errors\nAssertionError: expected true'), null);
});

test('expands only plain npm run chains, preserves lifecycle hooks and shell semantics', () => {
  const scripts = { verify: 'npm run test:all && npm run auth-worker:verify && npm run build', 'test:all': 'NODE_ENV=test node --test', 'auth-worker:verify': 'npm --prefix workers/auth ci && npm --prefix workers/auth test' };
  assert.equal(expandValidationCommands('npm run verify && npm run lint', scripts), 'npm run test:all;npm run auth-worker:verify;npm run build;npm run lint');
  assert.equal(expandValidationCommands('npm run verify', { ...scripts, preverify: 'node setup.js' }), 'npm run verify');
  assert.equal(expandValidationCommands('npm run verify || npm run lint', scripts), 'npm run verify || npm run lint');
  assert.equal(expandValidationCommands('npm run verify', { verify: 'npm run verify' }), 'npm run verify');
  assert.equal(expandValidationCommands('npm run verify', { verify: 'npm run build && echo done' }), 'npm run verify');
});

test('smoke starts the installed binary with a real test config and reports early native crashes', () => {
  const root = mkdtempSync(join(tmpdir(), 'kaseki-runtime-'));
  try {
    const dir = join(root, 'node_modules/workerd');
    mkdirSync(join(dir, 'bin'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'workerd', version: '1.0.0', bin: { workerd: 'bin/workerd' } }));
    writeFileSync(join(dir, 'bin/workerd'), '#!/bin/sh\n[ "$1" = test ] || exit 3\ngrep -q "Workerd.Config" "$2" || exit 4\nexit 0\n', { mode: 0o755 });
    assert.equal(smokeWorkerd(root).status, 'passed');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint .', verify: 'npm run auth-worker:verify', 'auth-worker:verify': 'npm --prefix workers/auth run test' } }));
    assert.equal(smokeWorkerd(root, 'npm run lint').status, 'not_required');
    mkdirSync(join(root, 'workers/auth'), { recursive: true });
    writeFileSync(join(root, 'workers/auth/package.json'), JSON.stringify({ scripts: { test: 'vitest run' }, devDependencies: { '@cloudflare/vitest-pool-workers': '1.0.0' } }));
    assert.equal(smokeWorkerd(root, 'npm run verify').status, 'passed');
    const linked = join(root, 'linked-workspace');
    mkdirSync(linked);
    symlinkSync(join(root, 'node_modules'), join(linked, 'node_modules'), 'dir');
    assert.equal(smokeWorkerd(linked).status, 'passed');
    writeFileSync(join(dir, 'bin/workerd'), '#!/bin/sh\necho "MmapAligned() failed; TCMalloc assumes a 48-bit virtual address space size" >&2\nexit 134\n', { mode: 0o755 });
    assert.equal(smokeWorkerd(root).classification, 'workerd_address_space_incompatible');
    assert.equal(smokeWorkerd(root, 'npm run verify').classification, 'workerd_address_space_incompatible');
    assert.equal(smokeWorkerd(root).status, 'failed');
    assert.equal(smokeWorkerd(join(root, 'missing')).status, 'not_installed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
