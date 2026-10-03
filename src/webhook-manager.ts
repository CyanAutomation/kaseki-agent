import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { WebhookPayload, WebhookConfig } from './kaseki-api-types';
import { createEventLogger, EventLogger } from './logger';
import { getRetryDecision } from './webhook-retry-policy';
import { postWebhookSafely, WebhookHttpResponse } from './safe-webhook-http';

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
  deliveryClaimOwner?: string;
  deliveryClaimExpiresAt?: number;
}

interface PersistedWebhookQueueEntry {
  jobId: string;
  payload: WebhookPayload;
  config: WebhookConfig;
  deliveryAttempts: number;
  attempts?: WebhookDeliveryAttempt[];
  nextRetryTime?: number;
  deliveryClaimOwner?: string;
  deliveryClaimExpiresAt?: number;
  terminal?: boolean;
}

export interface WebhookManagerOptions {
  now?: () => number;
  deliveryClaimLeaseMs?: number;
  allowedOrigins?: readonly string[];
  sendWebhook?: (url: string, body: string, headers: Record<string, string>) => Promise<WebhookHttpResponse>;
}

export interface WebhookQueueSnapshotEntry {
  jobId: string;
  deliveryAttempts: number;
  nextRetryTime?: number;
  lastAttemptStatus?: WebhookDeliveryAttempt['status'];
}

export interface WebhookDeliverySummary {
  id: string;
  jobId: string;
  eventType: string;
  status: WebhookDeliveryAttempt['status'];
  attempts: Array<Pick<WebhookDeliveryAttempt, 'timestamp' | 'status' | 'statusCode' | 'durationMs' | 'error'>>;
  nextRetryAt?: string;
}

/**
 * Webhook manager handles async delivery of webhook events with retry logic.
 */
export class WebhookManager extends EventEmitter {
  private deliveryQueue: WebhookQueueEntry[] = [];
  private logger: EventLogger;
  private deliveryLogPath: string;
  private deliveryLogLockPath: string;
  private removedDeliveryKeys = new Set<string>();
  private processInterval: NodeJS.Timeout | null = null;
  private maxConcurrentDeliveries = 5;
  private activeDeliveries = 0;
  private readonly now: () => number;
  private readonly fileSystemClockOffsetMs: number;
  private readonly deliveryClaimOwner = `${process.pid}:${crypto.randomUUID()}`;
  private readonly deliveryClaimLeaseMs: number;
  private readonly sendWebhook: NonNullable<WebhookManagerOptions['sendWebhook']>;

  constructor(resultsDir: string, options: WebhookManagerOptions = {}) {
    super();
    this.logger = createEventLogger('webhook-manager');
    this.deliveryLogPath = path.join(resultsDir, '.kaseki-webhook-delivery.log');
    this.deliveryLogLockPath = path.join(resultsDir, '.kaseki-webhook-delivery.log.lock');
    this.now = options.now ?? Date.now;
    this.deliveryClaimLeaseMs = options.deliveryClaimLeaseMs ?? 30_000;
    this.sendWebhook = options.sendWebhook ?? ((url, body, headers) => postWebhookSafely(url, body, headers, {
      allowedOrigins: options.allowedOrigins,
    }));
    // File timestamps use the system clock. Translate them into the injected
    // clock's domain so stale-lock recovery remains deterministic in tests.
    this.fileSystemClockOffsetMs = this.now() - Date.now();
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
          timestamp: this.nowIso(),
          status: 'pending',
        },
      ],
      nextRetryTime: this.now(),
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

  /** Return a secret-free delivery history snapshot for one run. */
  getDeliveriesForJob(jobId: string): WebhookDeliverySummary[] {
    return this.readPersistedEntries()
      .filter((entry) => entry.jobId === jobId)
      .map((entry) => {
        const attempts = (entry.attempts ?? []).map((attempt) => ({
          timestamp: attempt.timestamp,
          status: attempt.status,
          statusCode: attempt.statusCode,
          durationMs: attempt.durationMs,
          error: safeDeliveryError(attempt.error),
        }));
        const lastAttempt = attempts[attempts.length - 1];
        const retryPolicy = entry.config.retryPolicy ?? { maxAttempts: 5, initialDelayMs: 1000, maxDelayMs: 30000 };
        const status: WebhookDeliveryAttempt['status'] = lastAttempt?.status === 'success'
          ? 'success'
          : lastAttempt?.status === 'failed' || entry.terminal || entry.deliveryAttempts >= retryPolicy.maxAttempts
            ? 'failed'
            : lastAttempt?.status === 'retry'
              ? 'retry'
              : 'pending';
        return {
          id: this.deliveryId(entry),
          jobId: entry.jobId,
          eventType: entry.payload.eventType,
          status,
          attempts,
          ...(typeof entry.nextRetryTime === 'number' && status === 'retry'
            ? { nextRetryAt: new Date(entry.nextRetryTime).toISOString() }
            : {}),
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Requeue a terminal failed delivery once, retaining its prior attempts. */
  retryFailedDelivery(jobId: string, deliveryId: string): boolean {
    let lockOwner: string | undefined;
    try {
      lockOwner = this.acquireDeliveryLogLock();
      const entries = this.readPersistedEntries();
      const entry = entries.find((candidate) => candidate.jobId === jobId && this.deliveryId(candidate) === deliveryId);
      if (!entry) return false;
      const lastAttempt = entry.attempts?.[entry.attempts.length - 1];
      if (lastAttempt?.status !== 'failed') return false;

      entry.terminal = false;
      entry.deliveryAttempts = 0;
      entry.nextRetryTime = this.now();
      delete entry.deliveryClaimOwner;
      delete entry.deliveryClaimExpiresAt;
      entry.attempts = [...(entry.attempts ?? []), { timestamp: this.nowIso(), status: 'pending' }];
      this.writePersistedEntries(entries);
      this.deliveryQueue = this.deliveryQueue.filter((queued) => this.deliveryKey(queued) !== this.deliveryKey(entry));
      this.deliveryQueue.push({
        jobId: entry.jobId,
        payload: entry.payload,
        config: entry.config,
        deliveryAttempts: 0,
        attempts: entry.attempts,
        nextRetryTime: this.now(),
      });
      return true;
    } catch (error) {
      this.logger.error('Failed to retry webhook delivery', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      if (lockOwner) this.releaseDeliveryLogLock(lockOwner);
    }
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
  private async processQueue(): Promise<boolean> {
    // Limit concurrent deliveries
    if (this.activeDeliveries >= this.maxConcurrentDeliveries) {
      return false;
    }

    // Find next entry to deliver (exclude entries already in flight)
    const now = this.now();
    const entry = this.deliveryQueue.find((e) => {
      const lastAttempt = e.attempts[e.attempts.length - 1];
      const isCompleted = lastAttempt?.status === 'success';
      const shouldRetry = e.nextRetryTime && e.nextRetryTime <= now;
      const exceedsMaxAttempts = e.deliveryAttempts >= (e.config.retryPolicy?.maxAttempts || 5);
      const isInFlight = e.inFlight === true;
      return !isCompleted && shouldRetry && !exceedsMaxAttempts && !isInFlight;
    });

    if (!entry) {
      return false;
    }

    // The in-memory flag only protects this instance. The durable claim below
    // serializes delivery with every manager sharing the log.
    entry.inFlight = true;
    if (!this.claimDelivery(entry)) {
      entry.inFlight = false;
      return false;
    }
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

    return true;
  }

  /**
   * Deliver a webhook with retry logic.
   */
  private async deliverWebhook(entry: WebhookQueueEntry): Promise<void> {
    // Note: inFlight flag is set in processQueue() before this method is called
    const { config, payload, jobId } = entry;
    const signature = this.generateSignature(payload, config);
    const startTime = this.now();

    try {
      const response = await this.sendWebhook(config.url, JSON.stringify(payload), {
          'Content-Type': 'application/json',
          'X-Kaseki-Event': payload.eventType,
          'X-Kaseki-Job-Id': jobId,
          ...(signature && { 'X-Kaseki-Signature': signature }),
      });

      const durationMs = this.now() - startTime;

      this.handleWebhookResponse(entry, response, durationMs);
    } catch (error) {
      this.handleWebhookError(entry, error, this.now() - startTime);
    }
  }

  private handleWebhookResponse(
    entry: WebhookQueueEntry,
    response: WebhookHttpResponse,
    durationMs: number,
  ): void {
    const { config, payload, jobId } = entry;
    if (response.ok) {
      entry.attempts.push({ timestamp: this.nowIso(), status: 'success', statusCode: response.status, durationMs });
      this.logger.event('webhook_delivered', { jobId, eventType: payload.eventType, statusCode: response.status, durationMs, attempts: entry.deliveryAttempts });
      this.finishClaimedDelivery(entry, true);
      return;
    }

    const retryDecision = getRetryDecision(entry.deliveryAttempts, config);
    entry.attempts.push({
      timestamp: this.nowIso(),
      status: retryDecision.hasRemainingAttempts ? 'retry' : 'failed',
      statusCode: response.status,
      durationMs,
      error: `HTTP ${response.status}`,
    });
    if (retryDecision.hasRemainingAttempts) {
      entry.nextRetryTime = this.now() + retryDecision.backoffMs;
      this.logger.event('webhook_retry_scheduled', { jobId, eventType: payload.eventType, statusCode: response.status, nextRetryMs: retryDecision.backoffMs, attemptNumber: entry.deliveryAttempts });
      this.finishClaimedDelivery(entry, false);
      return;
    }
    this.logger.event('webhook_delivery_failed', { jobId, eventType: payload.eventType, statusCode: response.status, attempts: entry.deliveryAttempts });
    this.finishClaimedDelivery(entry, true);
  }

  private handleWebhookError(entry: WebhookQueueEntry, error: unknown, durationMs: number): void {
    const { config, payload, jobId } = entry;
    const errorMsg = error instanceof Error ? error.message : String(error);
    const retryPolicy = config.retryPolicy || { maxAttempts: 5, initialDelayMs: 1000, maxDelayMs: 30000 };
    const backoffMs = Math.min(retryPolicy.initialDelayMs * Math.pow(2, entry.deliveryAttempts - 1), retryPolicy.maxDelayMs);
    const hasRemainingAttempts = entry.deliveryAttempts < retryPolicy.maxAttempts;
    entry.attempts.push({ timestamp: this.nowIso(), status: hasRemainingAttempts ? 'retry' : 'failed', error: errorMsg, durationMs });
    if (hasRemainingAttempts) {
      entry.nextRetryTime = this.now() + backoffMs;
      this.logger.event('webhook_delivery_error', { jobId, eventType: payload.eventType, error: errorMsg, nextRetryMs: backoffMs, attemptNumber: entry.deliveryAttempts });
      this.finishClaimedDelivery(entry, false);
      return;
    }
    this.logger.event('webhook_delivery_failed', { jobId, eventType: payload.eventType, error: errorMsg, attempts: entry.deliveryAttempts });
    this.finishClaimedDelivery(entry, true);
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

  /** Record a lease while holding the same lock used to rewrite the log. */
  private claimDelivery(entry: WebhookQueueEntry): boolean {
    let lockOwner: string | undefined;
    try {
      lockOwner = this.acquireDeliveryLogLock();
      const entries = this.readPersistedEntries();
      const key = this.deliveryKey(entry);
      const persisted = entries.find((candidate) => this.deliveryKey(candidate) === key);
      if (!persisted) {
        this.deliveryQueue = this.deliveryQueue.filter((candidate) => candidate !== entry);
        return false;
      }

      const claimIsLive =
        typeof persisted.deliveryClaimOwner === 'string' &&
        typeof persisted.deliveryClaimExpiresAt === 'number' &&
        persisted.deliveryClaimExpiresAt > this.now();
      if (claimIsLive && persisted.deliveryClaimOwner !== this.deliveryClaimOwner) {
        this.synchronizeQueueEntry(entry, persisted);
        return false;
      }

      persisted.deliveryClaimOwner = this.deliveryClaimOwner;
      persisted.deliveryClaimExpiresAt = this.now() + this.deliveryClaimLeaseMs;
      // Persist the attempt before issuing the request. If this process dies,
      // another manager can recover the entry after the lease expires.
      persisted.deliveryAttempts++;
      this.writePersistedEntries(entries);
      this.synchronizeQueueEntry(entry, persisted);
      return true;
    } catch (error) {
      this.logger.error('Failed to claim webhook delivery', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      if (lockOwner) this.releaseDeliveryLogLock(lockOwner);
    }
  }

  /** Commit a claimed result only if the durable claim is still ours. */
  private finishClaimedDelivery(entry: WebhookQueueEntry, remove: boolean): void {
    let lockOwner: string | undefined;
    try {
      lockOwner = this.acquireDeliveryLogLock();
      const entries = this.readPersistedEntries();
      const key = this.deliveryKey(entry);
      const index = entries.findIndex((candidate) => this.deliveryKey(candidate) === key);
      if (index < 0) {
        this.deliveryQueue = this.deliveryQueue.filter((candidate) => candidate !== entry);
        this.logger.warn('Webhook delivery claim ownership changed before result was persisted', {
          jobId: entry.jobId,
        });
        return;
      }
      if (entries[index].deliveryClaimOwner !== this.deliveryClaimOwner) {
        this.synchronizeQueueEntry(entry, entries[index]);
        this.logger.warn('Webhook delivery claim ownership changed before result was persisted', {
          jobId: entry.jobId,
        });
        return;
      }

      if (remove) {
        entries[index] = {
          ...entries[index],
          deliveryAttempts: entry.deliveryAttempts,
          attempts: entry.attempts,
          terminal: true,
        };
        delete entries[index].deliveryClaimOwner;
        delete entries[index].deliveryClaimExpiresAt;
        this.deliveryQueue = this.deliveryQueue.filter((candidate) => candidate !== entry);
      } else {
        delete entry.deliveryClaimOwner;
        delete entry.deliveryClaimExpiresAt;
        entries[index] = {
          jobId: entry.jobId,
          payload: entry.payload,
          config: entry.config,
          deliveryAttempts: entry.deliveryAttempts,
          attempts: entry.attempts,
          nextRetryTime: entry.nextRetryTime,
        };
      }
      this.writePersistedEntries(entries);
    } catch (error) {
      this.logger.error('Failed to persist claimed webhook delivery result', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (lockOwner) this.releaseDeliveryLogLock(lockOwner);
    }
  }

  private writePersistedEntries(entries: PersistedWebhookQueueEntry[]): void {
    const tempPath = `${this.deliveryLogPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      const terminalEntries = entries.filter((entry) => this.isTerminalEntry(entry)).slice(-1000);
      const activeEntries = entries.filter((entry) => !this.isTerminalEntry(entry));
      fs.writeFileSync(tempPath, [...activeEntries, ...terminalEntries].map((entry) => JSON.stringify(entry)).join('\n'), {
        encoding: 'utf-8',
        mode: 0o600,
      });
      fs.renameSync(tempPath, this.deliveryLogPath);
    } finally {
      fs.rmSync(tempPath, { force: true });
    }
  }

  /** Copy persisted delivery state without sharing mutable attempt records. */
  private synchronizeQueueEntry(
    entry: WebhookQueueEntry,
    persisted: PersistedWebhookQueueEntry
  ): void {
    entry.deliveryAttempts = persisted.deliveryAttempts;
    entry.attempts = (persisted.attempts ?? []).map((attempt) => ({ ...attempt }));
    entry.nextRetryTime = persisted.nextRetryTime;
    entry.deliveryClaimOwner = persisted.deliveryClaimOwner;
    entry.deliveryClaimExpiresAt = persisted.deliveryClaimExpiresAt;
  }

  /**
   * Persist delivery log to disk.
   */
  private persistDeliveryLog(): void {
    let lockOwner: string | undefined;
    let tempPath: string | undefined;
    try {
      lockOwner = this.acquireDeliveryLogLock();
      const now = this.now();
      const memoryEntries: PersistedWebhookQueueEntry[] = this.deliveryQueue.map((entry) => {
        if (
          entry.deliveryClaimOwner === this.deliveryClaimOwner &&
          (entry.deliveryClaimExpiresAt ?? 0) <= now
        ) {
          delete entry.deliveryClaimOwner;
          delete entry.deliveryClaimExpiresAt;
        }
        return {
          jobId: entry.jobId,
          payload: entry.payload,
          config: entry.config,
          deliveryAttempts: entry.deliveryAttempts,
          attempts: entry.attempts,
          nextRetryTime: entry.nextRetryTime,
          deliveryClaimOwner: entry.deliveryClaimOwner,
          deliveryClaimExpiresAt: entry.deliveryClaimExpiresAt,
        };
      });

      const diskEntries = this.readPersistedEntries();
      const merged = new Map<string, PersistedWebhookQueueEntry>();
      for (const entry of diskEntries) {
        const key = this.deliveryKey(entry);
        if (!this.removedDeliveryKeys.has(key)) {
          merged.set(key, entry);
        }
      }
      for (const entry of memoryEntries) {
        const key = this.deliveryKey(entry);
        const diskEntry = merged.get(key);
        const hasForeignLiveClaim =
          diskEntry?.deliveryClaimOwner !== undefined &&
          diskEntry.deliveryClaimOwner !== this.deliveryClaimOwner &&
          (diskEntry.deliveryClaimExpiresAt ?? 0) > now;
        if (!hasForeignLiveClaim) merged.set(key, entry);
      }

      tempPath = `${this.deliveryLogPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
      fs.writeFileSync(tempPath, [...merged.values()].map((e) => JSON.stringify(e)).join('\n'), {
        encoding: 'utf-8',
        mode: 0o600,
      });
      fs.renameSync(tempPath, this.deliveryLogPath);
      tempPath = undefined;
      this.removedDeliveryKeys.clear();
    } catch (error) {
      this.logger.error('Failed to persist webhook delivery log', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (tempPath) {
        fs.rmSync(tempPath, { force: true });
      }
      if (lockOwner) {
        this.releaseDeliveryLogLock(lockOwner);
      }
    }
  }

  private acquireDeliveryLogLock(): string {
    const owner = `${process.pid}:${crypto.randomUUID()}`;
    const staleAfterMs = 30_000;
    const deadline = this.now() + 5_000;

    while (true) {
      try {
        const fd = fs.openSync(this.deliveryLogLockPath, 'wx', 0o600);
        fs.writeFileSync(fd, JSON.stringify({ owner, pid: process.pid, acquiredAt: this.now() }));
        fs.closeSync(fd);
        return owner;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') {
          throw error;
        }

        try {
          const metadata = JSON.parse(fs.readFileSync(this.deliveryLogLockPath, 'utf-8')) as {
            acquiredAt?: number;
          };
          const stat = fs.statSync(this.deliveryLogLockPath);
          const lockTime =
            typeof metadata.acquiredAt === 'number'
              ? metadata.acquiredAt
              : stat.mtimeMs + this.fileSystemClockOffsetMs;
          if (this.now() - lockTime > staleAfterMs) {
            fs.rmSync(this.deliveryLogLockPath, { force: true });
            continue;
          }
        } catch (lockError) {
          if ((lockError as NodeJS.ErrnoException).code === 'ENOENT') {
            continue;
          }
          const stat = fs.statSync(this.deliveryLogLockPath);
          if (this.now() - (stat.mtimeMs + this.fileSystemClockOffsetMs) > staleAfterMs) {
            fs.rmSync(this.deliveryLogLockPath, { force: true });
            continue;
          }
        }

        if (this.now() >= deadline) {
          throw new Error(`Timed out acquiring webhook delivery log lock: ${this.deliveryLogLockPath}`);
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
  }

  private releaseDeliveryLogLock(owner: string): void {
    try {
      const content = fs.readFileSync(this.deliveryLogLockPath, 'utf-8');
      const metadata = JSON.parse(content) as { owner?: string };
      if (metadata.owner === owner) {
        fs.rmSync(this.deliveryLogLockPath, { force: true });
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        this.logger.warn('Failed to release webhook delivery log lock', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private readPersistedEntries(): PersistedWebhookQueueEntry[] {
    if (!fs.existsSync(this.deliveryLogPath)) {
      return [];
    }

    const entries: PersistedWebhookQueueEntry[] = [];
    for (const line of fs.readFileSync(this.deliveryLogPath, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const candidate = JSON.parse(line) as Partial<PersistedWebhookQueueEntry>;
        if (
          typeof candidate.jobId === 'string' &&
          candidate.payload &&
          typeof candidate.payload.eventType === 'string' &&
          candidate.config &&
          typeof candidate.config.url === 'string' &&
          typeof candidate.deliveryAttempts === 'number'
        ) {
          entries.push(candidate as PersistedWebhookQueueEntry);
        } else {
          this.logger.warn('Skipping malformed webhook delivery log line during persistence', {
            reason: 'missing_required_fields',
          });
        }
      } catch (error) {
        this.logger.warn('Skipping malformed webhook delivery log line during persistence', {
          reason: 'invalid_json',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return entries;
  }

  private deliveryKey(entry: Pick<PersistedWebhookQueueEntry, 'jobId' | 'payload' | 'config'>): string {
    return JSON.stringify([
      entry.jobId,
      entry.payload.eventType,
      entry.payload.timestamp,
      entry.config.url,
    ]);
  }

  private deliveryId(entry: Pick<PersistedWebhookQueueEntry, 'jobId' | 'payload' | 'config'>): string {
    return crypto.createHash('sha256').update(this.deliveryKey(entry)).digest('hex').slice(0, 32);
  }

  private isTerminalEntry(entry: PersistedWebhookQueueEntry): boolean {
    const lastAttempt = entry.attempts?.[entry.attempts.length - 1];
    return entry.terminal === true || lastAttempt?.status === 'success' || lastAttempt?.status === 'failed';
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

      const now = this.now();
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

        if (isTerminalSuccess || !hasRemainingAttempts || candidate.terminal) {
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
          deliveryClaimOwner: candidate.deliveryClaimOwner,
          deliveryClaimExpiresAt: candidate.deliveryClaimExpiresAt,
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
   * Return a read-only queue snapshot for deterministic tests.
   */
  getQueuedDeliveriesForTest(): WebhookQueueSnapshotEntry[] {
    return this.deliveryQueue.map((entry) => ({
      jobId: entry.jobId,
      deliveryAttempts: entry.deliveryAttempts,
      nextRetryTime: entry.nextRetryTime,
      lastAttemptStatus: entry.attempts[entry.attempts.length - 1]?.status,
    }));
  }

  /**
   * Drain ready webhook deliveries without relying on the background interval.
   */
  async drainQueueForTest(): Promise<number> {
    this.stopProcessing();

    let processedCount = 0;
    while (await this.processQueue()) {
      processedCount++;
    }

    return processedCount;
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }

  /**
   * Gracefully shutdown the webhook manager.
   */
  async shutdown(): Promise<void> {
    this.stopProcessing();

    // Wait for active deliveries to complete (with timeout)
    const shutdownTimeout = 5000;
    const startTime = this.now();

    while (this.activeDeliveries > 0) {
      if (this.now() - startTime > shutdownTimeout) {
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

function safeDeliveryError(error: string | undefined): string | undefined {
  if (!error) return undefined;
  const httpStatus = /^HTTP (\d{3})\b/.exec(error);
  if (httpStatus) return `HTTP ${httpStatus[1]}`;
  if (/egress policy/i.test(error)) return 'Webhook egress policy blocked delivery';
  return 'Webhook delivery failed';
}
