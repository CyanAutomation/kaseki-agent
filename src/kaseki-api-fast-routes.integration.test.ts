import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import express from 'express';
import type { AddressInfo, Server } from 'net';
import { createApiRouter } from './kaseki-api-routes';
import { IdempotencyStore } from './idempotency-store';
import { PreFlightValidator } from './pre-flight-validator';
import { createMockScheduler, createTestConfig, type MockJob, type TestScheduler } from './test-utils';

async function listen(app: express.Express): Promise<{ server: Server; baseUrl: string }> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const port = (server.address() as AddressInfo).port;
  return { server, baseUrl: `http://127.0.0.1:${port}/api` };
}

async function close(server: Server, idempotencyStore: IdempotencyStore): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  await idempotencyStore.shutdown();
}

async function createFastRouteHarness(scheduler: TestScheduler = createMockScheduler()): Promise<{
  baseUrl: string;
  server: Server;
  idempotencyStore: IdempotencyStore;
  resultsDir: string;
  scheduler: TestScheduler;
}> {
  const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-api-fast-routes-'));
  const config = createTestConfig(resultsDir);
  const idempotencyStore = new IdempotencyStore(config.resultsDir, 24);
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter(scheduler as any, config, idempotencyStore, new PreFlightValidator()));
  const { server, baseUrl } = await listen(app);
  return { baseUrl, server, idempotencyStore, resultsDir, scheduler };
}

const auth = { Authorization: 'Bearer test-key' };

describe('kaseki API fast route/service integration', () => {
  let cleanup: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const item of cleanup.reverse()) {
      try { await item(); } catch (e) { console.error('Cleanup error:', e); }
    }
    cleanup = [];
    delete process.env.KASEKI_SKIP_BOOTSTRAP_CHECK;
  });

  test('validates request payloads before scheduler submission', async () => {
    process.env.KASEKI_SKIP_BOOTSTRAP_CHECK = '1';
    const harness = await createFastRouteHarness();
    cleanup.push(() => close(harness.server, harness.idempotencyStore));
    cleanup.push(() => fs.rmSync(harness.resultsDir, { recursive: true, force: true }));

    const response = await fetch(`${harness.baseUrl}/runs`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: 'not-a-url' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expect.objectContaining({ status: 400, title: 'Bad Request' }));
    expect(harness.scheduler.submitJob).not.toHaveBeenCalled();
  });

  test('returns the run submission contract and persists fulfilled idempotency state', async () => {
    process.env.KASEKI_SKIP_BOOTSTRAP_CHECK = '1';
    const scheduler = createMockScheduler();
    scheduler.submitJob.mockImplementation(async (request) => ({
      id: 'kaseki-1',
      status: 'queued',
      request,
      createdAt: new Date('2026-06-18T02:00:00Z'),
      resultDir: path.join(os.tmpdir(), 'kaseki-1'),
      correlationId: 'corr-route-contract',
      requestId: 'req-route-contract',
    }));
    const harness = await createFastRouteHarness(scheduler);
    cleanup.push(() => close(harness.server, harness.idempotencyStore));
    cleanup.push(() => fs.rmSync(harness.resultsDir, { recursive: true, force: true }));

    const response = await fetch(`${harness.baseUrl}/runs`, {
      method: 'POST',
      headers: {
        ...auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        repoUrl: 'https://github.com/example/repo',
        publishMode: 'none',
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(payload).toEqual({
      id: 'kaseki-1',
      status: 'queued',
      createdAt: '2026-06-18T02:00:00.000Z',
      correlationId: 'corr-route-contract',
      requestId: 'req-route-contract',
    });
    expect(scheduler.submitJob).toHaveBeenCalledWith(expect.objectContaining({
      repoUrl: 'https://github.com/example/repo',
      publishMode: 'none',
    }));
    expect(scheduler.submitJob).toHaveBeenCalledTimes(1);

    const persistedLines = fs.readFileSync(
      path.join(harness.resultsDir, '.kaseki-api-idempotency.jsonl'),
      'utf-8'
    ).trim().split('\n').map((line) => JSON.parse(line));
    expect(persistedLines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
        state: 'fulfilled',
        jobId: 'kaseki-1',
        responsePayload: expect.objectContaining({
          id: 'kaseki-1',
          status: 'queued',
        }),
      }),
    ]));
  });

  test('reports deterministic not-ready health response without submitting work', async () => {
    const scheduler = createMockScheduler();
    scheduler.getReadiness.mockReturnValue({
      ready: false,
      reasons: ['results_dir_unwritable:EACCES'],
    });
    const harness = await createFastRouteHarness(scheduler);
    cleanup.push(() => close(harness.server, harness.idempotencyStore));
    cleanup.push(() => fs.rmSync(harness.resultsDir, { recursive: true, force: true }));

    const response = await fetch(`${harness.baseUrl}/ready`);
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      status: 'not_ready',
      timestamp: expect.any(String),
      reasons: ['results_dir_unwritable:EACCES'],
    });
    expect(scheduler.submitJob).not.toHaveBeenCalled();
  });

  test('requires valid bearer auth for protected routes while leaving readiness public', async () => {
    const harness = await createFastRouteHarness();
    cleanup.push(() => close(harness.server, harness.idempotencyStore));
    cleanup.push(() => fs.rmSync(harness.resultsDir, { recursive: true, force: true }));

    await expect(fetch(`${harness.baseUrl}/ready`).then((res) => res.status)).resolves.toBe(200);
    await expect(fetch(`${harness.baseUrl}/runs`).then((res) => res.status)).resolves.toBe(401);
    await expect(fetch(`${harness.baseUrl}/runs`, { headers: { Authorization: 'Bearer wrong' } }).then((res) => res.status)).resolves.toBe(401);
    await expect(fetch(`${harness.baseUrl}/runs`, { headers: auth }).then((res) => res.status)).resolves.toBe(200);
  });

  test('lists jobs without starting a process-level service', async () => {
    const jobs: MockJob[] = [
      { id: 'kaseki-queued', status: 'queued' as any, createdAt: new Date('2026-06-18T01:00:00Z') },
      { id: 'kaseki-done', status: 'completed', createdAt: new Date('2026-06-18T00:00:00Z'), exitCode: 0 },
    ];
    const scheduler = createMockScheduler();
    scheduler.listJobs.mockReturnValue(jobs);
    const harness = await createFastRouteHarness(scheduler);
    cleanup.push(() => close(harness.server, harness.idempotencyStore));
    cleanup.push(() => fs.rmSync(harness.resultsDir, { recursive: true, force: true }));

    const response = await fetch(`${harness.baseUrl}/runs?limit=1`, { headers: auth });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.total).toBe(2);
    expect(payload.runs).toEqual([
      expect.objectContaining({ id: 'kaseki-queued', status: 'queued' as any, createdAt: '2026-06-18T01:00:00.000Z' }),
    ]);
  });

  test('surfaces explicit job status transitions through the status route', async () => {
    const job: MockJob = { id: 'kaseki-transition', status: 'queued' as any, createdAt: new Date('2026-06-18T00:00:00Z') };
    const scheduler = createMockScheduler({ [job.id]: job });
    const harness = await createFastRouteHarness(scheduler);
    cleanup.push(() => close(harness.server, harness.idempotencyStore));
    cleanup.push(() => fs.rmSync(harness.resultsDir, { recursive: true, force: true }));

    const observed: string[] = [];
    for (const status of ['queued', 'running', 'completed'] as const) {
      job.status = status;
      const response = await fetch(`${harness.baseUrl}/runs/${job.id}/status`, { headers: auth });
      expect(response.status).toBe(200);
      observed.push((await response.json()).status);
    }

    expect(observed).toEqual(['queued', 'running', 'completed']);
  });
});
