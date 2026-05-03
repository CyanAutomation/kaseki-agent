// fallow-ignore-next-line unused-files
import * as fs from 'fs';
import type { Server } from 'http';
import { createGracefulShutdown } from './kaseki-api-service';
import { loadConfig } from './kaseki-api-config';
import { JobScheduler } from './job-scheduler';
import { RunRequestSchema } from './kaseki-api-types';

describe('Kaseki API Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('loadConfig requires KASEKI_API_KEYS or KASEKI_API_KEYS_FILE', () => {
    delete process.env.KASEKI_API_KEYS;
    delete process.env.KASEKI_API_KEYS_FILE;
    process.env.KASEKI_RESULTS_DIR = '/tmp';

    expect(() => loadConfig()).toThrow(/KASEKI_API_KEYS.*required/i);
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
    process.env.KASEKI_API_KEYS = 'test-key';
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
      name: 'parses numeric strings and trims comma-delimited API keys',
      env: {
        KASEKI_API_KEYS: ' key1 , key2 , key3 ',
        KASEKI_API_PORT: '3001',
        KASEKI_API_MAX_CONCURRENT_RUNS: '7',
      },
      expectedConfig: {
        port: 3001,
        apiKeys: ['key1', 'key2', 'key3'],
        maxConcurrentRuns: 7,
      },
    },
    {
      name: 'accepts boundary max port and keeps defaults for omitted values',
      env: {
        KASEKI_API_KEYS: 'solo-key',
        KASEKI_API_PORT: '65535',
      },
      expectedConfig: {
        port: 65535,
        apiKeys: ['solo-key'],
        maxConcurrentRuns: 3,
      },
    },
    {
      name: 'uses default port when unset and normalizes sparse key list',
      env: {
        KASEKI_API_KEYS: 'alpha,, beta,   ,gamma ',
      },
      expectedConfig: {
        port: 8080,
        apiKeys: ['alpha', 'beta', 'gamma'],
        maxConcurrentRuns: 3,
      },
    },
  ])('loadConfig normalization: $name', ({ env, expectedConfig }) => {
    delete process.env.KASEKI_API_PORT;
    delete process.env.KASEKI_API_MAX_CONCURRENT_RUNS;
    process.env.KASEKI_RESULTS_DIR = '/tmp';
    Object.assign(process.env, env);

    const config = loadConfig();

    expect({
      port: config.port,
      apiKeys: config.apiKeys,
      maxConcurrentRuns: config.maxConcurrentRuns,
    }).toEqual(expectedConfig);
  });


  test('loadConfig parses API keys from file', () => {
    const keysFile = '/tmp/test-keys.txt';
    fs.writeFileSync(keysFile, 'key1\n# comment\nkey2\n');

    process.env.KASEKI_API_KEYS_FILE = keysFile;
    process.env.KASEKI_RESULTS_DIR = '/tmp';

    const config = loadConfig();
    expect(config.apiKeys).toEqual(['key1', 'key2']);

    fs.unlinkSync(keysFile);
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
      maxDiffBytes: 200000,
      agentTimeoutSeconds: 1200,
      logLevel: 'info' as const,
    };

    scheduler = new JobScheduler(config);
  });

  afterEach(() => {
    scheduler.shutdown();
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  test('submitJob creates a queued job', () => {
    // Saturate scheduler concurrency so a newly submitted job remains queued.
    (scheduler as any).running.add('existing-running-job');
    (scheduler as any).running.add('second-existing-running-job');

    const request = {
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
    };

    const submitted = scheduler.submitJob(request);

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

  test('submit/get/list keep job identity, request payload, and queue visibility coherent', () => {
    const request = {
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
    };

    const submitted = scheduler.submitJob(request);
    const retrieved = scheduler.getJob(submitted.id);
    const jobs = scheduler.listJobs();

    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(submitted.id);
    expect(retrieved?.request).toEqual(request);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe(submitted.id);
    expect(jobs[0].request).toEqual(request);
  });

  test('listJobs returns all jobs sorted by creation time (newest first)', () => {
    const request1 = { repoUrl: 'https://github.com/org/repo1', ref: 'main' };
    const request2 = { repoUrl: 'https://github.com/org/repo2', ref: 'main' };

    scheduler.submitJob(request1);
    scheduler.submitJob(request2);

    const jobs = scheduler.listJobs();
    expect(jobs.length).toBe(2);
    expect(jobs[0].request.repoUrl).toBe(request2.repoUrl); // Newest first
    expect(jobs[1].request.repoUrl).toBe(request1.repoUrl);
  });

  test('getQueueStatus reports pending and running count', () => {
    scheduler.submitJob({ repoUrl: 'https://github.com/org/repo', ref: 'main' });

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

    const exit = jest.fn((code: number) => {
      callOrder.push(`exit:${code}`);
      return undefined as never;
    }) as unknown as (code: number) => never;

    const gracefulShutdown = createGracefulShutdown({
      server,
      scheduler,
      forceExitAfterMs: 1000,
      exit,
    });

    const shutdownPromise = gracefulShutdown('SIGTERM');

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(scheduler.shutdown).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();

    closeCallback?.();

    await shutdownPromise;

    expect(callOrder).toEqual(['scheduler.shutdown', 'exit:0']);
  });
});
