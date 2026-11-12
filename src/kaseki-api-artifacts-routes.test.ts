// HTTP artifact behavior follows the public API contracts documented in docs/API.md.
// Contract: docs/API.md#list-run-artifacts-discovery-endpoint
jest.mock('./lib/subprocess-helpers', () => {
  const actual = jest.requireActual('./lib/subprocess-helpers');
  return { ...actual, execDockerCommand: jest.fn() };
});

jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  spawnSync: jest.fn(),
}));

jest.mock('./secrets/host-secrets-reader', () => ({
  readHostSecret: jest.fn(),
  resolveHostSecretPath: jest.fn((name) => `/agents/secrets/${name}`),
  getSecretLocations: jest.fn((name) => ({
    primary: `/agents/secrets/${name}`,
    secondary: `/home/user/secrets/${name}`,
  })),
  clearSecretCache: jest.fn(),
}));

import {
  cleanupTestApp,
  createTestApp,
  drainResponseBody,
  listenTestApp,
  restoreApiRouteTestDefaults,
  setupApiRouteTestDefaults,
} from '../tests/helpers/kaseki-api-routes.test-support';
import * as fs from 'node:fs';
import * as path from 'node:path';
import express from 'express';
import { createApiRouter } from './kaseki-api-routes';
import { IdempotencyStore } from './idempotency-store';
import { PreFlightValidator } from './pre-flight-validator';
import { createMockScheduler, createTestConfig } from './test-utils';

beforeEach(() => {
  setupApiRouteTestDefaults();
});

afterEach(() => {
  restoreApiRouteTestDefaults();
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
      expect(JSON.parse(await failureRes.text())).toMatchObject({ failureClass: 'validation' });

      const stderrRes = await fetch(`http://127.0.0.1:${port}/api/results/${jobId}/stderr.log`, { headers });
      expect(stderrRes.status).toBe(200);
      expect(await stderrRes.text()).toBe('stderr output');

      const stdoutRes = await fetch(`http://127.0.0.1:${port}/api/results/${jobId}/stdout.log`, { headers });
      expect(stdoutRes.status).toBe(200);
      expect(await stdoutRes.text()).toBe('stdout output');

      const validationRes = await fetch(`http://127.0.0.1:${port}/api/results/${jobId}/validation.log`, { headers });
      expect(validationRes.status).toBe(200);
      expect(await validationRes.text()).toBe('validation output');
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('redacts sensitive values from downloaded log artifacts', async () => {
    const jobId = 'kaseki-log-redaction';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'stdout.log'), 'secret=/run/secrets/kaseki/api-token\nsha256_fingerprint=0123456789abcdef0123456789abcdef');

    const scheduler = createMockScheduler({
      [jobId]: { id: jobId, status: 'completed', createdAt: new Date(), resultDir: jobDir }
    });
    const { server, port, idempotencyStore } = await createTestApp(scheduler, createTestConfig(resultsDir));

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/results/${jobId}/stdout.log`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain('[redacted secret path]');
      expect(body).toContain('sha256_fingerprint=[redacted]');
      expect(body).not.toContain('api-token');
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('redacts embedded stderr from downloaded failure artifacts', async () => {
    const jobId = 'kaseki-failure-redaction';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'failure.json'), JSON.stringify({
      failed_command: 'github token generation',
      stderr_tail: 'secret=/run/secrets/kaseki/github_app_private_key',
    }));

    const scheduler = createMockScheduler({
      [jobId]: { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir }
    });
    const { server, port, idempotencyStore } = await createTestApp(scheduler, createTestConfig(resultsDir));

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/results/${jobId}/failure.json`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      const body = await response.text();
      expect(body).toContain('[redacted secret path]');
      expect(body).not.toContain('github_app_private_key');
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
      const rawBody = await rawRes.text();
      expect(JSON.parse(rawBody)).toMatchObject({ overall_assessment: 'good' });

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
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/artifacts?manifest=true`, {
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

  test('provider failed run recommends gateway diagnostics first when available', async () => {
    const jobId = 'kaseki-provider-failed-artifacts';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'metadata.json'), JSON.stringify({
      provider_error_type: 'provider_error',
      failed_command: 'pi scouting agent',
    }));
    fs.writeFileSync(path.join(jobDir, '.gateway-diagnostics.jsonl'), '{"event":"provider_registered","apiType":"custom-gateway"}\n');
    fs.writeFileSync(path.join(jobDir, 'provider-attempts.jsonl'), '{"phase":"coding","attempt":"primary-1"}\n');
    fs.writeFileSync(path.join(jobDir, 'gateway-summary.json'), '{"provider_errors":1}\n');
    fs.writeFileSync(path.join(jobDir, 'failure.json'), JSON.stringify({ provider_error_type: 'provider_error' }));
    fs.writeFileSync(path.join(jobDir, 'result-summary.md'), '# summary');

    const scheduler = {
      getJob: (id: string) =>
        id === jobId
          ? { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir, exitCode: 88 }
          : undefined,
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
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/artifacts`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.recommended[0]).toBe('.gateway-diagnostics.jsonl');
      expect(body.recommended[1]).toBe('provider-attempts.jsonl');
      expect(body.recommended[2]).toBe('gateway-summary.json');
      expect(body.recommended).toContain('failure.json');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('running run exposes materialized diagnostic artifacts as available', async () => {
    const jobId = 'kaseki-running-artifacts';
    const fallbackDir = path.join(resultsDir, jobId);
    fs.mkdirSync(fallbackDir, { recursive: true });
    fs.writeFileSync(path.join(fallbackDir, 'result-summary.md'), '# running summary');
    fs.writeFileSync(path.join(fallbackDir, 'stderr.log'), 'not yet final');

    const scheduler = {
      getJob: (id: string) => (id === jobId ? { id: jobId, status: 'running', createdAt: new Date() } : undefined),
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
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
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/artifacts?manifest=true`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.runStatus).toBe('running');
      // Materialized general diagnostics stay visible while a run is active.
      expect(body.recommended).toContain('result-summary.md');
      const stderrFile = body.artifacts.find((artifact: any) => artifact.name === 'stderr.log');
      const summaryFile = body.artifacts.find((artifact: any) => artifact.name === 'result-summary.md');
      const goalCheckFile = body.artifacts.find((artifact: any) => artifact.name === 'goal-check.json');
      expect(stderrFile.available).toBe(true);
      expect(summaryFile.available).toBe(true);
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
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/artifacts?manifest=true`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;

      // Verify comprehensive enumeration
      expect(body.artifacts.length).toBeGreaterThan(10); // Should have many artifacts
      expect(body.artifactCount).toBeGreaterThan(5); // At least some available
      expect(body.downloadBaseUrl).toBe(`/api/v1/results/${jobId}/`);

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
      getJob: () => undefined,
      submitJob: jest.fn(),
      listJobs: () => [],
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir: fs.mkdtempSync(path.join('/tmp', 'kaseki-routes-notfound-test-')),
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

  test('phase stderr diagnostic logs are available through logs aliases', async () => {
    const jobId = 'kaseki-phase-stderr';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'goal-setting-stderr.log'), 'goal-setting stderr\n');
    fs.writeFileSync(path.join(jobDir, 'scouting-stderr.log'), 'scouting stderr\n');

    const scheduler = createMockScheduler({
      [jobId]: {
        id: jobId,
        status: 'failed',
        createdAt: new Date(),
        resultDir: jobDir,
        exitCode: 1
      } as any
    });
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const goalResponse = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/logs/goal-setting-stderr`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(goalResponse.status).toBe(200);
      await expect(goalResponse.json()).resolves.toMatchObject({
        logType: 'goal-setting-stderr',
        content: 'goal-setting stderr\n'
      });

      const scoutingResponse = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/logs/scouting-stderr`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(scoutingResponse.status).toBe(200);
      await expect(scoutingResponse.json()).resolves.toMatchObject({
        logType: 'scouting-stderr',
        content: 'scouting stderr\n'
      });
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('uppercase run ids resolve to lowercase retained jobs', async () => {
    const jobId = 'kaseki-147';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'stdout.log'), 'stdout via uppercase id\n');

    const job = {
      id: jobId,
      status: 'failed',
      createdAt: new Date(),
      resultDir: jobDir,
      exitCode: 1
    } as any;
    const scheduler = {
      ...createMockScheduler({ [jobId]: job }),
      getJob: jest.fn((id: string) => id === jobId ? job : undefined),
      listJobs: jest.fn(() => [job])
    } as any;
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const statusResponse = await fetch(`http://127.0.0.1:${port}/api/runs/KASEKI-147/status`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(statusResponse.status).toBe(200);
      await expect(statusResponse.json()).resolves.toMatchObject({ id: jobId, status: 'failed' });

      const logResponse = await fetch(`http://127.0.0.1:${port}/api/runs/KASEKI-147/logs/stdout`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(logResponse.status).toBe(200);
      await expect(logResponse.json()).resolves.toMatchObject({ content: 'stdout via uppercase id\n' });
    } finally {
      await cleanupTestApp(server, idempotencyStore);
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
      getJob: (id: string) => (id === job.id ? job : undefined),
      submitJob: jest.fn(() => job),
      listJobs: () => [job],
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
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

  test('removed progress endpoint returns 404; events remain available', async () => {
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
      expect(progressResponse.status).toBe(404);
      expect(await eventsResponse.json()).toMatchObject({ events: expect.any(Array) });
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('events endpoint falls back to live docker progress for active runs', async () => {
    const jobId = 'kaseki-live-events';
    const scheduler = {
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
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/artifacts?manifest=true`, {
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
      expect(body.diagnosticEntryPoint).toBe('pre-validation.log');
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

  test('analysis remains available when optional artifacts are malformed', async () => {
    const jobId = 'kaseki-analysis-malformed-optional-artifacts';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'metadata.json'), '{"model":"broken": fallback}');
    fs.writeFileSync(path.join(jobDir, 'changed-files.txt'), 'README.md\n');
    fs.writeFileSync(path.join(jobDir, 'git.diff'), 'diff --git a/README.md b/README.md\n');
    fs.writeFileSync(path.join(jobDir, 'validation-timings.tsv'), 'command\texit\telapsed\nvalid\t0\t3\nbroken\tnot-a-number\t?\n');

    const scheduler = createMockScheduler({
      [jobId]: { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir } as any,
    });
    const { server, port, idempotencyStore } = await createTestApp(scheduler, createTestConfig(resultsDir));

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/analysis`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.changes).toEqual({ changedFiles: ['README.md'], diffSize: expect.any(Number) });
      expect(body.validation).toEqual({ passed: true, commandResults: [{ command: 'valid', exitCode: 0, elapsed: 3 }] });
      expect(body.analysisWarnings).toEqual(expect.arrayContaining([
        expect.stringContaining('metadata.json'),
        expect.stringContaining('Skipped malformed validation-timings.tsv record')
      ]));
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('completed-run analysis does not warn about an absent failure artifact', async () => {
    const jobId = 'kaseki-analysis-completed-without-failure';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'validation-timings.tsv'), 'command\texit\telapsed\nvalid\t0\t3\n');

    const scheduler = createMockScheduler({
      [jobId]: { id: jobId, status: 'completed', createdAt: new Date(), resultDir: jobDir } as any,
    });
    const { server, port, idempotencyStore } = await createTestApp(scheduler, createTestConfig(resultsDir));

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/analysis`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.analysisWarnings ?? []).not.toEqual(expect.arrayContaining([
        expect.stringContaining('failure.json')
      ]));
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('analysis recovers a successful validation command from the validation log when timings are unavailable', async () => {
    const jobId = 'kaseki-analysis-validation-log-fallback';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'validation.log'), [
      '[validation pipeline] command=npm run check',
      '[validation pipeline] statuses: command=0 tee=0 filter=0',
    ].join('\n'));

    const scheduler = createMockScheduler({
      [jobId]: { id: jobId, status: 'completed', createdAt: new Date(), resultDir: jobDir } as any,
    });
    const { server, port, idempotencyStore } = await createTestApp(scheduler, createTestConfig(resultsDir));

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/analysis`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      expect((await response.json() as any).validation).toEqual({
        passed: true,
        commandResults: [{ command: 'npm run check', exitCode: 0, elapsed: 0 }],
      });
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('analysis uses terminal failure validation status over earlier successful timings', async () => {
    const jobId = 'kaseki-analysis-terminal-validation-failure';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'validation-timings.tsv'), 'command\texit\telapsed\nnpm run build\t0\t3\n');
    fs.writeFileSync(path.join(jobDir, 'failure.json'), JSON.stringify({ validation_exit_code: 1 }));

    const scheduler = createMockScheduler({
      [jobId]: { id: jobId, status: 'failed', createdAt: new Date(), resultDir: jobDir } as any,
    });
    const { server, port, idempotencyStore } = await createTestApp(scheduler, createTestConfig(resultsDir));

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/analysis`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      expect((await response.json() as any).validation).toEqual({
        passed: false,
        commandResults: [{ command: 'npm run build', exitCode: 0, elapsed: 3 }],
      });
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('runs list includes terminal exit code from result metadata when scheduler job lacks it', async () => {
    const jobId = 'kaseki-list-exit-code';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'metadata.json'), '{"exit_code":127}');

    const scheduler = {
      getJob: jest.fn(),
      submitJob: jest.fn(),
      listJobs: () => [{ id: jobId, status: 'failed', createdAt: new Date('2026-05-07T12:00:00Z'), resultDir: jobDir }],
      cancelJob: jest.fn()
    } as any;

    const config = {
      port: 0,
      apiKeys: ['test-key'],
      resultsDir,
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

  test('runs list includes compact phase and diagnostic status for failed runs', async () => {
    const jobId = 'kaseki-list-diagnostics';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'metadata.json'), JSON.stringify({
      exit_code: 86,
      failed_command: 'pi scouting agent',
      scouting_attempts: 2,
      provider_error_message: 'Schema validation failed',
      provider_error_provider: 'gateway',
    }));
    fs.writeFileSync(path.join(jobDir, 'scouting-validation-errors.jsonl'), JSON.stringify({
      reason_code: 'schema_mismatch', field: 'requirements', severity: 'critical',
    }) + '\n');

    const scheduler = createMockScheduler({
      [jobId]: { id: jobId, status: 'failed', createdAt: new Date('2026-05-07T12:00:00Z'), resultDir: jobDir } as any,
    });
    scheduler.listJobs.mockReturnValue([
      { id: jobId, status: 'failed', createdAt: new Date('2026-05-07T12:00:00Z'), resultDir: jobDir } as any,
    ]);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, createTestConfig(resultsDir));

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.runs[0]).toMatchObject({
        id: jobId,
        exitCode: 86,
        phaseOutcome: { scouting: 'failed', weaving: 'not_reached' },
        diagnosticEntryPoint: 'scouting-validation-errors.jsonl',
      });
    } finally {
      await cleanupTestApp(server, idempotencyStore);
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
      expect(body.runs[0].resultDir).toBeUndefined();
      expect(body.hasMore).toBe(true);
      expect(typeof body.nextCursor).toBe('string');
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('runs list uses a stable cursor and supports state and repository filters', async () => {
    const jobs = [
      { id: 'kaseki-4', status: 'failed', createdAt: new Date('2026-05-07T12:03:00Z'), request: { repoUrl: 'https://github.com/org/a' } },
      { id: 'kaseki-3', status: 'completed', createdAt: new Date('2026-05-07T12:02:00Z'), request: { repoUrl: 'https://github.com/org/a' } },
      { id: 'kaseki-2', status: 'completed', createdAt: new Date('2026-05-07T12:01:00Z'), request: { repoUrl: 'https://github.com/org/b' } },
      { id: 'kaseki-1', status: 'completed', createdAt: new Date('2026-05-07T12:00:00Z'), request: { repoUrl: 'https://github.com/org/a' } },
    ];
    const scheduler = createMockScheduler(Object.fromEntries(jobs.map((job) => [job.id, job as any])));
    scheduler.listAllJobs = jest.fn().mockResolvedValue(jobs as any);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, createTestConfig(resultsDir));
    try {
      const headers = { Authorization: 'Bearer test-key' };
      const first = await fetch(`http://127.0.0.1:${port}/api/runs?limit=1&status=completed&repo=https%3A%2F%2Fgithub.com%2Forg%2Fa`, { headers });
      const firstBody = await first.json() as any;
      expect(firstBody.runs.map((run: any) => run.id)).toEqual(['kaseki-3']);
      expect(firstBody.total).toBe(2);
      const second = await fetch(`http://127.0.0.1:${port}/api/runs?limit=1&status=completed&repo=https%3A%2F%2Fgithub.com%2Forg%2Fa&cursor=${encodeURIComponent(firstBody.nextCursor)}`, { headers });
      expect((await second.json() as any).runs.map((run: any) => run.id)).toEqual(['kaseki-1']);
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
        displayName: 'Weaving',
        percentComplete: 42,
        message: 'pi coding agent',
        updatedAt: '2026-05-05T00:00:00.000Z',
        source: 'progress.jsonl'
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
        updatedAt: '2026-05-05T00:00:01.000Z',
        source: 'docker-logs'
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
        updatedAt: '2026-05-05T00:00:02.000Z',
        source: 'docker-logs'
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
