import * as fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import type { KasekiApiConfig } from '../../kaseki-api-config';
import type { Job } from '../../kaseki-api-types';
import type { SoyuzOutboxEntry } from '../../job-persistence-manager';
import type { TaskAdmissionEvaluator } from '../../task-admission';
import { SoyuzAdapter } from './SoyuzAdapter';
import { loadSoyuzAdapterConfig, type SoyuzAdapterConfig } from './config';

jest.mock('../../kaseki-api-health-checks', () => ({
  checkGitHubAppCredentials: jest.fn(() => ({ name: 'github-app', ok: true })),
  checkTemplatePublishModeCompatibility: jest.fn(() => ({ ok: true })),
  getSubmissionTemplateHealthStatus: jest.fn(() => ({ status: { ok: true }, fromCache: true })),
  isTemplateDoctorTimeout: jest.fn(() => false),
}));

const RUN_ID = '019a6000-0000-7000-8000-000000000002';
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
    visibilityTimeoutMs: 120_000,
    requestTimeoutMs: 1_000,
    cancellationPollIntervalMs: 60_000,
    heartbeatIntervalMs: 60_000,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createScheduler(_workerId: string) {
  const jobs: Job[] = [];
  const callbacks: SoyuzOutboxEntry[] = [];
  const claimIntents: Array<{ externalRunId: string; workerId: string; queuedAt: string; claimCallbackId: string; createdAt: string }> = [];
  const scheduler = {
    isRunSlotAvailable: jest.fn(() => !jobs.some((job) => job.status === 'queued' || job.status === 'running')),
    getReadiness: jest.fn(() => ({ ready: true, reasons: [] })),
    listSoyuzJobs: jest.fn(async () => [...jobs]),
    findSoyuzJob: jest.fn(async (externalRunId: string) => jobs.find((job) => job.soyuz?.externalRunId === externalRunId)),
    submitSoyuzJob: jest.fn(async (
      request: unknown,
      externalRunId: string,
      owner: string,
      correlationId: string,
      requestId: string,
      claimCallbackId?: string,
      _advisoryRoutingHints?: unknown,
      _origin?: NonNullable<Job['soyuz']>['origin'],
      _retryOf?: string | null,
      publicationRoute?: NonNullable<Job['soyuz']>['publicationRoute'],
      publicationBaseSha?: string,
      _canonicalCreatedAt?: Date,
      taskAdmission?: Job['taskAdmission'],
    ) => {
      const job: Job = {
        id: `kaseki-${jobs.length + 1}`,
        status: 'queued',
        request: request as Job['request'],
        taskAdmission,
        createdAt: new Date(),
        correlationId,
        requestId,
        soyuz: {
          externalRunId,
          workerId: owner,
          contractVersion: '1',
          ...(claimCallbackId ? { claimCallbackId } : {}),
          ...(publicationRoute ? { publicationRoute } : {}),
          ...(publicationBaseSha ? { publicationBaseSha } : {}),
          startedCallbackId: '44444444-4444-4444-8444-444444444444',
          startAuthorized: false,
          metadataUpdatedAt: new Date().toISOString(),
        },
      };
      jobs.push(job);
      return job;
    }),
    reserveSoyuzStart: jest.fn(async (localRunId: string) => jobs.some((job) => job.id === localRunId && job.status === 'queued')),
    recordSoyuzAdmissionFailure: jest.fn(async (
      _request: unknown,
      externalRunId: string,
      owner: string,
      correlationId: string,
      requestId: string,
      claimCallbackId?: string,
      _origin?: NonNullable<Job['soyuz']>['origin'],
      _retryOf?: string | null,
      taskAdmission?: Job['taskAdmission'],
    ) => {
      const job: Job = {
        id: `kaseki-${jobs.length + 1}`,
        status: 'failed',
        failureClass: 'kaseki_admission_rejected',
        request: queuedRun.request,
        taskAdmission,
        createdAt: new Date(),
        completedAt: new Date(),
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
    failOrphanedSoyuzJob: jest.fn(async (localRunId: string) => {
      const job = jobs.find((candidate) => candidate.id === localRunId);
      if (job) {
        job.status = 'failed';
        job.failureClass = 'executor_lost';
        return true;
      }
      return false;
    }),
    holdSoyuzJob: jest.fn((localRunId: string) => {
      const job = jobs.find((candidate) => candidate.id === localRunId);
      if (job) job.status = 'failed';
    }),
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
    blockSoyuzCallback: jest.fn(async () => undefined),
    getSoyuzOutboxStatus: jest.fn(async () => ({ pending: 0, failures: 0, blocked: 0 })),
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
  failFirstRunRead?: boolean;
  failFirstArtifactUpload?: boolean;
  rejectArtifactUploadReport?: boolean;
  artifactUploadErrorMessage?: string;
  rejectTerminalCallback?: boolean;
  failTerminalCallback?: boolean;
} = {}, runValue: unknown = queuedRun) {
  let pulls = 0;
  let acks = 0;
  let claims = 0;
  let runReads = 0;
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
          messages: [{ body: runValue, id: 'ephemeral-message-id', timestamp_ms: Date.now(), attempts: pulls, lease_id: `lease-${pulls}` }],
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
        return jsonResponse({ error: { code: 'ARTIFACT_STORE_FAILED', message: options.artifactUploadErrorMessage ?? 'simulated upload failure' } }, 503);
      }
      return jsonResponse({ data: { id: action } }, 201);
    }
    if (method === 'PUT' && parsed.pathname.includes('/publication-manifests/')) {
      return jsonResponse({ data: { accepted: true } }, 201);
    }
    if (method === 'POST' && action === 'publication-intents') {
      return jsonResponse({ data: { publicationId: '019a6000-0000-7000-8000-000000000004' } }, 201);
    }
    if (method === 'POST' && ['completed', 'failed', 'cancelled'].includes(action ?? '')) {
      if (options.failTerminalCallback) {
        return jsonResponse({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Temporary Soyuz failure' } }, 503);
      }
      if (options.rejectTerminalCallback) {
        return jsonResponse({ error: {
          code: 'INVALID_WORKER_CALLBACK',
          message: 'Failed callback failed validation',
          details: [{ path: 'failureMessage', message: 'Invalid length' }],
        } }, 422);
      }
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

    if (method === 'GET' && action === RUN_ID) {
      runReads += 1;
      if (options.failFirstRunRead && runReads === 1) {
        return jsonResponse({ error: { code: 'UPSTREAM_TIMEOUT', message: 'simulated status read failure' } }, 503);
      }
      return jsonResponse({ data: responseData(), requestId: 'soyuz-request' });
    }
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
    if (method === 'POST' && action === 'events') {
      if (options.rejectArtifactUploadReport && body?.type === 'artifacts.uploaded') {
        return jsonResponse({ error: { code: 'INVALID_WORKER_EVENT', message: 'Unsupported event type' } }, 422);
      }
      if (body?.type === 'artifacts.uploaded' && state.status !== 'running' && state.status !== 'cancel_requested') {
        return jsonResponse({ error: { code: 'RUN_NOT_ACTIVE', message: 'Run no longer accepts operational events' } }, 409);
      }
      return jsonResponse({ data: { eventId: body?.eventId } }, 202);
    }
    throw new Error(`Unexpected request ${method} ${url}`);
  });
  return { fetchImpl, calls };
}

function makeAdapter(
  workerId: string,
  scheduler: object,
  fetchImpl: typeof fetch,
  taskAdmissionEvaluator: TaskAdmissionEvaluator = async () => ({
    allowed: true,
    status: 'allowed',
    reason: 'safe',
    responseTime: 1,
  }),
): SoyuzAdapter {
  const config = adapterConfig(workerId);
  return new SoyuzAdapter(
    { soyuz: config } as KasekiApiConfig,
    scheduler as never,
    taskAdmissionEvaluator,
    config,
    fetchImpl,
  );
}

describe('Soyuz adapter handoff', () => {
  test('ignores the retired queue batch-size setting', () => {
    const config = loadSoyuzAdapterConfig({ SOYUZ_ENABLED: 'false', SOYUZ_BATCH_SIZE: '100' });
    expect(config).not.toHaveProperty('batchSize');
  });

  test('pins a Kirisame route once, uploads claim-bound evidence, and registers intent before completion', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kaseki-soyuz-kirisame-route-'));
    const repoPath = path.join(root, 'repo');
    const runsDir = path.join(root, 'runs');
    const run = globalThis.structuredClone(queuedRun);
    run.request.repoUrl = 'https://github.com/CyanAutomation/somatic.git';
    run.request.publishMode = 'pr';
    const state = runState();
    const { fetchImpl, calls } = createFetch(state, {}, run);
    const { scheduler, jobs } = createScheduler('host-a');
    const config = adapterConfig('host-a');
    config.kirisamePublicationProducerEnabled = true;
    config.runsDir = runsDir;

    try {
      await fs.mkdir(path.join(repoPath, 'docs'), { recursive: true });
      await fs.writeFile(path.join(repoPath, 'docs/guide.md'), 'Old guide\n');
      await fs.writeFile(path.join(repoPath, 'obsolete.txt'), 'Remove me\n');
      execFileSync('git', ['init', '-q'], { cwd: repoPath });
      execFileSync('git', ['config', 'user.name', 'Kaseki Test'], { cwd: repoPath });
      execFileSync('git', ['config', 'user.email', 'kaseki-test@example.invalid'], { cwd: repoPath });
      execFileSync('git', ['add', '--all'], { cwd: repoPath });
      execFileSync('git', ['commit', '-qm', 'base'], { cwd: repoPath });
      const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, encoding: 'utf8' }).trim();
      await fs.writeFile(path.join(repoPath, 'docs/guide.md'), 'Updated guide\n');
      await fs.rm(path.join(repoPath, 'obsolete.txt'));
      await fs.writeFile(path.join(repoPath, 'new.txt'), 'New file\n');

      const adapter = new SoyuzAdapter(
        { soyuz: config } as KasekiApiConfig,
        scheduler as never,
        undefined,
        config,
        fetchImpl,
        async () => baseSha,
      );
      await adapter.runOnce();
      expect(jobs[0]?.soyuz).toMatchObject({ publicationRoute: 'kirisame', publicationBaseSha: baseSha });

      const job = jobs[0]!;
      const workspacePath = path.join(runsDir, job.id, 'workspace/repo');
      await fs.mkdir(path.dirname(workspacePath), { recursive: true });
      await fs.cp(repoPath, workspacePath, { recursive: true });
      job.resultDir = path.join(root, 'results', job.id);
      job.status = 'completed';
      job.exitCode = 0;
      job.completedAt = new Date('2026-11-24T12:00:00.000Z');

      await adapter.runOnce();
      await adapter.runOnce();

      const manifestIndex = calls.findIndex((call) => call.url.includes('/publication-manifests/'));
      const evidenceIndex = calls.findIndex((call) => call.url.endsWith('/events') && call.body?.type === 'validation.completed');
      const intentIndex = calls.findIndex((call) => call.url.endsWith('/publication-intents'));
      const completionIndex = calls.findIndex((call) => call.url.endsWith('/completed'));
      expect(manifestIndex).toBeGreaterThanOrEqual(0);
      expect(evidenceIndex).toBeGreaterThan(manifestIndex);
      expect(intentIndex).toBeGreaterThan(evidenceIndex);
      expect(completionIndex).toBeGreaterThan(intentIndex);
      expect(calls[evidenceIndex]?.body?.claimCallbackId).toBe(jobs[0]?.soyuz?.claimCallbackId);
      expect((calls[evidenceIndex]?.body?.payload as Record<string, unknown>)?.publicationEvidence).toMatchObject({
        outcome: 'passed',
        runId: RUN_ID,
        baseSha,
      });
      expect(calls[completionIndex]?.body).not.toHaveProperty('publishedUrl');
      expect(state.status).toBe('completed');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('keeps non-allowlisted destinations on the legacy publisher route', async () => {
    const run = globalThis.structuredClone(queuedRun);
    run.request.publishMode = 'pr';
    const { fetchImpl } = createFetch(runState(), {}, run);
    const { scheduler, jobs } = createScheduler('host-a');
    const config = adapterConfig('host-a');
    config.kirisamePublicationProducerEnabled = true;
    const resolveBaseSha = jest.fn(async () => '64e2e8195e5a4bc0a1a201603481e9d88cc4e37d');
    const adapter = new SoyuzAdapter(
      { soyuz: config } as KasekiApiConfig,
      scheduler as never,
      undefined,
      config,
      fetchImpl,
      resolveBaseSha,
    );

    await adapter.runOnce();

    expect(jobs[0]?.soyuz?.publicationRoute).toBe('legacy');
    expect(resolveBaseSha).not.toHaveBeenCalled();
  });

  test('does not pull another message while this agent has an active run', async () => {
    const state = runState();
    const { fetchImpl, calls } = createFetch(state);
    const { scheduler, jobs } = createScheduler('host-a');
    jobs.push({
      id: 'local-active-run',
      status: 'running',
      request: queuedRun.request,
      createdAt: new Date(),
      correlationId: CORRELATION_ID,
      requestId: REQUEST_ID,
    });

    await makeAdapter('host-a', scheduler, fetchImpl).runOnce();

    expect(calls.some((call) => call.url.endsWith('/messages/pull'))).toBe(false);
  });

  test('reads active canonical run status at most once per configured interval', async () => {
    const now = Date.parse('2026-11-16T12:00:00.000Z');
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const state = runState();
      state.status = 'running';
      state.workerId = 'host-a';
      state.claimCallbackId = '66666666-6666-4666-8666-666666666666';
      const { fetchImpl, calls } = createFetch(state);
      const { scheduler, jobs } = createScheduler('host-a');
      jobs.push({
        id: 'local-active-run',
        status: 'running',
        request: queuedRun.request,
        createdAt: new Date(now),
        correlationId: CORRELATION_ID,
        requestId: REQUEST_ID,
        soyuz: {
          externalRunId: RUN_ID,
          workerId: 'host-a',
          contractVersion: '1',
          claimCallbackId: state.claimCallbackId,
          startedCallbackId: '44444444-4444-4444-8444-444444444444',
          startAuthorized: true,
          lastHeartbeatAt: new Date(now).toISOString(),
          metadataUpdatedAt: new Date(now).toISOString(),
        },
      });
      scheduler.isRunSlotAvailable.mockReturnValue(false);
      const config = adapterConfig('host-a');
      config.cancellationPollIntervalMs = 60_000;
      config.heartbeatIntervalMs = 10_000;
      const adapter = new SoyuzAdapter({ soyuz: config } as KasekiApiConfig, scheduler as never, undefined, config, fetchImpl);
      const statusReads = () => calls.filter((call) => call.method === 'GET' && call.url.endsWith(`/v1/worker/runs/${RUN_ID}`));

      await adapter.runOnce();
      expect(statusReads()).toHaveLength(1);

      clock.mockReturnValue(now + 59_000);
      state.status = 'cancel_requested';
      await adapter.runOnce();
      expect(statusReads()).toHaveLength(1);
      expect(scheduler.cancelSoyuzJob).not.toHaveBeenCalled();
      expect(scheduler.enqueueSoyuzCallback).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'event',
        payload: expect.objectContaining({ type: 'worker.heartbeat' }),
      }));

      clock.mockReturnValue(now + 60_000);
      await adapter.runOnce();
      expect(statusReads()).toHaveLength(2);
      expect(scheduler.cancelSoyuzJob).toHaveBeenCalledWith('local-active-run');
    } finally {
      random.mockRestore();
      clock.mockRestore();
    }
  });

  test('does not fetch canonical status for a terminal local run awaiting its callback', async () => {
    const { fetchImpl, calls } = createFetch(runState());
    const { scheduler, jobs } = createScheduler('host-a');
    jobs.push({
      id: 'local-terminal-run',
      status: 'failed',
      failureClass: 'execution_failed',
      request: queuedRun.request,
      createdAt: new Date(),
      completedAt: new Date(),
      correlationId: CORRELATION_ID,
      requestId: REQUEST_ID,
      soyuz: {
        externalRunId: RUN_ID,
        workerId: 'host-a',
        contractVersion: '1',
        startedCallbackId: '44444444-4444-4444-8444-444444444444',
        startAuthorized: true,
        terminalCallbackDelivered: false,
      },
    });
    scheduler.isRunSlotAvailable.mockReturnValue(false);

    await makeAdapter('host-a', scheduler, fetchImpl).runOnce();

    expect(calls.some((call) => call.method === 'GET' && call.url.endsWith(`/v1/worker/runs/${RUN_ID}`))).toBe(false);
    expect(scheduler.persistSoyuzTerminalCallback).toHaveBeenCalledWith(jobs[0], expect.objectContaining({ eventType: 'failed' }));
  });

  test('blocks permanent callback validation failures and retains their details', async () => {
    const entry: SoyuzOutboxEntry = {
      externalRunId: RUN_ID,
      callbackId: '55555555-5555-4555-8555-555555555555',
      eventType: 'failed',
      payload: {
        callbackId: '55555555-5555-4555-8555-555555555555',
        workerId: 'host-a',
        failureClass: 'execution_failed',
        failureMessage: 'The run failed.',
      },
      attemptCount: 4,
      nextAttemptAt: new Date(0).toISOString(),
      deliveryState: 'delivering',
      createdAt: new Date(0).toISOString(),
    };
    const { fetchImpl } = createFetch(runState(), { rejectTerminalCallback: true });
    const { scheduler } = createScheduler('host-a');
    scheduler.claimSoyuzCallbacks.mockResolvedValue([entry]);
    scheduler.isRunSlotAvailable.mockReturnValue(false);

    await makeAdapter('host-a', scheduler, fetchImpl).runOnce();

    expect(scheduler.blockSoyuzCallback).toHaveBeenCalledWith(
      entry.callbackId,
      'Failed callback failed validation',
      [{ path: 'failureMessage', message: 'Invalid length' }],
    );
    expect(scheduler.retrySoyuzCallback).not.toHaveBeenCalled();
  });

  test('blocks a completed publication callback when host admission evidence is invalid', async () => {
    const entry: SoyuzOutboxEntry = {
      externalRunId: RUN_ID,
      callbackId: '77777777-7777-4777-8777-777777777777',
      eventType: 'completed',
      payload: { completedAt: new Date().toISOString() },
      attemptCount: 1,
      nextAttemptAt: new Date(0).toISOString(),
      deliveryState: 'delivering',
      createdAt: new Date(0).toISOString(),
    };
    const { fetchImpl } = createFetch(runState());
    const { scheduler, jobs } = createScheduler('host-a');
    scheduler.claimSoyuzCallbacks.mockResolvedValue([entry]);
    scheduler.isRunSlotAvailable.mockReturnValue(false);
    jobs.push({
      id: 'kirisame-invalid-publication',
      status: 'completed',
      exitCode: 0,
      request: { ...queuedRun.request },
      createdAt: new Date(),
      completedAt: new Date(),
      resultDir: '/tmp/kaseki-invalid-publication',
      correlationId: CORRELATION_ID,
      requestId: REQUEST_ID,
      soyuz: {
        externalRunId: RUN_ID,
        workerId: 'host-a',
        contractVersion: '1',
        claimCallbackId: '88888888-8888-4888-8888-888888888888',
        startedCallbackId: '44444444-4444-4444-8444-444444444444',
        startAuthorized: true,
        publicationRoute: 'kirisame',
      },
    });

    await makeAdapter('host-a', scheduler, fetchImpl).runOnce();

    const reason = 'Kirisame publication requires a successful host execution and pinned base commit.';
    expect(scheduler.blockSoyuzCallback).toHaveBeenCalledWith(
      entry.callbackId,
      reason,
      [{ path: 'publication', message: reason }],
    );
    expect(scheduler.retrySoyuzCallback).not.toHaveBeenCalled();
  });

  test('continues retrying transient server failures', async () => {
    const entry: SoyuzOutboxEntry = {
      externalRunId: RUN_ID,
      callbackId: '66666666-6666-4666-8666-666666666666',
      eventType: 'failed',
      payload: {
        callbackId: '66666666-6666-4666-8666-666666666666',
        workerId: 'host-a',
        failureClass: 'execution_failed',
        failureMessage: 'The run failed.',
      },
      attemptCount: 2,
      nextAttemptAt: new Date(0).toISOString(),
      deliveryState: 'delivering',
      createdAt: new Date(0).toISOString(),
    };
    const { fetchImpl } = createFetch(runState(), { failTerminalCallback: true });
    const { scheduler } = createScheduler('host-a');
    scheduler.claimSoyuzCallbacks.mockResolvedValue([entry]);
    scheduler.isRunSlotAvailable.mockReturnValue(false);

    await makeAdapter('host-a', scheduler, fetchImpl).runOnce();

    expect(scheduler.retrySoyuzCallback).toHaveBeenCalledWith(
      entry.callbackId,
      expect.any(String),
      'Temporary Soyuz failure',
    );
    expect(scheduler.blockSoyuzCallback).not.toHaveBeenCalled();
  });

  test('terminalizes a running local job whose executor disappeared without polling Soyuz', async () => {
    const state = runState();
    state.status = 'running';
    state.workerId = 'host-a';
    const { fetchImpl, calls } = createFetch(state);
    const { scheduler, jobs } = createScheduler('host-a');
    jobs.push({
      id: 'local-orphaned-run',
      status: 'running',
      request: queuedRun.request,
      createdAt: new Date(),
      correlationId: CORRELATION_ID,
      requestId: REQUEST_ID,
      soyuz: {
        externalRunId: RUN_ID,
        workerId: 'host-a',
        contractVersion: '1',
        startedCallbackId: '44444444-4444-4444-8444-444444444444',
        startAuthorized: true,
      },
    });
    scheduler.isJobExecuting.mockReturnValue(false);
    scheduler.isRunSlotAvailable.mockReturnValue(false);

    await makeAdapter('host-a', scheduler, fetchImpl).runOnce();

    expect(scheduler.failOrphanedSoyuzJob).toHaveBeenCalledWith('local-orphaned-run');
    expect(calls.some((call) => call.method === 'GET' && call.url.endsWith(`/v1/worker/runs/${RUN_ID}`))).toBe(false);
    expect(scheduler.enqueueSoyuzCallback).not.toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'event',
      payload: expect.objectContaining({ type: 'worker.heartbeat', payload: expect.objectContaining({ executionActive: false }) }),
    }));
  });

  test('backs off failed canonical reads and resumes at the next retry time', async () => {
    const now = Date.parse('2026-11-16T12:00:00.000Z');
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const state = runState();
      state.status = 'running';
      state.workerId = 'host-a';
      const { fetchImpl, calls } = createFetch(state, { failFirstRunRead: true });
      const { scheduler, jobs } = createScheduler('host-a');
      jobs.push({
        id: 'local-active-run',
        status: 'running',
        request: queuedRun.request,
        createdAt: new Date(now),
        correlationId: CORRELATION_ID,
        requestId: REQUEST_ID,
        soyuz: {
          externalRunId: RUN_ID,
          workerId: 'host-a',
          contractVersion: '1',
          startedCallbackId: '44444444-4444-4444-8444-444444444444',
          startAuthorized: true,
          lastHeartbeatAt: new Date(now).toISOString(),
          metadataUpdatedAt: new Date(now).toISOString(),
        },
      });
      scheduler.isRunSlotAvailable.mockReturnValue(false);
      const config = adapterConfig('host-a');
      config.pollIntervalMs = 5_000;
      const adapter = new SoyuzAdapter({ soyuz: config } as KasekiApiConfig, scheduler as never, undefined, config, fetchImpl);
      const statusReads = () => calls.filter((call) => call.method === 'GET' && call.url.endsWith(`/v1/worker/runs/${RUN_ID}`));

      await adapter.runOnce();
      expect(statusReads()).toHaveLength(1);

      clock.mockReturnValue(now + 4_999);
      await adapter.runOnce();
      expect(statusReads()).toHaveLength(1);

      clock.mockReturnValue(now + 5_000);
      await adapter.runOnce();
      expect(statusReads()).toHaveLength(2);
    } finally {
      clock.mockRestore();
    }
  });

  test('caps canonical status reads globally and rotates deferred runs fairly', async () => {
    const now = Date.parse('2026-11-16T12:00:00.000Z');
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const runIds = Array.from({ length: 61 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
      const calls: string[] = [];
      const fetchImpl = jest.fn(async (input: Parameters<typeof fetch>[0]) => {
        const runId = new URL(String(input)).pathname.split('/').pop()!;
        calls.push(runId);
        return jsonResponse({ data: {
          runId,
          contractVersion: '1',
          status: 'running',
          stage: null,
          claimExpiresAt: null,
          cancelRequestedAt: null,
          workerId: 'host-a',
          claimCallbackId: null,
          updatedAt: new Date(now).toISOString(),
          lastHeartbeatAt: null,
          operationalHealth: 'healthy',
        } });
      }) as unknown as typeof fetch;
      const { scheduler, jobs } = createScheduler('host-a');
      jobs.push(...runIds.map((externalRunId, index): Job => ({
        id: `local-run-${index}`,
        status: 'running',
        request: queuedRun.request,
        createdAt: new Date(now),
        correlationId: CORRELATION_ID,
        requestId: REQUEST_ID,
        soyuz: {
          externalRunId,
          workerId: 'host-a',
          contractVersion: '1',
          startedCallbackId: '44444444-4444-4444-8444-444444444444',
          startAuthorized: true,
        },
      })));
      scheduler.isRunSlotAvailable.mockReturnValue(false);
      const config = adapterConfig('host-a');
      config.cancellationPollIntervalMs = 60_000;
      const adapter = new SoyuzAdapter({ soyuz: config } as KasekiApiConfig, scheduler as never, undefined, config, fetchImpl);

      await adapter.runOnce();
      expect(calls).toHaveLength(60);
      expect(calls).not.toContain(runIds[60]);

      clock.mockReturnValue(now + 60_000);
      await adapter.runOnce();
      expect(calls).toContain(runIds[60]);
    } finally {
      clock.mockRestore();
    }
  });

  test('adds jitter after a canonical read so tracked runs do not synchronize', async () => {
    const now = Date.parse('2026-11-16T12:00:00.000Z');
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    const random = jest.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const state = runState();
      state.status = 'running';
      state.workerId = 'host-a';
      const { fetchImpl, calls } = createFetch(state);
      const { scheduler, jobs } = createScheduler('host-a');
      jobs.push({
        id: 'local-active-run',
        status: 'running',
        request: queuedRun.request,
        createdAt: new Date(now),
        correlationId: CORRELATION_ID,
        requestId: REQUEST_ID,
        soyuz: {
          externalRunId: RUN_ID,
          workerId: 'host-a',
          contractVersion: '1',
          startedCallbackId: '44444444-4444-4444-8444-444444444444',
          startAuthorized: true,
          lastHeartbeatAt: new Date(now).toISOString(),
        },
      });
      scheduler.isRunSlotAvailable.mockReturnValue(false);
      const config = adapterConfig('host-a');
      config.cancellationPollIntervalMs = 60_000;
      const adapter = new SoyuzAdapter({ soyuz: config } as KasekiApiConfig, scheduler as never, undefined, config, fetchImpl);
      const statusReads = () => calls.filter((call) => call.method === 'GET' && call.url.endsWith(`/v1/worker/runs/${RUN_ID}`));

      await adapter.runOnce();
      clock.mockReturnValue(now + 60_000);
      await adapter.runOnce();
      expect(statusReads()).toHaveLength(1);

      clock.mockReturnValue(now + 62_500);
      await adapter.runOnce();
      expect(statusReads()).toHaveLength(2);
    } finally {
      random.mockRestore();
      clock.mockRestore();
    }
  });

  test('uploads bounded allowlisted artifacts and retries them before reporting terminal status', async () => {
    const resultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kaseki-soyuz-terminal-'));
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await fs.writeFile(path.join(resultDir, 'result-summary.md'), '# Finished\n');
      await fs.writeFile(path.join(resultDir, 'git.diff'), 'diff --git a/a b/a\n');
      await fs.writeFile(path.join(resultDir, 'changed-files.txt'), 'src/a.ts\nsrc/b.ts\n');
      await fs.writeFile(path.join(resultDir, 'metadata.json'), JSON.stringify({ github_pr_url: 'https://github.com/example/project/pull/7' }));
      await fs.writeFile(path.join(resultDir, 'run-scorecard.json'), '{"overall_score":72}\n');
      await fs.writeFile(path.join(resultDir, 'run-evaluation.json'), '{"task_completion_score":3}\n');
      await fs.writeFile(path.join(resultDir, 'stdout.log'), 'private raw log');
      const state = runState();
      state.status = 'running';
      state.workerId = 'host-a';
      state.claimCallbackId = '66666666-6666-4666-8666-666666666666';
      const { fetchImpl, calls } = createFetch(state, {
        failFirstArtifactUpload: true,
        artifactUploadErrorMessage: 'storage token=ghp_ABCDEFGHIJKLMNOPQRSTUVWX rejected',
      });
      const { scheduler, jobs } = createScheduler('host-a');
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
        'result-summary.md', 'git.diff', 'changed-files.txt', 'run-scorecard.json', 'run-evaluation.json', 'result-summary.md',
      ]);
      expect(artifactCalls.every((call) => call.payloadBytes && call.payloadBytes < 2_000_000)).toBe(true);
      const completion = calls.find((call) => call.method === 'POST' && call.url.endsWith('/completed'));
      expect(completion).toMatchObject({
        body: {
          summary: '# Finished',
          publishedUrl: 'https://github.com/example/project/pull/7',
          changedFileCount: 2,
        },
      });
      const artifactReport = calls.find((call) => call.method === 'POST' && call.url.endsWith('/events'));
      expect(artifactReport).toMatchObject({
        body: {
          type: 'artifacts.uploaded',
          payload: { status: 'complete', uploadedCount: 5, failedCount: 0, skippedCount: 0 },
        },
      });
      expect(calls.indexOf(artifactReport!)).toBeLessThan(calls.indexOf(completion!));
      expect(artifactCalls.at(-1)!.url.localeCompare(completion!.url)).toBeLessThan(0);
      expect(jobs[0].soyuz?.uploadedArtifactNames).toEqual(expect.arrayContaining([
        'result-summary.md', 'git.diff', 'changed-files.txt', 'run-scorecard.json', 'run-evaluation.json',
      ]));
      expect(jobs[0].soyuz?.artifactUploadReport).toMatchObject({
        status: 'complete',
        uploadedCount: 5,
        failedCount: 0,
        skippedCount: 0,
      });
      const uploadWarning = logSpy.mock.calls
        .map(([entry]) => JSON.parse(String(entry)) as { message?: string; detail?: Record<string, unknown> })
        .find((entry) => entry.message === 'Soyuz artifact upload failed and will be retried with the terminal callback');
      expect(uploadWarning?.detail?.error).toContain('storage token=[redacted] rejected');
      expect(uploadWarning?.detail?.error).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWX');
      expect(state.status).toBe('completed');
    } finally {
      logSpy.mockRestore();
      await fs.rm(resultDir, { recursive: true, force: true });
    }
  });

  test('queues a concise failure.json diagnosis in Soyuz terminal callbacks', async () => {
    const resultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kaseki-soyuz-failure-callback-'));
    try {
      await fs.writeFile(path.join(resultDir, 'failure.json'), JSON.stringify({
        failureClass: 'worker-container-startup',
        diagnostic_reason: 'Worker image could not start because its registry secret was unavailable.',
      }));
      const { fetchImpl } = createFetch(runState());
      const { scheduler } = createScheduler('host-a');
      const job: Job = {
        id: 'kaseki-failed',
        status: 'failed',
        failureClass: 'worker-container-startup',
        exitCode: 1,
        request: queuedRun.request,
        createdAt: new Date(),
        completedAt: new Date(),
        resultDir,
        soyuz: {
          externalRunId: RUN_ID,
          workerId: 'host-a',
          contractVersion: '1',
          startedCallbackId: '44444444-4444-4444-8444-444444444444',
          startAuthorized: true,
        },
      };

      await makeAdapter('host-a', scheduler, fetchImpl)['ensureTerminalCallback'](job);

      expect(scheduler.persistSoyuzTerminalCallback).toHaveBeenCalledWith(job, expect.objectContaining({
        eventType: 'failed',
        payload: expect.objectContaining({
          failureClass: 'worker-container-startup',
          failureMessage: 'Kaseki reported worker-container-startup: Worker image could not start because its registry secret was unavailable.',
        }),
      }));
    } finally {
      await fs.rm(resultDir, { recursive: true, force: true });
    }
  });

  test('delivers a pre-agent validation failure through the durable Soyuz callback outbox', async () => {
    const resultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kaseki-soyuz-pre-validation-failure-'));
    try {
      await fs.writeFile(path.join(resultDir, 'failure.json'), JSON.stringify({
        failureClass: 'pre_agent_validation_failed',
        pre_validation_failure_reason: 'validation_toolchain_preflight_failed: missing executable tsc',
      }));
      const state = runState();
      state.status = 'running';
      state.workerId = 'host-a';
      state.claimCallbackId = '66666666-6666-4666-8666-666666666666';
      const { fetchImpl, calls } = createFetch(state);
      const { scheduler, jobs } = createScheduler('host-a');
      scheduler.isRunSlotAvailable.mockReturnValue(false);
      const job: Job = {
        id: 'kaseki-pre-validation-failed',
        status: 'failed',
        failureClass: 'pre_agent_validation_failed',
        exitCode: 127,
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
        },
      };
      jobs.push(job);
      const adapter = makeAdapter('host-a', scheduler, fetchImpl);

      await adapter.runOnce();
      expect(scheduler.persistSoyuzTerminalCallback).toHaveBeenCalledWith(job, expect.objectContaining({
        eventType: 'failed',
        payload: expect.objectContaining({
          failureClass: 'pre_agent_validation_failed',
          failureMessage: expect.stringContaining('missing executable tsc'),
        }),
      }));

      await adapter.runOnce();
      expect(calls.find((call) => call.method === 'POST' && call.url.endsWith('/failed'))?.body).toEqual(expect.objectContaining({
        failureClass: 'pre_agent_validation_failed',
        failureMessage: expect.stringContaining('missing executable tsc'),
      }));
      expect(state.status).toBe('failed');
    } finally {
      await fs.rm(resultDir, { recursive: true, force: true });
    }
  });

  test('continues terminal delivery when an older Soyuz host rejects the artifact report event', async () => {
    const resultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kaseki-soyuz-legacy-report-'));
    try {
      await fs.writeFile(path.join(resultDir, 'result-summary.md'), '# Finished\n');
      const state = runState();
      state.status = 'running';
      state.workerId = 'host-a';
      state.claimCallbackId = '66666666-6666-4666-8666-666666666666';
      const { fetchImpl, calls } = createFetch(state, { rejectArtifactUploadReport: true });
      const { scheduler, jobs } = createScheduler('host-a');
      jobs.push({
        id: 'kaseki-legacy-report',
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
      await adapter.runOnce();

      expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/events') && call.body?.type === 'artifacts.uploaded')).toBe(true);
      expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/completed'))).toBe(true);
      expect(state.status).toBe('completed');
    } finally {
      await fs.rm(resultDir, { recursive: true, force: true });
    }
  });

  test('recovers an uncertain queue acknowledgement by external run ID without a second local job', async () => {
    const state = runState();
    const { fetchImpl, calls } = createFetch(state, { loseFirstAck: true });
    const { scheduler, jobs } = createScheduler('host-a');
    const adapter = makeAdapter('host-a', scheduler, fetchImpl);

    await adapter.runOnce();
    expect(state.status).toBe('running');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].soyuz?.startAuthorized).toBe(true);
    expect(scheduler.submitSoyuzJob).toHaveBeenCalledTimes(1);
    expect(calls.find((call) => call.url.endsWith('/messages/pull'))?.body).toEqual({
      visibility_timeout_ms: 120_000,
      batch_size: 1,
    });

    jobs[0].status = 'completed';
    state.status = 'completed';
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
    const { scheduler, jobs, claimIntents } = createScheduler('host-a');

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

  test('reconciles a queued local run by claiming it before authorizing its start', async () => {
    const state = runState();
    const { fetchImpl, calls } = createFetch(state);
    const { scheduler, jobs } = createScheduler('host-a');
    jobs.push({
      id: 'kaseki-recovery',
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

    await makeAdapter('host-a', scheduler, fetchImpl).runOnce();

    expect(state.status).toBe('running');
    expect(calls.filter((call) => call.url.endsWith('/claim'))).toHaveLength(1);
    expect(calls.filter((call) => call.url.endsWith('/started'))).toHaveLength(1);
    expect(scheduler.authorizeSoyuzStart).toHaveBeenCalledWith('kaseki-recovery');
    expect(calls.some((call) => call.url.endsWith('/messages/pull'))).toBe(false);
  });

  test('surfaces recovery when Soyuz starts a run that Kaseki cannot authorize', async () => {
    const state = runState();
    const { fetchImpl } = createFetch(state);
    const { scheduler, jobs } = createScheduler('host-a');
    jobs.push({
      id: 'kaseki-recovery',
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
    scheduler.authorizeSoyuzStart.mockResolvedValue(false);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await makeAdapter('host-a', scheduler, fetchImpl).runOnce();

      const loggedEvents = logSpy.mock.calls.map(([line]) => JSON.parse(String(line)) as {
        component?: string;
        message?: string;
        detail?: Record<string, unknown>;
      });
      expect(state.status).toBe('running');
      expect(jobs[0].status).toBe('queued');
      expect(loggedEvents).toContainEqual(expect.objectContaining({
        component: 'soyuz-adapter',
        message: 'Soyuz local-run reconciliation failed',
        detail: expect.objectContaining({
          localRunId: 'kaseki-recovery',
          error: 'Soyuz accepted started callback but Kaseki no longer has an authorizable queued job',
        }),
      }));
    } finally {
      logSpy.mockRestore();
    }
  });

  test('claims and durably reports work rejected by Kaseki admission without starting it', async () => {
    const state = runState();
    const { fetchImpl, calls } = createFetch(state);
    const { scheduler, jobs, claimIntents } = createScheduler('host-a');
    const rejectAdmission: TaskAdmissionEvaluator = async () => ({
      allowed: false,
      status: 'rejected',
      reason: 'unsafe task',
      reasonCode: 'high_risk',
      signal: 'risk_level',
      riskLevel: 'high',
      riskScore: 2,
      responseTime: 1,
    });

    const adapter = makeAdapter('host-a', scheduler, fetchImpl, rejectAdmission);
    await adapter.runOnce();
    // The callback is durably queued during admission handling and delivered on
    // the next adapter cycle, matching the production outbox lifecycle.
    await adapter.runOnce();

    expect(state.status).toBe('failed');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe('failed');
    expect(jobs[0]).toMatchObject({
      taskAdmission: {
        status: 'rejected',
        reasonCode: 'high_risk',
        signal: 'risk_level',
        riskLevel: 'high',
        riskScore: 2,
      },
    });
    expect(scheduler.recordSoyuzAdmissionFailure).toHaveBeenCalledTimes(1);
    expect(scheduler.authorizeSoyuzStart).not.toHaveBeenCalled();
    expect(calls.some((call) => call.url.endsWith('/started'))).toBe(false);
    expect(calls.some((call) => call.url.endsWith('/events') && call.body?.type === 'artifacts.uploaded')).toBe(false);
    const failedCallback = calls.find((call) => call.url.endsWith('/failed'));
    expect(failedCallback?.body).toMatchObject({
      failureClass: 'kaseki_admission_rejected',
      taskAdmission: {
        reasonCode: 'high_risk',
        riskLevel: 'high',
        riskScore: 2,
      },
    });
    expect(calls.some((call) => call.url.endsWith('/messages/ack'))).toBe(true);
    expect(claimIntents).toHaveLength(0);
  });

  test('retains the bounded admission result on a run that passes admission', async () => {
    const state = runState();
    const { fetchImpl } = createFetch(state);
    const { scheduler, jobs } = createScheduler('host-a');
    const admitWithRisk: TaskAdmissionEvaluator = async () => ({
      allowed: true,
      status: 'allowed',
      reason: 'Task Admission evaluation found no high-confidence unsafe condition.',
      reasonCode: 'admitted',
      riskLevel: 'review',
      riskScore: 1,
      responseTime: 7,
      answers: { private_classifier_output: { type: 'text', text: 'must not persist' } } as never,
    });

    await makeAdapter('host-a', scheduler, fetchImpl, admitWithRisk).runOnce();

    expect(jobs[0]).toMatchObject({
      taskAdmission: {
        status: 'allowed',
        reasonCode: 'admitted',
        riskLevel: 'review',
        riskScore: 1,
      },
    });
    expect(JSON.stringify(jobs[0].taskAdmission)).not.toContain('private_classifier_output');
    expect(JSON.stringify(jobs[0].taskAdmission)).not.toContain('must not persist');
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
