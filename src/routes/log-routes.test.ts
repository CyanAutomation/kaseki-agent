import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createLogRoutes } from './log-routes';
import { createMockScheduler, createTestConfig } from '../test-utils';

describe('log route rate limiting', () => {
  test('limits repeated filesystem log reads for a client IP', async () => {
    const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-log-rate-limit-'));
    const jobId = 'kaseki-log-rate-limit';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'stdout.log'), 'log content\n');

    const config = createTestConfig(resultsDir);
    config.apiRequestsPerMinute = 1;
    const scheduler = createMockScheduler({
      [jobId]: {
        id: jobId,
        status: 'completed',
        createdAt: new Date(),
        resultDir: jobDir,
      },
    });
    const app = express();
    app.use(createLogRoutes(scheduler as any, config));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const port = (server.address() as AddressInfo).port;

    try {
      const first = await fetch(`http://127.0.0.1:${port}/runs/${jobId}/logs/stdout`);
      const second = await fetch(`http://127.0.0.1:${port}/runs/${jobId}/logs/stdout`);

      expect(first.status).toBe(200);
      expect(await first.json()).toMatchObject({ logType: 'stdout', content: 'log content\n' });
      expect(second.status).toBe(429);
      expect(Number(second.headers.get('retry-after'))).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('does not add an independent limit after the shared API auth middleware identifies a key', async () => {
    const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-log-shared-limit-'));
    const jobId = 'kaseki-log-shared-limit';
    const jobDir = path.join(resultsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'stdout.log'), 'log content\n');

    const config = createTestConfig(resultsDir);
    config.apiRequestsPerMinute = 1;
    const scheduler = createMockScheduler({
      [jobId]: {
        id: jobId,
        status: 'completed',
        createdAt: new Date(),
        resultDir: jobDir,
      },
    });
    const app = express();
    app.use((_req, res, next) => {
      // createApiRouter sets this after validating the API key and applies its
      // fixed-window request quota before mounting this router.
      res.locals.apiKey = 'test-key';
      next();
    });
    app.use(createLogRoutes(scheduler as any, config));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const port = (server.address() as AddressInfo).port;

    try {
      const first = await fetch(`http://127.0.0.1:${port}/runs/${jobId}/logs/stdout`);
      const second = await fetch(`http://127.0.0.1:${port}/runs/${jobId}/logs/stdout`);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });
});
