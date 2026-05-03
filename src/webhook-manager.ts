import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { WebhookPayload, WebhookConfig } from './kaseki-api-types.js';
import { createEventLogger, EventLogger } from './logger.js';

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
  attempts: WebhookDeliveryAttempt[];
  nextRetryTime?: number; // Unix timestamp
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

  /**
   * Process the delivery queue.
   */
  private async processQueue(): Promise<void> {
    // Limit concurrent deliveries
    if (this.activeDeliveries >= this.maxConcurrentDeliveries) {
      return;
    }

    // Find next entry to deliver
    const now = Date.now();
    const entry = this.deliveryQueue.find((e) => {
      const lastAttempt = e.attempts[e.attempts.length - 1];
      const isCompleted = lastAttempt.status === 'success';
      const shouldRetry = e.nextRetryTime && e.nextRetryTime <= now;
      const exceedsMaxAttempts = e.attempts.length > (e.config.retryPolicy?.maxAttempts || 5);
      return !isCompleted && shouldRetry && !exceedsMaxAttempts;
    });

    if (!entry) {
      return;
    }

    this.activeDeliveries++;
    try {
      await this.deliverWebhook(entry);
    } finally {
      this.activeDeliveries--;
    }
  }

  /**
   * Deliver a webhook with retry logic.
   */
  private async deliverWebhook(entry: WebhookQueueEntry): Promise<void> {
    const { config, payload, jobId } = entry;
    const signature = this.generateSignature(payload, config);
    const startTime = Date.now();

    try {
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
          attempts: entry.attempts.length,
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
          retryPolicy.initialDelayMs * Math.pow(2, entry.attempts.length - 1),
          retryPolicy.maxDelayMs
        );

        entry.attempts.push({
          timestamp: new Date().toISOString(),
          status: entry.attempts.length < retryPolicy.maxAttempts ? 'retry' : 'failed',
          statusCode: response.status,
          durationMs,
          error: `HTTP ${response.status}`,
        });

        if (entry.attempts.length < retryPolicy.maxAttempts) {
          entry.nextRetryTime = Date.now() + backoffMs;

          this.logger.event('webhook_retry_scheduled', {
            jobId,
            eventType: payload.eventType,
            statusCode: response.status,
            nextRetryMs: backoffMs,
            attemptNumber: entry.attempts.length,
          });
        } else {
          this.logger.event('webhook_delivery_failed', {
            jobId,
            eventType: payload.eventType,
            statusCode: response.status,
            attempts: entry.attempts.length,
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
        retryPolicy.initialDelayMs * Math.pow(2, entry.attempts.length - 1),
        retryPolicy.maxDelayMs
      );

      entry.attempts.push({
        timestamp: new Date().toISOString(),
        status: entry.attempts.length < retryPolicy.maxAttempts ? 'retry' : 'failed',
        error: errorMsg,
        durationMs,
      });

      if (entry.attempts.length < retryPolicy.maxAttempts) {
        entry.nextRetryTime = Date.now() + backoffMs;

        this.logger.event('webhook_delivery_error', {
          jobId,
          eventType: payload.eventType,
          error: errorMsg,
          nextRetryMs: backoffMs,
          attemptNumber: entry.attempts.length,
        });
      } else {
        this.logger.event('webhook_delivery_failed', {
          jobId,
          eventType: payload.eventType,
          error: errorMsg,
          attempts: entry.attempts.length,
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
        eventType: entry.payload.eventType,
        webhookUrl: entry.config.url,
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

      // For now, we discard pending deliveries on restart
      // In a production system, you might want to reload them
      this.logger.event('webhook_log_loaded', {
        pendingDeliveries: lines.length,
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
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.persistDeliveryLog();
    this.logger.event('webhook_manager_shutdown', {
      queueSize: this.deliveryQueue.length,
    });
  }
}
