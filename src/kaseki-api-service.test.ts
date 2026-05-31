// Mock the host-secrets-reader module
jest.mock('./secrets/host-secrets-reader', () => ({
  readHostSecret: jest.fn(),
  resolveHostSecretPath: jest.fn((name) => `/agents/secrets/${name}`),
  getSecretLocations: jest.fn((name) => ({
    primary: `/agents/secrets/${name}`,
    secondary: `/home/user/secrets/${name}`,
  })),
  getSecretFilePath: jest.fn((name) => `/agents/secrets/${name}`),
  clearSecretCache: jest.fn(),
}));

import * as fs from 'fs';
import type { Server } from 'http';
import * as hostSecretsReader from './secrets/host-secrets-reader';
import { assertSupportedNodeVersion, createGracefulShutdown, ensureResultsDir } from './kaseki-api-service';
import { loadConfig } from './kaseki-api-config';
import { JobScheduler } from './job-scheduler';
import { WebhookManager } from './webhook-manager';
import { RunRequestSchema } from './kaseki-api-types';

describe('Kaseki API Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('loadConfig allows empty API keys for trusted unauthenticated local mode', () => {
    const { readHostSecret } = jest.mocked(hostSecretsReader);
    (readHostSecret as jest.Mock).mockReturnValue(null);

    process.env.KASEKI_RESULTS_DIR = '/tmp';

    const config = loadConfig();

    expect(config.apiKeys).toEqual([]);
    expect(config.host).toBe('127.0.0.1');
  });

  test.each([
    {
      name: 'rejects non-numeric port string',
      port: 'invalid',
      expectedError: 'KASEKI_API_PORT must be a valid port number, got: invalid',
    },
    {
      name: 'rejects zero port',
      port: '0',
      expectedError: 'KASEKI_API_PORT must be a valid port number, got: 0',
    },
    {
      name: 'rejects negative port',
      port: '-1',
      expectedError: 'KASEKI_API_PORT must be a valid port number, got: -1',
    },
    {
      name: 'rejects port above 65535',
      port: '65536',
      expectedError: 'KASEKI_API_PORT must be a valid port number, got: 65536',
    },
    {
      name: 'accepts minimum valid port',
      port: '1',
      expectedPort: 1,
    },
    {
      name: 'accepts maximum valid port',
      port: '65535',
      expectedPort: 65535,
    },
  ])('loadConfig port boundaries: $name', ({ port, expectedError, expectedPort }) => {
    const { readHostSecret } = jest.mocked(hostSecretsReader);
    (readHostSecret as jest.Mock).mockReturnValue('test-key');

    process.env.KASEKI_API_PORT = port;
    process.env.KASEKI_RESULTS_DIR = '/tmp';

    if (expectedError) {
      expect(() => loadConfig()).toThrow(expectedError);
      return;
    }

    const config = loadConfig();
    expect(config.port).toBe(expectedPort);
  });

  describe.each([
    {
      name: 'parses numeric strings and normalizes newline-delimited API keys',
      apiKeysValue: ' key1 \n key2 \n key3 ',
      port: '3001',
      maxConcurrentRuns: '7',
      expectedConfig: {
        port: 3001,
        apiKeys: ['key1', 'key2', 'key3'],
        maxConcurrentRuns: 7,
      },
    },
    {
      name: 'accepts boundary max port and keeps defaults for omitted values',
      apiKeysValue: 'solo-key',
      port: '65535',
      expectedConfig: {
        port: 65535,
        apiKeys: ['solo-key'],
        maxConcurrentRuns: 3,
      },
    },
    {
      name: 'uses default port when unset and normalizes sparse key list',
      apiKeysValue: 'alpha\n\nbeta\n\n\ngamma\n',
      expectedConfig: {
        port: 8080,
        apiKeys: ['alpha', 'beta', 'gamma'],
        maxConcurrentRuns: 3,
      },
    },
  ])('loadConfig normalization: $name', ({ apiKeysValue, port, maxConcurrentRuns, expectedConfig }) => {
    const { readHostSecret } = jest.mocked(hostSecretsReader);
    (readHostSecret as jest.Mock).mockReturnValue(apiKeysValue);

    if (port) process.env.KASEKI_API_PORT = port;
    else delete process.env.KASEKI_API_PORT;

    if (maxConcurrentRuns) process.env.KASEKI_API_MAX_CONCURRENT_RUNS = maxConcurrentRuns;
    else delete process.env.KASEKI_API_MAX_CONCURRENT_RUNS;

    process.env.KASEKI_RESULTS_DIR = '/tmp';

    const config = loadConfig();

    expect({
      port: config.port,
      apiKeys: config.apiKeys,
      maxConcurrentRuns: config.maxConcurrentRuns,
    }).toEqual(expectedConfig);
  });

  test('loadConfig parses API keys from host secrets', async () => {
    const { readHostSecret } = jest.mocked(hostSecretsReader);
    const fileContents = 'key1\n# comment\nkey2\n';
    (readHostSecret as jest.Mock).mockReturnValue(fileContents);

    process.env.KASEKI_RESULTS_DIR = '/tmp';

    const config = loadConfig();
    expect(config.apiKeys).toEqual(['key1', 'key2']);
  });
});

describe('Kaseki API startup filesystem checks', () => {
  test('ensureResultsDir creates a missing writable results directory', () => {
    const parent = fs.mkdtempSync('/tmp/kaseki-api-results-parent-');
    const resultsDir = `${parent}/nested/results`;

    try {
      ensureResultsDir(resultsDir);
      expect(fs.statSync(resultsDir).isDirectory()).toBe(true);
      fs.accessSync(resultsDir, fs.constants.R_OK | fs.constants.W_OK);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe('Kaseki API Request Validation', () => {
  test.each([
    {
      name: 'accepts minimal required fields',
      request: { repoUrl: 'https://github.com/org/repo', ref: 'main' },
      expected: { repoUrl: 'https://github.com/org/repo', ref: 'main' },
    },
    {
      name: 'applies default ref when omitted',
      request: { repoUrl: 'https://github.com/org/repo' },
      expected: { repoUrl: 'https://github.com/org/repo', ref: 'main' },
    },
    {
      name: 'accepts startup check mode',
      request: { repoUrl: 'https://github.com/org/repo', startupCheck: true },
      expected: { repoUrl: 'https://github.com/org/repo', ref: 'main', startupCheck: true },
    },
    {
      name: 'accepts explicit PR publishing mode',
      request: { repoUrl: 'https://github.com/org/repo', publishMode: 'pr' },
      expected: { repoUrl: 'https://github.com/org/repo', ref: 'main', publishMode: 'pr' },
    },
    {
      name: 'accepts explicit draft PR publishing mode',
      request: { repoUrl: 'https://github.com/org/repo', publishMode: 'draft_pr' },
      expected: { repoUrl: 'https://github.com/org/repo', ref: 'main', publishMode: 'draft_pr' },
    },
    {
      name: 'accepts graceful auto publishing mode',
      request: { repoUrl: 'https://github.com/org/repo', publishMode: 'auto' },
      expected: { repoUrl: 'https://github.com/org/repo', ref: 'main', publishMode: 'auto' },
    },
    {
      name: 'accepts inspect mode (skips pre-agent validation automatically)',
      request: { repoUrl: 'https://github.com/org/repo', taskMode: 'inspect' },
      expected: {
        repoUrl: 'https://github.com/org/repo',
        ref: 'main',
        taskMode: 'inspect',
      },
    },
    {
      name: 'accepts goal check controls',
      request: {
        repoUrl: 'https://github.com/org/repo',
        goalCheck: { enabled: true, maxRetries: 2, model: 'openrouter/free', timeoutSeconds: 300 },
      },
      expected: {
        repoUrl: 'https://github.com/org/repo',
        ref: 'main',
        goalCheck: { enabled: true, maxRetries: 2, model: 'openrouter/free', timeoutSeconds: 300 },
      },
    },
    {
      name: 'accepts run evaluation controls',
      request: {
        repoUrl: 'https://github.com/org/repo',
        runEvaluation: { enabled: true, model: 'openrouter/free', timeoutSeconds: 300 },
      },
      expected: {
        repoUrl: 'https://github.com/org/repo',
        ref: 'main',
        runEvaluation: { enabled: true, model: 'openrouter/free', timeoutSeconds: 300 },
      },
    },
    {
      name: 'accepts controller-style allowlist and validation aliases',
      request: {
        repoUrl: 'https://github.com/org/repo',
        allowlist: { include: ['src/lib/parser.ts'] },
        validation: { commands: ['npm test -- parser'] },
      },
      expected: {
        repoUrl: 'https://github.com/org/repo',
        ref: 'main',
        allowlist: { include: ['src/lib/parser.ts'] },
        validation: { commands: ['npm test -- parser'] },
      },
    },
    {
      name: 'accepts snake_case HTTP payload aliases',
      request: {
        repo_url: 'https://github.com/org/repo',
        git_ref: 'feature/setup',
        task_prompt: 'Run a first-time setup smoke test',
        changed_files_allowlist: ['src/**'],
        max_diff_bytes: 400000,
        validation_commands: ['npm test'],
        goal_check: { enabled: true, maxRetries: 1, model: 'openrouter/free', timeoutSeconds: 300 },
        run_evaluation: { enabled: true, model: 'openrouter/free', timeoutSeconds: 300 },
        task_mode: 'inspect',
        publish_mode: 'none',
        skip_pre_agent_validation: true,
        startup_check: true,
        startup_check_mode: 'boot',
        timeout_seconds: 600,
      },
      expected: {
        repoUrl: 'https://github.com/org/repo',
        ref: 'feature/setup',
        taskPrompt: 'Run a first-time setup smoke test',
        changedFilesAllowlist: ['src/**'],
        maxDiffBytes: 400000,
        validationCommands: ['npm test'],
        goalCheck: { enabled: true, maxRetries: 1, model: 'openrouter/free', timeoutSeconds: 300 },
        runEvaluation: { enabled: true, model: 'openrouter/free', timeoutSeconds: 300 },
        taskMode: 'inspect',
        publishMode: 'none',
        startupCheck: true,
        startupCheckMode: 'boot',
        timeoutSeconds: 600,
      },
    },
  ])('RunRequestSchema success cases: $name', ({ request, expected }) => {
    const result = RunRequestSchema.parse(request);
    expect(result).toMatchObject(expected);
  });

  test.each([
    {
      name: 'rejects invalid URL',
      request: { repoUrl: 'not-a-url', ref: 'main' },
      expectedIssue: {
        path: ['repoUrl'],
        messagePattern: /url/i,
        value: 'not-a-url',
      },
    },
    {
      name: 'rejects invalid taskMode enum',
      request: { repoUrl: 'https://github.com/org/repo', taskMode: 'invalid' },
      expectedIssue: {
        path: ['taskMode'],
        messagePattern: /invalid (option|enum)|expected/i,
        value: 'invalid',
      },
    },
    {
      name: 'rejects invalid publishMode enum',
      request: { repoUrl: 'https://github.com/org/repo', publishMode: 'invalid' },
      expectedIssue: {
        path: ['publishMode'],
        messagePattern: /invalid (option|enum)|expected/i,
        value: 'invalid',
      },
    },
  ])('RunRequestSchema rejects invalid payloads: $name', ({ request, expectedIssue }) => {
    const result = RunRequestSchema.safeParse(request);

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    const matchingIssue = result.error.issues.find((issue) =>
      expectedIssue.path.every((segment, index) => issue.path[index] === segment),
    );

    expect(matchingIssue).toBeDefined();
    expect(matchingIssue?.path).toEqual(expectedIssue.path);
    expect(matchingIssue?.message).toMatch(expectedIssue.messagePattern);
    const valueAtIssuePath = expectedIssue.path.reduce<any>((acc, segment) =>
      (acc as any)?.[segment],
      request as any,
    );
    expect(valueAtIssuePath).toBe(expectedIssue.value);
  });
});

describe('Job Scheduler', () => {
  let scheduler: JobScheduler;
  let resultsDir: string;

  beforeEach(() => {
    resultsDir = fs.mkdtempSync('/tmp/kaseki-api-service-test-');
    const config = {
      port: 8080,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 2,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 400000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info' as const,
    };

    const webhookManager = new WebhookManager(resultsDir);
    scheduler = new JobScheduler(config, webhookManager);
  });

  afterEach(() => {
    scheduler.shutdown();
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  test('submitJob creates a queued job', async () => {
    // Saturate scheduler concurrency so a newly submitted job remains queued.
    (scheduler as any).running.add('existing-running-job');
    (scheduler as any).running.add('second-existing-running-job');

    const request = {
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
    };

    const submitted = await scheduler.submitJob(request);

    // Contract outcome: job is queued when concurrency limit is reached.
    expect(submitted.status).toBe('queued');
    expect(submitted.request).toEqual(request);

    // Contract outcome: queued job is visible via status and list/get endpoints.
    expect(scheduler.getQueueStatus()).toEqual({
      pending: 1,
      running: 2,
      maxConcurrent: 2,
    });

    const retrieved = scheduler.getJob(submitted.id);
    const jobs = scheduler.listJobs();

    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(submitted.id);
    expect(retrieved?.status).toBe('queued');
    expect(jobs.some((job) => job.id === submitted.id && job.status === 'queued')).toBe(true);
  });

  test('submit/get/list keep job identity, request payload, and queue visibility coherent', async () => {
    const request = {
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
    };

    const submitted = await scheduler.submitJob(request);
    const retrieved = scheduler.getJob(submitted.id);
    const jobs = scheduler.listJobs();

    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(submitted.id);
    expect(retrieved?.request).toEqual(request);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe(submitted.id);
    expect(jobs[0].request).toEqual(request);
  });

  test('listJobs returns all jobs sorted by creation time (newest first)', async () => {
    const request1 = { repoUrl: 'https://github.com/org/repo1', ref: 'main' };
    const request2 = { repoUrl: 'https://github.com/org/repo2', ref: 'main' };

    await scheduler.submitJob(request1);
    await scheduler.submitJob(request2);

    const jobs = scheduler.listJobs();
    expect(jobs.length).toBe(2);
    expect(jobs[0].request.repoUrl).toBe(request2.repoUrl); // Newest first
    expect(jobs[1].request.repoUrl).toBe(request1.repoUrl);
  });

  test('getQueueStatus reports pending and running count', async () => {
    await scheduler.submitJob({ repoUrl: 'https://github.com/org/repo', ref: 'main' });

    const status = scheduler.getQueueStatus();
    expect(status).toEqual({
      pending: 0,
      running: 1,
      maxConcurrent: 2,
    });
  });
});

describe('Kaseki API graceful shutdown', () => {
  test('waits for server close before scheduler shutdown and exit', async () => {
    const callOrder: string[] = [];
    let closeCallback: ((err?: Error) => void) | undefined;

    const server = {
      close: jest.fn((cb: (err?: Error) => void) => {
        closeCallback = cb;
      }),
    } as unknown as Server;

    const scheduler = {
      shutdown: jest.fn(() => {
        callOrder.push('scheduler.shutdown');
      }),
    };

    const webhookManager = {
      shutdown: jest.fn(),
    } as any;

    const idempotencyStore = {
      shutdown: jest.fn(),
    } as any;

    const exit = jest.fn((code: number) => {
      callOrder.push(`exit:${code}`);
      return undefined as never;
    }) as unknown as (code: number) => never;

    const gracefulShutdown = createGracefulShutdown({
      server,
      scheduler,
      webhookManager,
      idempotencyStore,
      forceExitAfterMs: 1000,
      exit,
    });

    const shutdownPromise = gracefulShutdown();

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(scheduler.shutdown).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();

    closeCallback?.();

    await shutdownPromise;

    expect(callOrder).toEqual(['scheduler.shutdown', 'exit:0']);
  });
});

describe('Node runtime precheck', () => {
  const originalExit = process.exit;

  afterEach(() => {
    process.exit = originalExit;
    jest.restoreAllMocks();
  });

  test('allows supported Node major versions', async () => {
    expect(() => assertSupportedNodeVersion('24.0.0')).not.toThrow();
    expect(() => assertSupportedNodeVersion('25.1.2')).not.toThrow();
  });

  test.each(['x.y.z', '24.x.1', 'v24.0.0', '24.0.0-beta'])(
    'exits early for malformed Node version string %s',
    (version) => {
      const exitMock = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`exit:${code}`);
      }) as never);

      expect(() => assertSupportedNodeVersion(version)).toThrow('exit:1');
      expect(exitMock).toHaveBeenCalledWith(1);
    },
  );
  test('exits early for unsupported Node major versions', async () => {
    const exitMock = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    expect(() => assertSupportedNodeVersion('22.22.2')).toThrow('exit:1');
    expect(exitMock).toHaveBeenCalledWith(1);
  });
});
