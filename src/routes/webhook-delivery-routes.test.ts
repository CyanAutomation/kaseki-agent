import express from 'express';
import { Server } from 'http';
import { createWebhookDeliveryRoutes } from './webhook-delivery-routes';
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

describe('webhook delivery routes', () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  });

  it('lists secret-free delivery history and retries a failed delivery', async () => {
    const summary = {
      id: 'delivery-1', jobId: 'run-1', eventType: 'job.failed', status: 'failed',
      attempts: [{ timestamp: '2026-10-03T00:00:00.000Z', status: 'failed', statusCode: 500, error: 'HTTP 500' }],
    } as const;
    const scheduler = {
      getJobIncludingHistory: jest.fn().mockResolvedValue({ id: 'run-1' }),
      getWebhookDeliveries: jest.fn().mockReturnValue([summary]),
      retryWebhookDelivery: jest.fn().mockReturnValue(true),
    } as unknown as JobScheduler;
    const app = express();
    app.use(createWebhookDeliveryRoutes(scheduler));
    const started = await listen(app);
    server = started.server;

    const response = await fetch(`${started.url}/runs/run-1/webhook-deliveries`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deliveries: [summary] });

    const retry = await fetch(`${started.url}/runs/run-1/webhook-deliveries/delivery-1/retry`, { method: 'POST' });
    expect(retry.status).toBe(202);
    await expect(retry.json()).resolves.toMatchObject({ id: 'delivery-1', status: 'pending' });
    expect(scheduler.retryWebhookDelivery).toHaveBeenCalledWith('run-1', 'delivery-1');
  });

  it('returns 409 when a delivery is not failed', async () => {
    const scheduler = {
      getJobIncludingHistory: jest.fn().mockResolvedValue({ id: 'run-1' }),
      getWebhookDeliveries: jest.fn().mockReturnValue([{ id: 'delivery-1', status: 'success' }]),
      retryWebhookDelivery: jest.fn(),
    } as unknown as JobScheduler;
    const app = express();
    app.use(createWebhookDeliveryRoutes(scheduler));
    const started = await listen(app);
    server = started.server;

    const response = await fetch(`${started.url}/runs/run-1/webhook-deliveries/delivery-1/retry`, { method: 'POST' });
    expect(response.status).toBe(409);
    expect(scheduler.retryWebhookDelivery).not.toHaveBeenCalled();
  });
});
