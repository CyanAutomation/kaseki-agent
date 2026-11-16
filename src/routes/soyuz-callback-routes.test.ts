import express from 'express';
import { Server } from 'http';
import { createSoyuzCallbackRoutes } from './soyuz-callback-routes';
import type { JobScheduler } from '../job-scheduler';

async function listen(app: express.Express): Promise<{ server: Server; url: string }> {
  const server = await new Promise<Server>((resolve, reject) => {
    const nextServer = app.listen(0, '127.0.0.1', () => resolve(nextServer));
    nextServer.on('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

describe('Soyuz callback routes', () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  });

  it('lists blocked callback diagnostics without exposing callback payloads and retries a selected callback', async () => {
    const callbackId = '22222222-2222-4222-8222-222222222222';
    const blocked = [{
      callbackId,
      externalRunId: '11111111-1111-4111-8111-111111111111',
      eventType: 'failed',
      attemptCount: 4,
      createdAt: '2026-11-16T12:00:00.000Z',
      blockedAt: '2026-11-16T12:04:00.000Z',
      lastError: 'Failed callback failed validation',
      lastErrorDetails: '[{"path":"failureMessage","message":"Invalid length"}]',
    }];
    const scheduler = {
      getBlockedSoyuzCallbacks: jest.fn().mockResolvedValue(blocked),
      retryBlockedSoyuzCallback: jest.fn().mockResolvedValue(true),
    } as unknown as JobScheduler;
    const app = express();
    app.use(createSoyuzCallbackRoutes(scheduler));
    const started = await listen(app);
    server = started.server;

    const response = await fetch(`${started.url}/soyuz/callbacks/blocked`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ callbacks: blocked });

    const retry = await fetch(`${started.url}/soyuz/callbacks/${callbackId}/retry`, { method: 'POST' });
    expect(retry.status).toBe(202);
    await expect(retry.json()).resolves.toMatchObject({ callbackId, status: 'pending' });
    expect(scheduler.retryBlockedSoyuzCallback).toHaveBeenCalledWith(callbackId);
  });

  it('rejects retries for callbacks that are not blocked', async () => {
    const callbackId = '22222222-2222-4222-8222-222222222222';
    const scheduler = {
      getBlockedSoyuzCallbacks: jest.fn().mockResolvedValue([]),
      retryBlockedSoyuzCallback: jest.fn().mockResolvedValue(false),
    } as unknown as JobScheduler;
    const app = express();
    app.use(createSoyuzCallbackRoutes(scheduler));
    const started = await listen(app);
    server = started.server;

    const response = await fetch(`${started.url}/soyuz/callbacks/${callbackId}/retry`, { method: 'POST' });
    expect(response.status).toBe(409);
    expect(scheduler.retryBlockedSoyuzCallback).toHaveBeenCalledWith(callbackId);
  });

  it('rejects malformed callback IDs before calling persistence', async () => {
    const scheduler = {
      getBlockedSoyuzCallbacks: jest.fn().mockResolvedValue([]),
      retryBlockedSoyuzCallback: jest.fn().mockResolvedValue(false),
    } as unknown as JobScheduler;
    const app = express();
    app.use(createSoyuzCallbackRoutes(scheduler));
    const started = await listen(app);
    server = started.server;

    const response = await fetch(`${started.url}/soyuz/callbacks/not-a-uuid/retry`, { method: 'POST' });

    expect(response.status).toBe(400);
    expect(scheduler.retryBlockedSoyuzCallback).not.toHaveBeenCalled();
  });
});
