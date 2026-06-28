import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { runPiEventFilter } from './pi-event-filter';
import { JobScheduler } from './job-scheduler';
import { createApiRouter, classifyDockerFailure } from './kaseki-api-routes';
import { IdempotencyStore } from './idempotency-store';
import { PreFlightValidator } from './pre-flight-validator';
import { createMockScheduler, createTestConfig } from './test-utils';

describe('affected binary source contracts', () => {
  test('pi-event-filter exports and runs the event filtering contract from source', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-event-filter-contract-'));
    const inputPath = path.join(tmpDir, 'events.raw.jsonl');
    const filteredPath = path.join(tmpDir, 'events.jsonl');
    const summaryPath = path.join(tmpDir, 'summary.json');

    try {
      fs.writeFileSync(inputPath, [
        JSON.stringify({
          type: 'tool_execution_start',
          timestamp: '2026-01-01T00:00:00.000Z',
          message: { model: 'contract-model', api: 'contract-api' },
          assistantMessageEvent: { type: 'thinking_delta' },
        }),
        JSON.stringify({
          type: 'tool_execution_end',
          timestamp: '2026-01-01T00:00:01.000Z',
          message: {
            model: 'contract-model',
            api: 'contract-api',
            content: [
              { type: 'thinking', text: 'hidden' },
              { type: 'output_text', text: 'visible' },
            ],
          },
          assistantMessageEvent: {
            type: 'output_delta',
            partial: { content: [{ type: 'thinking', text: 'hidden' }, { type: 'output_text', text: 'kept' }] },
          },
        }),
      ].join('\n') + '\n');

      expect(typeof runPiEventFilter).toBe('function');
      await runPiEventFilter(inputPath, filteredPath, summaryPath);

      const kept = JSON.parse(fs.readFileSync(filteredPath, 'utf8').trim());
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
      expect(kept.message.content).toEqual([{ type: 'output_text', text: 'visible' }]);
      expect(kept.assistantMessageEvent.partial.content).toEqual([{ type: 'output_text', text: 'kept' }]);
      expect(summary).toMatchObject({
        selected_model: 'contract-model',
        selected_api: 'contract-api',
        tool_start_count: 1,
        tool_end_count: 1,
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('job-scheduler source exports JobScheduler and queues submitted jobs', async () => {
    const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-scheduler-contract-'));
    const scheduler = new JobScheduler({ ...createTestConfig(resultsDir), maxConcurrentRuns: 0 }, { enqueueWebhook: jest.fn() } as any);

    try {
      expect(typeof JobScheduler).toBe('function');
      const job = await scheduler.submitJob({ repoUrl: 'https://github.com/example/repo', ref: 'main', task: 'contract test' } as any);
      expect(job.status).toBe('queued');
      expect(scheduler.getJob(job.id)).toMatchObject({ id: job.id, status: 'queued' });
    } finally {
      await scheduler.shutdown();
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('kaseki-api-routes source exports router and docker failure classification behavior', () => {
    const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-routes-contract-'));

    try {
      const config = { ...createTestConfig(resultsDir), apiKeys: ['secret'] };
      const router = createApiRouter(
        createMockScheduler() as any,
        config,
        new IdempotencyStore(resultsDir, 24),
        new PreFlightValidator(),
      );
      const app = express();
      app.use('/api', router);

      expect(typeof createApiRouter).toBe('function');
      expect(app._router ?? app.router).toBeDefined();
      expect(classifyDockerFailure('Cannot connect to the Docker daemon at unix:///var/run/docker.sock')).toMatchObject({
        detail: 'Docker daemon is unreachable from the API process.',
        remediation: 'Mount /var/run/docker.sock and verify the host Docker daemon is running.',
      });
    } finally {
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });
});
