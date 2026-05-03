// fallow-ignore-next-line unused-files
import * as fs from 'fs';
import * as path from 'path';
import express from 'express';
import { AddressInfo } from 'net';
import { decodeUtf8TailSafely, readArtifactContent, tailLogByLines } from './kaseki-api-routes';
import { ResultCache } from './result-cache';
import { createApiRouter } from './kaseki-api-routes';
import { IdempotencyStore } from './idempotency-store';
import { PreFlightValidator } from './pre-flight-validator';

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

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { readTailBytes } = require('./kaseki-api-routes') as typeof import('./kaseki-api-routes');
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

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 0, maxConcurrent: 1 }),
      getJob: (id: string) => id === jobId
        ? { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir }
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
      maxDiffBytes: 200000,
      agentTimeoutSeconds: 1200,
      logLevel: 'info' as const,
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));

    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
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
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('non-failed run is blocked from retrieving failure diagnostics artifacts', async () => {
    const jobId = 'kaseki-running-1';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'failure.json'), JSON.stringify({ failureClass: 'validation' }));

    const scheduler = {
      getQueueStatus: () => ({ pending: 0, running: 1, maxConcurrent: 1 }),
      getJob: (id: string) => id === jobId
        ? { id: jobId, status: 'running', createdAt: new Date(), resultDir: jobDir }
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
      maxDiffBytes: 200000,
      agentTimeoutSeconds: 1200,
      logLevel: 'info' as const,
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));

    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    const headers = { Authorization: 'Bearer test-key' };

    try {
      const failureRes = await fetch(`http://127.0.0.1:${port}/api/results/${jobId}/failure.json`, { headers });
      expect(failureRes.status).toBe(400);
      const failureBody = (await failureRes.json()) as any;
      expect(failureBody.title).toBe('Bad Request');
      expect(failureBody.status).toBe(400);
      expect(failureBody.detail).toContain('Artifact only available for failed runs: failure.json');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
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
      maxDiffBytes: 200000,
      agentTimeoutSeconds: 1200,
      logLevel: 'info' as const,
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;

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
      maxDiffBytes: 200000,
      agentTimeoutSeconds: 1200,
      logLevel: 'info' as const,
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/artifacts`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.runStatus).toBe('running');
      expect(body.recommended).toContain('result-summary.md');
      const stderrFile = body.artifacts.find((artifact: any) => artifact.name === 'stderr.log');
      const summaryFile = body.artifacts.find((artifact: any) => artifact.name === 'result-summary.md');
      expect(stderrFile.available).toBe(false);
      expect(summaryFile.available).toBe(true);
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
      maxDiffBytes: 200000,
      agentTimeoutSeconds: 1200,
      logLevel: 'info' as const,
    };

    const idempotencyStore = new IdempotencyStore(config.resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
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
      maxDiffBytes: 200000,
      agentTimeoutSeconds: 1200,
      logLevel: 'info' as const,
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.status).toBe('failed');
      expect(body.artifacts).toEqual({
        metadataJson: true,
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
      maxDiffBytes: 200000,
      agentTimeoutSeconds: 1200,
      logLevel: 'info' as const,
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/status`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.artifacts).toEqual({
        metadataJson: false,
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
});
