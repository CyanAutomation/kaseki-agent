import * as fs from 'fs';
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

  test('loadConfig validates port number', () => {
    process.env.KASEKI_API_KEYS = 'test-key';
    process.env.KASEKI_API_PORT = 'invalid';
    process.env.KASEKI_RESULTS_DIR = '/tmp';

    expect(() => loadConfig()).toThrow(/port number/i);
  });

  test('loadConfig with valid environment', () => {
    process.env.KASEKI_API_KEYS = 'key1,key2';
    process.env.KASEKI_API_PORT = '8080';
    process.env.KASEKI_MAX_CONCURRENT_RUNS = '3';
    process.env.KASEKI_RESULTS_DIR = '/tmp';

    const config = loadConfig();
    expect(config.port).toBe(8080);
    expect(config.apiKeys).toEqual(['key1', 'key2']);
    expect(config.maxConcurrentRuns).toBe(3);
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
  test('RunRequestSchema validates required fields', async () => {
    const request = {
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
    };

    const result = RunRequestSchema.parse(request);
    expect(result.repoUrl).toBe('https://github.com/org/repo');
    expect(result.ref).toBe('main');
  });

  test('RunRequestSchema rejects invalid URL', async () => {
    const request = {
      repoUrl: 'not-a-url',
      ref: 'main',
    };

    expect(() => RunRequestSchema.parse(request)).toThrow();
  });

  test('RunRequestSchema provides default ref', async () => {
    const request = {
      repoUrl: 'https://github.com/org/repo',
    };

    const result = RunRequestSchema.parse(request);
    expect(result.ref).toBe('main');
  });

  test('RunRequestSchema validates taskMode enum', async () => {
    const request = {
      repoUrl: 'https://github.com/org/repo',
      taskMode: 'invalid',
    };

    expect(() => RunRequestSchema.parse(request)).toThrow();
  });
});

describe('Job Scheduler', () => {
  let scheduler: JobScheduler;

  beforeEach(() => {
    const config = {
      port: 8080,
      apiKeys: ['test-key'],
      resultsDir: '/tmp/kaseki-results',
      logDir: '/tmp/kaseki-api',
      maxConcurrentRuns: 2,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 200000,
      agentTimeoutSeconds: 1200,
      logLevel: 'info' as const,
    };

    scheduler = new JobScheduler(config);
  });

  test('submitJob creates a queued job', () => {
    const request = {
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
    };

    const job = scheduler.submitJob(request);
    expect(job.status).toBe('queued');
    expect(job.id).toMatch(/^kaseki-[0-9a-f-]{36}$/);
    expect(job.request).toEqual(request);
  });

  test('getJob retrieves a submitted job', () => {
    const request = {
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
    };

    const submitted = scheduler.submitJob(request);
    const retrieved = scheduler.getJob(submitted.id);

    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(submitted.id);
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
      pending: 1,
      running: 0,
      maxConcurrent: 2,
    });
  });
});
