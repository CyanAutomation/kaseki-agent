import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { KasekiApiConfig } from '../../kaseki-api-config';
import type { Job } from '../../kaseki-api-types';
import type { SoyuzOutboxEntry } from '../../job-persistence-manager';
import { SoyuzAdapter } from './SoyuzAdapter';
import type { SoyuzAdapterConfig } from './config';

jest.mock('../../kaseki-api-health-checks', () => ({
  checkGitHubAppCredentials: jest.fn(() => ({ name: 'github-app', ok: true })),
  checkTemplatePublishModeCompatibility: jest.fn(() => ({ ok: true })),
  getSubmissionTemplateHealthStatus: jest.fn(() => ({ status: { ok: true }, fromCache: true })),
  isTemplateDoctorTimeout: jest.fn(() => false),
}));

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const CORRELATION_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

const queuedRun = {
  contractVersion: '1',
  runId: RUN_ID,
  createdAt: '2026-10-09T12:00:00.000Z',
  correlationId: CORRELATION_ID,
  requestId: REQUEST_ID,
  request: {
    repoUrl: 'https://github.com/example/project',
    ref: 'main',
    taskPrompt: 'Add a focused health endpoint and its documentation.',
    taskMode: 'patch',
    publishMode: 'none',
  },
};

function adapterConfig(workerId: string): SoyuzAdapterConfig {
  return {
    enabled: true,
    apiUrl: 'https://soyuz.example.test',
    workerApiToken: 'worker-secret-that-is-not-logged',
    accountId: '0123456789abcdef0123456789abcdef',
    queueId: 'queue-id',
    queueApiToken: 'cloudflare-queue-token-that-is-not-logged',
    workerId,
    pollIntervalMs: 250,
    batchSize: 1,
    visibilityTimeoutMs: 120_000,
    requestTimeoutMs: 1_000,
    cancellationPollIntervalMs: 15_000,
    heartbeatIntervalMs: 60_000,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createScheduler(workerId: string, maxConcurrent = 1) {
  const jobs: Job[] = [];
  const callbacks: SoyuzOutboxEntry[] = [];
  const claimIntents: Array<{ externalRunId: string; workerId: string; queuedAt: string; claimCallbackId: string; createdAt: string }> = [];
  const scheduler = {
    getQueueStatus: jest.fn(() => ({
      pending: jobs.filter((job) => job.status === 'queued').length,
      running: jobs.filter((job) => job.status === 'running').length,
      maxConcurrent,
    })),
    getReadiness: jest.fn(() => ({ ready: true, reasons: [] })),
    listSoyuzJobs: jest.fn(async () => [...jobs]),
    findSoyuzJob: jest.fn(async (externalRunId: string) => jobs.find((job) => job.soyuz?.externalRunId === externalRunId)),
    submitSoyuzJob: jest.fn(async (_request: unknown, externalRunId: string, owner: string, correlationId: string, requestId: string, claimCallbackId?: string) => {
      const job: Job = {
        id: `kaseki-${jobs.length + 1}`,
        status: 'queued',
        request: queuedRun.request,
        createdAt: new Date(),
        correlationId,
        requestId,
        soyuz: {
          externalRunId,
          workerId: owner,
          contractVersion: '1',
          ...(claimCallbackId ? { claimCallbackId } : {}),
          startedCallbackId: '44444444-4444-4444-8444-444444444444',
          startAuthorized: false,
          metadataUpdatedAt: new Date().toISOString(),
        },
      };
      jobs.push(job);
      return job;
    }),
    authorizeSoyuzStart: jest.fn(async (localRunId: string) => {
      const job = jobs.find((candidate) => candidate.id === localRunId);
      if (!job?.soyuz || job.status !== 'queued') return false;
      job.soyuz.startAuthorized = true;
      job.soyuz.lastHeartbeatAt = new Date().toISOString();
      job.status = 'running';
      return true;
    }),
    isJobExecuting: jest.fn((localRunId: string) => jobs.some((job) => job.id === localRunId && job.status === 'running')),
    isJobProcessAlive: jest.fn(() => false),
    cancelSoyuzJob: jest.fn(async (localRunId: string) => {
      const job = jobs.find((candidate) => candidate.id === localRunId);
      if (job) {
        job.status = 'failed';
        job.failureClass = 'cancelled';
      }
    }),
    holdSoyuzJob: jest.fn(),
    getLiveProgressEvents: jest.fn(() => []),
    claimSoyuzCallbacks: jest.fn(async () => callbacks.filter((candidate) => candidate.deliveryState === 'pending').slice(0, 25)),
    persistSoyuzTerminalCallback: jest.fn(async (job: Job, entry: SoyuzOutboxEntry) => {
      if (!callbacks.some((candidate) => candidate.callbackId === entry.callbackId)) callbacks.push(entry);
      if (job.soyuz) {
        job.soyuz.terminalCallbackId = entry.callbackId;
        job.soyuz.terminalCallbackDelivered = false;
      }
    }),
    completeSoyuzCallback: jest.fn(async (callbackId: string) => {
      const entry = callbacks.find((candidate) => candidate.callbackId === callbackId);
      if (entry) entry.deliveryState = 'delivered';
      const job = jobs.find((candidate) => candidate.soyuz?.terminalCallbackId === callbackId);
      if (job?.soyuz) job.soyuz.terminalCallbackDelivered = true;
    }),
    retrySoyuzCallback: jest.fn(async (callbackId: string) => {
      const entry = callbacks.find((candidate) => candidate.callbackId === callbackId);
      if (entry) {
        entry.attemptCount += 1;
        entry.deliveryState = 'pending';
        entry.nextAttemptAt = new Date(0).toISOString();
      }
    }),
    getSoyuzOutboxStatus: jest.fn(async () => ({ pending: 0, failures: 0 })),
    updateSoyuzJobMetadata: jest.fn(async (localRunId: string, update: Partial<NonNullable<Job['soyuz']>>) => {
      const job = jobs.find((candidate) => candidate.id === localRunId);
      if (job?.soyuz) Object.assign(job.soyuz, update);
    }),
    enqueueSoyuzCallback: jest.fn(async () => undefined),
    persistSoyuzClaimIntent: jest.fn(async (intent: typeof claimIntents[number]) => {
      const index = claimIntents.findIndex((candidate) => candidate.claimCallbackId === intent.claimCallbackId);
      if (index >= 0) claimIntents[index] = intent;
      else claimIntents.push(intent);
    }),
    hasSoyuzClaimIntent: jest.fn(async (externalRunId: string, claimCallbackId: string) => claimIntents.some(
      (intent) => intent.externalRunId === externalRunId && intent.claimCallbackId === claimCallbackId,
    )),
    removeSoyuzClaimIntent: jest.fn(async (externalRunId: string, claimCallbackId: string) => {
      const index = claimIntents.findIndex((intent) => intent.externalRunId === externalRunId && intent.claimCallbackId === claimCallbackId);
      if (index >= 0) claimIntents.splice(index, 1);
    }),
  };
  return { scheduler, jobs, claimIntents };
}

function runState() {
  return {
    status: 'queued' as 'queued' | 'claimed' | 'running' | 'cancel_requested',
    workerId: null as string | null,
    claimCallbackId: null as string | null,
    claimExpiresAt: null as string | null,
    startedAt: null as string | null,
  };
}

function createFetch(state: ReturnType<typeof runState>, options: {
  loseFirstAck?: boolean;
  loseFirstClaimResponse?: boolean;
  failFirstArtifactUpload?: boolean;
} = {}) {
  let pulls = 0;
  let acks = 0;
  let claims = 0;
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown>; headers: Headers; payloadBytes?: number }> = [];
  const fetchImpl = jest.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    const headers = new Headers(init?.headers);
    calls.push({ url, method, body, headers, payloadBytes: init?.body instanceof Uint8Array ? init.body.byteLength : undefined });

    if (url.endsWith('/messages/pull')) {
      pulls += 1;
      return jsonResponse({
        success: true,
        errors: [],
        result: {
          messages: [{ body: queuedRun, id: 'ephemeral-message-id', timestamp_ms: Date.now(), attempts: pulls, lease_id: `lease-${pulls}` }],
        },
      });
    }
    if (url.endsWith('/messages/ack')) {
      acks += 1;
      if (options.loseFirstAck && acks === 1) {
        return jsonResponse({ success: false, errors: [{ message: 'simulated lost acknowledgement response' }] }, 503);
      }
      return jsonResponse({ success: true, errors: [], result: {} });
    }

    const parsed = new URL(url);
    const action = parsed.pathname.split('/').pop();
    if (method === 'PUT' && parsed.pathname.includes('/artifacts/')) {
      if (options.failFirstArtifactUpload && calls.filter((call) => call.method === 'PUT').length === 1) {
        return jsonResponse({ error: { code: 'ARTIFACT_STORE_FAILED', message: 'simulated upload failure' } }, 503);
      }
      return jsonResponse({ data: { id: action } }, 201);
    }
    if (method === 'POST' && ['completed', 'failed', 'cancelled'].includes(action ?? '')) {
      state.status = action as 'completed' | 'failed' | 'cancelled';
      return jsonResponse({ data: { runId: RUN_ID }, requestId: 'soyuz-request' });
    }
    const responseData = () => ({
      runId: RUN_ID,
      contractVersion: '1',
      status: state.status,
      stage: null,
      claimExpiresAt: state.claimExpiresAt,
      cancelRequestedAt: null,
      workerId: state.workerId,
      claimCallbackId: state.claimCallbackId,
      updatedAt: new Date().toISOString(),
      lastHeartbeatAt: null,
      operationalHealth: 'healthy',
    });

    if (method === 'GET' && action === RUN_ID) return jsonResponse({ data: responseData(), requestId: 'soyuz-request' });
    if (method === 'POST' && action === 'claim') {
      claims += 1;
      await Promise.resolve();
      if (state.status !== 'queued') {
        if ((state.status === 'claimed' || state.status === 'running')
          && state.workerId === body?.workerId
          && state.claimCallbackId === body?.callbackId) {
          return jsonResponse({ data: responseData(), requestId: 'soyuz-request' });
        }
        return jsonResponse({ error: { code: 'RUN_CLAIMED', message: 'Another worker already owns this run' } }, 409);
      }
      state.status = 'claimed';
      state.workerId = String(body?.workerId);
      state.claimCallbackId = String(body?.callbackId);
      state.claimExpiresAt = new Date(Date.now() + 120_000).toISOString();
      if (options.loseFirstClaimResponse && claims === 1) {
        return jsonResponse({ error: { code: 'UPSTREAM_TIMEOUT', message: 'simulated lost claim response' } }, 503);
      }
      return jsonResponse({ data: responseData(), requestId: 'soyuz-request' });
    }
    if (method === 'POST' && action === 'started') {
      if (state.status === 'claimed' && state.workerId === body?.workerId
        && (!body?.claimCallbackId || state.claimCallbackId === body.claimCallbackId)) {
        state.status = 'running';
        state.startedAt = String(body?.startedAt);
        state.claimExpiresAt = null;
        return jsonResponse({ data: responseData(), requestId: 'soyuz-request' });
      }
      if (state.status === 'running' && state.workerId === body?.workerId) {
        return jsonResponse({ data: responseData(), requestId: 'soyuz-request' });
      }
      return jsonResponse({ error: { code: 'INVALID_STATE_TRANSITION', message: 'Run cannot start' } }, 409);
    }
    throw new Error(`Unexpected request ${method} ${url}`);
  });
  return { fetchImpl, calls };
}

function makeAdapter(workerId: string, scheduler: object, fetchImpl: typeof fetch): SoyuzAdapter {
  const config = adapterConfig(workerId);
  return new SoyuzAdapter(
    { soyuz: config } as KasekiApiConfig,
    scheduler as never,
    async () => ({ allowed: true, status: 'allowed', reason: 'safe', responseTime: 1 }),
    config,
    fetchImpl,
  );
}

describe('Soyuz adapter handoff', () => {
  test('uploads bounded allowlisted artifacts and retries them before reporting terminal status', async () => {
    const resultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kaseki-soyuz-terminal-'));
    try {
      await fs.writeFile(path.join(resultDir, 'result-summary.md'), '# Finished\n');
      await fs.writeFile(path.join(resultDir, 'git.diff'), 'diff --git a/a b/a\n');
      await fs.writeFile(path.join(resultDir, 'stdout.log'), 'private raw log');
      const state = runState();
      state.status = 'running';
      state.workerId = 'host-a';
      state.claimCallbackId = '66666666-6666-4666-8666-666666666666';
      const { fetchImpl, calls } = createFetch(state, { failFirstArtifactUpload: true });
      const { scheduler, jobs } = createScheduler('host-a', 0);
      jobs.push({
        id: 'kaseki-terminal',
        status: 'completed',
        request: queuedRun.request,
        createdAt: new Date(),
        completedAt: new Date(),
        resultDir,
        correlationId: CORRELATION_ID,
        requestId: REQUEST_ID,
        soyuz: {
          externalRunId: RUN_ID,
          workerId: 'host-a',
          contractVersion: '1',
          claimCallbackId: state.claimCallbackId,
          startedCallbackId: '44444444-4444-4444-8444-444444444444',
          startAuthorized: true,
          metadataUpdatedAt: new Date().toISOString(),
        },
      });
      const adapter = makeAdapter('host-a', scheduler, fetchImpl);

      await adapter.runOnce();
      await adapter.runOnce();
      expect(state.status).toBe('running');
      expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/completed'))).toBe(false);
      await adapter.runOnce();

      const artifactCalls = calls.filter((call) => call.method === 'PUT');
      expect(artifactCalls.map((call) => call.headers.get('x-artifact-name'))).toEqual([
        'result-summary.md', 'git.diff', 'result-summary.md',
      ]);
      expect(artifactCalls.every((call) => call.payloadBytes && call.payloadBytes < 2_000_000)).toBe(true);
      expect(calls.find((call) => call.method === 'POST' && call.url.endsWith('/completed'))).toBeDefined();
      expect(artifactCalls.at(-1)!.url.localeCompare(calls.find((call) => call.method === 'POST' && call.url.endsWith('/completed'))!.url)).toBeLessThan(0);
      expect(jobs[0].soyuz?.uploadedArtifactNames).toEqual(expect.arrayContaining(['result-summary.md', 'git.diff']));
      expect(state.status).toBe('completed');
    } finally {
      await fs.rm(resultDir, { recursive: true, force: true });
    }
  });

  test('recovers an uncertain queue acknowledgement by external run ID without a second local job', async () => {
    const state = runState();
    const { fetchImpl, calls } = createFetch(state, { loseFirstAck: true });
    const { scheduler, jobs } = createScheduler('host-a', 2);
    const adapter = makeAdapter('host-a', scheduler, fetchImpl);

    await adapter.runOnce();
    expect(state.status).toBe('running');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].soyuz?.startAuthorized).toBe(true);
    expect(scheduler.submitSoyuzJob).toHaveBeenCalledTimes(1);

    await adapter.runOnce();
    expect(jobs).toHaveLength(1);
    expect(scheduler.submitSoyuzJob).toHaveBeenCalledTimes(1);
    expect(calls.filter((call) => call.url.endsWith('/started'))).toHaveLength(1);
    expect(calls.filter((call) => call.url.endsWith('/messages/ack'))).toHaveLength(2);
    expect(calls.some((call) => call.url.endsWith('/messages/ack') && Array.isArray(call.body?.retries) && (call.body?.retries as unknown[]).length > 0)).toBe(false);
  });

  test('recovers a claim accepted before its response was lost after the adapter restarts', async () => {
    const state = runState();
    const { fetchImpl, calls } = createFetch(state, { loseFirstClaimResponse: true });
    const { scheduler, jobs, claimIntents } = createScheduler('host-a', 2);

    await makeAdapter('host-a', scheduler, fetchImpl).runOnce();
    expect(state.status).toBe('claimed');
    expect(jobs).toHaveLength(0);
    expect(claimIntents[0]?.claimCallbackId).toBe(state.claimCallbackId);

    await makeAdapter('host-a', scheduler, fetchImpl).runOnce();

    expect(state.status).toBe('running');
    expect(jobs).toHaveLength(1);
    expect(scheduler.authorizeSoyuzStart).toHaveBeenCalledTimes(1);
    expect(calls.filter((call) => call.url.endsWith('/claim'))).toHaveLength(1);
    expect(calls.find((call) => call.url.endsWith('/started'))?.body?.claimCallbackId).toBe(state.claimCallbackId);
  });

  test('two simulated hosts cannot both claim and schedule one Soyuz run', async () => {
    const state = runState();
    const { fetchImpl } = createFetch(state);
    const hostA = createScheduler('host-a');
    const hostB = createScheduler('host-b');
    const adapterA = makeAdapter('host-a', hostA.scheduler, fetchImpl);
    const adapterB = makeAdapter('host-b', hostB.scheduler, fetchImpl);

    await Promise.all([adapterA.runOnce(), adapterB.runOnce()]);

    expect(['claimed', 'running']).toContain(state.status);
    expect(hostA.jobs.length + hostB.jobs.length).toBe(1);
    expect(hostA.scheduler.authorizeSoyuzStart.mock.calls.length + hostB.scheduler.authorizeSoyuzStart.mock.calls.length).toBe(1);
    expect(hostA.scheduler.submitSoyuzJob.mock.calls.length + hostB.scheduler.submitSoyuzJob.mock.calls.length).toBe(1);
  });

  test('two controller instances with the same worker ID cannot share one claim', async () => {
    const state = runState();
    const { fetchImpl } = createFetch(state);
    const hostA = createScheduler('duplicated-host-id');
    const hostB = createScheduler('duplicated-host-id');
    const adapterA = makeAdapter('duplicated-host-id', hostA.scheduler, fetchImpl);
    const adapterB = makeAdapter('duplicated-host-id', hostB.scheduler, fetchImpl);

    await Promise.all([adapterA.runOnce(), adapterB.runOnce()]);

    expect(state.status).toBe('running');
    expect(state.claimCallbackId).toBeTruthy();
    expect(hostA.jobs.length + hostB.jobs.length).toBe(1);
    expect(hostA.scheduler.authorizeSoyuzStart.mock.calls.length + hostB.scheduler.authorizeSoyuzStart.mock.calls.length).toBe(1);
    expect(hostA.scheduler.submitSoyuzJob.mock.calls.length + hostB.scheduler.submitSoyuzJob.mock.calls.length).toBe(1);
  });

  test('reconciles a pre-start cancellation without authorizing execution', async () => {
    const state = runState();
    state.status = 'cancel_requested';
    state.workerId = 'host-a';
    const { fetchImpl, calls } = createFetch(state);
    const { scheduler, jobs } = createScheduler('host-a');
    jobs.push({
      id: 'kaseki-1',
      status: 'queued',
      request: queuedRun.request,
      createdAt: new Date(),
      correlationId: CORRELATION_ID,
      requestId: REQUEST_ID,
      soyuz: {
        externalRunId: RUN_ID,
        workerId: 'host-a',
        contractVersion: '1',
        startedCallbackId: '44444444-4444-4444-8444-444444444444',
        startAuthorized: false,
        metadataUpdatedAt: new Date().toISOString(),
      },
    });
    const adapter = makeAdapter('host-a', scheduler, fetchImpl);

    await adapter.runOnce();

    expect(scheduler.cancelSoyuzJob).toHaveBeenCalledWith('kaseki-1');
    expect(scheduler.authorizeSoyuzStart).not.toHaveBeenCalled();
    expect(calls.some((call) => call.url.endsWith('/started'))).toBe(false);
    expect(calls.filter((call) => call.url.endsWith('/messages/ack'))).toHaveLength(1);
  });
});
