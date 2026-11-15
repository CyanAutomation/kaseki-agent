import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { JobScheduler } from '../job-scheduler';
import type { Job, StatusResponse } from '../kaseki-api-types';
import type { KasekiApiConfig } from '../kaseki-api-config';
import { StatusResponseBuilder } from '../utils/status-response-builder';
import type { SoyuzSubmissionClient } from '../integrations/soyuz/SoyuzSubmissionClient';
import { createStatusRoutes } from './status-routes';

const CANONICAL_ID = '11111111-1111-4111-8111-111111111111';

describe('status routes cancellation', () => {
  const buildStatus = jest.spyOn(StatusResponseBuilder.prototype, 'buildStatus')
    .mockImplementation((job) => ({ id: job.id, status: job.status } as StatusResponse));

  afterEach(() => {
    buildStatus.mockClear();
  });

  it('cancels a local active run and returns the built status', async () => {
    const job = makeJob('local-run', 'running');
    const cancelJob = jest.fn(() => job);
    const scheduler = makeScheduler([job], { cancelJob });

    await withStatusRoute(scheduler, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/runs/local-run/cancel`, { method: 'POST' });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ id: 'local-run', status: 'running', cancelOutcome: 'cancelled' });
      expect(cancelJob).toHaveBeenCalledWith('local-run');
    });
  });

  it('does not cancel a terminal local run', async () => {
    const job = makeJob('local-run', 'completed');
    const cancelJob = jest.fn(() => job);
    const scheduler = makeScheduler([job], { cancelJob });

    await withStatusRoute(scheduler, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/runs/local-run/cancel`, { method: 'POST' });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ id: 'local-run', status: 'completed', cancelOutcome: 'already_terminal' });
      expect(cancelJob).not.toHaveBeenCalled();
    });
  });

  it('uses the Soyuz cancel operation for an unknown canonical run ID', async () => {
    const cancelRun = jest.fn(async () => ({
      id: CANONICAL_ID,
      status: 'cancelled',
      origin: { type: 'kaseki', id: 'host-1' },
    }));
    const submissionClient = { cancelRun } as unknown as SoyuzSubmissionClient;

    await withStatusRoute(makeScheduler([]), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/runs/${CANONICAL_ID}/cancel`, { method: 'POST' });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id: CANONICAL_ID,
        status: 'failed',
        cancelOutcome: 'already_terminal',
      });
      expect(cancelRun).toHaveBeenCalledWith(CANONICAL_ID);
    }, submissionClient);
  });
});

function makeJob(id: string, status: Job['status']): Job {
  return {
    id,
    status,
    request: {} as Job['request'],
    createdAt: new Date('2026-11-15T00:00:00.000Z'),
  } as Job;
}

function makeScheduler(
  jobs: Job[],
  overrides: { cancelJob?: (id: string) => Job | undefined } = {},
): JobScheduler {
  const find = (id: string) => jobs.find((job) => job.id === id);
  return {
    getJobIncludingHistory: async (id: string) => find(id),
    listAllJobs: async () => jobs,
    getJob: (id: string) => find(id),
    listJobs: () => jobs,
    cancelJob: overrides.cancelJob ?? (() => undefined),
  } as unknown as JobScheduler;
}

async function withStatusRoute(
  scheduler: JobScheduler,
  run: (baseUrl: string) => Promise<void>,
  submissionClient?: SoyuzSubmissionClient,
): Promise<void> {
  const app = express();
  app.use(createStatusRoutes(scheduler, { resultsDir: '/tmp' } as KasekiApiConfig, undefined, submissionClient));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
