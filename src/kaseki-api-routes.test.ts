// Mock Docker subprocess helpers so preflight route tests can assert generated Docker args deterministically.
// Contract: docs/API.md#api-endpoints
// HTTP behavior here follows the public contracts in docs/API.md; external
// effects are mocked so route assertions stay deterministic.
jest.mock('./lib/subprocess-helpers', () => {
  const actual = jest.requireActual('./lib/subprocess-helpers');
  return {
    ...actual,
    execDockerCommand: jest.fn()
  };
});

// Mock Pi provider subprocess calls while keeping other child_process helpers real.
jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  spawnSync: jest.fn()
}));

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
import { execFileSync } from 'node:child_process';
import express from 'express';
import type { AddressInfo } from 'net';
import { TextDecoder } from 'util';
import * as hostSecretsReader from './secrets/host-secrets-reader';
import { decodeUtf8TailSafely, tailLogByLines } from './utils/utf8-helpers';
import { classifyDockerFailure } from './lib/subprocess-helpers';
import { readArtifactContent } from './routes/artifact-routes';
import { ResultCache } from './result-cache';
import { validateGitHubAppPrivateKey } from './github-app-private-key';
import { createApiRouter } from './kaseki-api-routes';
import { RunAlreadyActiveError } from './job-scheduler';
import { clearContainerPreflightResults, logContainerPreflightResults } from './startup/container-preflight';
import { clearCachedStartupHealthReport, writeStartupHealthArtifacts } from './kaseki-api/startup-summary-artifact';
import type { StartupHealthReport } from './kaseki-api-types';
import { IdempotencyStore } from './idempotency-store';
import { PreFlightValidator } from './pre-flight-validator';
import { createMockScheduler, createTestConfig } from './test-utils';
import type { TaskAdmissionEvaluator } from './task-admission';
import * as gatewaySmoke from './kaseki-api-gateway-smoke';
import { StorageCapacityError } from './storage-capacity';
import { SoyuzSubmissionClient } from './integrations/soyuz/SoyuzSubmissionClient';
import type { SoyuzAdapterConfig } from './integrations/soyuz/config';
import {
  cleanupTestApp,
  createTestApp,
  defaultGithubPrivateKeyPem,
  drainResponseBody,
  execDockerCommandMock,
  listenTestApp,
  restoreApiRouteTestDefaults,
  setupApiRouteTestDefaults,
  spawnSyncMock,
} from '../tests/helpers/kaseki-api-routes.test-support';

describe('kaseki-api-routes scorecard integration', () => {
  test('registers the protected scorecard route in the /api assembly', async () => {
    const config = createTestConfig(fs.mkdtempSync(path.join(os.tmpdir(), 'scorecard-api-')));
    const harness = await createTestApp(createMockScheduler(), config);
    try {
      const response = await fetch(`http://127.0.0.1:${harness.port}/api/runs/missing/scorecard`, {
        headers: { Authorization: `Bearer ${config.apiKeys[0]}` },
      });
      expect(response.status).toBe(404);
      expect((await response.json()).title).toBe('Run not found');
    } finally {
      await cleanupTestApp(harness.server, harness.idempotencyStore);
    }
  });
});

describe('webhook test egress policy', () => {
  test('rejects loopback destinations through the API route', async () => {
    const config = createTestConfig(fs.mkdtempSync(path.join(os.tmpdir(), 'webhook-egress-api-')));
    const harness = await createTestApp(createMockScheduler(), config);
    try {
      const response = await fetch(`http://127.0.0.1:${harness.port}/api/webhooks/test`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKeys[0]}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: 'https://127.0.0.1/internal' }),
      });
      expect(response.status).toBe(400);
      expect((await response.json()).detail).toContain('non-public network address');
    } finally {
      await cleanupTestApp(harness.server, harness.idempotencyStore);
    }
  });
});

describe('API access quotas and request identifiers', () => {
  test('rate limits run retry submissions before the retry handler repeats work', async () => {
    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-api-retry-limit-'));
    const config = createTestConfig(resultsDir);
    config.apiRequestsPerMinute = 1;
    const scheduler = {
      ...createMockScheduler(),
      getJobIncludingHistory: jest.fn(async () => undefined),
    } as any;
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);
    const request = () => fetch(`http://127.0.0.1:${port}/api/runs/missing/retry`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: '77777777-7777-4777-8777-777777777777' }),
    });

    try {
      const first = await request();
      const second = await request();

      expect(first.status).toBe(404);
      expect(second.status).toBe(429);
      expect(scheduler.getJobIncludingHistory).toHaveBeenCalledTimes(1);
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('rate limits invalid bearer credentials by client IP instead of attacker-controlled tokens', async () => {
    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-api-invalid-key-limit-'));
    const config = createTestConfig(resultsDir);
    config.apiRequestsPerMinute = 1;
    const { server, port, idempotencyStore } = await createTestApp(createMockScheduler(), config);
    try {
      const first = await fetch(`http://127.0.0.1:${port}/api/capabilities`, {
        headers: { Authorization: 'Bearer invalid-one' },
      });
      const second = await fetch(`http://127.0.0.1:${port}/api/capabilities`, {
        headers: { Authorization: 'Bearer invalid-two' },
      });

      expect(first.status).toBe(401);
      expect(second.status).toBe(429);
      expect(Number(second.headers.get('retry-after'))).toBeGreaterThan(0);
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('keeps independent valid API keys in separate rate-limit buckets', async () => {
    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-api-key-limit-buckets-'));
    const config = createTestConfig(resultsDir);
    config.apiKeys = ['test-key', 'other-key'];
    config.apiRequestsPerMinute = 1;
    const { server, port, idempotencyStore } = await createTestApp(createMockScheduler(), config);
    try {
      const first = await fetch(`http://127.0.0.1:${port}/api/capabilities`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      const second = await fetch(`http://127.0.0.1:${port}/api/capabilities`, {
        headers: { Authorization: 'Bearer other-key' },
      });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('allows a valid bearer key to submit runs without per-key permissions', async () => {
    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-api-key-run-access-'));
    const scheduler = createMockScheduler();
    scheduler.submitJob.mockImplementation(async request => ({
      id: 'kaseki-key-run-access',
      status: 'queued',
      createdAt: new Date('2026-05-15T00:00:00.000Z'),
      resultDir: path.join(resultsDir, 'kaseki-key-run-access'),
      request,
    }));
    const config = createTestConfig(resultsDir);
    const taskAdmissionEvaluator: TaskAdmissionEvaluator = async () => ({
      allowed: true,
      status: 'allowed',
      reason: 'test accepted',
      responseTime: 1,
    });
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config, taskAdmissionEvaluator);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoUrl: 'https://github.com/org/repo',
          taskPrompt: 'Submit a run with a valid bearer key',
          publishMode: 'none',
          idempotencyKey: '99999999-9999-4999-8999-999999999999',
        }),
      });

      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({ id: 'kaseki-key-run-access' });
      expect(scheduler.submitJob).toHaveBeenCalledTimes(1);
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('enforces per-key request quotas', async () => {
    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-api-usage-'));
    const config = createTestConfig(resultsDir);
    config.apiRequestsPerMinute = 1;
    const { server, port, idempotencyStore } = await createTestApp(createMockScheduler(), config);
    try {
      const headers = { Authorization: 'Bearer test-key' };
      expect((await fetch(`http://127.0.0.1:${port}/api/capabilities`, { headers })).status).toBe(200);
      const limited = await fetch(`http://127.0.0.1:${port}/api/capabilities`, { headers });
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('exposes per-key request usage and reports unknown token cost as null', async () => {
    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-api-usage-view-'));
    const { server, port, idempotencyStore } = await createTestApp(createMockScheduler(), createTestConfig(resultsDir));
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/usage`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      const body = await response.json() as any;
      expect(response.status).toBe(200);
      expect(body.requestCount).toBe(1);
      expect(body.costUsd).toBeNull();
      expect(body.limits.requestsPerMinute).toBeGreaterThan(0);
      expect(body).not.toHaveProperty('githubIssueLookupCount');
      expect(body.limits).not.toHaveProperty('githubIssuesPerMinute');
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('does not expose the removed GitHub issues endpoint', async () => {
    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-api-removed-github-issues-'));
    const { server, port, idempotencyStore } = await createTestApp(createMockScheduler(), createTestConfig(resultsDir));
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/github-issues`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'owner/repo' }),
      });

      expect(response.status).toBe(404);
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });
});

beforeEach(() => {
  setupApiRouteTestDefaults();
});

afterEach(() => {
  restoreApiRouteTestDefaults();
});

describe('HTTP hardening headers', () => {
  let harness: Awaited<ReturnType<typeof createTestApp>> | undefined;

  afterEach(async () => {
    if (harness) {
      await cleanupTestApp(harness.server, harness.idempotencyStore);
      harness = undefined;
    }
  });

  test('does not expose Express and sets nosniff on API responses', async () => {
    const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-api-headers-'));
    const config = createTestConfig(resultsDir);
    harness = await createTestApp(createMockScheduler(), config);

    const res = await fetch(`http://127.0.0.1:${harness.port}/api/ready`);

    expect(res.headers.get('x-powered-by')).toBeNull();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });
});

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
    const jobD = {
      id: 'kaseki-98',
      status: 'failed' as const,
      createdAt: new Date('2026-05-25T07:00:00.000Z'),
      resultDir: path.join(resultsDir, 'kaseki-98'),
      request: { repoUrl: 'https://github.com/org/repo-d', ref: 'main' }
    };
    const jobE = {
      id: 'kaseki-97',
      status: 'completed' as const,
      createdAt: new Date('2026-05-25T06:00:00.000Z'),
      resultDir: path.join(resultsDir, 'kaseki-97'),
      request: { repoUrl: 'https://github.com/org/repo-e', ref: 'main' }
    };
    const jobF = {
      id: 'kaseki-96',
      status: 'failed' as const,
      createdAt: new Date('2026-05-25T05:00:00.000Z'),
      resultDir: path.join(resultsDir, 'kaseki-96'),
      request: { repoUrl: 'https://github.com/org/repo-f', ref: 'main' }
    };
    for (const job of [jobA, jobB, jobC, jobD, jobE]) fs.mkdirSync(job.resultDir, { recursive: true });
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
    fs.writeFileSync(path.join(jobC.resultDir, 'run-evaluation-events.jsonl'), '{"type":"message"}\n');
    fs.writeFileSync(path.join(jobC.resultDir, 'run-evaluation.json'), JSON.stringify({
      overall_assessment: 'mixed',
      reviewer_confidence: 'low',
      task_completion_score: 2,
    }) + '\\n');
    for (const job of [jobD, jobE]) {
      fs.writeFileSync(path.join(job.resultDir, 'run-evaluation.json'), JSON.stringify({
        overall_assessment: 'good', reviewer_confidence: 'medium', task_completion_score: 3,
      }));
    }

    const scheduler = createMockScheduler({
      [jobA.id]: jobA as any,
      [jobB.id]: jobB as any,
      [jobC.id]: jobC as any,
      [jobD.id]: jobD as any,
      [jobE.id]: jobE as any,
      [jobF.id]: jobF as any,
    });
    scheduler.listJobs.mockReturnValue([jobA, jobB, jobC, jobD, jobE, jobF]);
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/improvements?limit=6`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      const body = (await response.json()) as any;

      expect(response.status).toBe(200);
      expect(body.evaluator).toEqual({
        available: 4,
        missing: 0,
        invalid: 1,
        expired: 1,
        diagnostics: { missing_artifact: 1, artifacts_expired: 1 },
      });
      expect(body.counts.byAssessment.good).toBe(3);
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
      expect(body.runs[5]).toMatchObject({ assessment: 'unavailable', confidence: 'unavailable', evaluationDiagnostic: 'artifacts_expired' });
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

describe('Soyuz submission routing', () => {
  const soyuzId = '11111111-1111-4111-8111-111111111111';
  const sourceId = '22222222-2222-4222-8222-222222222222';

  function makeSubmissionClient(fetchImpl: typeof fetch): SoyuzSubmissionClient {
    const config: SoyuzAdapterConfig = {
      enabled: false,
      submissionEnabled: true,
      submissionApiToken: 'soyuz-submission-token-123456',
      apiUrl: 'https://soyuz.example.test',
      workerApiToken: 'soyuz-worker-token-123456',
      accountId: '',
      queueId: '',
      queueApiToken: '',
      workerId: '',
      pollIntervalMs: 5_000,
      visibilityTimeoutMs: 120_000,
      requestTimeoutMs: 20_000,
      cancellationPollIntervalMs: 15_000,
      heartbeatIntervalMs: 60_000,
    };
    return new SoyuzSubmissionClient(config, fetchImpl);
  }

  function apiResponse(data: Record<string, unknown>, status = 202): Response {
    return new Response(JSON.stringify({ data }), { status, headers: { 'content-type': 'application/json' } });
  }

  test('uses a durable idempotency intent and returns the Soyuz UUID as the public ID', async () => {
    const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-soyuz-submit-'));
    const config = createTestConfig(resultsDir);
    const scheduler = createMockScheduler();
    const fetchImpl = jest.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith(`/v1/worker/runs/${soyuzId}`)) {
        return apiResponse({
          runId: soyuzId,
          status: 'queued',
          updatedAt: '2026-10-17T12:00:00.000Z',
          origin: { type: 'kaseki', id: 'kaseki-prod' },
        }, 200);
      }
      return apiResponse({
        id: soyuzId,
        status: 'queued',
        createdAt: '2026-10-17T12:00:00.000Z',
        origin: { type: 'kaseki', id: 'kaseki-prod' },
      });
    });
    const client = makeSubmissionClient(fetchImpl as typeof fetch);
    const harness = await createTestApp(scheduler, config, undefined, client);
    const key = crypto.randomUUID();
    const body = { repoUrl: 'https://github.com/example/repo', ref: 'main', taskPrompt: 'Add a focused health check.', publishMode: 'none', idempotencyKey: key };
    const submit = () => fetch(`http://127.0.0.1:${harness.port}/api/runs`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(body),
    });

    try {
      const first = await submit();
      const firstBody = await first.json() as any;
      const replay = await submit();
      const replayBody = await replay.json() as any;
      const status = await fetch(`http://127.0.0.1:${harness.port}/api/runs/${soyuzId}/status`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      const statusBody = await status.json() as any;
      const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, NonNullable<Parameters<typeof fetch>[1]>];

      expect(first.status).toBe(202);
      expect(firstBody.id).toBe(soyuzId);
      expect(firstBody.origin).toEqual({ type: 'kaseki', id: 'kaseki-prod' });
      expect(replay.status).toBe(200);
      expect(replayBody.id).toBe(soyuzId);
      expect(status.status).toBe(200);
      expect(statusBody.id).toBe(soyuzId);
      expect(statusBody.origin).toEqual({ type: 'kaseki', id: 'kaseki-prod' });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(url).toBe('https://soyuz.example.test/v1/runs');
      expect(new Headers(init.headers).get('idempotency-key')).toBe(key);
      expect(JSON.parse(String(init.body)).idempotencyKey).toBe(key);
      expect(scheduler.submitJob).not.toHaveBeenCalled();
    } finally {
      await cleanupTestApp(harness.server, harness.idempotencyStore);
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('submits directly to the local scheduler when requested, even with Soyuz routing enabled', async () => {
    const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-soyuz-local-submit-'));
    const config = createTestConfig(resultsDir);
    const scheduler = createMockScheduler();
    scheduler.submitJob.mockImplementation(async request => ({
      id: 'kaseki-local-fallback',
      status: 'queued',
      createdAt: new Date('2026-10-17T12:00:00.000Z'),
      resultDir: path.join(resultsDir, 'kaseki-local-fallback'),
      request,
    }));
    const fetchImpl = jest.fn(async () => apiResponse({
      id: soyuzId,
      status: 'queued',
      createdAt: '2026-10-17T12:00:00.000Z',
      origin: { type: 'kaseki', id: 'kaseki-prod' },
    }));
    const harness = await createTestApp(scheduler, config, undefined, makeSubmissionClient(fetchImpl as typeof fetch));
    const key = crypto.randomUUID();
    const baseRequest = {
      repoUrl: 'https://github.com/example/repo',
      ref: 'main',
      taskPrompt: 'Add a focused health check.',
      publishMode: 'none',
      idempotencyKey: key,
    };
    const localRequestBody = {
      ...baseRequest,
      webhookConfig: { url: 'https://hooks.example.test/run', secret: 'webhook-secret-value-123456' },
    };
    const submitLocal = () => fetch(`http://127.0.0.1:${harness.port}/api/runs/local`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(localRequestBody),
    });

    try {
      const localResponse = await submitLocal();
      const localBody = await localResponse.json() as any;
      const localReplay = await submitLocal();
      const localReplayBody = await localReplay.json() as any;
      const soyuzResponse = await fetch(`http://127.0.0.1:${harness.port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify(baseRequest),
      });
      const soyuzBody = await soyuzResponse.json() as any;

      expect(localResponse.status).toBe(202);
      expect(localBody.id).toBe('kaseki-local-fallback');
      expect(localReplay.status).toBe(200);
      expect(localReplayBody.id).toBe('kaseki-local-fallback');
      expect(scheduler.submitJob).toHaveBeenCalledTimes(1);
      expect(scheduler.submitJob).toHaveBeenCalledWith(expect.objectContaining({
        webhookConfig: expect.objectContaining({ url: 'https://hooks.example.test/run' }),
      }));
      expect(soyuzResponse.status).toBe(202);
      expect(soyuzBody.id).toBe(soyuzId);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      await cleanupTestApp(harness.server, harness.idempotencyStore);
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('rejects webhook secrets before creating a Soyuz submission intent', async () => {
    const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-soyuz-webhook-'));
    const fetchImpl = jest.fn(async () => apiResponse({ id: soyuzId, status: 'queued', createdAt: '2026-10-17T12:00:00.000Z' }));
    const scheduler = createMockScheduler();
    const harness = await createTestApp(scheduler, createTestConfig(resultsDir), undefined, makeSubmissionClient(fetchImpl as typeof fetch));
    const key = crypto.randomUUID();

    try {
      const response = await fetch(`http://127.0.0.1:${harness.port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({
          repoUrl: 'https://github.com/example/repo',
          ref: 'main',
          taskPrompt: 'Add a focused health check.',
          publishMode: 'none',
          idempotencyKey: key,
          webhookConfig: { url: 'https://hooks.example.test/run', secret: 'webhook-secret-value-123456' },
        }),
      });
      const body = await response.json() as any;

      expect(response.status).toBe(400);
      expect(body.detail).toContain('does not support webhookConfig');
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(scheduler.submitJob).not.toHaveBeenCalled();
    } finally {
      await cleanupTestApp(harness.server, harness.idempotencyStore);
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('keeps the submission intent after an uncertain network failure', async () => {
    const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-soyuz-uncertain-'));
    const config = createTestConfig(resultsDir);
    const fetchImpl = jest.fn(async () => { throw new Error('socket reset after request'); });
    const harness = await createTestApp(createMockScheduler(), config, undefined, makeSubmissionClient(fetchImpl as typeof fetch));
    const key = crypto.randomUUID();
    const submit = () => fetch(`http://127.0.0.1:${harness.port}/api/runs`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ repoUrl: 'https://github.com/example/repo', ref: 'main', taskPrompt: 'Add a focused health check.', publishMode: 'none', idempotencyKey: key }),
    });

    try {
      const uncertain = await submit();
      const uncertainBody = await uncertain.json() as any;
      const immediateReplay = await submit();

      expect(uncertain.status).toBe(503);
      expect(uncertainBody.idempotencyKey).toBe(key);
      expect(uncertainBody.retryWithSameIdempotencyKey).toBe(true);
      expect(immediateReplay.status).toBe(409);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      await cleanupTestApp(harness.server, harness.idempotencyStore);
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test.each(['completed', 'failed', 'cancelled', 'admission_failed'])(
    'routes canonical Soyuz retries through the retry operation for terminal state %s',
    async (sourceStatus) => {
      const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-soyuz-retry-'));
      const config = createTestConfig(resultsDir);
      const fetchImpl = jest.fn(async (input: Parameters<typeof fetch>[0]) => {
        const url = String(input);
        if (url.endsWith(`/v1/worker/runs/${sourceId}`)) {
          return apiResponse({ runId: sourceId, status: sourceStatus, updatedAt: '2026-10-17T12:00:00.000Z' }, 200);
        }
        return apiResponse({
          id: soyuzId,
          status: 'queued',
          createdAt: '2026-10-17T12:01:00.000Z',
          origin: { type: 'kaseki', id: 'kaseki-prod' },
          retryOf: sourceId,
        });
      });
      const harness = await createTestApp(createMockScheduler(), config, undefined, makeSubmissionClient(fetchImpl as typeof fetch));
      const key = crypto.randomUUID();
      const retry = () => fetch(`http://127.0.0.1:${harness.port}/api/runs/${sourceId}/retry`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: key }),
      });

      try {
        const first = await retry();
        const firstBody = await first.json() as any;
        const replay = await retry();
        const replayBody = await replay.json() as any;

        expect(first.status).toBe(202);
        expect(firstBody.id).toBe(soyuzId);
        expect(firstBody.retryOf).toBe(sourceId);
        expect(replay.status).toBe(200);
        expect(replayBody.id).toBe(soyuzId);
        expect(fetchImpl.mock.calls.filter(([input]) => String(input).includes('/retry'))).toHaveLength(1);
      } finally {
        await cleanupTestApp(harness.server, harness.idempotencyStore);
        fs.rmSync(resultsDir, { recursive: true, force: true });
      }
    },
  );
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
        recommendedCurrentEndpoint: '/api/v1/preflight',
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

  test('GET /api/capabilities reports the single-run agent limit', async () => {
    const { server, port, idempotencyStore } = await createTestApp(createMockScheduler(), createTestConfig(resultsDir));
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/capabilities`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ limits: { maxActiveRunsPerAgent: 1 } });
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
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
      expect(body.reasons).toContain('results_dir_unwritable');
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
      expect(body).not.toContain('kaseki_queue_pending');
      expect(body).toContain('kaseki_runs_total');
      expect(body).toContain('kaseki_run_duration_seconds');
      expect(body).toContain('kaseki_evaluator_artifact_completion_rate');
      expect(body).toContain('kaseki_goal_check_failures_total');
      expect(body).toContain('kaseki_dependency_cache_bytes 4096');
      expect(body).toContain('kaseki_dependency_cache_entries 2');
      expect(body).toContain('kaseki_dependency_cache_config_max_bytes 8192');
      expect(body).toContain('kaseki_dependency_cache_config_max_age_days 7');
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });
});

describe('canonical run resource', () => {
  test('returns stable lifecycle metadata and resource links without filesystem paths', async () => {
    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-run-resource-'));
    const jobId = 'kaseki-resource-1';
    const job = {
      id: jobId,
      status: 'completed',
      createdAt: new Date('2026-08-02T00:00:00.000Z'),
      startedAt: new Date('2026-08-02T00:01:00.000Z'),
      completedAt: new Date('2026-08-02T00:02:00.000Z'),
      resultDir: path.join(resultsDir, jobId),
      request: { repoUrl: 'https://github.com/org/repo', projectName: 'test-project' },
    };
    const scheduler = createMockScheduler({ [jobId]: job as any });
    (scheduler as any).getJobIncludingHistory = jest.fn().mockResolvedValue(job);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, createTestConfig(resultsDir));
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      const body = await response.json() as any;
      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        id: jobId,
        status: 'completed',
        projectName: 'test-project',
        repoUrl: 'https://github.com/org/repo',
        links: { status: `/api/v1/runs/${jobId}/status`, artifacts: `/api/v1/runs/${jobId}/artifacts` },
      });
      expect(body.resultDir).toBeUndefined();
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      fs.rmSync(resultsDir, { recursive: true, force: true });
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
          project_name: 'aliased-project',
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
          projectName: 'aliased-project',
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
    scheduler.submitJob.mockImplementation(async request => ({
      id: 'kaseki-alias',
      status: 'queued',
      createdAt: new Date('2026-05-15T00:00:00.000Z'),
      resultDir: path.join(resultsDir, 'kaseki-alias'),
      request
    }));
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_url: 'https://github.com/org/repo',
          project_name: 'aliased-project',
          git_ref: 'main',
          task_prompt: 'Run a first-time setup task smoke test',
          publish_mode: 'none',
          idempotency_key: crypto.randomUUID(),
        })
      });

      const body = (await res.json()) as any;
      if (res.status !== 202) {
        throw new Error(`Expected 202, got ${res.status}: ${JSON.stringify(body)}`);
      }
      expect(body).toEqual(expect.objectContaining({
        id: 'kaseki-alias',
        projectName: 'aliased-project'
      }));
      expect(scheduler.submitJob).toHaveBeenCalledWith(
        expect.objectContaining({
          repoUrl: 'https://github.com/org/repo',
          projectName: 'aliased-project',
          ref: 'main',
          taskPrompt: 'Run a first-time setup task smoke test',
          publishMode: 'none'
        })
      );
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('forwards JEV admission hints as advisory job metadata without requesting review', async () => {
    const scheduler = createMockScheduler();
    scheduler.submitJob.mockImplementation(async request => ({
      id: 'kaseki-jev-routing',
      status: 'queued',
      createdAt: new Date('2026-05-15T00:00:00.000Z'),
      resultDir: path.join(resultsDir, 'kaseki-jev-routing'),
      request,
    }));
    const hints = { taskType: 'documentation' as const, validationFocus: 'docs_checks' as const };
    const taskAdmissionEvaluator: TaskAdmissionEvaluator = async () => ({
      allowed: true,
      status: 'allowed',
      reason: 'safe',
      responseTime: 1,
      routingHints: hints,
    });
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config, taskAdmissionEvaluator);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoUrl: 'https://github.com/org/repo',
          taskPrompt: 'Update the documentation for setup.',
          validationCommands: ['npm run docs:check'],
          publishMode: 'none',
          idempotencyKey: crypto.randomUUID(),
        }),
      });

      expect(response.status).toBe(202);
      expect(scheduler.submitJob).toHaveBeenCalledWith(expect.objectContaining({
        validationCommands: ['npm run docs:check'],
      }), hints);
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('POST /api/runs includes projectName from a full submitted job', async () => {
    const scheduler = createMockScheduler();
    scheduler.submitJob.mockResolvedValue({
      id: 'kaseki-project-name',
      status: 'queued',
      createdAt: new Date('2026-05-15T00:00:00.000Z'),
      resultDir: path.join(resultsDir, 'kaseki-project-name'),
      request: {
        repoUrl: 'https://github.com/org/repo',
        ref: 'main',
        taskPrompt: 'Run a project identity smoke test',
        publishMode: 'none',
        projectName: 'restored-project'
      }
    });
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoUrl: 'https://github.com/org/repo',
          ref: 'main',
          taskPrompt: 'Run a project identity smoke test',
          publishMode: 'none',
          projectName: 'restored-project',
          idempotencyKey: crypto.randomUUID(),
        })
      });

      expect(res.status).toBe(202);
      expect(await res.json()).toEqual(expect.objectContaining({
        id: 'kaseki-project-name',
        projectName: 'restored-project'
      }));
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });
});

describe('kaseki-api-routes idempotent submissions', () => {
  let resultsDir: string;
  const requestBody = {
    repoUrl: 'https://github.com/org/repo',
    ref: 'main',
    taskPrompt: 'Apply the requested idempotency test change',
    publishMode: 'none',
    idempotencyKey: '77777777-7777-4777-8777-777777777777'
  };

  beforeEach(() => {
    resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-runs-idempotency-'));
  });

  afterEach(() => {
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  test('rejects submissions without a caller-provided idempotency key', async () => {
    const scheduler = createMockScheduler();
    const { server, port, idempotencyStore } = await createTestApp(scheduler, createTestConfig(resultsDir));
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...requestBody, idempotencyKey: undefined }),
      });
      expect(response.status).toBe(400);
      expect((await response.json()).detail).toContain('Idempotency-Key');
      expect(scheduler.submitJob).not.toHaveBeenCalled();
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('accepts a caller-provided Idempotency-Key header', async () => {
    const scheduler = createMockScheduler();
    scheduler.submitJob.mockResolvedValue({
      id: 'kaseki-header-idempotency',
      status: 'queued',
      createdAt: new Date('2026-07-21T00:00:00.000Z'),
      resultDir: path.join(resultsDir, 'kaseki-header-idempotency'),
    });
    const { server, port, idempotencyStore } = await createTestApp(scheduler, createTestConfig(resultsDir));
    try {
      const { idempotencyKey: _bodyKey, ...body } = requestBody;
      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
          'Idempotency-Key': '88888888-8888-4888-8888-888888888888',
        },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({ id: 'kaseki-header-idempotency' });
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('releases a fresh claim when scheduler submission fails', async () => {
    const scheduler = createMockScheduler();
    scheduler.submitJob
      .mockRejectedValueOnce(new Error('queue unavailable'))
      .mockResolvedValueOnce({
        id: 'kaseki-retry',
        status: 'queued',
        createdAt: new Date('2026-07-21T00:00:00.000Z'),
        resultDir: path.join(resultsDir, 'kaseki-retry')
      });
    const { server, port, idempotencyStore } = await createTestApp(
      scheduler,
      createTestConfig(resultsDir)
    );

    try {
      const submit = () => fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      const failed = await submit();
      expect(failed.status).toBe(400);
      await failed.arrayBuffer();

      const retry = await submit();
      expect(retry.status).toBe(202);
      expect((await retry.json()) as object).toEqual(expect.objectContaining({ id: 'kaseki-retry' }));
      expect(scheduler.submitJob).toHaveBeenCalledTimes(2);
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('returns 409 while the agent is busy, releases the key, then replays an accepted retry', async () => {
    const scheduler = createMockScheduler();
    scheduler.submitJob
      .mockRejectedValueOnce(new RunAlreadyActiveError())
      .mockResolvedValueOnce({
        id: 'kaseki-after-busy',
        status: 'running',
        createdAt: new Date('2026-07-21T00:00:00.000Z'),
        resultDir: path.join(resultsDir, 'kaseki-after-busy'),
      });
    const { server, port, idempotencyStore } = await createTestApp(scheduler, createTestConfig(resultsDir));
    const submit = () => fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    try {
      const busy = await submit();
      expect(busy.status).toBe(409);
      expect(await busy.json()).toMatchObject({ code: 'RUN_ALREADY_ACTIVE' });

      const accepted = await submit();
      expect(accepted.status).toBe(202);
      expect(await accepted.json()).toMatchObject({ id: 'kaseki-after-busy' });

      const replay = await submit();
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({ id: 'kaseki-after-busy' });
      expect(scheduler.submitJob).toHaveBeenCalledTimes(2);
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('returns a structured 507 and releases the idempotency claim for low storage', async () => {
    const scheduler = createMockScheduler();
    scheduler.submitJob
      .mockRejectedValueOnce(new StorageCapacityError({
        code: 'insufficient_storage',
        statusCode: 507,
        availableBytes: 1024 ** 3,
        warningBytes: 5 * 1024 ** 3,
        minimumBytes: 2 * 1024 ** 3,
        cleanupAttempted: true,
        cleanupFreedBytes: 0,
      }))
      .mockResolvedValueOnce({
        id: 'kaseki-storage-retry',
        status: 'queued',
        createdAt: new Date('2026-07-21T00:00:00.000Z'),
        resultDir: path.join(resultsDir, 'kaseki-storage-retry'),
      });
    const { server, port, idempotencyStore } = await createTestApp(scheduler, createTestConfig(resultsDir));

    try {
      const submit = () => fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const rejected = await submit();
      expect(rejected.status).toBe(507);
      expect(await rejected.json()).toMatchObject({
        code: 'insufficient_storage',
        availableBytes: 1024 ** 3,
        minimumBytes: 2 * 1024 ** 3,
        cleanupAttempted: true,
        remediation: expect.any(String),
      });

      const retried = await submit();
      expect(retried.status).toBe(202);
      expect(await retried.json()).toMatchObject({ id: 'kaseki-storage-retry' });
    } finally {
      await cleanupTestApp(server, idempotencyStore);
    }
  });

});

describe('retry admission parity', () => {
  test('rechecks GitHub publish credentials before retry admission', async () => {
    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-retry-gates-'));
    const jobId = 'kaseki-publish-retry';
    const job = {
      id: jobId,
      status: 'failed',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      completedAt: new Date('2026-08-01T00:01:00.000Z'),
      resultDir: path.join(resultsDir, jobId),
      request: {
        repoUrl: 'https://github.com/org/repo',
        ref: 'main',
        taskPrompt: 'Retry the failed publish run',
        publishMode: 'pr',
      },
    };
    const scheduler = createMockScheduler({ [jobId]: job as any });
    const { server, port, idempotencyStore } = await createTestApp(scheduler, createTestConfig(resultsDir));
    try {
      jest.mocked(hostSecretsReader.readHostSecret).mockReturnValue(null);
      const response = await fetch(`http://127.0.0.1:${port}/api/runs/${jobId}/retry`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: '99999999-9999-4999-8999-999999999999' }),
      });
      expect(response.status).toBe(400);
      expect((await response.json()).detail).toContain('GitHub App credentials');
      expect(scheduler.submitJob).not.toHaveBeenCalled();
    } finally {
      await cleanupTestApp(server, idempotencyStore);
      fs.rmSync(resultsDir, { recursive: true, force: true });
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
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), repoUrl: 'https://github.com/org/repo' })
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
          publishMode: 'none',
          idempotencyKey: crypto.randomUUID(),
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
          recommendedCurrentEndpoint: '/api/v1/preflight',
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

  test('GET /api/preflight reports Pi adapter capability failures when requested', async () => {
    const piProviderSmokeSpy = jest.spyOn(gatewaySmoke, 'testPiGatewayProviderSmoke').mockReturnValueOnce({
      status: 'error',
      detail: 'Pi provider did not complete the coding-shaped tool-call contract',
      responseTime: 20,
      timestamp: '2026-07-24T00:00:00.000Z',
      provider: 'gateway',
      model: 'dynamic/kaseki-agent',
      remediation: 'Inspect the Pi adapter stream and gateway tool-call deltas.',
    });
    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-capability-results-'));
    const scheduler = createMockScheduler();
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/preflight?agentCapability=true`, {
        headers: { Authorization: 'Bearer test-key' }
      });
      const body = (await res.json()) as any;
      expect(res.status).toBe(503);
      expect(body.status).toBe('error');
      expect(body.checks).toContainEqual(expect.objectContaining({
        name: 'pi-provider-adapter',
        ok: false,
        remediation: expect.stringContaining('tool-call deltas'),
      }));
      expect(body.failedChecks).toContainEqual(expect.objectContaining({ name: 'pi-provider-adapter', ok: false }));
      expect(piProviderSmokeSpy).toHaveBeenCalledWith({ requested: true });
    } finally {
      piProviderSmokeSpy.mockRestore();
      await cleanupTestApp(server, idempotencyStore);
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

  test('GET /api/gateway-test enables response smoke with query override', async () => {
    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-gateway-test-route-results-'));
    const envSnapshot = { ...process.env };
    const originalFetch = global.fetch;
    let externalFetchCount = 0;

    try {
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1';
      process.env.LLM_GATEWAY_API_KEY = 'route-test-key';
      process.env.KASEKI_GATEWAY_RESPONSE_SMOKE = '0';

      const scheduler = createMockScheduler({});
      const config = createTestConfig(resultsDir);
      const { server, port, idempotencyStore } = await createTestApp(scheduler, config);
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((input: any, init?: any) => {
        const url = typeof input === 'string' ? input : String(input?.url ?? input);
        if (url.startsWith(`http://127.0.0.1:${port}`)) {
          return originalFetch(input, init);
        }
        externalFetchCount += 1;
        if (url.endsWith('/models')) {
          return Promise.resolve(new Response('{"models":[]}', { status: 200, headers: { 'content-type': 'application/json' } }));
        }
        const requestBody = JSON.parse(String(init?.body ?? '{}'));
        if (requestBody.stream === true) {
          return Promise.resolve(new Response([
            'event: response.output_text.delta',
            'data: {"type":"response.output_text.delta","delta":"kaseki gateway smoke ok"}',
            '',
            'data: [DONE]',
            '',
          ].join('\n'), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
        }
        return Promise.resolve(new Response(JSON.stringify({
          id: 'resp_route_smoke',
          output_text: 'kaseki gateway smoke ok',
          usage: { output_tokens: 5 }
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      });

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/gateway-test?inference=true&responseSmoke=1`, {
          headers: { Authorization: 'Bearer test-key' }
        });
        const body = (await res.json()) as any;
        expect(res.status).toBe(200);
        expect(body.responseSmokeValidated).toBe(true);
        expect(body.streamSmokeValidated).toBe(true);
        expect(body.largePromptSmokeValidated).toBe(true);
        expect(externalFetchCount).toBe(4);
      } finally {
        fetchSpy.mockRestore();
        await cleanupTestApp(server, idempotencyStore);
      }
    } finally {
      process.env = envSnapshot;
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('GET /api/gateway-test disables response smoke with query override', async () => {
    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-gateway-test-route-light-results-'));
    const envSnapshot = { ...process.env };
    const originalFetch = global.fetch;
    let externalFetchCount = 0;

    try {
      delete process.env.JEST_WORKER_ID;
      delete process.env.NODE_ENV;
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1';
      process.env.LLM_GATEWAY_API_KEY = 'route-test-key';
      process.env.KASEKI_GATEWAY_RESPONSE_SMOKE = '1';

      const scheduler = createMockScheduler({});
      const config = createTestConfig(resultsDir);
      const { server, port, idempotencyStore } = await createTestApp(scheduler, config);
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((input: any, init?: any) => {
        const url = typeof input === 'string' ? input : String(input?.url ?? input);
        if (url.startsWith(`http://127.0.0.1:${port}`)) {
          return originalFetch(input, init);
        }
        externalFetchCount += 1;
        return Promise.resolve(new Response('{"models":[]}', { status: 200, headers: { 'content-type': 'application/json' } }));
      });

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/gateway-test?responseSmoke=0`, {
          headers: { Authorization: 'Bearer test-key' }
        });
        const body = (await res.json()) as any;
        expect(res.status).toBe(200);
        expect(body.responseSmokeValidated).toBe(false);
        expect(externalFetchCount).toBe(1);
      } finally {
        fetchSpy.mockRestore();
        await cleanupTestApp(server, idempotencyStore);
      }
    } finally {
      process.env = envSnapshot;
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('GET /api/gateway-test?stage=1 runs Stage 1 only (connectivity check)', async () => {
    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-gateway-test-stage1-results-'));
    const envSnapshot = { ...process.env };
    const originalFetch = global.fetch;
    let externalFetchCount = 0;

    try {
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1';
      process.env.LLM_GATEWAY_API_KEY = 'route-test-key';

      const scheduler = createMockScheduler({});
      const config = createTestConfig(resultsDir);
      const { server, port, idempotencyStore } = await createTestApp(scheduler, config);
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((input: any, init?: any) => {
        const url = typeof input === 'string' ? input : String(input?.url ?? input);
        if (url.startsWith(`http://127.0.0.1:${port}`)) {
          return originalFetch(input, init);
        }
        externalFetchCount += 1;
        // Only Stage 1 should be called (connectivity check)
        if (url.endsWith('/models')) {
          return Promise.resolve(new Response('{"models":[]}', { status: 200, headers: { 'content-type': 'application/json' } }));
        }
        // If Stage 2 is reached, fail the test
        throw new Error('Stage 2 should not be called when stage=1 is specified');
      });

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/gateway-test?stage=1`, {
          headers: { Authorization: 'Bearer test-key' }
        });
        const body = (await res.json()) as any;
        expect(res.status).toBe(200);
        expect(body.status).toBe('ok');
        expect(body.responseSmokeValidated).toBe(false); // Stage 2 not run
        expect(externalFetchCount).toBe(1); // Only connectivity check
      } finally {
        fetchSpy.mockRestore();
        await cleanupTestApp(server, idempotencyStore);
      }
    } finally {
      process.env = envSnapshot;
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('GET /api/gateway-test?inference=true&stage=2&responseSmoke=true runs Stage 2 only (inference test)', async () => {
    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-gateway-test-stage2-results-'));
    const envSnapshot = { ...process.env };
    const originalFetch = global.fetch;
    let stage1Called = false;
    let stage2Called = false;

    try {
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1';
      process.env.LLM_GATEWAY_API_KEY = 'route-test-key';

      const scheduler = createMockScheduler({});
      const config = createTestConfig(resultsDir);
      const { server, port, idempotencyStore } = await createTestApp(scheduler, config);
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((input: any, init?: any) => {
        const url = typeof input === 'string' ? input : String(input?.url ?? input);
        if (url.startsWith(`http://127.0.0.1:${port}`)) {
          return originalFetch(input, init);
        }
        if (url.endsWith('/models')) {
          stage1Called = true;
          return Promise.resolve(new Response('{"models":[]}', { status: 200, headers: { 'content-type': 'application/json' } }));
        }
        // Stage 2 calls (standard, streaming, large prompt)
        stage2Called = true;
        const requestBody = JSON.parse(String(init?.body ?? '{}'));
        if (requestBody.stream === true) {
          return Promise.resolve(new Response([
            'event: response.output_text.delta',
            'data: {"type":"response.output_text.delta","delta":"kaseki gateway smoke ok"}',
            '',
            'data: [DONE]',
            '',
          ].join('\n'), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
        }
        return Promise.resolve(new Response(JSON.stringify({
          id: 'resp_stage2_test',
          output_text: 'kaseki gateway smoke ok',
          usage: { output_tokens: 5 }
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      });

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/gateway-test?inference=true&stage=2&responseSmoke=true`, {
          headers: { Authorization: 'Bearer test-key' }
        });
        const body = (await res.json()) as any;
        expect(res.status).toBe(200);
        expect(body.responseSmokeValidated).toBe(true); // Stage 2 ran
        expect(body.streamSmokeValidated).toBe(true);
        expect(body.largePromptSmokeValidated).toBe(true);
        expect(body.checks).toHaveLength(3);
        expect(stage1Called).toBe(false); // Stage 1 should NOT be called
        expect(stage2Called).toBe(true); // Stage 2 should be called
      } finally {
        fetchSpy.mockRestore();
        await cleanupTestApp(server, idempotencyStore);
      }
    } finally {
      process.env = envSnapshot;
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('GET /api/gateway-test?inference=true&stage=2&responseSmoke=true returns 200 without Pi provider smoke by default', async () => {
    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-gateway-test-pi-skipped-results-'));
    const envSnapshot = { ...process.env };
    const originalFetch = global.fetch;

    try {
      process.env.JEST_WORKER_ID = '1';
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1';
      process.env.LLM_GATEWAY_API_KEY = 'route-test-key';

      const scheduler = createMockScheduler({});
      const config = createTestConfig(resultsDir);
      const { server, port, idempotencyStore } = await createTestApp(scheduler, config);
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((input: any, init?: any) => {
        const url = typeof input === 'string' ? input : String(input?.url ?? input);
        if (url.startsWith(`http://127.0.0.1:${port}`)) {
          return originalFetch(input, init);
        }
        const requestBody = JSON.parse(String(init?.body ?? '{}'));
        if (requestBody.stream === true) {
          return Promise.resolve(new Response([
            'event: response.output_text.delta',
            'data: {"type":"response.output_text.delta","delta":"kaseki gateway smoke ok"}',
            '',
            'data: [DONE]',
            '',
          ].join('\n'), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
        }
        return Promise.resolve(new Response(JSON.stringify({
          id: 'resp_stage2_pi_skipped',
          output_text: 'kaseki gateway smoke ok',
          usage: { output_tokens: 5 }
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      });

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/gateway-test?inference=true&stage=2&responseSmoke=true`, {
          headers: { Authorization: 'Bearer test-key' }
        });
        const body = (await res.json()) as any;
        expect(res.status).toBe(200);
        expect(body.responseSmokeValidated).toBe(true);
        expect(body.piProviderSmoke).toBeUndefined();
      } finally {
        fetchSpy.mockRestore();
        await cleanupTestApp(server, idempotencyStore);
      }
    } finally {
      process.env = envSnapshot;
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('GET /api/gateway-test?inference=true&stage=2&responseSmoke=true&piProvider=true&debug=true returns debug output path for raw Pi output', async () => {
    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-gateway-test-pi-debug-results-'));
    const envSnapshot = { ...process.env };
    const originalFetch = global.fetch;
    const rawPiOutput = [
      JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }),
      JSON.stringify({ type: 'message_stop' }),
    ].join('\n');
    spawnSyncMock.mockReturnValue({
      status: 0,
      signal: null,
      output: [null, rawPiOutput, ''],
      pid: 123,
      stdout: rawPiOutput,
      stderr: '',
    } as any);

    try {
      process.env.JEST_WORKER_ID = '1';
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1';
      process.env.LLM_GATEWAY_API_KEY = 'route-test-key';

      const scheduler = createMockScheduler({});
      const config = createTestConfig(resultsDir);
      const { server, port, idempotencyStore } = await createTestApp(scheduler, config);
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((input: any, init?: any) => {
        const url = typeof input === 'string' ? input : String(input?.url ?? input);
        if (url.startsWith(`http://127.0.0.1:${port}`)) {
          return originalFetch(input, init);
        }
        const requestBody = JSON.parse(String(init?.body ?? '{}'));
        if (requestBody.stream === true) {
          return Promise.resolve(new Response([
            'event: response.output_text.delta',
            'data: {"type":"response.output_text.delta","delta":"kaseki gateway smoke ok"}',
            '',
            'data: [DONE]',
            '',
          ].join('\n'), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
        }
        return Promise.resolve(new Response(JSON.stringify({
          id: 'resp_stage2_pi_debug',
          output_text: 'kaseki gateway smoke ok',
          usage: { output_tokens: 5 }
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      });

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/gateway-test?inference=true&stage=2&responseSmoke=true&piProvider=true&debug=true`, {
          headers: { Authorization: 'Bearer test-key' }
        });
        const body = (await res.json()) as any;
        const debugOutputPath = body.piProviderSmoke?.diagnostics?.debugOutputPath;

        expect(res.status).toBe(503);
        expect(body.piProviderSmoke?.detail).toContain('produced no assistant text');
        expect(debugOutputPath).toMatch(/^\/tmp\/kaseki-pi-debug-\d+\.jsonl$/);
        expect(fs.readFileSync(debugOutputPath, 'utf8')).toBe(rawPiOutput);
        expect(fs.statSync(debugOutputPath).mode & 0o777).toBe(0o600);
        fs.rmSync(debugOutputPath, { force: true });
      } finally {
        fetchSpy.mockRestore();
        await cleanupTestApp(server, idempotencyStore);
      }
    } finally {
      spawnSyncMock.mockReset();
      process.env = envSnapshot;
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('GET /api/gateway-test?inference=true&stage=2&responseSmoke=true&piProvider=true returns 503 when explicit Pi provider smoke fails', async () => {
    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-gateway-test-pi-explicit-fail-results-'));
    const envSnapshot = { ...process.env };
    const originalFetch = global.fetch;
    spawnSyncMock.mockReturnValue({
      status: 1,
      signal: null,
      output: [null, '', 'provider failed'],
      pid: 123,
      stdout: '',
      stderr: 'provider failed',
    } as any);

    try {
      process.env.JEST_WORKER_ID = '1';
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1';
      process.env.LLM_GATEWAY_API_KEY = 'route-test-key';

      const scheduler = createMockScheduler({});
      const config = createTestConfig(resultsDir);
      const { server, port, idempotencyStore } = await createTestApp(scheduler, config);
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((input: any, init?: any) => {
        const url = typeof input === 'string' ? input : String(input?.url ?? input);
        if (url.startsWith(`http://127.0.0.1:${port}`)) {
          return originalFetch(input, init);
        }
        const requestBody = JSON.parse(String(init?.body ?? '{}'));
        if (requestBody.stream === true) {
          return Promise.resolve(new Response([
            'event: response.output_text.delta',
            'data: {"type":"response.output_text.delta","delta":"kaseki gateway smoke ok"}',
            '',
            'data: [DONE]',
            '',
          ].join('\n'), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
        }
        return Promise.resolve(new Response(JSON.stringify({
          id: 'resp_stage2_pi_explicit_fail',
          output_text: 'kaseki gateway smoke ok',
          usage: { output_tokens: 5 }
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      });

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/gateway-test?inference=true&stage=2&responseSmoke=true&piProvider=true`, {
          headers: { Authorization: 'Bearer test-key' }
        });
        const body = (await res.json()) as any;
        expect(res.status).toBe(503);
        expect(body.status).toBe('error');
        expect(body.responseSmokeValidated).toBe(true);
        expect(body.gatewayInferenceValidated).toBe(true);
        expect(body.piAdapterValidated).toBe(false);
        expect(body.partialSuccess).toBe(true);
        expect(body.piProviderSmoke).toEqual(expect.objectContaining({
          status: 'error',
          provider: 'gateway',
          detail: expect.stringContaining('Pi provider smoke exited 1'),
        }));
        expect(spawnSyncMock).toHaveBeenCalledWith(
          'pi',
          expect.arrayContaining(['--provider', 'gateway']),
          expect.any(Object)
        );
      } finally {
        fetchSpy.mockRestore();
        await cleanupTestApp(server, idempotencyStore);
      }
    } finally {
      spawnSyncMock.mockReset();
      process.env = envSnapshot;
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

  test('GET /api/preflight rejects gateway URLs that do not match the Pi responses endpoint', async () => {
    const { readHostSecret, resolveHostSecretPath } = jest.mocked(hostSecretsReader);
    (readHostSecret as jest.Mock).mockImplementation((name: string) => {
      if (name === 'github_app_id') return '12345';
      if (name === 'github_app_client_id') return 'Iv123client';
      if (name === 'github_app_private_key') return defaultGithubPrivateKeyPem;
      if (name === 'llm_gateway_api_key') return 'host-gateway-key';
      return null;
    });
    (resolveHostSecretPath as jest.Mock).mockImplementation((name: string) => `/tmp/secrets/${name}`);

    const root = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-gateway-url-'));
    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-gateway-url-results-'));
    const { templateDir, checkoutDir } = writePreflightTemplateFixture(root);
    const envSnapshot = { ...process.env };

    try {
      process.env.KASEKI_TEMPLATE_DIR = templateDir;
      process.env.KASEKI_CHECKOUT_DIR = checkoutDir;
      process.env.KASEKI_PROVIDER = 'gateway';
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/';
      delete process.env.LLM_GATEWAY_API_KEY;
      delete process.env.LLM_GATEWAY_API_KEY_FILE;

      const scheduler = createMockScheduler({});
      const config = createTestConfig(resultsDir);
      const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/preflight`, {
          headers: { Authorization: 'Bearer test-key' }
        });
        const body = (await res.json()) as any;
        const apiGatewayCheck = body.checks.find((check: any) => check.name === 'llm-gateway-connectivity');
        const workerGatewayCheck = body.checks.find((check: any) => check.name === 'worker-gateway-secret-mount');

        expect(apiGatewayCheck).toEqual(
          expect.objectContaining({
            ok: false,
            detail: expect.stringContaining('versioned OpenAI API endpoint')
          })
        );
        expect(workerGatewayCheck).toEqual(
          expect.objectContaining({
            ok: false,
            detail: expect.stringContaining('LLM_GATEWAY_URL must point to a versioned OpenAI API endpoint')
          })
        );
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
          'KASEKI_RESULTS_DIR=/results',
          'TMPDIR=/workspace/tmp'
        ])
      );
      expect(runArgs.slice(runArgs.indexOf('-e'), runArgs.indexOf('-v'))).toContain('KASEKI_RESULTS_DIR=/results');
      expect(runArgs.slice(runArgs.indexOf('--entrypoint'))).toEqual(
        expect.arrayContaining(['--entrypoint', '/bin/sh'])
      );
      expect(runArgs).toContain(
        'for file in /usr/local/bin/kaseki-agent /usr/local/bin/scripts/agent-prompt.sh /usr/local/bin/scripts/allowlist-helper.sh /usr/local/bin/scripts/context-handoff.js /usr/local/bin/scripts/inspect-mode-defaults.sh /usr/local/bin/scripts/dependency-cache-helpers.sh /usr/local/bin/scripts/scouting-allowlist.js /usr/local/bin/scripts/lib/json.sh; do if [ ! -r "$file" ]; then echo "missing packaged worker helper: $file" >&2; exit 66; fi; done; if [ ! -x /usr/local/bin/kaseki-agent ]; then echo "packaged worker agent is not executable: /usr/local/bin/kaseki-agent" >&2; exit 66; fi; exec /scripts/startup-checks.sh worker'
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
    const originalEnv = Object.fromEntries(githubEnvKeys.map((key) => [key, process.env[key]]));
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
      restoreEnv(originalEnv);
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
    const originalEnv = Object.fromEntries(githubEnvKeys.map((key) => [key, process.env[key]]));
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
      restoreEnv(originalEnv);
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
    const originalEnv = Object.fromEntries(githubEnvKeys.map((key) => [key, process.env[key]]));
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
      restoreEnv(originalEnv);
    }
  });

  test('GET /api/preflight flags incomplete GitHub App configuration', async () => {
    const { readHostSecret } = jest.mocked(hostSecretsReader);
    (readHostSecret as jest.Mock).mockReturnValue(null); // No GitHub App credentials

    const resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-preflight-github-missing-'));
    const originalEnv = Object.fromEntries(githubEnvKeys.map((key) => [key, process.env[key]]));
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
      restoreEnv(originalEnv);
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
    writeTemplateMetadata(['auto', 'none', 'branch', 'pr']);
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
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), repoUrl: 'https://github.com/org/repo', publishMode: 'pr' })
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

  test('admits publishable run submission when controller checkout is behind origin', async () => {
    const stale = createStaleCheckout();
    writeTemplateMetadata(['auto', 'none', 'branch', 'pr'], stale.localSha);
    writeRunKasekiDoctor(0, 'doctor ok');
    const scheduler = createMockScheduler();
    scheduler.submitJob.mockImplementation((runRequest: any) => ({
      id: 'job-stale-checkout',
      status: 'queued',
      createdAt: new Date(),
      resultDir: path.join(resultsDir, 'job-stale-checkout'),
      requestId: runRequest.requestId,
      correlationId: runRequest.correlationId,
      request: runRequest,
    }));
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);

    try {
      const preflight = await fetch(`http://127.0.0.1:${port}/api/preflight`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      const preflightBody = (await preflight.json()) as any;
      const freshnessCheck = preflightBody.checks.find(
        (check: any) => check.name === 'checkout-freshness',
      );
      expect(freshnessCheck.ok).toBe(false);
      expect(freshnessCheck.detail).toContain('Controller checkout is different from origin/main');

      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), repoUrl: 'https://github.com/org/repo', publishMode: 'pr' })
      });

      expect(response.status).toBe(202);
      await drainResponseBody(response);
      expect(scheduler.submitJob).toHaveBeenCalled();
    } finally {
      fs.rmSync(stale.remoteDir, { recursive: true, force: true });
      await cleanupTestApp(server, idempotencyStore);
    }
  });

  test('admits publishable runs when controller git metadata is unreadable', async () => {
    writeTemplateMetadata(['auto', 'none', 'branch', 'pr']);
    writeRunKasekiDoctor(0, 'doctor ok');
    // Create intentionally invalid git metadata so rev-parse fails consistently,
    // including in privileged environments where chmod(000) may still be readable.
    fs.mkdirSync(path.join(checkoutDir, '.git'), { recursive: true });

    const scheduler = createMockScheduler();
    scheduler.submitJob.mockImplementation((runRequest: any) => ({
      id: 'job-unreadable-checkout',
      status: 'queued',
      createdAt: new Date(),
      resultDir: path.join(resultsDir, 'job-unreadable-checkout'),
      requestId: runRequest.requestId,
      correlationId: runRequest.correlationId,
      request: runRequest,
    }));
    const config = createTestConfig(resultsDir);
    const { server, port, idempotencyStore } = await createTestApp(scheduler, config);
    try {
      const preflight = await fetch(`http://127.0.0.1:${port}/api/preflight`, {
        headers: { Authorization: 'Bearer test-key' },
      });
      const preflightBody = (await preflight.json()) as any;
      const freshnessCheck = preflightBody.checks.find(
        (check: any) => check.name === 'checkout-freshness',
      );
      expect(freshnessCheck.ok).toBe(false);
      expect(freshnessCheck.detail).toContain(
        'Failed to resolve controller checkout revision',
      );

      const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), repoUrl: 'https://github.com/org/repo', publishMode: 'pr' })
      });
      expect(response.status).toBe(202);
      await drainResponseBody(response);
      expect(scheduler.submitJob).toHaveBeenCalled();
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
    writeTemplateMetadata(['auto', 'none', 'branch', 'pr'], 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
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
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), repoUrl: 'https://github.com/org/repo', publishMode: 'pr' })
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
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), repoUrl: 'https://github.com/org/repo', publishMode: 'none' })
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
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), repoUrl: 'https://github.com/org/repo', publishMode: 'pr' })
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
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), repoUrl: 'https://github.com/org/repo', publishMode: 'pr' })
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
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), repoUrl: 'https://github.com/org/repo', publishMode: 'auto' })
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
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), repoUrl: 'https://github.com/org/repo', publishMode: 'auto' })
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
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), repoUrl: 'https://github.com/org/repo', publishMode: 'auto' })
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
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), repoUrl: 'https://github.com/org/repo', publishMode: 'auto' })
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
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), repoUrl: 'https://github.com/org/repo', publishMode: 'auto' })
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

  test('concurrent requests with the same idempotency key return one submitted job', async () => {
    let releaseSubmission!: () => void;
    let releaseLockRetries!: () => void;
    let signalSubmissionStarted!: () => void;
    let signalAllRequestsWaiting!: () => void;
    let waitingRequestCount = 0;
    const submissionGate = new Promise<void>((resolve) => {
      releaseSubmission = resolve;
    });
    const lockRetryGate = new Promise<void>((resolve) => {
      releaseLockRetries = resolve;
    });
    const submissionStarted = new Promise<void>((resolve) => {
      signalSubmissionStarted = resolve;
    });
    const allRequestsWaiting = new Promise<void>((resolve) => {
      signalAllRequestsWaiting = resolve;
    });
    const submitJob = jest.fn(async (runRequest: any) => {
      signalSubmissionStarted();
      await submissionGate;
      return {
        id: 'job-1',
        status: 'queued',
        createdAt: new Date(),
        resultDir: path.join(resultsDir, 'job-1'),
        requestId: runRequest.requestId,
        correlationId: runRequest.correlationId
      };
    });

    const scheduler = {
      getJob: jest.fn(),
      submitJob,
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

    const idempotencyStore = new IdempotencyStore(resultsDir, 24, {
      waitForLockRetry: async () => {
        waitingRequestCount += 1;
        if (waitingRequestCount === 7) signalAllRequestsWaiting();
        await lockRetryGate;
      },
    });
    const preFlightValidator = new PreFlightValidator();

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));

    const { server, port } = await listenTestApp(app);
    const headers = { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' };
    let responsesPromise: Promise<Response[]> | undefined;
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
      responsesPromise = Promise.all(requests);
      await submissionStarted;
      await allRequestsWaiting;
      expect(submitJob).toHaveBeenCalledTimes(1);
      releaseSubmission();
      const acceptedResponse = await Promise.race(requests.map(async (request) => {
        const response = await request;
        return response.status === 202
          ? response
          : new Promise<Response>(() => {});
      }));
      expect(acceptedResponse.status).toBe(202);
      releaseLockRetries();
      const responses = await responsesPromise;
      const payloads = await Promise.all(responses.map((r) => r.json() as Promise<any>));

      expect(submitJob).toHaveBeenCalledTimes(1);
      expect(responses.filter((response) => response.status === 202)).toHaveLength(1);
      expect(responses.filter((response) => response.status === 200)).toHaveLength(7);
      expect(payloads.map(({ id }) => id)).toEqual(Array(8).fill('job-1'));
    } finally {
      releaseSubmission();
      releaseLockRetries();
      if (responsesPromise) await Promise.allSettled([responsesPromise]);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
  });

  test('health endpoint remains responsive while run submission is contended', async () => {
    let releaseSubmission!: (job: Record<string, unknown>) => void;
    let signalSubmissionStarted!: () => void;
    const submissionGate = new Promise<Record<string, unknown>>((resolve) => {
      releaseSubmission = resolve;
    });
    const submissionStarted = new Promise<void>((resolve) => {
      signalSubmissionStarted = resolve;
    });

    const scheduler = {
      getJob: jest.fn(),
      submitJob: jest.fn(async () => {
        signalSubmissionStarted();
        return submissionGate;
      }),
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

    let runPromise: Promise<Response> | undefined;
    let runResponse: Response | undefined;
    let runError: unknown;
    try {
      runPromise = fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: '99999999-9999-4999-8999-999999999999', repoUrl: 'https://github.com/example/repo', ref: 'main' })
      });
      let runSettled = false;
      void runPromise.then(
        () => {
          runSettled = true;
        },
        () => {
          runSettled = true;
        },
      );
      await submissionStarted;

      const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      expect(healthResponse.status).toBe(200);
      const healthBody = (await healthResponse.json()) as any;
      expect(healthBody.status).toBe('ok');
      expect(runSettled).toBe(false);
    } finally {
      releaseSubmission({
        id: 'job-1',
        status: 'queued',
        createdAt: new Date(),
        resultDir: path.join(resultsDir, 'job-1'),
        requestId: 'req-1',
        correlationId: 'corr-1',
      });
      if (runPromise) {
        try {
          runResponse = await runPromise;
          await drainResponseBody(runResponse);
        } catch (error) {
          runError = error;
        }
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idempotencyStore.shutdown();
    }
    if (runError) throw runError;
    expect(runResponse?.status).toBe(202);
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
          idempotencyKey: crypto.randomUUID(),
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
          idempotencyKey: crypto.randomUUID(),
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
          repoUrl: 'https://github.com/org/repo',
          idempotencyKey: crypto.randomUUID(),
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
          repoUrl: 'https://github.com/org/repo',
          idempotencyKey: crypto.randomUUID(),
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
          idempotencyKey: crypto.randomUUID(),
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

  test('rejects removed draft_pr publish mode before queueing', async () => {
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
          idempotencyKey: crypto.randomUUID(),
          repoUrl: 'https://github.com/org/repo',
          publishMode: 'draft_pr'
        })
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as any;
      expect(body.detail).toContain('publishMode');
      expect(body.detail).toMatch(/Invalid (?:option|enum value)/);
      expect(body.detail).toMatch(/["']pr["']/);
      expect(body.detail).not.toContain('requires readable GitHub App credentials');
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
  let jobs: Record<string, any>;
  let harness: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    resultsDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-progress-sse-test-'));
    jobs = {};

    const scheduler = createMockScheduler(jobs);
    scheduler.getJob.mockImplementation((id: string) => jobs[id]);
    harness = await createTestApp(scheduler, createTestConfig(resultsDir));
  });

  afterAll(async () => {
    await cleanupTestApp(harness.server, harness.idempotencyStore);
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  const transitionJobTo = (jobId: string, status: 'completed' | 'failed') => {
    jobs[jobId] = { ...jobs[jobId], status };
  };

  const readStreamAfterStart = async (
    response: Response,
    expectedTerminalStatus: 'completed' | 'failed',
    onStart: () => void,
    timeoutMs = 5000
  ): Promise<{ text: string; closed: boolean }> => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let startReceived = false;
    let terminalReceived = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const timedOut = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        const missingEvent = terminalReceived
          ? 'stream closure after the terminal status event'
          : `terminal status event "${expectedTerminalStatus}"`;
        reject(new Error(
          `Timed out after ${timeoutMs}ms waiting for ${missingEvent}. SSE received so far: ${JSON.stringify(text)}`
        ));
      }, timeoutMs);
    });

    try {
      while (true) {
        const { value, done } = await Promise.race([reader.read(), timedOut]);
        if (done) {
          if (!terminalReceived) {
            throw new Error(
              `SSE stream closed before terminal status event "${expectedTerminalStatus}". ` +
              `SSE received: ${JSON.stringify(text)}`
            );
          }
          text += decoder.decode();
          return { text, closed: true };
        }
        text += decoder.decode(value, { stream: true });
        if (!startReceived && text.includes('"type":"start"')) {
          startReceived = true;
          onStart();
        }
        terminalReceived = text.includes(`"type":"status","status":"${expectedTerminalStatus}"`);
      }
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      await reader.cancel().catch(() => undefined);
    }
  };

  test.each([
    { terminalStatus: 'completed' as const, description: 'final status when progress.jsonl is missing and job becomes terminal' },
    { terminalStatus: 'failed' as const, description: 'failed status when progress.jsonl is missing and job fails' }
  ])('closes SSE with $description', async ({ terminalStatus }) => {
    const jobId = `kaseki-sse-no-progress-${terminalStatus}`;
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    jobs[jobId] = {
      id: jobId,
      status: 'running',
      createdAt: new Date(),
      startedAt: new Date(),
      resultDir: jobDir
    };

    const response = await fetch(`http://127.0.0.1:${harness.port}/api/runs/${jobId}/events/stream`, {
      headers: { Authorization: 'Bearer test-key', Accept: 'text/event-stream' }
    });

    expect(response.status).toBe(200);
    expect(response.body).toBeTruthy();

    const stream = await readStreamAfterStart(
      response,
      terminalStatus,
      () => transitionJobTo(jobId, terminalStatus)
    );

    expect(stream.text).toContain(`"type":"start","jobId":"${jobId}","status":"running"`);
    expect(stream.text).toContain(`"type":"status","status":"${terminalStatus}"`);
    expect(stream.closed).toBe(true);
  }, 15000);
});
