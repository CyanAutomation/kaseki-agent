import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { filterPiEvents, sanitize, shouldKeep } from './pi-event-filter';
import { JobScheduler } from './job-scheduler';
import { WebhookManager } from './webhook-manager';
import { classifyDockerFailure, createApiRouter } from './kaseki-api-routes';
import type { KasekiApiConfig } from './kaseki-api-config';

const tempDirs: string[] = [];
const webhookManagers: WebhookManager[] = [];

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createConfig(resultsDir = createTempDir('kaseki-contract-results-')): KasekiApiConfig {
  return {
    port: 8080,
    apiKeys: ['test-key'],
    resultsDir,
    maxConcurrentRuns: 0,
    defaultTaskMode: 'patch',
    maxDiffBytes: 200000,
    agentTimeoutSeconds: 60,
    logLevel: 'info',
  };
}

function createWebhookManager(): WebhookManager {
  const manager = new WebhookManager(createTempDir('kaseki-contract-webhooks-'));
  webhookManagers.push(manager);
  return manager;
}

afterEach(async () => {
  while (webhookManagers.length > 0) {
    await webhookManagers.pop()?.shutdown();
  }
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('affected binary source contracts', () => {
  test('pi-event-filter exports source behavior for filtering, sanitizing, and summary generation', async () => {
    const dir = createTempDir('kaseki-pi-filter-contract-');
    const inputPath = path.join(dir, 'events.jsonl');
    const outputPath = path.join(dir, 'filtered.jsonl');
    const summaryPath = path.join(dir, 'summary.json');
    const thinkingEvent = {
      type: 'assistant_message',
      assistantMessageEvent: {
        type: 'thinking_delta',
        partial: { content: [{ type: 'thinking', text: 'hidden' }] },
      },
    };
    const keptEvent = {
      type: 'tool_execution_end',
      timestamp: '2026-06-28T00:00:00.000Z',
      message: {
        model: 'openai/gpt-test',
        api: 'responses',
        content: [
          { type: 'thinking', text: 'hidden' },
          { type: 'output_text', text: 'visible result' },
        ],
      },
    };

    expect(shouldKeep(thinkingEvent)).toBe(false);
    expect(sanitize(keptEvent).message?.content).toEqual([
      { type: 'output_text', text: 'visible result' },
    ]);

    fs.writeFileSync(
      inputPath,
      `${JSON.stringify(thinkingEvent)}\nnot-json\n${JSON.stringify(keptEvent)}\n`,
    );

    await filterPiEvents(inputPath, outputPath, summaryPath);

    const filtered = fs.readFileSync(outputPath, 'utf8').trim().split('\n').map(JSON.parse);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].message.content).toEqual([{ type: 'output_text', text: 'visible result' }]);

    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    expect(summary.selected_model).toBe('openai/gpt-test');
    expect(summary.selected_api).toBe('responses');
    expect(summary.invalid_json_lines).toBe(1);
    expect(summary.tool_end_count).toBe(1);
  });

  test('job-scheduler exports JobScheduler and preserves queued job public behavior', async () => {
    const scheduler = new JobScheduler(createConfig(), createWebhookManager());

    const job = await scheduler.submitJob({
      repoUrl: 'https://github.com/example/repo',
      ref: 'main',
      taskMode: 'inspect',
    });

    expect(job.status).toBe('queued');
    expect(job.correlationId).toEqual(expect.any(String));
    expect(scheduler.getJob(job.id)).toBe(job);
    expect(scheduler.listJobs()).toEqual([job]);

    const cancelled = scheduler.cancelJob(job.id);
    expect(cancelled?.status).toBe('failed');
    expect(cancelled?.failureClass).toBe('cancelled');
  });

  test('kaseki-api-routes exports route factory and docker failure classification behavior', () => {
    const scheduler = new JobScheduler(createConfig(), createWebhookManager());
    const idempotencyStore = { get: jest.fn(), set: jest.fn() } as any;
    const preFlightValidator = { validate: jest.fn() } as any;

    const router = createApiRouter(scheduler, createConfig(), idempotencyStore, preFlightValidator);

    expect(typeof router).toBe('function');
    expect((router as any).stack.length).toBeGreaterThan(0);
    expect(classifyDockerFailure('docker: Cannot connect to the Docker daemon')).toMatchObject({
      detail: 'Docker daemon is unreachable from the API process.',
    });
  });
});
