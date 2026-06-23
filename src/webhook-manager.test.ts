import * as fs from 'fs';
import { WebhookManager } from './webhook-manager';
import { WebhookConfig, WebhookEventType, WebhookPayload } from './kaseki-api-types';

class FakeClock {
  private currentTime: number;

  constructor(initialTime: number) {
    this.currentTime = initialTime;
  }

  now = (): number => this.currentTime;

  advanceTo(time: number): void {
    this.currentTime = time;
  }
}

/**
 * WebhookManager Tests
 *
 * Validates webhook delivery, retry logic, and persistence across restarts.
 * Tests cover:
 * - Retry attempts with configurable max attempts (1–5 retries)
 * - Delivery log recovery on manager restart
 * - Malformed line handling and queue filtering
 * - Queue size tracking and state cleanup
 *
 * Note: Tests interact with disk-based delivery log (~158 lines total)
 */
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
  ])('should send webhook exactly $expectedSends time(s) when maxAttempts=$maxAttempts', async ({ maxAttempts, expectedSends }) => {
    // Spec: Webhook manager respects retry policy maxAttempts configuration
    // Behavioral intent: Failed webhook (500 status) should be retried exactly maxAttempts times, then removed from queue
    // Expected outcome: fetchMock.calls.length === expectedSends; queue is empty after max retries exhausted
    const resultsDir = fs.mkdtempSync('/tmp/kaseki-webhook-manager-test-');
    const clock = new FakeClock(Date.UTC(2026, 0, 1));
    const manager = new WebhookManager(resultsDir, { now: clock.now });
    manager.stopProcessing();

    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => '' });
    global.fetch = fetchMock as unknown as typeof fetch;

    manager.enqueueWebhook('job-123', basePayload, createConfig(maxAttempts));

    for (let i = 0; i < expectedSends + 2; i++) {
      await manager.drainQueueForTest();
      const [queueEntry] = manager.getQueuedDeliveriesForTest();
      if (queueEntry?.nextRetryTime !== undefined) {
        clock.advanceTo(queueEntry.nextRetryTime);
      }
    }

    expect(fetchMock).toHaveBeenCalledTimes(expectedSends);
    expect(manager.getQueueSize()).toBe(0);

    await manager.shutdown();
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });
});

describe('WebhookManager delivery log recovery', () => {
  // Spec: Webhook manager must recover pending deliveries from disk on restart
  // Critical for durability: All pending webhook deliveries should survive manager restart
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should re-enqueue pending deliveries on restart and retry immediately when retry time is stale', async () => {
    // Spec: Entries in delivery log with stale nextRetryTime should be retried immediately
    // Behavioral intent: Old log entries should be picked up and processed on next processQueue() call
    // Expected outcome: Queue size > 0; nextRetryTime updated to current time (stale retry marked as ready)
    const resultsDir = fs.mkdtempSync('/tmp/kaseki-webhook-manager-recovery-test-');
    const deliveryLogPath = `${resultsDir}/.kaseki-webhook-delivery.log`;
    const clock = new FakeClock(Date.UTC(2026, 0, 1));

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
          nextRetryTime: clock.now() - 60_000,
        }),
      ].join('\n'),
      'utf-8'
    );

    const manager = new WebhookManager(resultsDir, { now: clock.now });
    manager.stopProcessing();

    try {
      expect(manager.getQueueSize()).toBe(1);
      const [queueEntry] = manager.getQueuedDeliveriesForTest();
      expect(queueEntry?.nextRetryTime).toBe(clock.now());
    } finally {
      await manager.shutdown();
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  test('should skip malformed lines and non-retryable entries while recovering valid pending rows', async () => {
    // Spec: Delivery log parsing must be robust to malformed JSON and terminal states
    // Behavioral intent: Parser should skip invalid lines, skip successful/maxed deliveries, only enqueue valid pending
    // Expected outcome: Only job-valid (pending, attempts < maxAttempts) is enqueued; others filtered
    // Regression: GH#2567 — Do not crash on malformed JSON; log skipped entries
    const resultsDir = fs.mkdtempSync('/tmp/kaseki-webhook-manager-malformed-test-');
    const deliveryLogPath = `${resultsDir}/.kaseki-webhook-delivery.log`;
    const clock = new FakeClock(Date.UTC(2026, 0, 1));
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
          nextRetryTime: clock.now() + 10_000,
        }),
        JSON.stringify({
          jobId: 'job-maxed',
          payload: { eventType: WebhookEventType.JOB_FAILED, jobId: 'job-maxed', timestamp: new Date().toISOString(), data: {} },
          config: { url: 'https://example.com/webhook', retryPolicy: { maxAttempts: 1, initialDelayMs: 100, maxDelayMs: 500 } },
          deliveryAttempts: 1,
          attempts: [{ timestamp: new Date().toISOString(), status: 'failed' }],
          nextRetryTime: clock.now() + 10_000,
        }),
        JSON.stringify({
          jobId: 'job-valid',
          payload: { eventType: WebhookEventType.JOB_FAILED, jobId: 'job-valid', timestamp: new Date().toISOString(), data: {} },
          config: { url: 'https://example.com/webhook', retryPolicy: { maxAttempts: 2, initialDelayMs: 100, maxDelayMs: 500 } },
          deliveryAttempts: 0,
          attempts: [{ timestamp: new Date().toISOString(), status: 'pending' }],
          nextRetryTime: clock.now() + 10_000,
        }),
      ].join('\n'),
      'utf-8'
    );

    const manager = new WebhookManager(resultsDir, { now: clock.now });
    manager.stopProcessing();

    try {
      expect(manager.getQueueSize()).toBe(1);
      expect(manager.getQueuedDeliveriesForTest()[0]?.jobId).toBe('job-valid');
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      await manager.shutdown();
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });
});
