import * as fs from 'fs';
import { WebhookManager } from './webhook-manager';
import { WebhookConfig, WebhookEventType, WebhookPayload } from './kaseki-api-types';

describe('WebhookManager retry attempts', () => {
  const originalFetch = global.fetch;

  afterEach(async () => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const basePayload: WebhookPayload = {
    eventType: WebhookEventType.JOB_FAILED,
    jobId: 'job-123',
    timestamp: new Date().toISOString(),
    data: { status: 'failed', error: 'boom' },
  };

  const createConfig = (maxAttempts: number): WebhookConfig => ({
    url: 'https://example.com/webhook',
    retryPolicy: {
      maxAttempts,
      initialDelayMs: 100,
      maxDelayMs: 1000,
    },
  });

  test.each([
    { maxAttempts: 1, expectedSends: 1 },
    { maxAttempts: 2, expectedSends: 2 },
  ])('sends exactly $expectedSends time(s) when maxAttempts=$maxAttempts', async ({ maxAttempts, expectedSends }) => {
    const resultsDir = fs.mkdtempSync('/tmp/kaseki-webhook-manager-test-');
    const manager = new WebhookManager(resultsDir);
    manager.stopProcessing();

    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    global.fetch = fetchMock as unknown as typeof fetch;

    manager.enqueueWebhook('job-123', basePayload, createConfig(maxAttempts));

    for (let i = 0; i < expectedSends + 2; i++) {
      await (manager as any).processQueue();
      const queueEntry = (manager as any).deliveryQueue[0];
      if (queueEntry) {
        queueEntry.nextRetryTime = Date.now() - 1;
      }
    }

    expect(fetchMock).toHaveBeenCalledTimes(expectedSends);
    expect(manager.getQueueSize()).toBe(0);

    await manager.shutdown();
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });
});

describe('WebhookManager delivery log recovery', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('re-enqueues pending deliveries on restart and retries immediately when retry time is stale', () => {
    const resultsDir = fs.mkdtempSync('/tmp/kaseki-webhook-manager-recovery-test-');
    const deliveryLogPath = `${resultsDir}/.kaseki-webhook-delivery.log`;

    fs.writeFileSync(
      deliveryLogPath,
      [
        JSON.stringify({
          jobId: 'job-retry',
          payload: {
            eventType: WebhookEventType.JOB_FAILED,
            jobId: 'job-retry',
            timestamp: new Date().toISOString(),
            data: { status: 'failed' },
          },
          config: {
            url: 'https://example.com/webhook',
            retryPolicy: { maxAttempts: 3, initialDelayMs: 100, maxDelayMs: 500 },
          },
          deliveryAttempts: 1,
          attempts: [{ timestamp: new Date().toISOString(), status: 'retry' }],
          nextRetryTime: Date.now() - 60_000,
        }),
      ].join('\n'),
      'utf-8'
    );

    const manager = new WebhookManager(resultsDir);
    manager.stopProcessing();

    expect(manager.getQueueSize()).toBe(1);
    const queueEntry = (manager as any).deliveryQueue[0];
    expect(queueEntry.nextRetryTime).toBeGreaterThanOrEqual(Date.now() - 1000);

    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  test('skips malformed lines and terminal/non-retryable entries while recovering valid pending rows', () => {
    const resultsDir = fs.mkdtempSync('/tmp/kaseki-webhook-manager-malformed-test-');
    const deliveryLogPath = `${resultsDir}/.kaseki-webhook-delivery.log`;
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    fs.writeFileSync(
      deliveryLogPath,
      [
        '{not-json}',
        JSON.stringify({
          payload: { eventType: WebhookEventType.JOB_FAILED },
          config: { url: 'https://example.com/webhook' },
          deliveryAttempts: 0,
        }),
        JSON.stringify({
          jobId: 'job-success',
          payload: { eventType: WebhookEventType.JOB_FAILED, jobId: 'job-success', timestamp: new Date().toISOString(), data: {} },
          config: { url: 'https://example.com/webhook', retryPolicy: { maxAttempts: 5, initialDelayMs: 100, maxDelayMs: 500 } },
          deliveryAttempts: 1,
          attempts: [{ timestamp: new Date().toISOString(), status: 'success' }],
          nextRetryTime: Date.now() + 10_000,
        }),
        JSON.stringify({
          jobId: 'job-maxed',
          payload: { eventType: WebhookEventType.JOB_FAILED, jobId: 'job-maxed', timestamp: new Date().toISOString(), data: {} },
          config: { url: 'https://example.com/webhook', retryPolicy: { maxAttempts: 1, initialDelayMs: 100, maxDelayMs: 500 } },
          deliveryAttempts: 1,
          attempts: [{ timestamp: new Date().toISOString(), status: 'failed' }],
          nextRetryTime: Date.now() + 10_000,
        }),
        JSON.stringify({
          jobId: 'job-valid',
          payload: { eventType: WebhookEventType.JOB_FAILED, jobId: 'job-valid', timestamp: new Date().toISOString(), data: {} },
          config: { url: 'https://example.com/webhook', retryPolicy: { maxAttempts: 2, initialDelayMs: 100, maxDelayMs: 500 } },
          deliveryAttempts: 0,
          attempts: [{ timestamp: new Date().toISOString(), status: 'pending' }],
          nextRetryTime: Date.now() + 10_000,
        }),
      ].join('\n'),
      'utf-8'
    );

    const manager = new WebhookManager(resultsDir);
    manager.stopProcessing();

    expect(manager.getQueueSize()).toBe(1);
    expect((manager as any).deliveryQueue[0].jobId).toBe('job-valid');
    expect(logSpy).toHaveBeenCalled();

    logSpy.mockRestore();
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });
});
