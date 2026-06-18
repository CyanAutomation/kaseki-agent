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
  await new Promise<void>((resolve) => server.close(() => resolve()));
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
    for (const item of cleanup.reverse()) await item();
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
