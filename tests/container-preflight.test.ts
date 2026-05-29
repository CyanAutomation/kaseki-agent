/**
 * tests/container-preflight.test.ts
 *
 * Tests for container preflight diagnostics module.
 * Validates setup completeness and staleness detection.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ContainerPreflightDiagnostics, getContainerPreflightResults, logContainerPreflightResults } from '../src/startup/container-preflight';
import type { KasekiApiConfig } from '../src/kaseki-api-config';
import type { PreflightCheck } from '../src/kaseki-api-types';

// Mock the logger to avoid spam during tests
jest.mock('../src/logger', () => ({
  createEventLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    event: jest.fn(),
  }),
}));

type PreflightCheckName =
  | 'setup-completeness'
  | 'secrets-readable'
  | 'checkout-exists'
  | 'git-freshness'
  | 'git-safe-directory'
  | 'template-bootstrap'
  | 'deleted-bind-mounts';

interface PreflightFixture {
  config: KasekiApiConfig;
  tempDir: string;
  kasekiRoot: string;
  resultsDir: string;
  runsDir: string;
  cacheDir: string;
  templateDir: string;
  checkoutDir: string;
  secretsDir: string;
}

const expectedCheckNames: PreflightCheckName[] = [
  'setup-completeness',
  'secrets-readable',
  'checkout-exists',
  'git-freshness',
  'git-safe-directory',
  'template-bootstrap',
  'deleted-bind-mounts',
];

const requiredTemplateFiles = [
  'run-kaseki.sh',
  'kaseki-agent.sh',
  'scripts/kaseki-preflight.sh',
  'scripts/startup-checks.sh',
];

function createConfig(tempDir: string): KasekiApiConfig {
  return {
    resultsDir: path.join(tempDir, 'results'),
    port: 8080,
    host: '127.0.0.1',
    apiKeys: [],
    defaultTaskMode: 'patch',
    logLevel: 'warn',
    maxConcurrentRuns: 1,
    maxDiffBytes: 400000,
    agentTimeoutSeconds: 10800,
    artifactCacheMaxEntries: 100,
    artifactCacheTtlMs: 3600000,
    artifactCacheMaxFileBytes: 10485760,
  };
}

function createFixture(): PreflightFixture {
  const tempDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-test-'));
  const config = createConfig(tempDir);
  const kasekiRoot = path.join(tempDir, 'agents');
  const resultsDir = path.join(kasekiRoot, 'kaseki-results');
  const runsDir = path.join(kasekiRoot, 'kaseki-runs');
  const cacheDir = path.join(kasekiRoot, 'kaseki-cache');
  const templateDir = path.join(kasekiRoot, 'kaseki-template');
  const checkoutDir = path.join(kasekiRoot, 'kaseki-agent');
  const secretsDir = path.join(tempDir, 'secrets');
  const homeDir = path.join(tempDir, 'home');

  for (const dir of [resultsDir, runsDir, cacheDir, templateDir, checkoutDir, secretsDir, homeDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  process.env.KASEKI_ROOT = kasekiRoot;
  process.env.KASEKI_TEMPLATE_DIR = templateDir;
  process.env.KASEKI_CHECKOUT_DIR = checkoutDir;
  process.env.KASEKI_SECRETS_DIR = secretsDir;
  process.env.HOME = homeDir;

  return {
    config,
    tempDir,
    kasekiRoot,
    resultsDir,
    runsDir,
    cacheDir,
    templateDir,
    checkoutDir,
    secretsDir,
  };
}

function writeRequiredSecrets(fixture: PreflightFixture): void {
  fs.writeFileSync(path.join(fixture.secretsDir, 'openrouter_api_key'), 'fake-key');
  fs.writeFileSync(path.join(fixture.secretsDir, 'kaseki_api_keys'), 'api-keys');
}

function writeRequiredTemplateFiles(fixture: PreflightFixture, mode = 0o755): void {
  fs.mkdirSync(path.join(fixture.templateDir, 'scripts'), { recursive: true });

  for (const file of requiredTemplateFiles) {
    const filePath = path.join(fixture.templateDir, file);
    fs.writeFileSync(filePath, '#!/bin/bash\necho test\n');
    fs.chmodSync(filePath, mode);
  }
}

function initGitRepository(fixture: PreflightFixture): string {
  spawnSync('git', ['init'], { cwd: fixture.checkoutDir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: fixture.checkoutDir });
  spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: fixture.checkoutDir });
  fs.writeFileSync(path.join(fixture.checkoutDir, 'test.txt'), 'content');
  spawnSync('git', ['add', 'test.txt'], { cwd: fixture.checkoutDir });
  spawnSync('git', ['commit', '-m', 'test'], { cwd: fixture.checkoutDir });

  const revParse = spawnSync('git', ['-C', fixture.checkoutDir, 'rev-parse', 'HEAD'], { encoding: 'utf-8' });
  return revParse.stdout.trim();
}

function runDiagnostics(fixture: PreflightFixture): PreflightCheck[] {
  return new ContainerPreflightDiagnostics(fixture.config).run();
}

function getCheck(checks: PreflightCheck[], name: PreflightCheckName): PreflightCheck {
  const byName = new Map(checks.map((check) => [check.name, check]));
  const check = byName.get(name);

  if (!check) {
    throw new Error(`Expected preflight check named ${name}; received ${checks.map((c) => c.name).join(', ')}`);
  }

  return check;
}

function expectCheckContract(check: PreflightCheck, expected: {
  name: PreflightCheckName;
  ok: boolean;
  detail: string;
  remediation?: string;
}): void {
  expect(check).toMatchObject({
    name: expected.name,
    ok: expected.ok,
    detail: expected.detail,
  });
  expect(typeof check.name).toBe('string');
  expect(typeof check.ok).toBe('boolean');
  expect(typeof check.detail).toBe('string');

  if (expected.remediation === undefined) {
    expect(check).not.toHaveProperty('remediation');
  } else {
    expect(check.remediation).toBe(expected.remediation);
  }
}

function expectDetailSet(detail: string | undefined, label: string, expectedItems: string[]): void {
  const section = detail
    ?.split('; ')
    .find((part) => part.startsWith(`${label}: `));

  expect(section).toBe(`${label}: ${expectedItems.join(', ')}`);
}

describe('ContainerPreflightDiagnostics', () => {
  let fixture: PreflightFixture;
  const originalHome = process.env.HOME;
  const originalGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;

  beforeEach(() => {
    fixture = createFixture();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    delete process.env.KASEKI_ROOT;
    delete process.env.KASEKI_TEMPLATE_DIR;
    delete process.env.KASEKI_CHECKOUT_DIR;
    delete process.env.KASEKI_SECRETS_DIR;

    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalGitConfigGlobal === undefined) {
      delete process.env.GIT_CONFIG_GLOBAL;
    } else {
      process.env.GIT_CONFIG_GLOBAL = originalGitConfigGlobal;
    }
  });

  describe('checkSetupCompleteness', () => {
    test('passes when all required directories exist and are readable', () => {
      const check = getCheck(runDiagnostics(fixture), 'setup-completeness');

      expectCheckContract(check, {
        name: 'setup-completeness',
        ok: true,
        detail: 'Required /agents subdirectories exist and are readable',
      });
    });

    test('fails with the exact missing directory set', () => {
      fs.rmSync(fixture.resultsDir, { recursive: true });
      fs.rmSync(fixture.cacheDir, { recursive: true });

      const check = getCheck(runDiagnostics(fixture), 'setup-completeness');

      expectCheckContract(check, {
        name: 'setup-completeness',
        ok: false,
        detail: `Missing directories: ${fixture.resultsDir}, ${fixture.cacheDir}`,
        remediation: 'Run: sudo kaseki-agent host setup --fix',
      });
      expectDetailSet(check.detail, 'Missing directories', [fixture.resultsDir, fixture.cacheDir]);
    });

    test('fails with the exact unreadable directory set', () => {
      const originalAccessSync = fs.accessSync;
      jest.spyOn(fs, 'accessSync').mockImplementation((target, mode) => {
        if (target === fixture.runsDir && mode === fs.constants.R_OK) {
          throw new Error('permission denied');
        }
        return originalAccessSync(target, mode);
      });

      const check = getCheck(runDiagnostics(fixture), 'setup-completeness');

      expectCheckContract(check, {
        name: 'setup-completeness',
        ok: false,
        detail: `Unreadable directories: ${fixture.runsDir}`,
        remediation: 'Run: sudo kaseki-agent host setup --fix',
      });
      expectDetailSet(check.detail, 'Unreadable directories', [fixture.runsDir]);
    });
  });

  describe('checkSecretsReadable', () => {
    test('passes when secrets directory and required files are readable', () => {
      writeRequiredSecrets(fixture);

      const check = getCheck(runDiagnostics(fixture), 'secrets-readable');

      expectCheckContract(check, {
        name: 'secrets-readable',
        ok: true,
        detail: 'Secrets directory is readable and required secrets are accessible',
      });
    });

    test('fails when secrets directory does not exist', () => {
      fs.rmSync(fixture.secretsDir, { recursive: true });

      const check = getCheck(runDiagnostics(fixture), 'secrets-readable');

      expectCheckContract(check, {
        name: 'secrets-readable',
        ok: false,
        detail: `Secrets directory does not exist: ${fixture.secretsDir}`,
        remediation: 'Run: sudo kaseki-agent host setup --fix',
      });
    });

    test('fails with the exact missing secret set', () => {
      fs.writeFileSync(path.join(fixture.secretsDir, 'kaseki_api_keys'), 'api-keys');

      const check = getCheck(runDiagnostics(fixture), 'secrets-readable');

      expectCheckContract(check, {
        name: 'secrets-readable',
        ok: false,
        detail: 'Missing secrets: openrouter_api_key',
        remediation: 'Run: sudo kaseki-agent host setup --fix',
      });
      expectDetailSet(check.detail, 'Missing secrets', ['openrouter_api_key']);
    });

    test('fails with the exact unreadable secret set', () => {
      writeRequiredSecrets(fixture);
      const unreadableSecret = path.join(fixture.secretsDir, 'openrouter_api_key');
      const originalAccessSync = fs.accessSync;
      jest.spyOn(fs, 'accessSync').mockImplementation((target, mode) => {
        if (target === unreadableSecret && mode === fs.constants.R_OK) {
          throw new Error('permission denied');
        }
        return originalAccessSync(target, mode);
      });

      const check = getCheck(runDiagnostics(fixture), 'secrets-readable');

      expectCheckContract(check, {
        name: 'secrets-readable',
        ok: false,
        detail: 'Unreadable secrets: openrouter_api_key',
        remediation: 'Run: sudo kaseki-agent host setup --fix',
      });
      expectDetailSet(check.detail, 'Unreadable secrets', ['openrouter_api_key']);
    });
  });

  describe('checkCheckoutExists', () => {
    test('passes when checkout directory exists and is readable', () => {
      const check = getCheck(runDiagnostics(fixture), 'checkout-exists');

      expectCheckContract(check, {
        name: 'checkout-exists',
        ok: true,
        detail: `Checkout directory exists and is readable: ${fixture.checkoutDir}`,
      });
    });

    test('fails when checkout directory does not exist', () => {
      fs.rmSync(fixture.checkoutDir, { recursive: true });

      const check = getCheck(runDiagnostics(fixture), 'checkout-exists');

      expectCheckContract(check, {
        name: 'checkout-exists',
        ok: false,
        detail: `Checkout directory does not exist: ${fixture.checkoutDir}`,
        remediation: 'Run: sudo kaseki-agent host setup --fix',
      });
    });

    test('fails when checkout directory is unreadable', () => {
      const originalAccessSync = fs.accessSync;
      jest.spyOn(fs, 'accessSync').mockImplementation((target, mode) => {
        if (target === fixture.checkoutDir && mode === fs.constants.R_OK) {
          throw new Error('permission denied');
        }
        return originalAccessSync(target, mode);
      });

      const check = getCheck(runDiagnostics(fixture), 'checkout-exists');

      expectCheckContract(check, {
        name: 'checkout-exists',
        ok: false,
        detail: `Checkout directory is not readable: ${fixture.checkoutDir}`,
        remediation: `Fix permissions: sudo chown -R 10000:10000 ${fixture.checkoutDir}`,
      });
    });
  });

  describe('checkGitFreshness', () => {
    test('fails gracefully when .git directory is missing', () => {
      const gitDir = path.join(fixture.checkoutDir, '.git');

      const check = getCheck(runDiagnostics(fixture), 'git-freshness');

      expectCheckContract(check, {
        name: 'git-freshness',
        ok: false,
        detail: `Git directory is missing or inaccessible: ${gitDir}`,
        remediation: 'Run: sudo kaseki-agent host setup --fix',
      });
    });

    test('succeeds when git repository is accessible', () => {
      const head = initGitRepository(fixture);

      const check = getCheck(runDiagnostics(fixture), 'git-freshness');

      expectCheckContract(check, {
        name: 'git-freshness',
        ok: true,
        detail: `Git repository is readable and at ref: ${head.substring(0, 8)}`,
      });
    });
  });

  describe('checkGitSafeDirectory', () => {
    test('warns when git safe.directory is not configured', () => {
      initGitRepository(fixture);

      const check = getCheck(runDiagnostics(fixture), 'git-safe-directory');

      expectCheckContract(check, {
        name: 'git-safe-directory',
        ok: false,
        detail: `Git safe.directory not configured for ${fixture.checkoutDir}`,
        remediation: `Configure: git config --global --add safe.directory ${fixture.checkoutDir}`,
      });
    });

    test('passes when safe.directory is configured', () => {
      initGitRepository(fixture);
      spawnSync('git', ['config', '--global', '--add', 'safe.directory', fixture.checkoutDir]);

      const check = getCheck(runDiagnostics(fixture), 'git-safe-directory');

      expectCheckContract(check, {
        name: 'git-safe-directory',
        ok: true,
        detail: `Git safe.directory is configured for ${fixture.checkoutDir}`,
      });
    });
  });

  describe('checkTemplateBootstrap', () => {
    test('fails with the exact missing file set', () => {
      const check = getCheck(runDiagnostics(fixture), 'template-bootstrap');

      expectCheckContract(check, {
        name: 'template-bootstrap',
        ok: false,
        detail: `Missing: ${requiredTemplateFiles.join(', ')}`,
        remediation: 'Run: sudo kaseki-agent host setup --fix',
      });
      expect(check.templatePath).toBe(fixture.templateDir);
      expectDetailSet(check.detail, 'Missing', requiredTemplateFiles);
    });

    test('fails with the exact unexecutable file set', () => {
      writeRequiredTemplateFiles(fixture);
      const originalAccessSync = fs.accessSync;
      jest.spyOn(fs, 'accessSync').mockImplementation((target, mode) => {
        if (target === path.join(fixture.templateDir, 'kaseki-agent.sh') && mode === fs.constants.X_OK) {
          throw new Error('permission denied');
        }
        return originalAccessSync(target, mode);
      });

      const check = getCheck(runDiagnostics(fixture), 'template-bootstrap');

      expectCheckContract(check, {
        name: 'template-bootstrap',
        ok: false,
        detail: 'Not executable: kaseki-agent.sh',
        remediation: 'Run: sudo kaseki-agent host setup --fix',
      });
      expect(check.templatePath).toBe(fixture.templateDir);
      expectDetailSet(check.detail, 'Not executable', ['kaseki-agent.sh']);
    });

    test('passes when all required files exist and are executable', () => {
      writeRequiredTemplateFiles(fixture);

      const check = getCheck(runDiagnostics(fixture), 'template-bootstrap');

      expectCheckContract(check, {
        name: 'template-bootstrap',
        ok: true,
        detail: 'All required template bootstrap files are present and executable',
      });
      expect(check.templatePath).toBe(fixture.templateDir);
    });
  });

  describe('checkDeletedBindMounts', () => {
    test('passes when no deleted mounts are detected', () => {
      const check = getCheck(runDiagnostics(fixture), 'deleted-bind-mounts');

      expect(check.name).toBe('deleted-bind-mounts');
      expect(check.ok).toBe(true);
      expect(['No deleted bind mounts detected', 'Could not read /proc/self/mountinfo; skipping check']).toContain(check.detail);
      expect(check).not.toHaveProperty('remediation');
    });
  });

  describe('full diagnostic run', () => {
    test('returns contract-shaped PreflightCheck objects in deterministic order', () => {
      const checks = runDiagnostics(fixture);

      expect(checks.map((check) => check.name)).toEqual(expectedCheckNames);
      expect(checks).toHaveLength(expectedCheckNames.length);

      for (const check of checks) {
        expect(typeof check.name).toBe('string');
        expect(typeof check.ok).toBe('boolean');
        expect(typeof check.detail).toBe('string');
        if (check.remediation !== undefined) {
          expect(typeof check.remediation).toBe('string');
          expect(check.remediation.length).toBeGreaterThan(0);
        }
      }
    });

    test('supports keyed lookup without index/order brittleness', () => {
      const checks = runDiagnostics(fixture);
      const keyedChecks = new Map(checks.map((check) => [check.name, check]));

      expect([...keyedChecks.keys()]).toEqual(expectedCheckNames);
      expect(keyedChecks.get('setup-completeness')).toMatchObject({
        name: 'setup-completeness',
        ok: true,
        detail: 'Required /agents subdirectories exist and are readable',
      });
      expect(keyedChecks.get('template-bootstrap')).toMatchObject({
        name: 'template-bootstrap',
        ok: false,
        detail: `Missing: ${requiredTemplateFiles.join(', ')}`,
        remediation: 'Run: sudo kaseki-agent host setup --fix',
        templatePath: fixture.templateDir,
      });
    });
  });

  describe('caching and retrieval', () => {
    test('logs and caches results', () => {
      const checks = runDiagnostics(fixture);

      logContainerPreflightResults(checks);

      expect(getContainerPreflightResults()).toEqual({
        timestamp: expect.any(String),
        checks,
      });
    });

    test('getContainerPreflightResults returns null or the cached contract shape', () => {
      const cached = getContainerPreflightResults();

      if (cached === null) {
        expect(cached).toBeNull();
      } else {
        expect(cached).toEqual({
          timestamp: expect.any(String),
          checks: expect.any(Array),
        });
      }
    });
  });
});
