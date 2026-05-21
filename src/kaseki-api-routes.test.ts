// Mock Docker subprocess helpers so preflight route tests can assert generated Docker args deterministically.
jest.mock('./lib/subprocess-helpers', () => {
  const actual = jest.requireActual('./lib/subprocess-helpers');
  return {
    ...actual,
    execDockerCommand: jest.fn(),
  };
});

// Mock the host-secrets-reader module
jest.mock('./secrets/host-secrets-reader', () => ({
  readHostSecret: jest.fn(),
  resolveHostSecretPath: jest.fn((name) => `/agents/secrets/${name}`),
  getSecretLocations: jest.fn((name) => ({
    primary: `/agents/secrets/${name}`,
    secondary: `/home/user/secrets/${name}`,
  })),
  clearSecretCache: jest.fn(),
}));

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import express, { Express } from 'express';
import { AddressInfo, Server } from 'net';
import * as hostSecretsReader from './secrets/host-secrets-reader';
import * as subprocessHelpers from './lib/subprocess-helpers';
import { classifyDockerFailure, decodeUtf8TailSafely, tailLogByLines } from './kaseki-api-routes';
import { readArtifactContent } from './routes/artifact-routes';
import { ResultCache } from './result-cache';
import { validateGitHubAppPrivateKey } from './github-app-private-key';
import { createApiRouter } from './kaseki-api-routes';
import { IdempotencyStore } from './idempotency-store';
import { PreFlightValidator } from './pre-flight-validator';
import {
  createMockScheduler,
  createTestConfig,
  type TestScheduler,
} from './test-utils';

const { privateKey: defaultGithubPrivateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const defaultGithubPrivateKeyPem = defaultGithubPrivateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const execDockerCommandMock = jest.mocked(subprocessHelpers.execDockerCommand);

function mockSuccessfulDockerCommands(): void {
  execDockerCommandMock.mockImplementation((args: string[]) => ({
    ok: true,
    stdout: args[0] === 'version' ? '24.0.0 -> 24.0.0' : undefined,
  }));
}

function mockReadableGithubAppCredentials(): void {
  const { readHostSecret } = jest.mocked(hostSecretsReader);
  (readHostSecret as jest.Mock).mockImplementation((name: string) => {
    if (name === 'github_app_id') return '12345';
    if (name === 'github_app_client_id') return 'Iv123client';
    if (name === 'github_app_private_key') return defaultGithubPrivateKeyPem;
    return null;
  });
}

beforeEach(() => {
  process.env.KASEKI_SKIP_BOOTSTRAP_CHECK = '1';
  mockSuccessfulDockerCommands();
  mockReadableGithubAppCredentials();
});

/**
 * Complete test app setup for kaseki-api-routes testing.
 * Returns { app, server, port, idempotencyStore, preFlightValidator }.
 * Call server.close() in finally block to clean up.
 *
 * @param scheduler Mock scheduler (use createMockScheduler from test-utils)
 * @param config Test config (use createTestConfig from test-utils)
 * @returns Object with Express app, HTTP server, port number, and stores
 */
async function createTestApp(
  scheduler: TestScheduler,
  config: ReturnType<typeof createTestConfig>,
): Promise<{
  app: Express;
  server: Server;
  port: number;
  idempotencyStore: IdempotencyStore;
  preFlightValidator: PreFlightValidator;
}> {
  const idempotencyStore = new IdempotencyStore(config.resultsDir, 24);
  const preFlightValidator = new PreFlightValidator();

  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter(scheduler as any, config, idempotencyStore, preFlightValidator));

  const { server, port } = await listenTestApp(app);

  return {
    app,
    server,
    port,
    idempotencyStore,
    preFlightValidator,
  };
}

async function listenTestApp(app: Express): Promise<{ server: Server; port: number }> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
  return { server, port: (server.address() as AddressInfo).port };
}

/**
 * Clean shutdown of server and idempotency store.
 */
async function cleanupTestApp(server: Server, idempotencyStore: IdempotencyStore): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await idempotencyStore.shutdown();
}

describe('kaseki-api-routes log truncation helpers', () => {
  test('decodeUtf8TailSafely trims incomplete 2-byte sequence split at chunk boundary', () => {
    const input = Buffer.concat([Buffer.from('cafe ', 'utf-8'), Buffer.from([0xc3])]);
    expect(decodeUtf8TailSafely(input)).toBe('cafe ');
  });

  test('decodeUtf8TailSafely trims incomplete 3-byte sequence split at chunk boundary', () => {
    const input = Buffer.concat([Buffer.from('prefix ', 'utf-8'), Buffer.from([0xe4, 0xbd])]);
    expect(decodeUtf8TailSafely(input)).toBe('prefix ');
  });

  test('decodeUtf8TailSafely trims incomplete 4-byte sequence split at chunk boundary', () => {
    const input = Buffer.concat([Buffer.from('emoji ', 'utf-8'), Buffer.from([0xf0, 0x9f, 0x98])]);
    expect(decodeUtf8TailSafely(input)).toBe('emoji ');
  });

  test('decodeUtf8TailSafely keeps chunks that start with continuation bytes when tail is complete', () => {
    const input = Buffer.concat([Buffer.from([0x98, 0x80]), Buffer.from('alpha 你好 😀 beta', 'utf-8')]);
    expect(decodeUtf8TailSafely(input)).toBe('��alpha 你好 😀 beta');
  });

  test('decodeUtf8TailSafely keeps pure ASCII tails unchanged', () => {
    const input = Buffer.from('line1\nline2\nASCII tail', 'utf-8');
    expect(decodeUtf8TailSafely(input)).toBe('line1\nline2\nASCII tail');
  });

  test.each([
    {
      name: 'empty content',
      content: '',
      lineCount: 3,
      expected: '',
    },
    {
      name: 'exact boundary',
      content: 'a\nb\nc',
      lineCount: 3,
      expected: 'a\nb\nc',
    },
    {
      name: 'over-requested lines',
      content: 'a\nb\nc',
      lineCount: 10,
      expected: 'a\nb\nc',
    },
    {
      name: 'CRLF input',
      content: 'a\r\nb\r\nc\r\nd',
      lineCount: 2,
      expected: 'c\nd',
    },
    {
      name: 'trailing newline handling',
      content: 'a\nb\nc\n',
      lineCount: 2,
      expected: 'c\n',
    },
  ])('tailLogByLines handles $name', ({ content, lineCount, expected }) => {
    expect(tailLogByLines(content, lineCount)).toBe(expected);
  });
});

describe('kaseki-api-routes artifact read behavior', () => {
  let testDir: string;
  let artifactPath: string;
  let cache: ResultCache;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-routes-test-'));
    artifactPath = path.join(testDir, 'pi-summary.json');
    cache = new ResultCache(10, 60_000);
  });

  afterEach(() => {
    delete process.env.KASEKI_SKIP_BOOTSTRAP_CHECK;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('returns fresh artifact content for running jobs when file changes between reads', () => {
    fs.writeFileSync(artifactPath, '{"version":1}');
    const firstRead = readArtifactContent(artifactPath, 'running', cache);
    expect(firstRead).toBe('{"version":1}');

    fs.writeFileSync(artifactPath, '{"version":2}');
    const secondRead = readArtifactContent(artifactPath, 'running', cache);
    expect(secondRead).toBe('{"version":2}');
  });
});

describe('kaseki-api-routes readiness and metrics endpoints', () => {
  let resultsDir: string;

  beforeEach(() => {
    resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-ready-metrics-test-'));
  });

  afterEach(() => {
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  test('GET /api/ready returns 200 when scheduler dependencies are ready', async () => {
    const scheduler = createMockScheduler();
    scheduler.getReadiness.mockReturnValue({ ready: true, reasons: [] });
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/ready`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.status).toBe('ready');
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('GET /api/ready returns 503 with machine-readable reasons when not ready', async () => {
    const scheduler = createMockScheduler();
    scheduler.getReadiness.mockReturnValue({ ready: false, reasons: ['results_dir_unwritable:EACCES'] });
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/ready`);
      expect(res.status).toBe(503);
      const body = (await res.json()) as any;
      expect(body.status).toBe('not_ready');
      expect(body.reasons).toContain('results_dir_unwritable:EACCES');
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('GET /api/metrics allows trusted unauthenticated local mode when no API keys are configured', async () => {
    const scheduler = createMockScheduler();
    const config = { ...createTestConfig(resultsDir), apiKeys: [] };
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/metrics`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/plain');
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('GET /api/metrics rejects unauthenticated non-loopback requests when no API keys are configured', async () => {
    const scheduler = createMockScheduler();
    const config = { ...createTestConfig(resultsDir), apiKeys: [] };
    const idempotencyStore = new IdempotencyStore(config.resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use((_req, _res, next) => {
      Object.defineProperty(_req.socket, 'remoteAddress', {
        value: '10.0.0.25',
        configurable: true,
      });
      next();
    });
    app.use('/api', createApiRouter(scheduler as any, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/metrics`);
      expect(res.status).toBe(401);
      const body = (await res.json()) as any;
      expect(body.detail).toBe('Unauthenticated local mode only accepts loopback requests');
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('GET /api/metrics returns prometheus content type and expected metric keys', async () => {
    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/metrics`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/plain');
      const body = await res.text();
      expect(body).toContain('kaseki_queue_pending');
      expect(body).toContain('kaseki_runs_total');
      expect(body).toContain('kaseki_run_duration_seconds');
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });
});

describe('kaseki-api-routes request aliases', () => {
  let resultsDir: string;

  beforeEach(() => {
    resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-request-aliases-'));
  });

  afterEach(() => {
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  test('POST /api/validate accepts snake_case payload aliases', async () => {
    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore, preFlightValidator } = await createTestApp(scheduler, config);
    jest.spyOn(preFlightValidator, 'validate').mockResolvedValue({
      isValid: true,
      checks: [],
      warnings: [],
      errors: [],
      estimatedDurationSeconds: 60,
    });

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/validate`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_url: 'https://github.com/org/repo',
          git_ref: 'main',
          task_prompt: 'Run a first-time setup validation smoke test',
        }),
      });

      expect(res.status).toBe(200);
      expect(preFlightValidator.validate).toHaveBeenCalledWith(expect.objectContaining({
        repoUrl: 'https://github.com/org/repo',
        ref: 'main',
        taskPrompt: 'Run a first-time setup validation smoke test',
      }));
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('POST /api/runs accepts snake_case payload aliases', async () => {
    const scheduler = createMockScheduler();
    scheduler.submitJob.mockResolvedValue({
      id: 'kaseki-alias',
      status: 'queued',
      createdAt: new Date('2026-05-15T00:00:00.000Z'),
      resultDir: path.join(resultsDir, 'kaseki-alias'),
    });
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_url: 'https://github.com/org/repo',
          git_ref: 'main',
          task_prompt: 'Run a first-time setup task smoke test',
          publish_mode: 'none',
        }),
      });

      expect(res.status).toBe(202);
      expect(scheduler.submitJob).toHaveBeenCalledWith(expect.objectContaining({
        repoUrl: 'https://github.com/org/repo',
        ref: 'main',
        taskPrompt: 'Run a first-time setup task smoke test',
        publishMode: 'none',
      }));
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });
});

describe('kaseki-api-routes template readiness gate', () => {
  let resultsDir: string;
  let originalSkipBootstrapCheck: string | undefined;
  let originalTemplateDir: string | undefined;

  beforeEach(() => {
    resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-template-gate-test-'));
    originalSkipBootstrapCheck = process.env.KASEKI_SKIP_BOOTSTRAP_CHECK;
    originalTemplateDir = process.env.KASEKI_TEMPLATE_DIR;
    delete process.env.KASEKI_SKIP_BOOTSTRAP_CHECK;
  });

  afterEach(() => {
    fs.rmSync(resultsDir, { recursive: true, force: true });
    if (originalSkipBootstrapCheck === undefined) {
      delete process.env.KASEKI_SKIP_BOOTSTRAP_CHECK;
    } else {
      process.env.KASEKI_SKIP_BOOTSTRAP_CHECK = originalSkipBootstrapCheck;
    }
    if (originalTemplateDir === undefined) {
      delete process.env.KASEKI_TEMPLATE_DIR;
    } else {
      process.env.KASEKI_TEMPLATE_DIR = originalTemplateDir;
    }
  });

  test('POST /api/runs rejects incomplete templates before queueing', async () => {
    const templateDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-incomplete-template-'));
    process.env.KASEKI_TEMPLATE_DIR = templateDir;
    fs.writeFileSync(path.join(templateDir, 'run-kaseki.sh'), '#!/usr/bin/env bash\n');

    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const idempotencyStore = new IdempotencyStore(config.resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler as any, config, idempotencyStore, preFlightValidator));
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://github.com/org/repo' }),
      });
      const body = (await res.json()) as any;

      expect(res.status).toBe(400);
      expect(body.type).toBe('https://api.kaseki.local/errors#template-not-ready');
      expect(body.detail).toContain('Template is incomplete');
      expect(scheduler.submitJob).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(resultsDir, '.kaseki-api-idempotency.jsonl'))).toBe(false);
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      fs.rmSync(templateDir, { recursive: true, force: true });
    }
  });
});

describe('kaseki-api-routes preflight diagnostics', () => {
  jest.setTimeout(15000);

  const githubEnvKeys = [
    'GITHUB_APP_ID',
    'GITHUB_APP_ID_FILE',
    'GITHUB_APP_CLIENT_ID',
    'GITHUB_APP_CLIENT_ID_FILE',
    'GITHUB_APP_PRIVATE_KEY',
    'GITHUB_APP_PRIVATE_KEY_FILE',
    'OPENROUTER_API_KEY',
  ];

  function restoreEnv(snapshot: Record<string, string | undefined>): void {
    for (const key of githubEnvKeys) {
      const value = snapshot[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('classifies Docker socket permission failures with actionable remediation', () => {
    const result = classifyDockerFailure(
      'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock'
    );

    expect(result.detail).toMatch(/socket is not accessible/);
    expect(result.remediation).toMatch(/group_add/);
  });

  test('classifies unreachable Docker daemon separately from image misses', () => {
    const result = classifyDockerFailure('Cannot connect to the Docker daemon at unix:///var/run/docker.sock');

    expect(result.detail).toMatch(/unreachable/);
    expect(result.remediation).toMatch(/daemon/);
  });

  function getWorkerSmokeDockerRunArgs(): string[] {
    const runCall = execDockerCommandMock.mock.calls.find(([args]) => args[0] === 'run');
    if (!runCall) {
      throw new Error('Expected worker smoke docker run command to be executed');
    }
    return runCall[0];
  }

  test('GET /api/preflight binds KASEKI_HOST_SECRETS_DIR for nested worker smoke Docker runs', async () => {
    const originalHostSecretsDir = process.env.KASEKI_HOST_SECRETS_DIR;
    const originalOpenRouterKeyFile = process.env.OPENROUTER_API_KEY_FILE;
    process.env.KASEKI_HOST_SECRETS_DIR = '/home/pi/secrets';
    delete process.env.OPENROUTER_API_KEY_FILE;
    const { resolveHostSecretPath } = jest.mocked(hostSecretsReader);
    (resolveHostSecretPath as jest.Mock).mockImplementation((name: string) => {
      if (name === 'openrouter_api_key') return '/run/secrets/kaseki/openrouter_api_key';
      return `/run/secrets/kaseki/${name}`;
    });

    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-worker-host-secrets-'));
    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/preflight`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect([200, 503]).toContain(res.status);

      const runArgs = getWorkerSmokeDockerRunArgs();
      expect(runArgs).toContain('/home/pi/secrets:/run/secrets/kaseki:ro');
      expect(runArgs).not.toContain('/run/secrets/kaseki:/run/secrets/kaseki:ro');
      expect(runArgs).toEqual(expect.arrayContaining([
        'OPENROUTER_API_KEY_FILE=/run/secrets/kaseki/openrouter_api_key',
        'KASEKI_SECRETS_DIR=/run/secrets/kaseki',
      ]));
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      if (originalHostSecretsDir === undefined) {
        delete process.env.KASEKI_HOST_SECRETS_DIR;
      } else {
        process.env.KASEKI_HOST_SECRETS_DIR = originalHostSecretsDir;
      }
      if (originalOpenRouterKeyFile === undefined) {
        delete process.env.OPENROUTER_API_KEY_FILE;
      } else {
        process.env.OPENROUTER_API_KEY_FILE = originalOpenRouterKeyFile;
      }
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('GET /api/preflight reports host secrets remediation for worker startup-check missing secrets', async () => {
    execDockerCommandMock.mockImplementation((args: string[]) => {
      if (args[0] === 'run') {
        return {
          ok: false,
          status: 3,
          detail: [
            'No OpenRouter API key configured',
            'GitHub App credentials are incomplete',
            'Create: /run/secrets/kaseki/openrouter_api_key',
          ].join('\n'),
        };
      }

      return {
        ok: true,
        stdout: args[0] === 'version' ? '24.0.0 -> 24.0.0' : undefined,
      };
    });

    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-worker-missing-secrets-'));
    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/preflight`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect([200, 503]).toContain(res.status);
      const body = (await res.json()) as any;
      const workerSmokeCheck = body.checks.find((check: any) => check.name === 'worker-smoke');

      expect(workerSmokeCheck).toEqual(expect.objectContaining({
        ok: false,
        detail: expect.stringContaining('No OpenRouter API key configured'),
        remediation: expect.stringMatching(/KASEKI_HOST_SECRETS_DIR|host secrets (directory|mount)/),
      }));
      expect(workerSmokeCheck.remediation).not.toMatch(/Docker daemon|Docker socket|docker\.sock/i);
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('GET /api/preflight falls back to the resolved host secret directory for local worker smoke runs', async () => {
    const originalHostSecretsDir = process.env.KASEKI_HOST_SECRETS_DIR;
    const originalOpenRouterKeyFile = process.env.OPENROUTER_API_KEY_FILE;
    delete process.env.KASEKI_HOST_SECRETS_DIR;
    delete process.env.OPENROUTER_API_KEY_FILE;
    const { resolveHostSecretPath } = jest.mocked(hostSecretsReader);
    (resolveHostSecretPath as jest.Mock).mockImplementation((name: string) => {
      if (name === 'openrouter_api_key') return '/tmp/kaseki-local-secrets/openrouter_api_key';
      return `/tmp/kaseki-local-secrets/${name}`;
    });

    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-worker-local-secrets-'));
    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/preflight`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect([200, 503]).toContain(res.status);

      const runArgs = getWorkerSmokeDockerRunArgs();
      expect(runArgs).toContain('/tmp/kaseki-local-secrets:/run/secrets/kaseki:ro');
      expect(runArgs).not.toContain('/run/secrets/kaseki:/run/secrets/kaseki:ro');
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      if (originalHostSecretsDir === undefined) {
        delete process.env.KASEKI_HOST_SECRETS_DIR;
      } else {
        process.env.KASEKI_HOST_SECRETS_DIR = originalHostSecretsDir;
      }
      if (originalOpenRouterKeyFile === undefined) {
        delete process.env.OPENROUTER_API_KEY_FILE;
      } else {
        process.env.OPENROUTER_API_KEY_FILE = originalOpenRouterKeyFile;
      }
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('GET /api/preflight resolves container secret mount to host bind source for worker smoke runs', async () => {
    const originalHostSecretsDir = process.env.KASEKI_HOST_SECRETS_DIR;
    const originalOpenRouterKeyFile = process.env.OPENROUTER_API_KEY_FILE;
    delete process.env.KASEKI_HOST_SECRETS_DIR;
    delete process.env.OPENROUTER_API_KEY_FILE;
    const { resolveHostSecretPath } = jest.mocked(hostSecretsReader);
    (resolveHostSecretPath as jest.Mock).mockImplementation((name: string) => {
      if (name === 'openrouter_api_key') return '/run/secrets/kaseki/openrouter_api_key';
      return `/run/secrets/kaseki/${name}`;
    });
    execDockerCommandMock.mockImplementation((args: string[]) => {
      if (args[0] === 'inspect' && args.includes('{{json .Mounts}}')) {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              Type: 'bind',
              Source: '/home/pi/secrets',
              Destination: '/run/secrets/kaseki',
            },
          ]),
        };
      }

      return {
        ok: true,
        stdout: args[0] === 'version' ? '24.0.0 -> 24.0.0' : undefined,
      };
    });

    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-worker-inspect-secrets-'));
    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/preflight`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect([200, 503]).toContain(res.status);

      const runArgs = getWorkerSmokeDockerRunArgs();
      expect(runArgs).toContain('/home/pi/secrets:/run/secrets/kaseki:ro');
      expect(runArgs).not.toContain('/run/secrets/kaseki:/run/secrets/kaseki:ro');
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      if (originalHostSecretsDir === undefined) {
        delete process.env.KASEKI_HOST_SECRETS_DIR;
      } else {
        process.env.KASEKI_HOST_SECRETS_DIR = originalHostSecretsDir;
      }
      if (originalOpenRouterKeyFile === undefined) {
        delete process.env.OPENROUTER_API_KEY_FILE;
      } else {
        process.env.OPENROUTER_API_KEY_FILE = originalOpenRouterKeyFile;
      }
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('GET /api/preflight reports deleted bind mounts for Kaseki paths', async () => {
    const tempRoot = fs.mkdtempSync(path.join('/tmp', 'kaseki-deleted-mount-'));
    const resultsDir = path.join(tempRoot, 'kaseki-results');
    fs.mkdirSync(resultsDir, { recursive: true });
    const mountInfoPath = path.join(tempRoot, 'mountinfo');
    const originalMountInfoPath = process.env.KASEKI_MOUNTINFO_PATH;
    process.env.KASEKI_MOUNTINFO_PATH = mountInfoPath;
    fs.writeFileSync(
      mountInfoPath,
      `101 99 179:2 /agents//deleted ${tempRoot} rw,noatime - ext4 /dev/mmcblk0p2 rw\n`,
    );

    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/preflight`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect([200, 503]).toContain(res.status);
      const body = (await res.json()) as any;
      const mountCheck = body.checks.find((check: any) => check.name === 'bind-mounts');
      expect(mountCheck).toEqual(expect.objectContaining({
        ok: false,
        detail: expect.stringContaining('/agents//deleted'),
        remediation: expect.stringContaining('--recreate-api'),
      }));
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      if (originalMountInfoPath === undefined) {
        delete process.env.KASEKI_MOUNTINFO_PATH;
      } else {
        process.env.KASEKI_MOUNTINFO_PATH = originalMountInfoPath;
      }
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('GET /api/preflight recreates a missing results directory when parent is writable', async () => {
    const tempRoot = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-repair-'));
    const resultsDir = path.join(tempRoot, 'kaseki-results');
    const mountInfoPath = path.join(tempRoot, 'mountinfo');
    const originalMountInfoPath = process.env.KASEKI_MOUNTINFO_PATH;
    process.env.KASEKI_MOUNTINFO_PATH = mountInfoPath;
    fs.writeFileSync(mountInfoPath, '');

    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      fs.rmSync(resultsDir, { recursive: true, force: true });
      expect(fs.existsSync(resultsDir)).toBe(false);
      const res = await fetch(`http://127.0.0.1:${port}/api/preflight`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect([200, 503]).toContain(res.status);
      const body = (await res.json()) as any;
      const resultsCheck = body.checks.find((check: any) => check.name === 'results-dir');
      expect(resultsCheck).toEqual(expect.objectContaining({
        ok: true,
        detail: `${resultsDir} is readable and writable.`,
      }));
      expect(fs.statSync(resultsDir).isDirectory()).toBe(true);
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      if (originalMountInfoPath === undefined) {
        delete process.env.KASEKI_MOUNTINFO_PATH;
      } else {
        process.env.KASEKI_MOUNTINFO_PATH = originalMountInfoPath;
      }
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('GET /api/preflight reports readable GitHub App file credentials', async () => {
    const { readHostSecret } = jest.mocked(hostSecretsReader);
    (readHostSecret as jest.Mock).mockImplementation((name: string) => {
      if (name === 'github_app_id') return '12345';
      if (name === 'github_app_client_id') return 'Iv123client';
      if (name === 'github_app_private_key') {
        const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
        return privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
      }
      return null;
    });

    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-github-'));
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/preflight`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect([200, 503]).toContain(res.status);
      const body = (await res.json()) as any;
      const githubCheck = body.checks.find((check: any) => check.name === 'github-app');
      expect(githubCheck).toEqual(expect.objectContaining({
        ok: true,
        detail: expect.stringContaining('GitHub App credentials are readable'),
      }));
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      fs.rmSync(resultsDir, { recursive: true, force: true });
      restoreEnv(Object.fromEntries(githubEnvKeys.map((key) => [key, process.env[key]])));
    }
  });

  test('GET /api/preflight accepts single-line GitHub App private key secret without leaking it', async () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
    const singleLinePrivateKey = privateKeyPem.replace(/\n/g, ' ').trim();
    const privateKeyBodyLine = privateKeyPem
      .split('\n')
      .find((line) => line && !line.includes('BEGIN') && !line.includes('END') && !line.includes('PRIVATE KEY'));
    if (!privateKeyBodyLine) {
      throw new Error('Failed to extract private key body line from generated PEM');
    }
    const { readHostSecret } = jest.mocked(hostSecretsReader);
    (readHostSecret as jest.Mock).mockImplementation((name: string) => {
      if (name === 'github_app_id') return '12345';
      if (name === 'github_app_client_id') return 'Iv123client';
      if (name === 'github_app_private_key') return singleLinePrivateKey;
      return null;
    });

    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-github-single-line-'));
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/preflight`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect([200, 503]).toContain(res.status);
      const body = (await res.json()) as any;
      const githubCheck = body.checks.find((check: any) => check.name === 'github-app');
      expect(githubCheck).toEqual(expect.objectContaining({
        ok: true,
        detail: expect.stringContaining('GitHub App credentials are readable'),
      }));
      const responseText = JSON.stringify(body);
      expect(responseText).not.toContain(singleLinePrivateKey);
      expect(responseText).not.toContain(privateKeyBodyLine);
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      fs.rmSync(resultsDir, { recursive: true, force: true });
      restoreEnv(Object.fromEntries(githubEnvKeys.map((key) => [key, process.env[key]])));
    }
  });

  test('GET /api/preflight rejects malformed private-key-looking GitHub App credentials', async () => {
    const malformedPrivateKey = '-----BEGIN RSA PRIVATE KEY-----\nnot-real-key-material\n-----END RSA PRIVATE KEY-----';
    const expectedValidation = validateGitHubAppPrivateKey(malformedPrivateKey);
    const { readHostSecret } = jest.mocked(hostSecretsReader);
    (readHostSecret as jest.Mock).mockImplementation((name: string) => {
      if (name === 'github_app_id') return '12345';
      if (name === 'github_app_client_id') return 'Iv123client';
      if (name === 'github_app_private_key') return malformedPrivateKey;
      return null;
    });

    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-github-malformed-'));
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/preflight`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect([200, 503]).toContain(res.status);
      const body = (await res.json()) as any;
      const githubCheck = body.checks.find((check: any) => check.name === 'github-app');
      expect(githubCheck).toEqual(expect.objectContaining({
        ok: false,
        detail: expectedValidation.error,
        remediation: expectedValidation.remediation,
      }));
      expect(githubCheck.detail).not.toContain('not-real-key-material');
      expect(githubCheck.remediation).not.toContain('not-real-key-material');
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      fs.rmSync(resultsDir, { recursive: true, force: true });
      restoreEnv(Object.fromEntries(githubEnvKeys.map((key) => [key, process.env[key]])));
    }
  });

  test('GET /api/preflight flags incomplete GitHub App configuration', async () => {
    const { readHostSecret } = jest.mocked(hostSecretsReader);
    (readHostSecret as jest.Mock).mockReturnValue(null); // No GitHub App credentials

    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-github-missing-'));
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/preflight`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect([200, 503]).toContain(res.status);
      const body = (await res.json()) as any;
      const githubCheck = body.checks.find((check: any) => check.name === 'github-app');
      expect(githubCheck).toEqual(expect.objectContaining({
        ok: false,
        detail: expect.stringContaining('default PR creation cannot run'),
        remediation: expect.stringContaining('github_app_private_key'),
      }));
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      fs.rmSync(resultsDir, { recursive: true, force: true });
      restoreEnv(Object.fromEntries(githubEnvKeys.map((key) => [key, process.env[key]])));
    }
  });
});

describe('kaseki-api-routes tail file descriptor cleanup', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('fs');
  });

  test('closes file descriptor when readSync throws', () => {
    const closeSyncMock = jest.fn();

    jest.isolateModules(() => {
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        openSync: jest.fn(() => 42),
        readSync: jest.fn(() => {
          throw new Error('read failed');
        }),
        closeSync: closeSyncMock,
      }));

      const { readTailBytes } = jest.requireActual('./utils/utf8-helpers') as typeof import('./utils/utf8-helpers');
      expect(() => readTailBytes('/tmp/fake.log', 200, 100)).toThrow('read failed');
    });

    expect(closeSyncMock).toHaveBeenCalledWith(42);
  });
});

describe('kaseki-api-routes results artifacts endpoint', () => {
  let resultsDir: string;

  beforeEach(() => {
    resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-routes-api-test-'));
  });

  afterEach(() => {
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  test('failed run can retrieve failure diagnostics artifacts', async () => {
    const jobId = 'kaseki-failed-1';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'failure.json'), JSON.stringify({ failureClass: 'validation' }));
    fs.writeFileSync(path.join(jobDir, 'stderr.log'), 'stderr output');
    fs.writeFileSync(path.join(jobDir, 'stdout.log'), 'stdout output');

    const scheduler = createMockScheduler({
      [jobId]: { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir },
    });
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);
    const headers = { Authorization: 'Bearer test-key' };

    try {
      const failureRes = await fetch(`http://127.0.0.1:${port}/api/results/${jobId}/failure.json`, { headers });
      expect(failureRes.status).toBe(200);
      const failureBody = (await failureRes.json()) as any;
      expect(failureBody.file).toBe('failure.json');
      expect(failureBody.contentType).toBe('application/json');

      const stderrRes = await fetch(`http://127.0.0.1:${port}/api/results/${jobId}/stderr.log`, { headers });
      expect(stderrRes.status).toBe(200);
      const stderrBody = (await stderrRes.json()) as any;
      expect(stderrBody.file).toBe('stderr.log');
      expect(stderrBody.contentType).toBe('text/plain');
      expect(stderrBody.content).toBe('stderr output');

      const stdoutRes = await fetch(`http://127.0.0.1:${port}/api/results/${jobId}/stdout.log`, { headers });
      expect(stdoutRes.status).toBe(200);
      const stdoutBody = (await stdoutRes.json()) as any;
      expect(stdoutBody.file).toBe('stdout.log');
      expect(stdoutBody.content).toBe('stdout output');
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('non-failed run is blocked from retrieving failure diagnostics artifacts', async () => {
    const jobId = 'kaseki-running-1';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'failure.json'), JSON.stringify({ failureClass: 'validation' }));

    const scheduler = createMockScheduler({
      [jobId]: { id: jobId, status: 'running' as const, createdAt: new Date(), resultDir: jobDir },
    });
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);
    const headers = { Authorization: 'Bearer test-key' };

    try {
      const failureRes = await fetch(`http://127.0.0.1:${port}/api/results/${jobId}/failure.json`, { headers });
      expect(failureRes.status).toBe(400);
      const failureBody = (await failureRes.json()) as any;
      expect(failureBody.title).toBe('Bad Request');
      expect(failureBody.status).toBe(400);
      expect(failureBody.detail).toContain('Artifact only available for failed runs: failure.json');
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });
});

describe('kaseki-api-routes run artifacts inventory endpoint', () => {
  let resultsDir: string;

  beforeEach(() => {
    resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-routes-artifacts-test-'));
  });

  afterEach(() => {
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  test('failed run reports partial artifacts with failure-triage recommendations', async () => {
    const jobId = 'kaseki-failed-artifacts';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'failure.json'), JSON.stringify({ failureClass: 'validation' }));
    fs.writeFileSync(path.join(jobDir, 'stderr.log'), 'stderr output');
    fs.writeFileSync(path.join(jobDir, 'result-summary.md'), '# summary');

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 0, maxConcurrent: 1 }),
      getJob: (id: string) =>
        id === jobId
          ? { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir, exitCode: 1 }
          : undefined,
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn(),
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const,
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/artifacts`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.runStatus).toBe('failed');
      expect(body.exitCode).toBe(1);
      expect(body.recommended).toContain('failure.json');
      expect(body.recommended).toContain('stderr.log');
      const failureFile = body.artifacts.find((artifact: any) => artifact.name === 'failure.json');
      const missingFile = body.artifacts.find((artifact: any) => artifact.name === 'stdout.log');
      expect(failureFile.available).toBe(true);
      expect(missingFile.available).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('running run does not expose failure-only artifacts as available', async () => {
    const jobId = 'kaseki-running-artifacts';
    const fallbackDir = path.join(resultsDir, jobId);
    fs.mkdirSync(fallbackDir, { recursive: true });
    fs.writeFileSync(path.join(fallbackDir, 'result-summary.md'), '# running summary');
    fs.writeFileSync(path.join(fallbackDir, 'stderr.log'), 'not yet final');

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 1, maxConcurrent: 1 }),
      getJob: (id: string) => (id === jobId ? { id: jobId, status: 'running', createdAt: new Date() } : undefined),
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn(),
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const,
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/artifacts`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.runStatus).toBe('running');
      // Running jobs have no recommended artifacts (non-terminal)
      expect(body.recommended.length).toBe(0);
      const stderrFile = body.artifacts.find((artifact: any) => artifact.name === 'stderr.log');
      const summaryFile = body.artifacts.find((artifact: any) => artifact.name === 'result-summary.md');
      expect(stderrFile.available).toBe(false);
      expect(summaryFile.available).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('artifact enumeration includes all artifacts with metadata and descriptions', async () => {
    const jobId = 'kaseki-comprehensive-artifacts';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    // Create a mix of artifacts to test availability filtering
    fs.writeFileSync(path.join(jobDir, 'metadata.json'), '{}');
    fs.writeFileSync(path.join(jobDir, 'result-summary.md'), '# Summary');
    fs.writeFileSync(path.join(jobDir, 'failure.json'), '{"exit_code": 1}');
    fs.writeFileSync(path.join(jobDir, 'stderr.log'), 'errors');
    fs.writeFileSync(path.join(jobDir, 'pi-events.jsonl'), '');
    fs.writeFileSync(path.join(jobDir, 'pi-summary.json'), '{}');
    fs.writeFileSync(path.join(jobDir, 'changed-files.txt'), 'src/file.ts');
    fs.writeFileSync(path.join(jobDir, 'git.diff'), 'diff content');
    fs.writeFileSync(path.join(jobDir, 'validation.log'), 'validation results');
    fs.writeFileSync(path.join(jobDir, 'quality.log'), 'quality results');
    fs.writeFileSync(path.join(jobDir, 'progress.log'), 'progress');
    fs.writeFileSync(path.join(jobDir, 'progress.jsonl'), '{"stage":"done"}');
    fs.writeFileSync(path.join(jobDir, 'exit_code'), '1');
    fs.writeFileSync(path.join(jobDir, 'restoration-report.md'), '# Restoration');
    fs.writeFileSync(path.join(jobDir, 'validation-timings.tsv'), 'command\tstart\tend');
    fs.writeFileSync(path.join(jobDir, 'stage-timings.tsv'), 'stage\tstart\tend');

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 0, maxConcurrent: 1 }),
      getJob: (id: string) =>
        id === jobId ? { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir, exitCode: 1 } : undefined,
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn(),
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const,
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/artifacts`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;

      // Verify comprehensive enumeration
      expect(body.artifacts.length).toBeGreaterThan(15); // Should have many artifacts
      expect(body.artifactCount).toBeGreaterThan(10); // At least 10 available
      expect(body.downloadBaseUrl).toBe(`/api/results/${jobId}/`);

      // Verify metadata inclusion
      const resultSummary = body.artifacts.find((a: any) => a.name === 'result-summary.md');
      expect(resultSummary).toMatchObject({
        name: 'result-summary.md',
        available: true,
        contentType: 'text/markdown',
        description: expect.stringContaining('summary'),
        availability: 'always',
      });

      // Verify conditional artifacts
      const changedFiles = body.artifacts.find((a: any) => a.name === 'changed-files.txt');
      expect(changedFiles).toMatchObject({
        available: true,
        contentType: 'text/plain',
        description: expect.stringContaining('filename'),
        availability: 'conditional',
      });

      // Verify failure-only artifacts
      const failureJson = body.artifacts.find((a: any) => a.name === 'failure.json');
      expect(failureJson).toMatchObject({
        available: true,
        availability: 'on-failure',
      });

      // Verify triage order hint
      expect(body.recommended[0]).toBe('failure.json'); // Should be first for failed run
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('returns 404 when run does not exist', async () => {
    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 0, maxConcurrent: 1 }),
      getJob: () => undefined,
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn(),
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir: fs.mkdtempSync(path.join('/tmp', 'kaseki-routes-notfound-test-')),
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const,
    };

    const idempotencyStore = new IdempotencyStore(config.resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/missing-run/artifacts`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect(response.status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });
});

describe('kaseki-api-routes logs endpoint stderr fallback', () => {
  let resultsDir: string;

  beforeEach(() => {
    resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-routes-logs-test-'));
  });

  afterEach(() => {
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  test('failed run with missing stderr returns synthetic fallback payload', async () => {
    const jobId = 'kaseki-failed-missing-stderr';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 0, maxConcurrent: 1 }),
      getJob: (id: string) =>
        id === jobId
          ? {
            id: jobId,
            status: 'failed',
            createdAt: new Date(),
            resultDir: jobDir,
            exitCode: 17,
            failureClass: 'validator_error',
            error: 'Validation step crashed',
          }
          : undefined,
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn(),
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const,
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/logs/stderr`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.logType).toBe('stderr');
      expect(body.content).toContain(`job id: ${jobId}`);
      expect(body.content).toContain('exit code: 17');
      expect(body.content).toContain('failure class: validator_error');
      expect(body.content).toContain('job.error: Validation step crashed');
      expect(body.content).toContain('canonical stderr.log was not generated');
      expect(body.size).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('non-failed run with missing stderr remains 404', async () => {
    const jobId = 'kaseki-running-missing-stderr';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 1, maxConcurrent: 1 }),
      getJob: (id: string) =>
        id === jobId
          ? {
            id: jobId,
            status: 'running',
            createdAt: new Date(),
            resultDir: jobDir,
          }
          : undefined,
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn(),
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const,
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/logs/stderr`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect(response.status).toBe(404);
      const body = (await response.json()) as any;
      expect(body.detail).toContain('Log file not found: stderr');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });
});

describe('kaseki-api-routes controller replay and events', () => {
  let resultsDir: string;

  beforeEach(() => {
    resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-routes-controller-test-'));
  });

  afterEach(() => {
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  test('idempotency replay returns the current job status instead of the original queued response', async () => {
    const job = {
      id: 'kaseki-99',
      status: 'queued',
      createdAt: new Date(),
      resultDir: path.join(resultsDir, 'kaseki-99'),
      correlationId: '11111111-1111-4111-8111-111111111111',
      requestId: '22222222-2222-4222-8222-222222222222',
    } as any;

    const scheduler = {
      getQueueStatus: () => ({ pending: 1, running: 0, maxConcurrent: 1 }),
      getJob: (id: string) => (id === job.id ? job : undefined),
      submitJob: jest.fn(() => job),
      listJobs: () => [job],
      cancelJob: jest.fn(),
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const,
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);
    const headers = { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' };
    const body = JSON.stringify({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
      idempotencyKey: '33333333-3333-4333-8333-333333333333',
    });

    try {
      const first = await fetch(`http://127.0.0.1:${port}/api/runs`, { method: 'POST', headers, body });
      expect(first.status).toBe(202);

      job.status = 'failed';
      job.completedAt = new Date();
      job.exitCode = 143;
      job.failureClass = 'cancelled';
      job.error = 'Job cancelled by API request';

      const replay = await fetch(`http://127.0.0.1:${port}/api/runs`, { method: 'POST', headers, body });
      expect(replay.status).toBe(200);
      const replayBody = (await replay.json()) as any;
      expect(replayBody).toMatchObject({
        id: job.id,
        status: 'failed',
        cached: true,
        exitCode: 143,
        failureClass: 'cancelled',
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('events endpoint falls back to live docker progress for active runs', async () => {
    const jobId = 'kaseki-live-events';
    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 1, maxConcurrent: 1 }),
      getJob: (id: string) => (id === jobId ? { id: jobId, status: 'running', createdAt: new Date() } : undefined),
      getLiveProgressEvents: jest.fn(() => [{ source: 'docker-logs', stage: 'startup check', message: 'container booted' }]),
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn(),
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const,
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/events`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.sources).toEqual(['docker-logs']);
      expect(body.events[0]).toMatchObject({ stage: 'startup check', message: 'container booted' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('artifact listing treats zero-byte diagnostics as unavailable', async () => {
    const jobId = 'kaseki-zero-artifacts';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'failure.json'), '');
    fs.writeFileSync(path.join(jobDir, 'stderr.log'), 'stderr');

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 0, maxConcurrent: 1 }),
      getJob: (id: string) => (id === jobId ? { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir } : undefined),
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn(),
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const,
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/artifacts`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      const failureFile = body.artifacts.find((artifact: any) => artifact.name === 'failure.json');
      const stderrFile = body.artifacts.find((artifact: any) => artifact.name === 'stderr.log');
      expect(failureFile.available).toBe(false);
      expect(stderrFile.available).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });
});

describe('kaseki-api-routes status artifact hints', () => {
  let resultsDir: string;

  beforeEach(() => {
    resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-routes-status-test-'));
  });

  afterEach(() => {
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  test('failed run reports deterministic artifact availability and prefers failure.json as diagnostic entrypoint', async () => {
    const jobId = 'kaseki-failed-status-1';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'metadata.json'), '{"id":"meta"}');
    fs.writeFileSync(path.join(jobDir, 'failure.json'), '{"failureClass":"validation"}');
    fs.writeFileSync(path.join(jobDir, 'stderr.log'), 'stderr');

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 0, maxConcurrent: 1 }),
      getJob: (id: string) =>
        id === jobId
          ? { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir, exitCode: 1 }
          : undefined,
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn(),
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const,
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.status).toBe('failed');
      expect(body.artifacts).toEqual({
        metadataJson: true,
        analysisMd: false,
        resultSummaryMd: false,
        failureJson: true,
        stderrLog: true,
        availableFiles: ['metadata.json', 'failure.json', 'stderr.log'],
      });
      expect(body.diagnosticEntryPoint).toBe('failure.json');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('runs list includes terminal exit code from result metadata when scheduler job lacks it', async () => {
    const jobId = 'kaseki-list-exit-code';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'metadata.json'), '{"exit_code":127}');

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 0, maxConcurrent: 1 }),
      getJob: jest.fn(),
      submitJob: jest.fn(),
      listJobs: () => [{ id: jobId, status: 'failed', createdAt: new Date('2026-05-07T12:00:00Z'), resultDir: jobDir }],
      cancelJob: jest.fn(),
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const,
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.runs[0]).toMatchObject({
        id: jobId,
        status: 'failed',
        exitCode: 127,
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('failed run falls back to result-summary.md diagnostic entrypoint when failure.json is missing', async () => {
    const jobId = 'kaseki-failed-status-2';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'result-summary.md'), '# summary');

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 0, maxConcurrent: 1 }),
      getJob: (id: string) => (id === jobId ? { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir } : undefined),
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn(),
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const,
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.artifacts).toEqual({
        metadataJson: false,
        analysisMd: false,
        resultSummaryMd: true,
        failureJson: false,
        stderrLog: false,
        availableFiles: ['result-summary.md'],
      });
      expect(body.diagnosticEntryPoint).toBe('result-summary.md');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('failed run prefers analysis.md diagnostic entrypoint when failure.json is missing', async () => {
    const jobId = 'kaseki-failed-status-analysis';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'analysis.md'), '# analysis');

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 0, maxConcurrent: 1 }),
      getJob: (id: string) => (id === jobId ? { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir } : undefined),
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn(),
    } as any;
    const config = { port: 0, apiKeys: ['test-key'], resultsDir, maxConcurrentRuns: 1, defaultTaskMode: 'patch' as const, maxDiffBytes: 400000, agentTimeoutSeconds: 10800, logLevel: 'info' as const };
    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, { headers: { Authorization: 'Bearer test-key' } });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.artifacts.analysisMd).toBe(true);
      expect(body.diagnosticEntryPoint).toBe('analysis.md');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('running status returns structured progress from progress.jsonl', async () => {
    const jobId = 'kaseki-running-status-progress-file';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(
      path.join(jobDir, 'progress.jsonl'),
      `${JSON.stringify({ stage: 'pi coding agent', percentComplete: 42, timestamp: '2026-05-05T00:00:00.000Z' })}\n`
    );

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 1, maxConcurrent: 1 }),
      getJob: (id: string) =>
        id === jobId ? { id: jobId, status: 'running', createdAt: new Date(), resultDir: jobDir, startedAt: new Date() } : undefined,
      getLiveProgressEvents: jest.fn(() => []),
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn(),
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const,
    };
    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.progress).toEqual({
        stage: 'pi coding agent',
        percentComplete: 42,
        message: 'pi coding agent',
        updatedAt: '2026-05-05T00:00:00.000Z',
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('running status falls back to live progress when progress.jsonl has no parseable final event', async () => {
    const jobId = 'kaseki-running-status-progress-malformed-file';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'progress.jsonl'), `${JSON.stringify({ stage: 'older file event' })}\n{not-json}\n`);

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 1, maxConcurrent: 1 }),
      getJob: (id: string) =>
        id === jobId ? { id: jobId, status: 'running', createdAt: new Date(), resultDir: jobDir, startedAt: new Date() } : undefined,
      getLiveProgressEvents: jest.fn(() => [
        { stage: 'live fallback', message: 'file tail was malformed', timestamp: '2026-05-05T00:00:01.000Z' },
      ]),
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn(),
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const,
    };
    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.progress).toEqual({
        stage: 'live fallback',
        message: 'file tail was malformed',
        updatedAt: '2026-05-05T00:00:01.000Z',
      });
      expect(scheduler.getLiveProgressEvents).toHaveBeenCalledWith(jobId, 1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('running status returns structured progress from live docker fallback', async () => {
    const jobId = 'kaseki-running-status-progress-live';
    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 1, maxConcurrent: 1 }),
      getJob: (id: string) => (id === jobId ? { id: jobId, status: 'running', createdAt: new Date(), startedAt: new Date() } : undefined),
      getLiveProgressEvents: jest.fn(() => [{ stage: 'startup check', message: 'container booted', timestamp: '2026-05-05T00:00:02.000Z' }]),
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn(),
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const,
    };
    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.progress).toEqual({
        stage: 'startup check',
        message: 'container booted',
        updatedAt: '2026-05-05T00:00:02.000Z',
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('failed run inlines result-summary.md content in status response', async () => {
    const jobId = 'kaseki-failed-inline-summary';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    const summaryContent = '# Kaseki Result\n\n- Status: failed\n- Exit code: 1\n';
    fs.writeFileSync(path.join(jobDir, 'result-summary.md'), summaryContent);
    fs.writeFileSync(path.join(jobDir, 'metadata.json'), '{}');

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 0, maxConcurrent: 1 }),
      getJob: (id: string) =>
        id === jobId ? { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir, exitCode: 1 } : undefined,
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn(),
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const,
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.resultSummaryContent).toBe(summaryContent);
      expect(body.resultSummaryContent).toContain('# Kaseki Result');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('failed run inlines failure.json content in status response', async () => {
    const jobId = 'kaseki-failed-inline-failure';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    const failureData = { instance: jobId, exit_code: 1, failed_command: 'npm run test', failureClass: 'validation' };
    fs.writeFileSync(path.join(jobDir, 'failure.json'), JSON.stringify(failureData));
    fs.writeFileSync(path.join(jobDir, 'result-summary.md'), '# Summary');

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 0, maxConcurrent: 1 }),
      getJob: (id: string) =>
        id === jobId ? { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir, exitCode: 1 } : undefined,
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn(),
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const,
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.failureJsonContent).toEqual(failureData);
      expect(body.failureJsonContent.exit_code).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('completed run does not inline failure.json (not applicable)', async () => {
    const jobId = 'kaseki-completed-no-failure';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'result-summary.md'), '# Success');
    fs.writeFileSync(path.join(jobDir, 'metadata.json'), '{}');

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 0, maxConcurrent: 1 }),
      getJob: (id: string) =>
        id === jobId ? { id: jobId, status: 'completed', createdAt: new Date(), resultDir: jobDir, exitCode: 0 } : undefined,
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn(),
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const,
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.resultSummaryContent).toBeDefined();
      expect(body.failureJsonContent).toBeUndefined();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });
});

describe('kaseki-api-routes template bootstrap health', () => {
  let resultsDir: string;
  let templateDir: string;
  let checkoutDir: string;
  const previousEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-routes-template-results-'));
    templateDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-routes-template-'));
    checkoutDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-routes-checkout-'));
    previousEnv.KASEKI_SKIP_BOOTSTRAP_CHECK = process.env.KASEKI_SKIP_BOOTSTRAP_CHECK;
    previousEnv.KASEKI_TEMPLATE_DIR = process.env.KASEKI_TEMPLATE_DIR;
    previousEnv.KASEKI_CHECKOUT_DIR = process.env.KASEKI_CHECKOUT_DIR;
    delete process.env.KASEKI_SKIP_BOOTSTRAP_CHECK;
    process.env.KASEKI_TEMPLATE_DIR = templateDir;
    process.env.KASEKI_CHECKOUT_DIR = checkoutDir;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(resultsDir, { recursive: true, force: true });
    fs.rmSync(templateDir, { recursive: true, force: true });
    fs.rmSync(checkoutDir, { recursive: true, force: true });
  });

  function writeRunKasekiDoctor(exitCode: number, stderr: string): void {
    fs.mkdirSync(path.join(templateDir, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(templateDir, 'lib'), { recursive: true });
    const scriptPath = path.join(templateDir, 'run-kaseki.sh');
    fs.writeFileSync(
      scriptPath,
      `#!/usr/bin/env bash\nif [[ "$1" == "--doctor" ]]; then\n  echo ${JSON.stringify(stderr)} >&2\n  exit ${exitCode}\nfi\nexit 0\n`,
    );
    fs.chmodSync(scriptPath, 0o755);
    fs.writeFileSync(path.join(templateDir, 'kaseki-agent.sh'), '#!/usr/bin/env bash\n');
    fs.writeFileSync(path.join(templateDir, 'scripts', 'kaseki-activate.sh'), '#!/usr/bin/env bash\n');
    fs.writeFileSync(path.join(templateDir, 'scripts', 'kaseki-preflight.sh'), '#!/usr/bin/env bash\n');
    fs.writeFileSync(path.join(templateDir, 'lib', 'pi-event-filter.js'), 'export {};\n');
    fs.writeFileSync(path.join(templateDir, 'lib', 'pi-progress-stream.js'), 'export {};\n');
    fs.writeFileSync(path.join(templateDir, 'lib', 'kaseki-report.js'), 'export {};\n');
    fs.writeFileSync(path.join(templateDir, 'lib', 'github-app-token.js'), 'export {};\n');
  }

  function writeTemplateMetadata(supportedPublishModes: string[], gitRef = 'test-ref'): void {
    fs.writeFileSync(
      path.join(templateDir, '.kaseki-template-version'),
      JSON.stringify({
        gitRef,
        supportedPublishModes,
        imageDigest: 'docker.io/cyanautomation/kaseki-agent@sha256:test',
      }),
    );
  }

  function git(args: string[], cwd: string): string {
    return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
  }

  function createStaleCheckout(): { remoteDir: string; localSha: string; remoteSha: string } {
    const remoteDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-routes-remote-'));
    const sourceDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-routes-source-'));
    fs.rmSync(checkoutDir, { recursive: true, force: true });
    try {
      git(['init', '--bare', '--initial-branch=main'], remoteDir);
      git(['init', '--initial-branch=main'], sourceDir);
      git(['config', 'user.email', 'test@example.com'], sourceDir);
      git(['config', 'user.name', 'Test User'], sourceDir);
      fs.writeFileSync(path.join(sourceDir, 'README.md'), 'first\n');
      git(['add', 'README.md'], sourceDir);
      git(['commit', '-m', 'first'], sourceDir);
      git(['remote', 'add', 'origin', remoteDir], sourceDir);
      git(['push', 'origin', 'main'], sourceDir);
      git(['clone', remoteDir, checkoutDir], '/tmp');
      const localSha = git(['rev-parse', 'HEAD'], checkoutDir);
      fs.writeFileSync(path.join(sourceDir, 'README.md'), 'second\n');
      git(['commit', '-am', 'second'], sourceDir);
      git(['push', 'origin', 'main'], sourceDir);
      const remoteSha = git(['rev-parse', 'HEAD'], sourceDir);
      return { remoteDir, localSha, remoteSha };
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  }

  test('allows PR run submission when template metadata supports pr', async () => {
    writeTemplateMetadata(['auto', 'none', 'branch', 'pr', 'draft_pr']);
    writeRunKasekiDoctor(0, 'doctor ok');
    const scheduler = createMockScheduler();
    scheduler.submitJob.mockImplementation((runRequest: any) => ({
      id: 'job-template-pr-supported',
      status: 'queued',
      createdAt: new Date(),
      resultDir: path.join(resultsDir, 'job-template-pr-supported'),
      requestId: runRequest.requestId,
      correlationId: runRequest.correlationId,
      request: runRequest,
    }));
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://github.com/org/repo', publishMode: 'pr' }),
      });

      expect(response.status).toBe(202);
      expect(scheduler.submitJob).toHaveBeenCalledWith(expect.objectContaining({
        repoUrl: 'https://github.com/org/repo',
        publishMode: 'pr',
      }));
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('rejects publishable run submission when controller checkout is behind origin', async () => {
    const stale = createStaleCheckout();
    writeTemplateMetadata(['auto', 'none', 'branch', 'pr', 'draft_pr'], stale.localSha);
    writeRunKasekiDoctor(0, 'doctor ok');
    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://github.com/org/repo', publishMode: 'pr' }),
      });

      expect(response.status).toBe(409);
      const body = (await response.json()) as any;
      expect(body.detail).toContain('Controller checkout is different from origin/main');
      expect(body.localRef).toBe(stale.localSha);
      expect(body.remoteRef).toBe(stale.remoteSha);
      expect(body.remediation).toBe('Run scripts/kaseki-activate.sh --controller bootstrap.');
      expect(scheduler.submitJob).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(stale.remoteDir, { recursive: true, force: true });
      await cleanupTestApp(server, idempotencyStore);
    }
  });



  test('returns specific checkout diagnostics for git rev-parse permission failures when enforcement applies', async () => {
    writeRunKasekiDoctor(0, 'doctor ok');
    git(['init', '--initial-branch=main'], checkoutDir);
    git(['config', 'user.email', 'test@example.com'], checkoutDir);
    git(['config', 'user.name', 'Test User'], checkoutDir);
    fs.writeFileSync(path.join(checkoutDir, 'README.md'), 'x\n');
    git(['add', 'README.md'], checkoutDir);
    git(['commit', '-m', 'init'], checkoutDir);
    fs.chmodSync(path.join(checkoutDir, '.git', 'HEAD'), 0o000);

    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://github.com/org/repo', publishMode: 'pr' }),
      });
      expect(response.status).toBe(409);
      const body = (await response.json()) as any;
      expect(body.detail).toContain('git rev-parse HEAD');
      // When .git/HEAD is unreadable, git returns "not a git repository" rather than "permission denied"
      expect(body.detail).toMatch(/permission denied|not a git repository/);
      expect(body.detail).toContain('stderr tail');
    } finally {
      fs.chmodSync(path.join(checkoutDir, '.git', 'HEAD'), 0o644);
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('skips freshness when checkout is missing .git metadata', async () => {
    writeRunKasekiDoctor(0, 'doctor ok');
    const scheduler = createMockScheduler();
    scheduler.submitJob.mockImplementation((runRequest: any) => ({ id: 'job-missing-git', status: 'queued', createdAt: new Date(), resultDir: path.join(resultsDir, 'job-missing-git'), requestId: runRequest.requestId, correlationId: runRequest.correlationId, request: runRequest }));
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);
    try {
      const preflight = await fetch(`http://127.0.0.1:${port}/api/preflight`, { headers: { Authorization: 'Bearer test-key' } });
      const body = (await preflight.json()) as any;
      const freshnessCheck = body.checks.find((check: any) => check.name === 'checkout-freshness');
      expect(freshnessCheck.detail).toContain('is not a git checkout');
      expect(freshnessCheck.ok).toBe(true);
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('uses template metadata gitRef as informational fallback when rev-parse fails', async () => {
    writeTemplateMetadata(['auto', 'none', 'branch', 'pr', 'draft_pr'], 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    writeRunKasekiDoctor(0, 'doctor ok');
    git(['init', '--initial-branch=main'], checkoutDir);
    git(['config', 'user.email', 'test@example.com'], checkoutDir);
    git(['config', 'user.name', 'Test User'], checkoutDir);
    fs.writeFileSync(path.join(checkoutDir, 'README.md'), 'x\n');
    git(['add', 'README.md'], checkoutDir);
    git(['commit', '-m', 'init'], checkoutDir);
    fs.chmodSync(path.join(checkoutDir, '.git', 'HEAD'), 0o000);
    const scheduler = createMockScheduler();
    scheduler.submitJob.mockImplementation((runRequest: any) => ({ id: 'job-fallback', status: 'queued', createdAt: new Date(), resultDir: path.join(resultsDir, 'job-fallback'), requestId: runRequest.requestId, correlationId: runRequest.correlationId, request: runRequest }));
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://github.com/org/repo', publishMode: 'pr' }),
      });
      expect(response.status).toBe(202);
      expect(scheduler.submitJob).toHaveBeenCalled();
    } finally {
      fs.chmodSync(path.join(checkoutDir, '.git', 'HEAD'), 0o644);
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('degrades freshness to warning when enforcement does not apply', async () => {
    writeRunKasekiDoctor(0, 'doctor ok');
    git(['init', '--initial-branch=main'], checkoutDir);
    git(['config', 'user.email', 'test@example.com'], checkoutDir);
    git(['config', 'user.name', 'Test User'], checkoutDir);
    fs.writeFileSync(path.join(checkoutDir, 'README.md'), 'x\n');
    git(['add', 'README.md'], checkoutDir);
    git(['commit', '-m', 'init'], checkoutDir);
    fs.chmodSync(path.join(checkoutDir, '.git', 'HEAD'), 0o000);
    const scheduler = createMockScheduler();
    scheduler.submitJob.mockImplementation((runRequest: any) => ({ id: 'job-non-enforced', status: 'queued', createdAt: new Date(), resultDir: path.join(resultsDir, 'job-non-enforced'), requestId: runRequest.requestId, correlationId: runRequest.correlationId, request: runRequest }));
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://github.com/org/repo', publishMode: 'none' }),
      });
      expect(response.status).toBe(202);
      expect(scheduler.submitJob).toHaveBeenCalled();
    } finally {
      fs.chmodSync(path.join(checkoutDir, '.git', 'HEAD'), 0o644);
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('rejects PR run submission before startup when template metadata lacks pr', async () => {
    writeTemplateMetadata(['auto', 'none', 'branch']);
    writeRunKasekiDoctor(0, 'doctor ok');
    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://github.com/org/repo', publishMode: 'pr' }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as any;
      expect(body.detail).toBe('Template does not support publish mode `pr`; redeploy kaseki-agent.');
      expect(body.templateMetadataPath).toBe(path.join(templateDir, '.kaseki-template-version'));
      expect(body.supportedPublishModes).toEqual(['auto', 'none', 'branch']);
      expect(scheduler.submitJob).not.toHaveBeenCalled();
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('rejects run submission when run-kaseki.sh is missing', async () => {
    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://github.com/org/repo', publishMode: 'auto' }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as any;
      expect(body.templatePath).toBe(templateDir);
      expect(body.detail).toContain('Missing template runner');
      expect(body.remediation).toBe('Run scripts/kaseki-activate.sh --controller bootstrap.');
      expect(scheduler.submitJob).not.toHaveBeenCalled();
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('rejects run submission when existing template doctor fails', async () => {
    writeRunKasekiDoctor(42, 'doctor failed because template dependency is missing');
    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://github.com/org/repo', publishMode: 'auto' }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as any;
      expect(body.templatePath).toBe(templateDir);
      expect(body.doctorCommand).toContain(path.join(templateDir, 'run-kaseki.sh'));
      expect(body.doctorStderrTail).toContain('template dependency is missing');
      expect(body.remediation).toBe('Run scripts/kaseki-activate.sh --controller bootstrap.');
      expect(scheduler.submitJob).not.toHaveBeenCalled();
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('accepts run submission when template doctor passes', async () => {
    writeRunKasekiDoctor(0, 'doctor ok');
    const scheduler = createMockScheduler();
    scheduler.submitJob.mockImplementation((runRequest: any) => ({
      id: 'job-template-healthy',
      status: 'queued',
      createdAt: new Date(),
      resultDir: path.join(resultsDir, 'job-template-healthy'),
      requestId: runRequest.requestId,
      correlationId: runRequest.correlationId,
      request: runRequest,
    }));
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://github.com/org/repo', publishMode: 'auto' }),
      });

      expect(response.status).toBe(202);
      expect(scheduler.submitJob).toHaveBeenCalledWith(expect.objectContaining({
        repoUrl: 'https://github.com/org/repo',
        publishMode: 'auto',
      }));
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });
});

describe('kaseki-api-routes idempotency concurrency', () => {
  let resultsDir: string;

  beforeEach(() => {
    resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-routes-idem-test-'));
  });

  afterEach(() => {
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  test('parallel requests with same idempotency key create exactly one job', async () => {
    let submitted = 0;
    const submitJob = jest.fn((runRequest: any) => {
      submitted += 1;
      return {
        id: `job-${submitted}`,
        status: 'queued',
        createdAt: new Date(),
        resultDir: path.join(resultsDir, `job-${submitted}`),
        requestId: runRequest.requestId,
        correlationId: runRequest.correlationId,
      };
    });

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 0, maxConcurrent: 1 }),
      getJob: jest.fn(),
      submitJob,
      listJobs: () => [],
      cancelJob: jest.fn(),
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const,
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));

    const { server, port } = await listenTestApp(app);
    const headers = { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' };
    const body = {
      repoUrl: 'https://github.com/example/repo',
      ref: 'main',
      issueNumber: 123,
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    };

    try {
      const requests = Array.from({ length: 8 }, () =>
        fetch(`http://127.0.0.1:${port}/api/runs`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        })
      );
      const responses = await Promise.all(requests);
      const payloads = await Promise.all(responses.map((r) => r.json() as Promise<any>));

      expect(submitJob).toHaveBeenCalledTimes(1);
      expect(responses.every((r) => r.status === 200 || r.status === 202)).toBe(true);
      expect(new Set(payloads.map((p) => p.id)).size).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('health endpoint remains responsive while run submission is contended', async () => {
    let resolveSubmission: any;
    const submissionGate = new Promise<any>((resolve) => {
      resolveSubmission = resolve;
    });

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 0, maxConcurrent: 1 }),
      getJob: jest.fn(),
      submitJob: jest.fn(async () => submissionGate),
      listJobs: () => [],
      cancelJob: jest.fn(),
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const,
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));

    const { server, port } = await listenTestApp(app);

    try {
      const runPromise = fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://github.com/example/repo', ref: 'main' }),
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(healthResponse.status).toBe(200);
      const healthBody = (await healthResponse.json()) as any;
      expect(healthBody.status).toBeDefined();

      if (resolveSubmission) resolveSubmission({
        id: 'job-1',
        status: 'queued',
        createdAt: new Date(),
        resultDir: path.join(resultsDir, 'job-1'),
        requestId: 'req-1',
        correlationId: 'corr-1',
      });

      const runResponse = await runPromise;
      expect(runResponse.status).toBe(202);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

});

describe('kaseki-api-routes timeoutSeconds validation', () => {
  let resultsDir: string;

  beforeEach(() => {
    resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-routes-timeout-test-'));
  });

  afterEach(() => {
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  test('rejects invalid timeoutSeconds with 400', async () => {
    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoUrl: 'https://github.com/example/repo',
          ref: 'main',
          timeoutSeconds: 10,
        }),
      });
      expect(response.status).toBe(400);
      const payload = (await response.json()) as any;
      expect(payload.detail).toMatch(/timeoutSeconds/);
      expect(scheduler.submitJob).not.toHaveBeenCalled();
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });
});

describe('kaseki-api-routes publish mode validation', () => {
  let resultsDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-routes-publish-test-'));
  });

  afterEach(() => {
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  test('accepts auto publish mode without requiring GitHub App credentials', async () => {
    const { readHostSecret } = jest.mocked(hostSecretsReader);
    (readHostSecret as jest.Mock).mockReset();
    (readHostSecret as jest.Mock).mockReturnValue(null);

    const scheduler = createMockScheduler();
    scheduler.submitJob.mockImplementation((runRequest: any) => ({
      id: 'job-auto-publish',
      status: 'queued',
      createdAt: new Date(),
      resultDir: path.join(resultsDir, 'job-auto-publish'),
      requestId: runRequest.requestId,
      correlationId: runRequest.correlationId,
      request: runRequest,
    }));
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repoUrl: 'https://github.com/org/repo',
          publishMode: 'auto',
        }),
      });

      expect(response.status).toBe(202);
      expect(scheduler.submitJob).toHaveBeenCalledWith(expect.objectContaining({
        repoUrl: 'https://github.com/org/repo',
        publishMode: 'auto',
      }));
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('resolves omitted publish mode to normal PR when GitHub App credentials are configured', async () => {
    const scheduler = createMockScheduler();
    scheduler.submitJob.mockImplementation((runRequest: any) => ({
      id: 'job-default-pr-publish',
      status: 'queued',
      createdAt: new Date(),
      resultDir: path.join(resultsDir, 'job-default-pr-publish'),
      requestId: runRequest.requestId,
      correlationId: runRequest.correlationId,
      request: runRequest,
    }));
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repoUrl: 'https://github.com/org/repo',
        }),
      });

      expect(response.status).toBe(202);
      expect(scheduler.submitJob).toHaveBeenCalledWith(expect.objectContaining({
        repoUrl: 'https://github.com/org/repo',
        publishMode: 'pr',
      }));
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('rejects omitted publish mode as normal PR when GitHub App credentials are not configured', async () => {
    const { readHostSecret } = jest.mocked(hostSecretsReader);
    // Ensure mock returns null for all GitHub App secrets
    (readHostSecret as jest.Mock).mockReset();
    (readHostSecret as jest.Mock).mockReturnValue(null);

    const previousEnv = {
      GITHUB_APP_ID: process.env.GITHUB_APP_ID,
      GITHUB_APP_ID_FILE: process.env.GITHUB_APP_ID_FILE,
      GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID,
      GITHUB_APP_CLIENT_ID_FILE: process.env.GITHUB_APP_CLIENT_ID_FILE,
      GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
      GITHUB_APP_PRIVATE_KEY_FILE: process.env.GITHUB_APP_PRIVATE_KEY_FILE,
    };
    for (const key of Object.keys(previousEnv)) {
      delete process.env[key];
    }

    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repoUrl: 'https://github.com/org/repo',
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as any;
      expect(body.detail).toContain('publishMode=pr requires readable GitHub App credentials');
      expect(scheduler.submitJob).not.toHaveBeenCalled();
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  test('rejects normal PR publishing when GitHub App credentials are not configured', async () => {
    const { readHostSecret } = jest.mocked(hostSecretsReader);
    // Ensure mock returns null for all GitHub App secrets
    (readHostSecret as jest.Mock).mockReset();
    (readHostSecret as jest.Mock).mockReturnValue(null);

    const previousEnv = {
      GITHUB_APP_ID: process.env.GITHUB_APP_ID,
      GITHUB_APP_ID_FILE: process.env.GITHUB_APP_ID_FILE,
      GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID,
      GITHUB_APP_CLIENT_ID_FILE: process.env.GITHUB_APP_CLIENT_ID_FILE,
      GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
      GITHUB_APP_PRIVATE_KEY_FILE: process.env.GITHUB_APP_PRIVATE_KEY_FILE,
    };
    for (const key of Object.keys(previousEnv)) {
      delete process.env[key];
    }

    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repoUrl: 'https://github.com/org/repo',
          publishMode: 'pr',
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as any;
      expect(body.detail).toContain('publishMode=pr requires readable GitHub App credentials');
      expect(scheduler.submitJob).not.toHaveBeenCalled();
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  test('rejects draft PR publishing when GitHub App credentials are not configured', async () => {
    const { readHostSecret } = jest.mocked(hostSecretsReader);
    // Ensure mock returns null for all GitHub App secrets
    (readHostSecret as jest.Mock).mockReset();
    (readHostSecret as jest.Mock).mockReturnValue(null);

    const previousEnv = {
      GITHUB_APP_ID: process.env.GITHUB_APP_ID,
      GITHUB_APP_ID_FILE: process.env.GITHUB_APP_ID_FILE,
      GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID,
      GITHUB_APP_CLIENT_ID_FILE: process.env.GITHUB_APP_CLIENT_ID_FILE,
      GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
      GITHUB_APP_PRIVATE_KEY_FILE: process.env.GITHUB_APP_PRIVATE_KEY_FILE,
    };
    for (const key of Object.keys(previousEnv)) {
      delete process.env[key];
    }

    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repoUrl: 'https://github.com/org/repo',
          publishMode: 'draft_pr',
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as any;
      expect(body.detail).toContain('publishMode=draft_pr requires readable GitHub App credentials');
      expect(scheduler.submitJob).not.toHaveBeenCalled();
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});

describe('artifact content cache configuration in routes', () => {
  let resultsDir: string;

  beforeEach(() => {
    resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-routes-artifact-cache-test-'));
  });

  afterEach(() => {
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  test('uses the injected artifact cache and exposes its stats on metrics', async () => {
    const jobId = 'kaseki-artifact-cache-stats';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'result-summary.md'), 'cached summary');

    const scheduler = createMockScheduler({
      [jobId]: {
        id: jobId,
        status: 'completed',
        createdAt: new Date(),
        resultDir: jobDir,
      },
    });
    const config = {
      ...createTestConfig(resultsDir),
      artifactCacheMaxEntries: 1,
      artifactCacheTtlMs: 60_000,
      artifactCacheMaxFileBytes: 1024,
    };
    const artifactCache = new ResultCache({
      maxEntries: config.artifactCacheMaxEntries,
      ttlMs: config.artifactCacheTtlMs,
      maxFileBytes: config.artifactCacheMaxFileBytes,
    });
    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler as any, config, idempotencyStore, preFlightValidator, artifactCache));
    const { server, port } = await listenTestApp(app);
    const headers = { Authorization: 'Bearer test-key' };

    try {
      const first = await fetch(`http://127.0.0.1:${port}/api/results/${jobId}/result-summary.md`, { headers });
      expect(first.status).toBe(200);
      const second = await fetch(`http://127.0.0.1:${port}/api/results/${jobId}/result-summary.md`, { headers });
      expect(second.status).toBe(200);

      const metrics = await fetch(`http://127.0.0.1:${port}/api/metrics`, { headers });
      expect(metrics.status).toBe(200);
      const body = await metrics.text();
      expect(body).toContain('kaseki_artifact_cache_entries 1');
      expect(body).toContain('kaseki_artifact_cache_hits_total 1');
      expect(body).toContain('kaseki_artifact_cache_misses_total 1');
      expect(body).toContain('kaseki_artifact_cache_max_entries 1');
      expect(body).toContain('kaseki_artifact_cache_max_file_bytes 1024');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('honors configured max file bytes passed through artifact routes', async () => {
    const jobId = 'kaseki-artifact-cache-size-limit';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'result-summary.md'), 'too large for cache');

    const scheduler = createMockScheduler({
      [jobId]: {
        id: jobId,
        status: 'completed',
        createdAt: new Date(),
        resultDir: jobDir,
      },
    });
    const config = {
      ...createTestConfig(resultsDir),
      artifactCacheMaxEntries: 3,
      artifactCacheTtlMs: 60_000,
      artifactCacheMaxFileBytes: 4,
    };
    const artifactCache = new ResultCache({
      maxEntries: config.artifactCacheMaxEntries,
      ttlMs: config.artifactCacheTtlMs,
      maxFileBytes: config.artifactCacheMaxFileBytes,
    });
    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler as any, config, idempotencyStore, preFlightValidator, artifactCache));
    const { server, port } = await listenTestApp(app);
    const headers = { Authorization: 'Bearer test-key' };

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/results/${jobId}/result-summary.md`, { headers });
      expect(response.status).toBe(200);
      expect(artifactCache.getStats()).toMatchObject({ entries: 0, misses: 1, maxFileBytes: 4 });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });
});
