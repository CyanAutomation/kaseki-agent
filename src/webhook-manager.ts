import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { WebhookPayload, WebhookConfig } from './kaseki-api-types';
import { createEventLogger, EventLogger } from './logger';

/**
 * Webhook delivery attempt record.
 */
interface WebhookDeliveryAttempt {
  timestamp: string; // ISO 8601
  status: 'pending' | 'success' | 'failed' | 'retry';
  statusCode?: number;
  error?: string;
  durationMs?: number;
}

/**
 * Webhook delivery queue entry.
 */
interface WebhookQueueEntry {
  jobId: string;
  payload: WebhookPayload;
  config: WebhookConfig;
  deliveryAttempts: number;
  attempts: WebhookDeliveryAttempt[];
  nextRetryTime?: number; // Unix timestamp
  inFlight?: boolean; // In-memory flag to prevent duplicate deliveries
}

interface PersistedWebhookQueueEntry {
  jobId: string;
  payload: WebhookPayload;
  config: WebhookConfig;
  deliveryAttempts: number;
  attempts?: WebhookDeliveryAttempt[];
  nextRetryTime?: number;
}

/**
 * Webhook manager handles async delivery of webhook events with retry logic.
 */
export class WebhookManager extends EventEmitter {
  private deliveryQueue: WebhookQueueEntry[] = [];
  private logger: EventLogger;
  private deliveryLogPath: string;
  private processInterval: NodeJS.Timeout | null = null;
  private maxConcurrentDeliveries = 5;
  private activeDeliveries = 0;

  constructor(resultsDir: string) {
    super();
    this.logger = createEventLogger('webhook-manager');
    this.deliveryLogPath = path.join(resultsDir, '.kaseki-webhook-delivery.log');
    this.loadDeliveryLog();
    this.startProcessing();
  }

  /**
   * Enqueue a webhook for delivery.
   */
  enqueueWebhook(jobId: string, payload: WebhookPayload, config: WebhookConfig): void {
    // Check if event type is subscribed to
    if (config.events && !config.events.includes(payload.eventType)) {
      this.logger.debug(`Webhook event ${payload.eventType} not subscribed for job ${jobId}`);
      return;
    }

    const entry: WebhookQueueEntry = {
      jobId,
      payload,
      config,
      deliveryAttempts: 0,
      attempts: [
        {
          timestamp: new Date().toISOString(),
          status: 'pending',
        },
      ],
      nextRetryTime: Date.now(),
    };

    this.deliveryQueue.push(entry);
    this.persistDeliveryLog();

    this.logger.event('webhook_enqueued', {
      jobId,
      eventType: payload.eventType,
      webhookUrl: config.url,
      queueSize: this.deliveryQueue.length,
    });
  }

  /**
   * Start the processing loop.
   */
  private startProcessing(): void {
    if (this.processInterval) {
      return;
    }

    this.processInterval = setInterval(() => {
      this.processQueue();
    }, 500); // Check every 500ms
    this.processInterval.unref();
  }

  /**
   * Stop the processing loop.
   */
  stopProcessing(): void {
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }
  }

  isHealthy(): boolean {
    return this.processInterval !== null && this.activeDeliveries <= this.maxConcurrentDeliveries;
  }

  /**
   * Process the delivery queue.
   */
  private async processQueue(): Promise<void> {
    // Limit concurrent deliveries
    if (this.activeDeliveries >= this.maxConcurrentDeliveries) {
      return;
    }

    // Find next entry to deliver (exclude entries already in flight)
    const now = Date.now();
    const entry = this.deliveryQueue.find((e) => {
      const lastAttempt = e.attempts[e.attempts.length - 1];
      const isCompleted = lastAttempt.status === 'success';
      const shouldRetry = e.nextRetryTime && e.nextRetryTime <= now;
      const exceedsMaxAttempts = e.deliveryAttempts >= (e.config.retryPolicy?.maxAttempts || 5);
      const isInFlight = e.inFlight === true;
      return !isCompleted && shouldRetry && !exceedsMaxAttempts && !isInFlight;
    });

    if (!entry) {
      return;
    }

    // Mark entry as in-flight before starting delivery
    entry.inFlight = true;
    this.activeDeliveries++;

    try {
      await this.deliverWebhook(entry);
    } finally {
      // Clear in-flight status unless entry was removed from queue during delivery
      const stillInQueue = this.deliveryQueue.includes(entry);
      if (stillInQueue) {
        entry.inFlight = false;
      }
      this.activeDeliveries--;
    }
  }

  /**
   * Deliver a webhook with retry logic.
   */
  private async deliverWebhook(entry: WebhookQueueEntry): Promise<void> {
    // Note: inFlight flag is set in processQueue() before this method is called
    const { config, payload, jobId } = entry;
    const signature = this.generateSignature(payload, config);
    const startTime = Date.now();

    try {
      entry.deliveryAttempts++;
      const response = await fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Kaseki-Event': payload.eventType,
          'X-Kaseki-Job-Id': jobId,
          ...(signature && { 'X-Kaseki-Signature': signature }),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      const durationMs = Date.now() - startTime;

      // Drain the response body to release the HTTP connection
      await response.text().catch(() => {});

      if (response.ok) {
        // Success
        entry.attempts.push({
          timestamp: new Date().toISOString(),
          status: 'success',
          statusCode: response.status,
          durationMs,
        });

        this.logger.event('webhook_delivered', {
          jobId,
          eventType: payload.eventType,
          statusCode: response.status,
          durationMs,
          attempts: entry.deliveryAttempts,
        });

        // Remove from queue
        this.deliveryQueue = this.deliveryQueue.filter((e) => e !== entry);
        this.persistDeliveryLog();
      } else {
        // Transient error, schedule retry
        const retryPolicy = config.retryPolicy || {
          maxAttempts: 5,
          initialDelayMs: 1000,
          maxDelayMs: 30000,
        };

        const backoffMs = Math.min(
          retryPolicy.initialDelayMs * Math.pow(2, entry.deliveryAttempts - 1),
          retryPolicy.maxDelayMs
        );
        const hasRemainingAttempts = entry.deliveryAttempts < retryPolicy.maxAttempts;

        entry.attempts.push({
          timestamp: new Date().toISOString(),
          status: hasRemainingAttempts ? 'retry' : 'failed',
          statusCode: response.status,
          durationMs,
          error: `HTTP ${response.status}`,
        });

        if (hasRemainingAttempts) {
          entry.nextRetryTime = Date.now() + backoffMs;

          this.logger.event('webhook_retry_scheduled', {
            jobId,
            eventType: payload.eventType,
            statusCode: response.status,
            nextRetryMs: backoffMs,
            attemptNumber: entry.deliveryAttempts,
          });
        } else {
          this.logger.event('webhook_delivery_failed', {
            jobId,
            eventType: payload.eventType,
            statusCode: response.status,
            attempts: entry.deliveryAttempts,
          });

          // Remove from queue after max attempts
          this.deliveryQueue = this.deliveryQueue.filter((e) => e !== entry);
        }

        this.persistDeliveryLog();
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);
      const retryPolicy = config.retryPolicy || {
        maxAttempts: 5,
        initialDelayMs: 1000,
        maxDelayMs: 30000,
      };

      const backoffMs = Math.min(
        retryPolicy.initialDelayMs * Math.pow(2, entry.deliveryAttempts - 1),
        retryPolicy.maxDelayMs
      );
      const hasRemainingAttempts = entry.deliveryAttempts < retryPolicy.maxAttempts;

      entry.attempts.push({
        timestamp: new Date().toISOString(),
        status: hasRemainingAttempts ? 'retry' : 'failed',
        error: errorMsg,
        durationMs,
      });

      if (hasRemainingAttempts) {
        entry.nextRetryTime = Date.now() + backoffMs;

        this.logger.event('webhook_delivery_error', {
          jobId,
          eventType: payload.eventType,
          error: errorMsg,
          nextRetryMs: backoffMs,
          attemptNumber: entry.deliveryAttempts,
        });
      } else {
        this.logger.event('webhook_delivery_failed', {
          jobId,
          eventType: payload.eventType,
          error: errorMsg,
          attempts: entry.deliveryAttempts,
        });

        // Remove from queue after max attempts
        this.deliveryQueue = this.deliveryQueue.filter((e) => e !== entry);
      }

      this.persistDeliveryLog();
    }
  }

  /**
   * Generate HMAC-SHA256 signature for webhook payload.
   */
  private generateSignature(payload: WebhookPayload, config: WebhookConfig): string | null {
    if (!config.secret) {
      return null;
    }

    const body = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', config.secret).update(body).digest('hex');
    return `sha256=${signature}`;
  }

  /**
   * Persist delivery log to disk.
   */
  private persistDeliveryLog(): void {
    try {
      const logEntries = this.deliveryQueue.map((entry) => ({
        jobId: entry.jobId,
        payload: entry.payload,
        config: entry.config,
        deliveryAttempts: entry.deliveryAttempts,
        attempts: entry.attempts,
        nextRetryTime: entry.nextRetryTime,
      }));

      fs.writeFileSync(
        this.deliveryLogPath,
        logEntries.map((e) => JSON.stringify(e)).join('\n'),
        'utf-8'
      );
    } catch (error) {
      this.logger.error('Failed to persist webhook delivery log', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Load delivery log from disk.
   */
  private loadDeliveryLog(): void {
    try {
      if (!fs.existsSync(this.deliveryLogPath)) {
        return;
      }

      const content = fs.readFileSync(this.deliveryLogPath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());

      const now = Date.now();
      for (const line of lines) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch (error) {
          this.logger.warn('Skipping malformed webhook delivery log line', {
            reason: 'invalid_json',
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }

        const candidate = parsed as Partial<PersistedWebhookQueueEntry>;
        const hasRequiredFields =
          typeof candidate.jobId === 'string' &&
          !!candidate.payload &&
          typeof candidate.payload.eventType === 'string' &&
          !!candidate.config &&
          typeof candidate.config.url === 'string' &&
          typeof candidate.deliveryAttempts === 'number';

        if (!hasRequiredFields) {
          this.logger.warn('Skipping malformed webhook delivery log line', {
            reason: 'missing_required_fields',
            hasJobId: typeof candidate.jobId === 'string',
            hasPayload: !!candidate.payload,
            hasEventType: !!candidate.payload && typeof candidate.payload.eventType === 'string',
            hasConfigUrl: !!candidate.config && typeof candidate.config.url === 'string',
            hasDeliveryAttempts: typeof candidate.deliveryAttempts === 'number',
          });
          continue;
        }

        const retryPolicy = candidate.config!.retryPolicy || {
          maxAttempts: 5,
          initialDelayMs: 1000,
          maxDelayMs: 30000,
        };
        const lastAttempt = candidate.attempts?.[candidate.attempts.length - 1];
        const isTerminalSuccess = lastAttempt?.status === 'success';
        const hasRemainingAttempts = candidate.deliveryAttempts! < retryPolicy.maxAttempts;

        if (isTerminalSuccess || !hasRemainingAttempts) {
          continue;
        }

        this.deliveryQueue.push({
          jobId: candidate.jobId!,
          payload: candidate.payload!,
          config: candidate.config!,
          deliveryAttempts: candidate.deliveryAttempts!,
          attempts: candidate.attempts || [],
          nextRetryTime:
            typeof candidate.nextRetryTime === 'number' && candidate.nextRetryTime > now
              ? candidate.nextRetryTime
              : now,
        });
      }

      this.logger.event('webhook_log_loaded', {
        pendingDeliveries: lines.length,
        requeuedDeliveries: this.deliveryQueue.length,
      });
    } catch (error) {
      this.logger.error('Failed to load webhook delivery log', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get current queue size.
   */
  getQueueSize(): number {
    return this.deliveryQueue.length;
  }

  /**
   * Gracefully shutdown the webhook manager.
   */
  async shutdown(): Promise<void> {
    this.stopProcessing();

    // Wait for active deliveries to complete (with timeout)
    const shutdownTimeout = 5000;
    const startTime = Date.now();

    while (this.activeDeliveries > 0) {
      if (Date.now() - startTime > shutdownTimeout) {
        this.logger.warn('Webhook manager shutdown timeout reached', {
          activeDeliveries: this.activeDeliveries,
        });
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100).unref());
    }

    this.persistDeliveryLog();

    this.logger.event('webhook_manager_shutdown', {
      queueSize: this.deliveryQueue.length,
    });

    // Clean up all event listeners to prevent handle leaks
    this.removeAllListeners();
  }
}
