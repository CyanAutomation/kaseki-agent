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
