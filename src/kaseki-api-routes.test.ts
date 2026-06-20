// Mock Docker subprocess helpers so preflight route tests can assert generated Docker args deterministically.
jest.mock('./lib/subprocess-helpers', () => {
  const actual = jest.requireActual('./lib/subprocess-helpers');
  return {
    ...actual,
    execDockerCommand: jest.fn()
  };
});

// Mock the host-secrets-reader module
jest.mock('./secrets/host-secrets-reader', () => ({
  readHostSecret: jest.fn(),
  resolveHostSecretPath: jest.fn((name) => `/agents/secrets/${name}`),
  getSecretLocations: jest.fn((name) => ({
    primary: `/agents/secrets/${name}`,
    secondary: `/home/user/secrets/${name}`
  })),
  clearSecretCache: jest.fn()
}));

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import { execFileSync } from 'child_process';
import express, { Express } from 'express';
import { AddressInfo, Server } from 'net';
import { TextDecoder } from 'util';
import * as hostSecretsReader from './secrets/host-secrets-reader';
import * as subprocessHelpers from './lib/subprocess-helpers';
import { classifyDockerFailure, decodeUtf8TailSafely, tailLogByLines } from './kaseki-api-routes';
import { readArtifactContent } from './routes/artifact-routes';
import { ResultCache } from './result-cache';
import { validateGitHubAppPrivateKey } from './github-app-private-key';
import { createApiRouter } from './kaseki-api-routes';
import { clearContainerPreflightResults, logContainerPreflightResults } from './startup/container-preflight';
import { clearCachedStartupHealthReport, writeStartupHealthArtifacts } from './kaseki-api/startup-summary-artifact';
import type { StartupHealthReport } from './kaseki-api-types';
import { IdempotencyStore } from './idempotency-store';
import { PreFlightValidator } from './pre-flight-validator';
import { createMockScheduler, createTestConfig, type TestScheduler } from './test-utils';

const { privateKey: defaultGithubPrivateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const defaultGithubPrivateKeyPem = defaultGithubPrivateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const execDockerCommandMock = jest.mocked(subprocessHelpers.execDockerCommand);

function mockSuccessfulDockerCommands(): void {
  execDockerCommandMock.mockImplementation((args: string[]) => ({
    ok: true,
    stdout: args[0] === 'version' ? '24.0.0 -> 24.0.0' : undefined
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
  config: ReturnType<typeof createTestConfig>
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
    preFlightValidator
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

/**
 * Drain a fetch response body to ensure the HTTP connection is properly released.
 * This is critical to prevent connection pool exhaustion and hanging processes.
 *
 * @param response The fetch Response object
 * @returns A new Response object with the body already consumed
 */
async function drainResponseBody(response: Response): Promise<Response> {
  // Consume the response body to release the socket back to the connection pool
  // This is necessary because if you don't read the response body,
  // Node.js keeps the socket open in the HTTP agent's connection pool,
  // which can prevent the process from exiting.
  const buffer = await response.arrayBuffer();

  // Return a new Response object with a fresh body so callers can still use
  // .json(), .text(), etc. if needed
  return new Response(buffer, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
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
      expected: ''
    },
    {
      name: 'exact boundary',
      content: 'a\nb\nc',
      lineCount: 3,
      expected: 'a\nb\nc'
    },
    {
      name: 'over-requested lines',
      content: 'a\nb\nc',
      lineCount: 10,
      expected: 'a\nb\nc'
    },
    {
      name: 'CRLF input',
      content: 'a\r\nb\r\nc\r\nd',
      lineCount: 2,
      expected: 'c\nd'
    },
    {
      name: 'trailing newline handling',
      content: 'a\nb\nc\n',
      lineCount: 2,
      expected: 'c\n'
    }
  ])('tailLogByLines handles $name', ({ content, lineCount, expected }) => {
    expect(tailLogByLines(content, lineCount)).toBe(expected);
  });
});

describe('kaseki-api-routes improvements aggregation', () => {
  let resultsDir: string;

  beforeEach(() => {
    resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-improvements-test-'));
  });

  afterEach(() => {
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  test('GET /api/improvements aggregates recent run evaluation artifacts and tolerates missing/invalid evaluations', async () => {
    const jobA = {
      id: 'kaseki-101',
      status: 'completed' as const,
      createdAt: new Date('2026-05-25T10:00:00.000Z'),
      resultDir: path.join(resultsDir, 'kaseki-101'),
      request: { repoUrl: 'https://github.com/org/repo-a', ref: 'main' }
    };
    const jobB = {
      id: 'kaseki-100',
      status: 'failed' as const,
      createdAt: new Date('2026-05-25T09:00:00.000Z'),
      resultDir: path.join(resultsDir, 'kaseki-100'),
      request: { repoUrl: 'https://github.com/org/repo-b', ref: 'main' }
    };
    const jobC = {
      id: 'kaseki-99',
      status: 'completed' as const,
      createdAt: new Date('2026-05-25T08:00:00.000Z'),
      resultDir: path.join(resultsDir, 'kaseki-99'),
      request: { repoUrl: 'https://github.com/org/repo-c', ref: 'main' }
    };
    for (const job of [jobA, jobB, jobC]) fs.mkdirSync(job.resultDir, { recursive: true });
    fs.writeFileSync(
      path.join(jobA.resultDir, 'metadata.json'),
      JSON.stringify({
        repo_url: 'https://github.com/org/repo-a',
        duration_seconds: 120,
        github_pr_url: 'https://github.com/org/repo-a/pull/1'
      })
    );
    fs.writeFileSync(path.join(jobA.resultDir, 'stage-timings.tsv'), 'validation\t0\t30\t\nrun evaluation\t0\t5\t\n');
    fs.writeFileSync(
      path.join(jobA.resultDir, 'run-evaluation.json'),
      JSON.stringify({
        overall_assessment: 'good',
        reviewer_confidence: 'high',
        task_completion_score: 4,
        human_review_focus: ['Review auth copy'],
        kaseki_improvement_opportunities: [
          { category: 'validation', priority: 'medium', suggestion: 'Avoid repeated validation commands.' }
        ]
      })
    );
    fs.writeFileSync(path.join(jobB.resultDir, 'run-evaluation.json'), '{not-json');

    const scheduler = createMockScheduler({
      [jobA.id]: jobA as any,
      [jobB.id]: jobB as any,
      [jobC.id]: jobC as any
    });
    scheduler.listJobs.mockReturnValue([jobA, jobB, jobC]);
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/improvements?limit=3`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      const body = (await response.json()) as any;

      expect(response.status).toBe(200);
      expect(body.evaluator).toEqual({ available: 1, missing: 1, invalid: 1 });
      expect(body.counts.byAssessment.good).toBe(1);
      expect(body.counts.byConfidence.high).toBe(1);
      expect(body.topImprovementOpportunities[0]).toMatchObject({
        category: 'validation',
        priority: 'medium',
        count: 1
      });
      expect(body.slowestStages[0]).toMatchObject({ stage: 'validation', averageSeconds: 30 });
      expect(body.runs[0]).toMatchObject({
        id: 'kaseki-101',
        assessment: 'good',
        confidence: 'high',
        taskCompletionScore: 4,
        topReviewFocus: 'Review auth copy',
        topImprovement: 'Avoid repeated validation commands.',
        prUrl: 'https://github.com/org/repo-a/pull/1'
      });
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
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

describe('kaseki-api-routes startup health content negotiation', () => {
  let resultsDir: string;

  const report: StartupHealthReport = {
    timestamp: '2026-06-13T00:00:00.000Z',
    status: 'ok',
    summary: { passed: 1, warnings: 0, blocking: 0 },
    timing: { bootstrapMs: 100, preflightMs: 50, totalMs: 150 },
    components: {
      api: { name: 'api', durationMs: 100, status: 'ok' }
    },
    preflight: {
      docker: { ok: true, detail: 'Docker available' }
    },
    issues: []
  };

  beforeEach(() => {
    resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-startup-health-test-'));
    clearCachedStartupHealthReport();
  });

  afterEach(() => {
    clearCachedStartupHealthReport();
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  test('GET /api/startup-health returns JSON by default', async () => {
    writeStartupHealthArtifacts(resultsDir, report);
    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/startup-health`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      const body = (await res.json()) as StartupHealthReport;
      expect(body.status).toBe('ok');
      expect(body).toMatchObject({
        scope: 'startup',
        current: false,
        recommendedCurrentEndpoint: '/api/preflight',
      });
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('GET /api/startup-health returns markdown for Accept: text/markdown', async () => {
    writeStartupHealthArtifacts(resultsDir, report);
    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/startup-health`, {
        headers: { Authorization: 'Bearer test-key', Accept: 'text/markdown' }
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/markdown');
      expect(await res.text()).toContain('# Startup Health Report');
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('GET /api/startup-health returns markdown for format=markdown', async () => {
    writeStartupHealthArtifacts(resultsDir, report);
    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/startup-health?format=markdown`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/markdown');
      expect(await res.text()).toContain('# Startup Health Report');
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('GET /api/startup-health/markdown is removed', async () => {
    writeStartupHealthArtifacts(resultsDir, report);
    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/startup-health/markdown`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(res.status).toBe(404);
      // Drain response body to release HTTP connection
      await drainResponseBody(res);
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
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
      // Drain response body to release HTTP connection
      await drainResponseBody(res);
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
        configurable: true
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
    const dependencyMetricsFile = path.join(resultsDir, 'dependency-cache.metrics');
    fs.writeFileSync(
      dependencyMetricsFile,
      'size_bytes=4096\nentry_count=2\nmax_bytes=8192\nmax_age_days=7\n',
      'utf-8'
    );
    const config = {
      ...createTestConfig(resultsDir),
      dependencyCacheMetricsFile: dependencyMetricsFile,
      dependencyCacheMaxBytes: 8192,
      dependencyCacheMaxAgeDays: 7
    };
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/metrics`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/plain');
      const body = await res.text();
      expect(body).toContain('kaseki_queue_pending');
      expect(body).toContain('kaseki_runs_total');
      expect(body).toContain('kaseki_run_duration_seconds');
      expect(body).toContain('kaseki_dependency_cache_bytes 4096');
      expect(body).toContain('kaseki_dependency_cache_entries 2');
      expect(body).toContain('kaseki_dependency_cache_config_max_bytes 8192');
      expect(body).toContain('kaseki_dependency_cache_config_max_age_days 7');
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
      estimatedDurationSeconds: 60
    });

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/validate`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_url: 'https://github.com/org/repo',
          git_ref: 'main',
          task_prompt: 'Run a first-time setup validation smoke test'
        })
      });

      expect(res.status).toBe(200);
      // Drain response body to release HTTP connection
      await drainResponseBody(res);
      expect(preFlightValidator.validate).toHaveBeenCalledWith(
        expect.objectContaining({
          repoUrl: 'https://github.com/org/repo',
          ref: 'main',
          taskPrompt: 'Run a first-time setup validation smoke test'
        })
      );
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
      resultDir: path.join(resultsDir, 'kaseki-alias')
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
          publish_mode: 'none'
        })
      });

      const body = (await res.json()) as any;
      if (res.status !== 202) {
        throw new Error(`Expected 202, got ${res.status}: ${JSON.stringify(body)}`);
      }
      expect(scheduler.submitJob).toHaveBeenCalledWith(
        expect.objectContaining({
          repoUrl: 'https://github.com/org/repo',
          ref: 'main',
          taskPrompt: 'Run a first-time setup task smoke test',
          publishMode: 'none'
        })
      );
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
        body: JSON.stringify({ repoUrl: 'https://github.com/org/repo' })
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

  test('POST /api/runs admits inspect runs with goal check disabled by default', async () => {
    process.env.KASEKI_SKIP_BOOTSTRAP_CHECK = '1';
    const scheduler = createMockScheduler();
    scheduler.submitJob.mockImplementation(async (request) => ({
      id: 'kaseki-1',
      status: 'queued',
      createdAt: new Date(),
      request,
      resultDir: path.join(resultsDir, 'kaseki-1')
    }));
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
        body: JSON.stringify({
          repoUrl: 'https://github.com/org/repo',
          taskPrompt: 'Inspect this repository and report findings only.',
          taskMode: 'inspect',
          publishMode: 'none'
        })
      });

      const body = (await res.json()) as any;
      expect(body.id).toBe('kaseki-1');
      expect(res.status).toBe(202);
      expect(scheduler.submitJob).toHaveBeenCalledWith(
        expect.objectContaining({
          taskMode: 'inspect',
          publishMode: 'none',
          goalCheck: { enabled: false }
        })
      );
    } finally {
      await cleanupTestApp(server, idempotencyStore);
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
    'KASEKI_PROVIDER',
    'LLM_GATEWAY_URL',
    'LLM_GATEWAY_API_KEY',
    'LLM_GATEWAY_API_KEY_FILE',
    'KASEKI_SECRETS_DIR'
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
    clearContainerPreflightResults();
  });

  afterEach(() => {
    clearContainerPreflightResults();
  });

  function writePreflightTemplateFixture(
    root: string,
    activatorContent = '#!/usr/bin/env bash\n'
  ): { templateDir: string; checkoutDir: string } {
    const templateDir = path.join(root, 'template');
    const checkoutDir = path.join(root, 'checkout');
    const requiredFiles = [
      'run-kaseki.sh',
      'kaseki-agent.sh',
      'scripts/kaseki-activate.sh',
      'scripts/kaseki-preflight.sh',
      'lib/pi-event-filter.js',
      'lib/pi-progress-stream.js',
      'lib/kaseki-report.js',
      'lib/github-app-token.js',
      'lib/github-app-private-key.js',
      'lib/github-utils.js',
      'lib/logger.js',
      'lib/secrets/host-secrets-reader.js'
    ];

    for (const dir of [templateDir, checkoutDir]) {
      fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'lib', 'secrets'), { recursive: true });
    }

    for (const fileName of requiredFiles) {
      fs.writeFileSync(path.join(templateDir, fileName), 'export {};\n');
    }

    fs.writeFileSync(
      path.join(templateDir, 'run-kaseki.sh'),
      '#!/usr/bin/env bash\nif [[ "$1" == "--doctor" ]]; then exit 0; fi\nexit 0\n'
    );
    fs.writeFileSync(path.join(templateDir, 'scripts', 'kaseki-activate.sh'), activatorContent);
    fs.writeFileSync(path.join(checkoutDir, 'scripts', 'kaseki-activate.sh'), activatorContent);
    return { templateDir, checkoutDir };
  }

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

  test('GET /api/preflight labels cached startup diagnostics as historical only', async () => {
    const startupTimestamp = '2026-01-02T03:04:05.000Z';
    jest.useFakeTimers().setSystemTime(new Date(startupTimestamp));
    logContainerPreflightResults([
      {
        name: 'setup-completeness',
        ok: false,
        detail: 'Missing directories observed during container startup',
        remediation: 'Run: sudo kaseki-agent host setup --fix'
      }
    ]);
    jest.useRealTimers();

    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-startup-'));
    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/preflight`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      const body = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(body.status).not.toBe('error');
      expect(body.checks.map((check: any) => check.name)).not.toContain('setup-completeness');
      expect(body.containerStartup).toEqual(
        expect.objectContaining({
          scope: 'startup',
          readinessImpact: 'excluded-from-current-readiness',
          current: false,
          recommendedCurrentEndpoint: '/api/preflight',
          timestamp: startupTimestamp,
          cachedAt: startupTimestamp
        })
      );
      expect(body.containerStartup.checks).toEqual([
        expect.objectContaining({
          name: 'setup-completeness',
          ok: false
        })
      ]);
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('GET /api/preflight includes server-side check summary fields', async () => {
    const root = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-summary-'));
    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-summary-results-'));
    const { templateDir, checkoutDir } = writePreflightTemplateFixture(root);
    const envSnapshot = { ...process.env };

    try {
      process.env.KASEKI_TEMPLATE_DIR = templateDir;
      process.env.KASEKI_CHECKOUT_DIR = checkoutDir;
      execDockerCommandMock.mockImplementation((args: string[]) => ({
        ok: args[0] === 'version',
        stdout: args[0] === 'version' ? '24.0.0 -> 24.0.0' : '',
        classification: { detail: 'image missing', remediation: 'pull image' }
      }));
      const scheduler = createMockScheduler({});
      const config = createTestConfig(resultsDir);
      const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/preflight`, {
          headers: { Authorization: 'Bearer test-key' }
        });
        const body = (await res.json()) as any;
        expect(body.checkCount).toBe(body.checks.length);
        expect(body.failedChecks).toEqual(body.checks.filter((check: any) => !check.ok));
        expect(body.failedChecks.length).toBeGreaterThan(0);
      } finally {
        await cleanupTestApp(server, idempotencyStore);
      }
    } finally {
      process.env = envSnapshot;
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('GET /api/preflight reports Gateway Test and preflight secret consistency', async () => {
    const { readHostSecret } = jest.mocked(hostSecretsReader);
    (readHostSecret as jest.Mock).mockImplementation((name: string) => {
      if (name === 'llm_gateway_api_key') return 'test-gateway-key';
      if (name === 'github_app_id') return '12345';
      if (name === 'github_app_client_id') return 'Iv123client';
      if (name === 'github_app_private_key') return defaultGithubPrivateKeyPem;
      return null;
    });

    const root = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-gateway-consistency-'));
    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-gateway-consistency-results-'));
    const { templateDir, checkoutDir } = writePreflightTemplateFixture(root);
    const envSnapshot = { ...process.env };

    try {
      process.env.KASEKI_TEMPLATE_DIR = templateDir;
      process.env.KASEKI_CHECKOUT_DIR = checkoutDir;
      process.env.KASEKI_PROVIDER = 'gateway';
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1/responses';

      const scheduler = createMockScheduler({});
      const config = createTestConfig(resultsDir);
      const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/preflight`, {
          headers: { Authorization: 'Bearer test-key' }
        });
        const body = (await res.json()) as any;
        const consistencyCheck = body.checks.find((check: any) => check.name === 'gateway-api-secret-consistency');
        expect(consistencyCheck).toEqual(
          expect.objectContaining({
            ok: true,
            detail: expect.stringContaining('Gateway Test and preflight can both resolve')
          })
        );
        expect(JSON.stringify(consistencyCheck)).not.toContain('test-gateway-key');
      } finally {
        await cleanupTestApp(server, idempotencyStore);
      }
    } finally {
      process.env = envSnapshot;
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('GET /api/preflight reports worker gateway launch config missing when API gateway test uses inline key only', async () => {
    const { readHostSecret, resolveHostSecretPath } = jest.mocked(hostSecretsReader);
    (readHostSecret as jest.Mock).mockImplementation((name: string) => {
      if (name === 'github_app_id') return '12345';
      if (name === 'github_app_client_id') return 'Iv123client';
      if (name === 'github_app_private_key') return defaultGithubPrivateKeyPem;
      return null;
    });
    // Return null so the code falls through to the KASEKI_SECRETS_DIR/path.join logic,
    // then set KASEKI_SECRETS_DIR to a non-existent path so the final hostSecretPath doesn't exist
    (resolveHostSecretPath as jest.Mock).mockReturnValue(null);

    const root = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-worker-gateway-'));
    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-worker-gateway-results-'));
    const { templateDir, checkoutDir } = writePreflightTemplateFixture(root);
    const envSnapshot = { ...process.env };

    try {
      process.env.KASEKI_TEMPLATE_DIR = templateDir;
      process.env.KASEKI_CHECKOUT_DIR = checkoutDir;
      process.env.KASEKI_PROVIDER = 'gateway';
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1/responses';
      process.env.LLM_GATEWAY_API_KEY = 'inline-api-gateway-test-key';
      delete process.env.LLM_GATEWAY_API_KEY_FILE;
      // Set to a non-existent path so the gateway secret file path doesn't exist
      process.env.KASEKI_SECRETS_DIR = '/tmp/kaseki-nonexistent-secrets-' + Math.random().toString(36).substring(7);

      const scheduler = createMockScheduler({});
      const config = createTestConfig(resultsDir);
      const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/preflight`, {
          headers: { Authorization: 'Bearer test-key' }
        });
        const body = (await res.json()) as any;
        const consistencyCheck = body.checks.find((check: any) => check.name === 'gateway-api-secret-consistency');
        const workerGatewayCheck = body.checks.find((check: any) => check.name === 'worker-gateway-secret-mount');

        expect(consistencyCheck).toEqual(
          expect.objectContaining({
            ok: false,
            detail: expect.stringContaining('gatewayTest=env')
          })
        );
        expect(workerGatewayCheck).toEqual(
          expect.objectContaining({
            ok: false,
            detail: expect.stringContaining('readable worker-mounted llm_gateway_api_key host path'),
            remediation: expect.stringContaining('Gateway test passed for the API container')
          })
        );
        expect(workerGatewayCheck.remediation).toContain('worker containers also require LLM_GATEWAY_URL, a mounted llm_gateway_api_key');
        expect(JSON.stringify(workerGatewayCheck)).not.toContain('inline-api-gateway-test-key');
      } finally {
        await cleanupTestApp(server, idempotencyStore);
      }
    } finally {
      process.env = envSnapshot;
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('GET /api/preflight reports template activator parity when checkout and template match', async () => {
    const originalTemplateDir = process.env.KASEKI_TEMPLATE_DIR;
    const originalCheckoutDir = process.env.KASEKI_CHECKOUT_DIR;
    const root = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-parity-ok-'));
    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-parity-results-'));
    const { templateDir, checkoutDir } = writePreflightTemplateFixture(root);
    process.env.KASEKI_TEMPLATE_DIR = templateDir;
    process.env.KASEKI_CHECKOUT_DIR = checkoutDir;

    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/preflight`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      const body = (await res.json()) as any;
      const parity = body.checks.find((check: any) => check.name === 'template-activator-parity');

      expect(res.status).toBe(200);
      expect(parity).toEqual(
        expect.objectContaining({
          ok: true,
          detail: 'Template activator matches checkout activator.'
        })
      );
      expect(parity.checksum).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      if (originalTemplateDir === undefined) delete process.env.KASEKI_TEMPLATE_DIR;
      else process.env.KASEKI_TEMPLATE_DIR = originalTemplateDir;
      if (originalCheckoutDir === undefined) delete process.env.KASEKI_CHECKOUT_DIR;
      else process.env.KASEKI_CHECKOUT_DIR = originalCheckoutDir;
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('GET /api/preflight degrades when deployed template activator drifts from checkout', async () => {
    const originalTemplateDir = process.env.KASEKI_TEMPLATE_DIR;
    const originalCheckoutDir = process.env.KASEKI_CHECKOUT_DIR;
    const root = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-parity-drift-'));
    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-parity-results-'));
    const { templateDir, checkoutDir } = writePreflightTemplateFixture(root, '#!/usr/bin/env bash\necho checkout\n');
    fs.writeFileSync(
      path.join(templateDir, 'scripts', 'kaseki-activate.sh'),
      '#!/usr/bin/env bash\necho stale-template\n'
    );
    process.env.KASEKI_TEMPLATE_DIR = templateDir;
    process.env.KASEKI_CHECKOUT_DIR = checkoutDir;

    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/preflight`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      const body = (await res.json()) as any;
      const parity = body.checks.find((check: any) => check.name === 'template-activator-parity');

      expect(res.status).toBe(200);
      expect(body.status).toBe('degraded');
      expect(parity).toEqual(
        expect.objectContaining({
          ok: false,
          detail: expect.stringContaining('deployed template may be stale'),
          remediation: 'Run scripts/kaseki-activate.sh --controller bootstrap.'
        })
      );
      expect(parity.checkoutHash).toMatch(/^[a-f0-9]{64}$/);
      expect(parity.templateHash).toMatch(/^[a-f0-9]{64}$/);
      expect(parity.checkoutHash).not.toBe(parity.templateHash);
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      if (originalTemplateDir === undefined) delete process.env.KASEKI_TEMPLATE_DIR;
      else process.env.KASEKI_TEMPLATE_DIR = originalTemplateDir;
      if (originalCheckoutDir === undefined) delete process.env.KASEKI_CHECKOUT_DIR;
      else process.env.KASEKI_CHECKOUT_DIR = originalCheckoutDir;
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
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
        headers: { Authorization: 'Bearer test-key' }
      });
      expect([200, 503]).toContain(res.status);
      // Drain response body to release HTTP connection
      await drainResponseBody(res);

      const runArgs = getWorkerSmokeDockerRunArgs();
      expect(runArgs).toContain('/home/pi/secrets:/run/secrets/kaseki:ro');
      expect(runArgs).not.toContain('/run/secrets/kaseki:/run/secrets/kaseki:ro');
      expect(runArgs).toEqual(
        expect.arrayContaining([
          'LLM_GATEWAY_API_KEY_FILE=/run/secrets/kaseki/llm_gateway_api_key',
          'KASEKI_SECRETS_DIR=/run/secrets/kaseki',
          'KASEKI_RESULTS_DIR=/results'
        ])
      );
      expect(runArgs.slice(runArgs.indexOf('-e'), runArgs.indexOf('-v'))).toContain('KASEKI_RESULTS_DIR=/results');
      expect(runArgs.slice(runArgs.indexOf('--entrypoint'))).toEqual(
        expect.arrayContaining(['--entrypoint', '/scripts/startup-checks.sh'])
      );
      expect(runArgs).not.toContain('/scripts/docker-entrypoint.sh');
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

  test('GET /api/preflight reports results mount remediation for worker startup-check failures', async () => {
    execDockerCommandMock.mockImplementation((args: string[]) => {
      if (args[0] === 'run') {
        return {
          ok: false,
          status: 3,
          detail: ['/agents/kaseki-results is not mounted', 'Error detected; startup blocked'].join('\n')
        };
      }

      return {
        ok: true,
        stdout: args[0] === 'version' ? '24.0.0 -> 24.0.0' : undefined
      };
    });

    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-worker-missing-results-'));
    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/preflight`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect([200, 503]).toContain(res.status);
      const body = (await res.json()) as any;
      const workerSmokeCheck = body.checks.find((check: any) => check.name === 'worker-smoke');

      expect(workerSmokeCheck).toEqual(
        expect.objectContaining({
          ok: false,
          detail: expect.stringContaining('/agents/kaseki-results is not mounted'),
          remediation: expect.stringMatching(/results (directory|dir|mount)|KASEKI_RESULTS_DIR/i)
        })
      );
      expect(workerSmokeCheck.remediation).not.toMatch(/Docker daemon|Docker socket|docker\.sock/i);
    } finally {
      await cleanupTestApp(server, idempotencyStore);
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
            'Checked configured OPENROUTER_API_KEY_FILE: /run/secrets/kaseki/custom_openrouter_key',
            'Create: /run/secrets/kaseki/openrouter_api_key'
          ].join('\n')
        };
      }

      return {
        ok: true,
        stdout: args[0] === 'version' ? '24.0.0 -> 24.0.0' : undefined
      };
    });

    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-worker-missing-secrets-'));
    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/preflight`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect([200, 503]).toContain(res.status);
      const body = (await res.json()) as any;
      const workerSmokeCheck = body.checks.find((check: any) => check.name === 'worker-smoke');

      expect(workerSmokeCheck).toEqual(
        expect.objectContaining({
          ok: false,
          detail: expect.stringContaining('No OpenRouter API key configured'),
          remediation: expect.stringMatching(/KASEKI_HOST_SECRETS_DIR|host secrets (directory|mount)/)
        })
      );
      expect(workerSmokeCheck.remediation).toContain('/run/secrets/kaseki/custom_openrouter_key');
      expect(workerSmokeCheck.remediation).toContain(
        '/run/secrets/kaseki/openrouter_api_key is the API container and nested worker secret mount'
      );
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
        headers: { Authorization: 'Bearer test-key' }
      });
      expect([200, 503]).toContain(res.status);
      // Drain response body to release HTTP connection
      await drainResponseBody(res);

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
              Destination: '/run/secrets/kaseki'
            }
          ])
        };
      }

      return {
        ok: true,
        stdout: args[0] === 'version' ? '24.0.0 -> 24.0.0' : undefined
      };
    });

    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-worker-inspect-secrets-'));
    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/preflight`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect([200, 503]).toContain(res.status);
      // Drain response body to release HTTP connection
      await drainResponseBody(res);

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
    fs.writeFileSync(mountInfoPath, `101 99 179:2 /agents//deleted ${tempRoot} rw,noatime - ext4 /dev/mmcblk0p2 rw\n`);

    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/preflight`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect([200, 503]).toContain(res.status);
      const body = (await res.json()) as any;
      const mountCheck = body.checks.find((check: any) => check.name === 'bind-mounts');
      expect(mountCheck).toEqual(
        expect.objectContaining({
          ok: false,
          detail: expect.stringContaining('/agents//deleted'),
          remediation: expect.stringContaining('--recreate-api')
        })
      );
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
        headers: { Authorization: 'Bearer test-key' }
      });
      expect([200, 503]).toContain(res.status);
      const body = (await res.json()) as any;
      const resultsCheck = body.checks.find((check: any) => check.name === 'results-dir');
      expect(resultsCheck).toEqual(
        expect.objectContaining({
          ok: true,
          detail: `${resultsDir} is readable and writable.`
        })
      );
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
        headers: { Authorization: 'Bearer test-key' }
      });
      expect([200, 503]).toContain(res.status);
      const body = (await res.json()) as any;
      const githubCheck = body.checks.find((check: any) => check.name === 'github-app');
      expect(githubCheck).toEqual(
        expect.objectContaining({
          ok: true,
          detail: expect.stringContaining('GitHub App credentials are readable')
        })
      );
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
        headers: { Authorization: 'Bearer test-key' }
      });
      expect([200, 503]).toContain(res.status);
      const body = (await res.json()) as any;
      const githubCheck = body.checks.find((check: any) => check.name === 'github-app');
      expect(githubCheck).toEqual(
        expect.objectContaining({
          ok: true,
          detail: expect.stringContaining('GitHub App credentials are readable')
        })
      );
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
        headers: { Authorization: 'Bearer test-key' }
      });
      expect([200, 503]).toContain(res.status);
      const body = (await res.json()) as any;
      const githubCheck = body.checks.find((check: any) => check.name === 'github-app');
      expect(githubCheck).toEqual(
        expect.objectContaining({
          ok: false,
          detail: expectedValidation.error,
          remediation: expectedValidation.remediation
        })
      );
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
        headers: { Authorization: 'Bearer test-key' }
      });
      expect([200, 503]).toContain(res.status);
      const body = (await res.json()) as any;
      const githubCheck = body.checks.find((check: any) => check.name === 'github-app');
      expect(githubCheck).toEqual(
        expect.objectContaining({
          ok: false,
          detail: expect.stringContaining('default PR creation cannot run'),
          remediation: expect.stringContaining('github_app_private_key')
        })
      );
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
        closeSync: closeSyncMock
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
    fs.writeFileSync(path.join(jobDir, 'pre-validation.log'), 'pre-validation output');
    fs.writeFileSync(path.join(jobDir, 'validation.log'), 'validation output');

    const scheduler = createMockScheduler({
      [jobId]: { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir }
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

      const validationRes = await fetch(`http://127.0.0.1:${port}/api/results/${jobId}/validation.log`, { headers });
      expect(validationRes.status).toBe(200);
      const validationBody = (await validationRes.json()) as any;
      expect(validationBody.file).toBe('validation.log');
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
      [jobId]: { id: jobId, status: 'running' as const, createdAt: new Date(), resultDir: jobDir }
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

  test('run-evaluation.json supports rendered format while preserving raw default', async () => {
    const jobId = 'kaseki-eval-rendered-1';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(
      path.join(jobDir, 'run-evaluation.json'),
      JSON.stringify({
        overall_assessment: 'good',
        summary: 'All checks passed',
        what_was_fixed: ['fixed flake'],
        human_review_recommendations: ['verify auth edge case'],
        metadata: { evaluator: 'pi' }
      })
    );

    const scheduler = createMockScheduler({
      [jobId]: { id: jobId, status: 'completed' as const, createdAt: new Date(), resultDir: jobDir }
    });
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);
    const headers = { Authorization: 'Bearer test-key' };

    try {
      const rawRes = await fetch(`http://127.0.0.1:${port}/api/results/${jobId}/run-evaluation.json`, { headers });
      expect(rawRes.status).toBe(200);
      const rawBody = (await rawRes.json()) as any;
      expect(rawBody.file).toBe('run-evaluation.json');
      expect(typeof rawBody.content).toBe('string');

      const renderedRes = await fetch(
        `http://127.0.0.1:${port}/api/results/${jobId}/run-evaluation.json?format=rendered`,
        { headers }
      );
      expect(renderedRes.status).toBe(200);
      const renderedBody = (await renderedRes.json()) as any;
      expect(renderedBody.format).toBe('rendered');
      expect(renderedBody.sections.overall).toEqual({ assessment: 'good' });
      expect(renderedBody.sections.summary).toEqual(['All checks passed']);
      expect(renderedBody.sections.solution).toEqual(['fixed flake']);
      expect(renderedBody.sections.problem).toEqual([]);
      expect(renderedBody.sections.humanReview).toEqual(['verify auth edge case']);
      expect(renderedBody.raw.metadata).toEqual({ evaluator: 'pi' });
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('rendered format includes markdown when requested', async () => {
    const jobId = 'kaseki-eval-rendered-markdown';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(
      path.join(jobDir, 'run-evaluation.json'),
      JSON.stringify({
        summary: ['All checks passed'],
        problem: ['Flaky auth test'],
        solution: ['Stabilized test fixture']
      })
    );

    const scheduler = createMockScheduler({
      [jobId]: { id: jobId, status: 'completed' as const, createdAt: new Date(), resultDir: jobDir }
    });
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const renderedRes = await fetch(
        `http://127.0.0.1:${port}/api/results/${jobId}/run-evaluation.json?format=rendered&markdown=true`,
        { headers: { Authorization: 'Bearer test-key' } }
      );
      expect(renderedRes.status).toBe(200);
      const renderedBody = (await renderedRes.json()) as any;
      expect(renderedBody.markdown).toContain('## Summary');
      expect(renderedBody.markdown).toContain('## Problem');
      expect(renderedBody.markdown).toContain('## Solution');
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('rendered format returns 422 when run-evaluation.json has invalid json', async () => {
    const jobId = 'kaseki-eval-rendered-invalid';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'run-evaluation.json'), '{invalid-json');

    const scheduler = createMockScheduler({
      [jobId]: { id: jobId, status: 'completed' as const, createdAt: new Date(), resultDir: jobDir }
    });
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/results/${jobId}/run-evaluation.json?format=rendered`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as any;
      expect(body.detail).toContain('Invalid JSON in run-evaluation.json artifact');
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
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/artifacts`, {
        headers: { Authorization: 'Bearer test-key' }
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
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/artifacts`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.runStatus).toBe('running');
      // Running jobs have no recommended artifacts (non-terminal)
      expect(body.recommended.length).toBe(0);
      const stderrFile = body.artifacts.find((artifact: any) => artifact.name === 'stderr.log');
      const goalCheckFile = body.artifacts.find((artifact: any) => artifact.name === 'goal-check.json');
      expect(stderrFile.available).toBe(false);
      expect(goalCheckFile.available).toBe(false);
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
    fs.writeFileSync(path.join(jobDir, 'failure.json'), '{"exit_code": 1}');
    fs.writeFileSync(path.join(jobDir, 'stderr.log'), 'errors');
    fs.writeFileSync(path.join(jobDir, 'pi-events.jsonl'), '');
    fs.writeFileSync(path.join(jobDir, 'pi-summary.json'), '{}');
    fs.writeFileSync(path.join(jobDir, 'changed-files.txt'), 'src/file.ts');
    fs.writeFileSync(path.join(jobDir, 'git.diff'), 'diff content');
    fs.writeFileSync(path.join(jobDir, 'pre-validation-timings.tsv'), 'command\tstart\tend');
    fs.writeFileSync(path.join(jobDir, 'validation.log'), 'validation results');
    fs.writeFileSync(path.join(jobDir, 'quality.log'), 'quality results');
    fs.writeFileSync(path.join(jobDir, 'progress.jsonl'), '{"stage":"done"}');
    fs.writeFileSync(path.join(jobDir, 'exit_code'), '1');
    fs.writeFileSync(path.join(jobDir, 'validation-timings.tsv'), 'command\tstart\tend');
    fs.writeFileSync(path.join(jobDir, 'stage-timings.tsv'), 'stage\tstart\tend');

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 0, maxConcurrent: 1 }),
      getJob: (id: string) =>
        id === jobId
          ? { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir, exitCode: 1 }
          : undefined,
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/artifacts`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;

      // Verify comprehensive enumeration
      expect(body.artifacts.length).toBeGreaterThan(10); // Should have many artifacts
      expect(body.artifactCount).toBeGreaterThan(5); // At least some available
      expect(body.downloadBaseUrl).toBe(`/api/results/${jobId}/`);

      // Verify metadata inclusion
      const piSummary = body.artifacts.find((a: any) => a.name === 'pi-summary.json');
      expect(piSummary).toMatchObject({
        name: 'pi-summary.json',
        available: true,
        contentType: 'application/json',
        description: expect.any(String),
        availability: 'always'
      });

      // Verify conditional artifacts
      const changedFiles = body.artifacts.find((a: any) => a.name === 'changed-files.txt');
      expect(changedFiles).toMatchObject({
        available: true,
        contentType: 'text/plain',
        description: expect.stringContaining('filename'),
        availability: 'conditional'
      });

      const preValidationLog = body.artifacts.find((a: any) => a.name === 'validation.log');
      expect(preValidationLog).toMatchObject({
        available: true,
        contentType: 'text/plain',
        description: expect.stringContaining('Validation'),
        availability: 'conditional'
      });

      // Verify failure-only artifacts
      const failureJson = body.artifacts.find((a: any) => a.name === 'failure.json');
      expect(failureJson).toMatchObject({
        available: true,
        availability: 'on-failure'
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
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir: fs.mkdtempSync(path.join('/tmp', 'kaseki-routes-notfound-test-')),
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const
    };

    const idempotencyStore = new IdempotencyStore(config.resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/missing-run/artifacts`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(404);
      // Drain response body to release HTTP connection
      await response.text().catch(() => {});
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
            error: 'Validation step crashed'
          }
          : undefined,
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/logs/stderr`, {
        headers: { Authorization: 'Bearer test-key' }
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
            resultDir: jobDir
          }
          : undefined,
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/logs/stderr`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(404);
      const body = (await response.json()) as any;
      expect(body.detail).toContain('Log file not found: stderr');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('combined logs concatenate available run logs with source metadata', async () => {
    const jobId = 'kaseki-combined-logs';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'stdout.log'), 'stdout line\n');
    fs.writeFileSync(path.join(jobDir, 'validation.log'), 'validation line\n');

    const scheduler = createMockScheduler({
      [jobId]: {
        id: jobId,
        status: 'failed',
        createdAt: new Date(),
        resultDir: jobDir
      } as any
    });
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/logs/combined`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.logType).toBe('combined');
      expect(body.content).toContain('===== stdout (stdout.log) =====');
      expect(body.content).toContain('stdout line');
      expect(body.content).toContain('===== validation (validation.log) =====');
      expect(body.content).toContain('validation line');
      expect(body.sources.map((source: any) => source.logType)).toEqual(['stdout', 'validation']);
    } finally {
      await cleanupTestApp(server, idempotencyStore);
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
      requestId: '22222222-2222-4222-8222-222222222222'
    } as any;

    const scheduler = {
      getQueueStatus: () => ({ pending: 1, running: 0, maxConcurrent: 1 }),
      getJob: (id: string) => (id === job.id ? job : undefined),
      submitJob: jest.fn(() => job),
      listJobs: () => [job],
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const
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
      idempotencyKey: '33333333-3333-4333-8333-333333333333'
    });

    try {
      const first = await fetch(`http://127.0.0.1:${port}/api/runs`, { method: 'POST', headers, body });
      expect(first.status).toBe(202);
      // Drain response body to release HTTP connection
      await drainResponseBody(first);

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
        failureClass: 'cancelled'
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('legacy progress endpoint returns the canonical structured events schema', async () => {
    const jobId = 'kaseki-legacy-progress-events';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(
      path.join(jobDir, 'progress.jsonl'),
      `${JSON.stringify({ stage: 'setup', message: 'ready' })}
`
    );

    const scheduler = createMockScheduler({
      [jobId]: { id: jobId, status: 'running', createdAt: new Date(), resultDir: jobDir } as any
    });
    scheduler.getLiveProgressEvents = jest.fn(() => [{ stage: 'live', message: 'still running' }]) as any;

    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const eventsResponse = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/events`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      const progressResponse = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/progress`, {
        headers: { Authorization: 'Bearer test-key' }
      });

      expect(eventsResponse.status).toBe(200);
      expect(progressResponse.status).toBe(200);
      expect(progressResponse.headers.get('deprecation')).toBe('true');
      expect(await progressResponse.json()).toEqual(await eventsResponse.json());
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('events endpoint falls back to live docker progress for active runs', async () => {
    const jobId = 'kaseki-live-events';
    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 1, maxConcurrent: 1 }),
      getJob: (id: string) => (id === jobId ? { id: jobId, status: 'running', createdAt: new Date() } : undefined),
      getLiveProgressEvents: jest.fn(() => [
        { source: 'docker-logs', stage: 'startup check', message: 'container booted' }
      ]),
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/events`, {
        headers: { Authorization: 'Bearer test-key' }
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

  test('events endpoint derives early progress from live docker log stages', async () => {
    const jobId = 'kaseki-live-log-events';
    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 1, maxConcurrent: 1 }),
      getJob: (id: string) => (id === jobId ? { id: jobId, status: 'running', createdAt: new Date() } : undefined),
      getLiveProgressEvents: jest.fn(() => []),
      getLiveDockerLogTail: jest.fn(() => '==> clone repository\n==> prepare node dependencies\n'),
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn()
    } as any;

    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/events`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.sources).toEqual(['docker-logs']);
      expect(body.events.map((event: any) => event.stage)).toEqual(['clone repository', 'prepare node dependencies']);
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('artifact listing exposes live stdout for running jobs before stdout.log is finalized', async () => {
    const jobId = 'kaseki-live-stdout-artifact';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    const scheduler = createMockScheduler({
      [jobId]: { id: jobId, status: 'running', createdAt: new Date(), resultDir: jobDir } as any
    });
    scheduler.getLiveDockerLogTail = jest.fn(() => 'live stdout content') as any;

    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/artifacts`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      const stdout = body.artifacts.find((artifact: any) => artifact.name === 'stdout.log');
      expect(stdout.available).toBe(true);
      expect(stdout.size).toBe(Buffer.byteLength('live stdout content', 'utf-8'));
    } finally {
      await cleanupTestApp(server, idempotencyStore);
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
      getJob: (id: string) =>
        id === jobId ? { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir } : undefined,
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/artifacts`, {
        headers: { Authorization: 'Bearer test-key' }
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
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' }
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
        stdoutLog: false,
        availableFiles: ['metadata.json', 'failure.json', 'stderr.log']
      });
      expect(body.diagnosticEntryPoint).toBe('failure.json');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('failed pre-agent validation status exposes failing test diagnostics', async () => {
    const jobId = 'kaseki-pre-validation-failed';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(
      path.join(jobDir, 'metadata.json'),
      JSON.stringify({
        instance: jobId,
        failed_command: 'pre-agent validation',
        pre_validation_exit_code: 1,
        exit_code: 1
      })
    );
    fs.writeFileSync(path.join(jobDir, 'failure.json'), '{"pre_validation_failure_reason":"pre_agent_validation_failed: npm run test (exit 1)"}');
    fs.writeFileSync(
      path.join(jobDir, 'pre-validation.log'),
      [
        'Summary of all failing tests',
        'FAIL src/kaseki-api-routes.test.ts',
        '  ● kaseki-api-routes preflight diagnostics › reports worker gateway launch config missing',
        '    expect(received).toEqual(expected) // deep equality'
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(jobDir, 'test-baseline-comparison.json'),
      JSON.stringify({
        baseline_validation_exit_code: 127,
        summary: {
          total_newly_introduced: 1,
          total_pre_existing: 0,
          total_fixed: 0
        }
      })
    );

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 0, maxConcurrent: 1 }),
      getJob: (id: string) =>
        id === jobId ? { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir } : undefined,
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.artifacts.availableFiles).toEqual(expect.arrayContaining([
        'pre-validation.log',
        'test-baseline-comparison.json'
      ]));
      expect(body.diagnosticEntryPoint).toBe('test-baseline-comparison.json');
      expect(body.diagnosticSummary.testFailure).toMatchObject({
        failedSuite: 'src/kaseki-api-routes.test.ts',
        failedTest: 'kaseki-api-routes preflight diagnostics › reports worker gateway launch config missing',
        assertionSummary: 'expect(received).toEqual(expected) // deep equality',
        baselineComparison: {
          totalNewlyIntroduced: 1,
          baselineValidationExitCode: 127,
          baselineComparisonReliable: false
        }
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('failed goal-check artifact validation status exposes goal-check diagnostic artifacts', async () => {
    const jobId = 'kaseki-failed-goal-check-artifact-invalid';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(
      path.join(jobDir, 'metadata.json'),
      JSON.stringify({
        goal_check_failure_reason: 'goal_check_artifact_invalid',
        failed_command: 'goal check',
        exit_code: 86
      })
    );
    fs.writeFileSync(path.join(jobDir, 'failure.json'), '{"failureClass":"goal-unmet"}');
    fs.writeFileSync(path.join(jobDir, 'goal-check-validation-errors.jsonl'), '{"summary":"critical"}\n');
    fs.writeFileSync(path.join(jobDir, 'goal-check-stderr.log'), 'schema validation failed');

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 0, maxConcurrent: 1 }),
      getJob: (id: string) =>
        id === jobId ? { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir } : undefined,
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.goalCheckFailureReason).toBe('goal_check_artifact_invalid');
      expect(body.artifacts.availableFiles).toEqual([
        'metadata.json',
        'failure.json',
        'goal-check-validation-errors.jsonl',
        'goal-check-stderr.log'
      ]);
      expect(body.artifacts.diagnosticFiles).toEqual(['goal-check-validation-errors.jsonl', 'goal-check-stderr.log']);
      expect(body.diagnosticEntryPoint).toBe('goal-check-validation-errors.jsonl');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('failed scouting artifact validation status exposes scouting diagnostics first', async () => {
    const jobId = 'kaseki-failed-scouting-artifact-invalid';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(
      path.join(jobDir, 'metadata.json'),
      JSON.stringify({
        instance: jobId,
        failed_command: 'pi scouting agent',
        scouting_exit_code: 86,
        exit_code: 86
      })
    );
    fs.writeFileSync(path.join(jobDir, 'failure.json'), '{"exit_code":86}');
    fs.writeFileSync(
      path.join(jobDir, 'scouting-validation-errors.jsonl'),
      '{"reason_code":"missing_file","field":"scouting-candidate.json"}\n'
    );
    fs.writeFileSync(path.join(jobDir, 'scouting-stderr.log'), 'scouting schema validation failed');

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 0, maxConcurrent: 1 }),
      getJob: (id: string) =>
        id === jobId ? { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir } : undefined,
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn()
    } as any;

    const config = createTestConfig(resultsDir);
    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.artifacts.diagnosticFiles).toEqual([
        'scouting-validation-errors.jsonl',
        'scouting-stderr.log'
      ]);
      expect(body.diagnosticEntryPoint).toBe('scouting-validation-errors.jsonl');
      expect(body.scoutingValidationErrorsContent).toEqual([
        { reason_code: 'missing_file', field: 'scouting-candidate.json' }
      ]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('analysis response includes validation diagnostics summary', async () => {
    const jobId = 'kaseki-analysis-diagnostics';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'metadata.json'), JSON.stringify({ instance: jobId, model: 'test-model' }));
    fs.writeFileSync(
      path.join(jobDir, 'goal-setting-validation-errors.jsonl'),
      '{"reason":"placeholder_content","field":"upgraded_goal"}\n'
    );
    fs.writeFileSync(
      path.join(jobDir, 'scouting-validation-errors.jsonl'),
      '{"reason_code":"missing_file","field":"scouting-candidate.json"}\n'
    );

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 0, maxConcurrent: 1 }),
      getJob: (id: string) =>
        id === jobId ? { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir } : undefined,
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn()
    } as any;

    const config = createTestConfig(resultsDir);
    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/analysis`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.diagnostics.entryPoint).toBe('goal-setting-validation-errors.jsonl');
      expect(body.diagnostics.files).toEqual([
        'goal-setting-validation-errors.jsonl',
        'scouting-validation-errors.jsonl'
      ]);
      expect(body.diagnostics.details).toEqual([
        { reason: 'placeholder_content', field: 'upgraded_goal' },
        { reason_code: 'missing_file', field: 'scouting-candidate.json' }
      ]);
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
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.runs[0]).toMatchObject({
        id: jobId,
        status: 'failed',
        exitCode: 127
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('runs list honors limit query parameter', async () => {
    const jobs = Array.from({ length: 4 }, (_, index) => ({
      id: `kaseki-${index + 1}`,
      status: 'completed',
      createdAt: new Date(`2026-05-07T12:0${index}:00Z`),
      resultDir: path.join(resultsDir, `kaseki-${index + 1}`),
    }));
    const scheduler = createMockScheduler(Object.fromEntries(jobs.map((job) => [job.id, job as any])));
    scheduler.listJobs = jest.fn(() => jobs as any);

    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs?limit=2`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.total).toBe(4);
      expect(body.runs.map((run: any) => run.id)).toEqual(['kaseki-1', 'kaseki-2']);
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('failed run falls back to result-summary.md diagnostic entrypoint when failure.json is missing', async () => {
    const jobId = 'kaseki-failed-status-2';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'result-summary.md'), '# summary');

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 0, maxConcurrent: 1 }),
      getJob: (id: string) =>
        id === jobId ? { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir } : undefined,
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.artifacts).toEqual({
        metadataJson: false,
        analysisMd: false,
        resultSummaryMd: true,
        failureJson: false,
        stderrLog: false,
        stdoutLog: false,
        availableFiles: ['result-summary.md']
      });
      expect(body.diagnosticEntryPoint).toBe('result-summary.md');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('failed run exposes stdout log as fallback diagnostic when richer artifacts are missing', async () => {
    const jobId = 'kaseki-failed-status-stdout-only';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'stdout.log'), 'controller bootstrap stdout\nmkdir: cannot create directory');

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 0, maxConcurrent: 1 }),
      getJob: (id: string) =>
        id === jobId ? { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir } : undefined,
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn()
    } as any;
    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const
    };
    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.artifacts.stdoutLog).toBe(true);
      expect(body.artifacts.availableFiles).toEqual(['stdout.log']);
      expect(body.diagnosticEntryPoint).toBe('stdout.log');
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
      getJob: (id: string) =>
        id === jobId ? { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir } : undefined,
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn()
    } as any;
    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const
    };
    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' }
      });
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
        id === jobId
          ? { id: jobId, status: 'running', createdAt: new Date(), resultDir: jobDir, startedAt: new Date() }
          : undefined,
      getLiveProgressEvents: jest.fn(() => []),
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const
    };
    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.progress).toEqual({
        stage: 'pi coding agent',
        displayName: 'Kaseki — Crafting',
        percentComplete: 42,
        message: 'pi coding agent',
        updatedAt: '2026-05-05T00:00:00.000Z'
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
    fs.writeFileSync(
      path.join(jobDir, 'progress.jsonl'),
      `${JSON.stringify({ stage: 'older file event' })}\n{not-json}\n`
    );

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 1, maxConcurrent: 1 }),
      getJob: (id: string) =>
        id === jobId
          ? { id: jobId, status: 'running', createdAt: new Date(), resultDir: jobDir, startedAt: new Date() }
          : undefined,
      getLiveProgressEvents: jest.fn(() => [
        { stage: 'live fallback', message: 'file tail was malformed', timestamp: '2026-05-05T00:00:01.000Z' }
      ]),
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const
    };
    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.progress).toEqual({
        stage: 'live fallback',
        message: 'file tail was malformed',
        updatedAt: '2026-05-05T00:00:01.000Z'
      });
      expect(scheduler.getLiveProgressEvents).toHaveBeenCalledWith(jobId, 100);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('running status returns structured progress from live docker fallback', async () => {
    const jobId = 'kaseki-running-status-progress-live';
    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 1, maxConcurrent: 1 }),
      getJob: (id: string) =>
        id === jobId ? { id: jobId, status: 'running', createdAt: new Date(), startedAt: new Date() } : undefined,
      getLiveProgressEvents: jest.fn(() => [
        { stage: 'startup check', message: 'container booted', timestamp: '2026-05-05T00:00:02.000Z' }
      ]),
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const
    };
    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.progress).toEqual({
        stage: 'startup check',
        message: 'container booted',
        updatedAt: '2026-05-05T00:00:02.000Z'
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('running status with metadata stages and finished progress events returns taskProgressPercent', async () => {
    const jobId = 'kaseki-running-status-task-progress-metadata';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(
      path.join(jobDir, 'metadata.json'),
      JSON.stringify({ stages: ['clone repository', 'pre-agent validation', 'pi coding agent', 'validation'] })
    );
    fs.writeFileSync(
      path.join(jobDir, 'progress.jsonl'),
      [
        {
          stage: 'clone repository',
          status: 'finished',
          detail: 'finished with exit 0',
          timestamp: '2026-05-05T00:00:00.000Z'
        },
        {
          stage: 'pre-agent validation',
          status: 'finished',
          detail: 'finished with exit 0',
          timestamp: '2026-05-05T00:00:01.000Z'
        }
      ]
        .map((event) => JSON.stringify(event))
        .join('\n')
    );

    const scheduler = createMockScheduler({
      [jobId]: {
        id: jobId,
        status: 'running',
        createdAt: new Date(),
        resultDir: jobDir
      }
    }) as any;
    scheduler.getLiveProgressEvents = jest.fn(() => []);
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.taskProgressPercent).toBe(50);
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('running status with live progress but no progress.jsonl returns bounded taskProgressPercent', async () => {
    const jobId = 'kaseki-running-status-task-progress-live';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    const scheduler = createMockScheduler({
      [jobId]: {
        id: jobId,
        status: 'running',
        createdAt: new Date(),
        resultDir: jobDir
      }
    }) as any;
    scheduler.getLiveProgressEvents = jest.fn(() => [
      { stage: 'pi coding agent', message: 'coding', timestamp: '2026-05-05T00:00:02.000Z' }
    ]);
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(typeof body.taskProgressPercent).toBe('number');
      expect(body.taskProgressPercent).toBeGreaterThanOrEqual(0);
      expect(body.taskProgressPercent).toBeLessThanOrEqual(100);
      expect(body.taskProgressPercent).toBeLessThan(100);
      expect(scheduler.getLiveProgressEvents).toHaveBeenCalledWith(jobId, 100);
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('malformed progress events do not break the status response', async () => {
    const jobId = 'kaseki-running-status-task-progress-malformed';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(
      path.join(jobDir, 'progress.jsonl'),
      '{not-json}\n' + JSON.stringify({ stage: { name: 'clone repository' }, status: 'finished' }) + '\n'
    );

    const scheduler = createMockScheduler({
      [jobId]: {
        id: jobId,
        status: 'running',
        createdAt: new Date(),
        resultDir: jobDir
      }
    }) as any;
    scheduler.getLiveProgressEvents = jest.fn(() => []);
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.status).toBe('running');
      expect(body.taskProgressPercent).toBe(0);
    } finally {
      await cleanupTestApp(server, idempotencyStore);
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
        id === jobId
          ? { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir, exitCode: 1 }
          : undefined,
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' }
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
        id === jobId
          ? { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir, exitCode: 1 }
          : undefined,
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' }
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
        id === jobId
          ? { id: jobId, status: 'completed', createdAt: new Date(), resultDir: jobDir, exitCode: 0 }
          : undefined,
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const { server, port } = await listenTestApp(app);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' }
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

  const requiredTemplateFixtureFiles = [
    'run-kaseki.sh',
    'kaseki-agent.sh',
    'scripts/kaseki-activate.sh',
    'scripts/kaseki-preflight.sh',
    'lib/pi-event-filter.js',
    'lib/pi-progress-stream.js',
    'lib/kaseki-report.js',
    'lib/github-app-token.js',
    'lib/github-app-private-key.js',
    'lib/github-utils.js',
    'lib/logger.js',
    'lib/secrets/host-secrets-reader.js'
  ] as const;

  function writeRunKasekiDoctor(exitCode: number, stderr: string): void {
    fs.mkdirSync(path.join(templateDir, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(templateDir, 'lib'), { recursive: true });
    fs.mkdirSync(path.join(templateDir, 'lib', 'secrets'), { recursive: true });

    for (const fixtureFile of requiredTemplateFixtureFiles) {
      fs.writeFileSync(path.join(templateDir, fixtureFile), 'export {};\n');
    }

    const scriptPath = path.join(templateDir, 'run-kaseki.sh');
    fs.writeFileSync(
      scriptPath,
      `#!/usr/bin/env bash\nif [[ "$1" == "--doctor" ]]; then\n  echo ${JSON.stringify(stderr)} >&2\n  exit ${exitCode}\nfi\nexit 0\n`
    );
    fs.chmodSync(scriptPath, 0o644);
    fs.writeFileSync(path.join(templateDir, 'kaseki-agent.sh'), '#!/usr/bin/env bash\n');
    fs.writeFileSync(path.join(templateDir, 'scripts', 'kaseki-activate.sh'), '#!/usr/bin/env bash\n');
    fs.writeFileSync(path.join(templateDir, 'scripts', 'kaseki-preflight.sh'), '#!/usr/bin/env bash\n');
  }

  function writeCheckoutActivateDoctor(exitCode: number, stderr: string, stdout = ''): string {
    const activatePath = path.join(checkoutDir, 'scripts', 'kaseki-activate.sh');
    fs.mkdirSync(path.dirname(activatePath), { recursive: true });
    fs.writeFileSync(
      activatePath,
      `#!/usr/bin/env bash
if [[ "$1" == "--json" && "$2" == "doctor" ]]; then
  if [[ -n ${JSON.stringify(stdout)} ]]; then
    echo ${JSON.stringify(stdout)}
  fi
  echo ${JSON.stringify(stderr)} >&2
  exit ${exitCode}
fi
exit 0
`
    );
    fs.chmodSync(activatePath, 0o644);
    return activatePath;
  }

  function writeTemplateMetadata(supportedPublishModes: string[], gitRef = 'test-ref'): void {
    fs.writeFileSync(
      path.join(templateDir, '.kaseki-template-version'),
      JSON.stringify({
        gitRef,
        supportedPublishModes,
        imageDigest: 'docker.io/cyanautomation/kaseki-agent@sha256:test'
      })
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
      request: runRequest
    }));
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://github.com/org/repo', publishMode: 'pr' })
      });

      expect(response.status).toBe(202);
      // Drain response body to release HTTP connection
      await drainResponseBody(response);
      expect(scheduler.submitJob).toHaveBeenCalledWith(
        expect.objectContaining({
          repoUrl: 'https://github.com/org/repo',
          publishMode: 'pr'
        })
      );
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
        body: JSON.stringify({ repoUrl: 'https://github.com/org/repo', publishMode: 'pr' })
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
    writeTemplateMetadata(['auto', 'none', 'branch', 'pr', 'draft_pr']);
    writeRunKasekiDoctor(0, 'doctor ok');
    // Create intentionally invalid git metadata so rev-parse fails consistently,
    // including in privileged environments where chmod(000) may still be readable.
    fs.mkdirSync(path.join(checkoutDir, '.git'), { recursive: true });

    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://github.com/org/repo', publishMode: 'pr' })
      });
      expect(response.status).toBe(409);
      const body = (await response.json()) as any;
      expect(body.detail).toContain('git rev-parse HEAD');
      // When .git/HEAD is unreadable, git returns "not a git repository" rather than "permission denied"
      expect(body.detail).toMatch(/permission denied|not a git repository/);
      expect(body.detail).toContain('stderr tail');
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('skips freshness when checkout is missing .git metadata', async () => {
    writeRunKasekiDoctor(0, 'doctor ok');
    const scheduler = createMockScheduler();
    scheduler.submitJob.mockImplementation((runRequest: any) => ({
      id: 'job-missing-git',
      status: 'queued',
      createdAt: new Date(),
      resultDir: path.join(resultsDir, 'job-missing-git'),
      requestId: runRequest.requestId,
      correlationId: runRequest.correlationId,
      request: runRequest
    }));
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);
    try {
      const preflight = await fetch(`http://127.0.0.1:${port}/api/preflight`, {
        headers: { Authorization: 'Bearer test-key' }
      });
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
    // Create intentionally invalid git metadata so rev-parse fails consistently,
    // including in privileged environments where chmod(000) may still be readable.
    fs.mkdirSync(path.join(checkoutDir, '.git'), { recursive: true });
    const scheduler = createMockScheduler();
    scheduler.submitJob.mockImplementation((runRequest: any) => ({
      id: 'job-fallback',
      status: 'queued',
      createdAt: new Date(),
      resultDir: path.join(resultsDir, 'job-fallback'),
      requestId: runRequest.requestId,
      correlationId: runRequest.correlationId,
      request: runRequest
    }));
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://github.com/org/repo', publishMode: 'pr' })
      });
      expect(response.status).toBe(202);
      // Drain response body to release HTTP connection
      await drainResponseBody(response);
      expect(scheduler.submitJob).toHaveBeenCalled();
    } finally {
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
    scheduler.submitJob.mockImplementation((runRequest: any) => ({
      id: 'job-non-enforced',
      status: 'queued',
      createdAt: new Date(),
      resultDir: path.join(resultsDir, 'job-non-enforced'),
      requestId: runRequest.requestId,
      correlationId: runRequest.correlationId,
      request: runRequest
    }));
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://github.com/org/repo', publishMode: 'none' })
      });
      expect(response.status).toBe(202);
      // Drain response body to release HTTP connection
      await drainResponseBody(response);
      expect(scheduler.submitJob).toHaveBeenCalled();
    } finally {
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
        body: JSON.stringify({ repoUrl: 'https://github.com/org/repo', publishMode: 'pr' })
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

  test('rejects PR run submission with compatibility error before doctor when template metadata lacks pr', async () => {
    writeTemplateMetadata(['auto', 'none', 'branch']);
    writeRunKasekiDoctor(42, 'doctor failed because template dependency is missing');
    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://github.com/org/repo', publishMode: 'pr' })
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as any;
      expect(body.type).toBe('https://api.kaseki.local/errors#template-incompatible');
      expect(body.detail).toBe('Template does not support publish mode `pr`; redeploy kaseki-agent.');
      expect(body.templateMetadataPath).toBe(path.join(templateDir, '.kaseki-template-version'));
      expect(body.supportedPublishModes).toEqual(['auto', 'none', 'branch']);
      expect(body.doctorCommand).toBeUndefined();
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
        body: JSON.stringify({ repoUrl: 'https://github.com/org/repo', publishMode: 'auto' })
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
        body: JSON.stringify({ repoUrl: 'https://github.com/org/repo', publishMode: 'auto' })
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
      request: runRequest
    }));
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://github.com/org/repo', publishMode: 'auto' })
      });

      expect(response.status).toBe(202);
      // Drain response body to release HTTP connection
      await drainResponseBody(response);
      expect(scheduler.submitJob).toHaveBeenCalledWith(
        expect.objectContaining({
          repoUrl: 'https://github.com/org/repo',
          publishMode: 'auto'
        })
      );
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('runs template doctor via bash even when run-kaseki.sh is not executable', async () => {
    writeRunKasekiDoctor(0, 'doctor ok');
    const scheduler = createMockScheduler();
    scheduler.submitJob.mockImplementation((runRequest: any) => ({
      id: 'job-template-healthy-nonexec',
      status: 'queued',
      createdAt: new Date(),
      resultDir: path.join(resultsDir, 'job-template-healthy-nonexec'),
      requestId: runRequest.requestId,
      correlationId: runRequest.correlationId,
      request: runRequest
    }));
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://github.com/org/repo', publishMode: 'auto' })
      });
      expect(response.status).toBe(202);
      // Drain response body to release HTTP connection
      await drainResponseBody(response);
      expect(scheduler.submitJob).toHaveBeenCalled();
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('runs checkout activate doctor via bash and keeps doctorCommand diagnostics stable', async () => {
    writeRunKasekiDoctor(0, 'doctor ok');
    const activatePath = writeCheckoutActivateDoctor(13, 'checkout activate doctor failed');
    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://github.com/org/repo', publishMode: 'auto' })
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as any;
      expect(body.doctorCommand).toBe(`${activatePath} --json doctor`);
      expect(body.doctorStderrTail).toContain('checkout activate doctor failed');
      expect(scheduler.submitJob).not.toHaveBeenCalled();
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('GET /api/preflight exposes activate doctor stdout diagnostics when JSON doctor fails', async () => {
    writeRunKasekiDoctor(0, 'doctor ok');
    const activatePath = writeCheckoutActivateDoctor(
      17,
      'stderr only says doctor failed',
      JSON.stringify({
        ok: false,
        failure: 'missing required jq binary from activate doctor stdout',
        remediation: 'Install jq or rerun kaseki-activate bootstrap'
      })
    );
    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/preflight`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      const templateCheck = body.checks.find((check: any) => check.name === 'template');
      expect(templateCheck.ok).toBe(false);
      expect(templateCheck.doctorCommand).toBe(`${activatePath} --json doctor`);
      expect(templateCheck.doctorStderrTail).toContain('stderr only says doctor failed');
      expect(templateCheck.doctorStdoutTail).toContain('missing required jq binary from activate doctor stdout');
      expect(templateCheck.doctorStdoutTail).toContain('Install jq or rerun kaseki-activate bootstrap');
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
        correlationId: runRequest.correlationId
      };
    });

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 0, maxConcurrent: 1 }),
      getJob: jest.fn(),
      submitJob,
      listJobs: () => [],
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const
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
      idempotencyKey: '11111111-1111-4111-8111-111111111111'
    };

    try {
      const requests = Array.from({ length: 8 }, () =>
        fetch(`http://127.0.0.1:${port}/api/runs`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body)
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
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const
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
        body: JSON.stringify({ repoUrl: 'https://github.com/example/repo', ref: 'main' })
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(healthResponse.status).toBe(200);
      const healthBody = (await healthResponse.json()) as any;
      expect(healthBody.status).toBeDefined();

      if (resolveSubmission)
        resolveSubmission({
          id: 'job-1',
          status: 'queued',
          createdAt: new Date(),
          resultDir: path.join(resultsDir, 'job-1'),
          requestId: 'req-1',
          correlationId: 'corr-1'
        });

      const runResponse = await runPromise;
      expect(runResponse.status).toBe(202);
      // Drain response body to release HTTP connection
      await drainResponseBody(runResponse);
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
          timeoutSeconds: 10
        })
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
      request: runRequest
    }));
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          repoUrl: 'https://github.com/org/repo',
          publishMode: 'auto'
        })
      });

      expect(response.status).toBe(202);
      // Drain response body to release HTTP connection
      await drainResponseBody(response);
      expect(scheduler.submitJob).toHaveBeenCalledWith(
        expect.objectContaining({
          repoUrl: 'https://github.com/org/repo',
          publishMode: 'auto'
        })
      );
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
      request: runRequest
    }));
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          repoUrl: 'https://github.com/org/repo'
        })
      });

      expect(response.status).toBe(202);
      // Drain response body to release HTTP connection
      await drainResponseBody(response);
      expect(scheduler.submitJob).toHaveBeenCalledWith(
        expect.objectContaining({
          repoUrl: 'https://github.com/org/repo',
          publishMode: 'pr'
        })
      );
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
      GITHUB_APP_PRIVATE_KEY_FILE: process.env.GITHUB_APP_PRIVATE_KEY_FILE
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
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          repoUrl: 'https://github.com/org/repo'
        })
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
      GITHUB_APP_PRIVATE_KEY_FILE: process.env.GITHUB_APP_PRIVATE_KEY_FILE
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
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          repoUrl: 'https://github.com/org/repo',
          publishMode: 'pr'
        })
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
      GITHUB_APP_PRIVATE_KEY_FILE: process.env.GITHUB_APP_PRIVATE_KEY_FILE
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
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          repoUrl: 'https://github.com/org/repo',
          publishMode: 'draft_pr'
        })
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
    fs.writeFileSync(path.join(jobDir, 'metadata.json'), '{"id":"kaseki-artifact-cache-stats"}');

    const scheduler = createMockScheduler({
      [jobId]: {
        id: jobId,
        status: 'completed',
        createdAt: new Date(),
        resultDir: jobDir
      }
    });
    const config = {
      ...createTestConfig(resultsDir),
      artifactCacheMaxEntries: 1,
      artifactCacheTtlMs: 60_000,
      artifactCacheMaxFileBytes: 1024
    };
    const artifactCache = new ResultCache({
      maxEntries: config.artifactCacheMaxEntries,
      ttlMs: config.artifactCacheTtlMs,
      maxFileBytes: config.artifactCacheMaxFileBytes
    });
    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler as any, config, idempotencyStore, preFlightValidator, artifactCache));
    const { server, port } = await listenTestApp(app);
    const headers = { Authorization: 'Bearer test-key' };

    try {
      const first = await fetch(`http://127.0.0.1:${port}/api/results/${jobId}/metadata.json`, { headers });
      expect(first.status).toBe(200);
      // Drain response body to release HTTP connection
      await drainResponseBody(first);
      const second = await fetch(`http://127.0.0.1:${port}/api/results/${jobId}/metadata.json`, { headers });
      expect(second.status).toBe(200);
      // Drain response body to release HTTP connection
      await drainResponseBody(second);

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
    fs.writeFileSync(path.join(jobDir, 'metadata.json'), '{"id":"too-large"}');

    const scheduler = createMockScheduler({
      [jobId]: {
        id: jobId,
        status: 'completed',
        createdAt: new Date(),
        resultDir: jobDir
      }
    });
    const config = {
      ...createTestConfig(resultsDir),
      artifactCacheMaxEntries: 3,
      artifactCacheTtlMs: 60_000,
      artifactCacheMaxFileBytes: 4
    };
    const artifactCache = new ResultCache({
      maxEntries: config.artifactCacheMaxEntries,
      ttlMs: config.artifactCacheTtlMs,
      maxFileBytes: config.artifactCacheMaxFileBytes
    });
    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler as any, config, idempotencyStore, preFlightValidator, artifactCache));
    const { server, port } = await listenTestApp(app);
    const headers = { Authorization: 'Bearer test-key' };

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/results/${jobId}/metadata.json`, { headers });
      expect(response.status).toBe(200);
      // Drain response body to release HTTP connection
      await drainResponseBody(response);
      expect(artifactCache.getStats()).toMatchObject({ entries: 0, misses: 1, maxFileBytes: 4 });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });
});

describe('progress SSE terminal behavior', () => {
  let resultsDir: string;

  beforeEach(() => {
    resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-progress-sse-test-'));
  });

  afterEach(() => {
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  test('closes SSE with final status when progress.jsonl is missing and job becomes terminal', async () => {
    const jobId = 'kaseki-sse-no-progress-terminal';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    const jobs: Record<string, any> = {
      [jobId]: {
        id: jobId,
        status: 'running',
        createdAt: new Date(),
        startedAt: new Date(),
        resultDir: jobDir
      }
    };
    const scheduler = createMockScheduler(jobs);
    scheduler.getJob.mockImplementation((id: string) => jobs[id]);

    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/events/stream`, {
        headers: { Authorization: 'Bearer test-key', Accept: 'text/event-stream' }
      });

      expect(response.status).toBe(200);
      expect(response.body).toBeTruthy();

      setTimeout(() => {
        jobs[jobId] = {
          ...jobs[jobId],
          status: 'completed'
        };
      }, 300);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let text = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        text += decoder.decode(value, { stream: true });
      }

      expect(text).toContain(`"type":"start","jobId":"${jobId}","status":"running"`);
      expect(text).toContain('"type":"status","status":"completed"');
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  }, 15000);

  test('closes SSE with failed status when progress.jsonl is missing and job fails', async () => {
    const jobId = 'kaseki-sse-no-progress-failed';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    const jobs: Record<string, any> = {
      [jobId]: {
        id: jobId,
        status: 'running',
        createdAt: new Date(),
        startedAt: new Date(),
        resultDir: jobDir
      }
    };
    const scheduler = createMockScheduler(jobs);
    scheduler.getJob.mockImplementation((id: string) => jobs[id]);

    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/events/stream`, {
        headers: { Authorization: 'Bearer test-key', Accept: 'text/event-stream' }
      });

      expect(response.status).toBe(200);
      expect(response.body).toBeTruthy();

      setTimeout(() => {
        jobs[jobId] = {
          ...jobs[jobId],
          status: 'failed'
        };
      }, 300);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let text = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        text += decoder.decode(value, { stream: true });
      }

      expect(text).toContain(`"type":"start","jobId":"${jobId}","status":"running"`);
      expect(text).toContain('"type":"status","status":"failed"');
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  }, 15000);
});
