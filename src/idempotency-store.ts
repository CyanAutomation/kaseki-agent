import * as fs from 'fs';
import * as path from 'path';
import { RunResponse } from './kaseki-api-types';
import { createEventLogger, EventLogger } from './logger';

/**
 * Idempotency cache entry.
 */
interface IdempotencyCacheEntry {
  idempotencyKey: string;
  requestFingerprint: string;
  state: 'pending' | 'fulfilled';
  jobId: string;
  requestTime: string; // ISO 8601
  responsePayload: RunResponse;
  expiresAt: number; // Unix timestamp
}

interface PersistedIdempotencyEntry {
  idempotencyKey: string;
  requestFingerprint?: string;
  state?: 'pending' | 'fulfilled';
  jobId?: string;
  requestTime?: string;
  responsePayload?: RunResponse;
  requestId?: string;
  correlationId?: string;
  expiresAt: number;
}

export type ClaimResult =
  | { kind: 'claimed' }
  | { kind: 'pending' }
  | { kind: 'fulfilled'; response: RunResponse };

/**
 * Idempotency store manages request deduplication with persistent storage.
 * Ensures safe retries: same idempotency key always returns the same job ID.
 */
export class IdempotencyStore {
  private cache = new Map<string, IdempotencyCacheEntry>();
  private persistencePath: string;
  private lockPath: string;
  private lockOwnerPath: string;
  private activeLockToken: string | null = null;
  private logger: EventLogger;
  private ttlHours: number;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private lastReadPosition = 0;
  private readRemainder = '';

  constructor(resultsDir: string, ttlHours: number = 24) {
    fs.mkdirSync(resultsDir, { recursive: true });
    this.persistencePath = path.join(resultsDir, '.kaseki-api-idempotency.jsonl');
    this.lockPath = path.join(resultsDir, '.kaseki-api-idempotency.lock');
    this.lockOwnerPath = path.join(this.lockPath, 'owner.json');
    this.logger = createEventLogger('idempotency-store');
    this.ttlHours = ttlHours;
    this.loadFromDisk();
    this.startCleanup();
  }

  /**
   * Check if idempotency key has been seen before and return cached response.
   */
  claimOrGet(idempotencyKey: string, requestFingerprint: string): ClaimResult {
    return this.withLock(() => {
      this.loadFromDisk();
      const entry = this.cache.get(idempotencyKey);
      if (!entry || Date.now() > entry.expiresAt) {
        const pendingEntry: IdempotencyCacheEntry = {
          idempotencyKey,
          requestFingerprint,
          state: 'pending',
          jobId: '',
          requestTime: new Date().toISOString(),
          responsePayload: {
            id: '',
            status: 'queued',
            createdAt: new Date().toISOString(),
          },
          expiresAt: Date.now() + this.ttlHours * 3600 * 1000,
        };

        this.cache.set(idempotencyKey, pendingEntry);
        this.persistToDisk(pendingEntry);
        return { kind: 'claimed' };
      }

      if (entry.requestFingerprint !== requestFingerprint) {
        throw new Error('Idempotency key has already been used with a different request payload');
      }

      if (entry.state === 'pending') {
        return { kind: 'pending' };
      }

      this.logger.event('idempotency_cache_hit', {
        idempotencyKey,
        jobId: entry.jobId,
        ageSeconds: Math.round((Date.now() - new Date(entry.requestTime).getTime()) / 1000),
      });

      return { kind: 'fulfilled', response: entry.responsePayload };
    });
  }

  /**
   * Store a new idempotency entry.
   */
  storeResponse(idempotencyKey: string, response: RunResponse, requestFingerprint: string): void {
    this.withLock(() => {
      this.loadFromDisk();
      const existing = this.cache.get(idempotencyKey);
      const entry: IdempotencyCacheEntry = existing
        ? {
          ...existing,
          requestFingerprint,
          state: 'fulfilled',
          jobId: response.id,
          responsePayload: response,
        }
        : {
          idempotencyKey,
          requestFingerprint,
          state: 'fulfilled',
          jobId: response.id,
          requestTime: new Date().toISOString(),
          responsePayload: response,
          expiresAt: Date.now() + this.ttlHours * 3600 * 1000,
        };

      this.cache.set(idempotencyKey, entry);
      this.persistToDisk(entry);

      this.logger.event('idempotency_cache_store', {
        idempotencyKey,
        jobId: response.id,
        ttlHours: this.ttlHours,
      });
    });
  }

  private withLock<T>(fn: () => T): T {
    this.acquireLock();
    try {
      return fn();
    } finally {
      this.releaseLock();
    }
  }

  private acquireLock(): void {
    const maxRetries = 600; // 3 seconds total (600 * 5ms)
    const staleThresholdMs = 30000; // 30 seconds
    let retries = 0;

    while (retries < maxRetries) {
      try {
        fs.mkdirSync(this.lockPath);
        const owner = {
          pid: process.pid,
          createdAt: new Date().toISOString(),
          token: this.generateLockToken(),
        };
        fs.writeFileSync(this.lockOwnerPath, JSON.stringify(owner), { encoding: 'utf-8', flag: 'wx' });
        this.activeLockToken = owner.token;
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') {
          try {
            const ownerMetadata = this.readLockOwner();
            const lockLooksStale = this.isLockStale(staleThresholdMs, ownerMetadata?.pid);
            if (lockLooksStale && this.canRemoveStaleLock(ownerMetadata)) {
              this.forceRemoveLockDir();
              continue;
            }
          } catch {
            // If stale-lock check/removal fails, proceed to retry sleep.
          }
        } else if (code === 'ENOENT') {
          // Lock dir may have been concurrently removed between creation and owner write.
          continue;
        } else {
          throw error;
        }

        this.sleepSync(5);
        retries++;
      }
    }

    throw new Error('Failed to acquire lock after maximum retries');
  }

  private releaseLock(): void {
    const ownerMetadata = this.readLockOwner();
    if (!ownerMetadata || ownerMetadata.token !== this.activeLockToken) {
      this.activeLockToken = null;
      return;
    }

    try {
      fs.rmSync(this.lockOwnerPath, { force: true });
      fs.rmdirSync(this.lockPath);
    } catch {
      // Ignore lock release failures.
    } finally {
      this.activeLockToken = null;
    }
  }

  private readLockOwner(): { pid?: number; token?: string } | null {
    try {
      const content = fs.readFileSync(this.lockOwnerPath, 'utf-8');
      return JSON.parse(content) as { pid?: number; token?: string };
    } catch {
      return null;
    }
  }

  private isLockStale(staleThresholdMs: number, ownerPid?: number): boolean {
    const stats = fs.statSync(this.lockPath);
    const exceedsAgeThreshold = Date.now() - stats.mtimeMs > staleThresholdMs;
    if (!exceedsAgeThreshold) {
      return false;
    }

    return ownerPid ? !this.isProcessAlive(ownerPid) : true;
  }

  private canRemoveStaleLock(ownerMetadata: { pid?: number; token?: string } | null): boolean {
    if (!ownerMetadata?.token) {
      return true;
    }

    const latestOwner = this.readLockOwner();
    return latestOwner?.token === ownerMetadata.token;
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private forceRemoveLockDir(): void {
    fs.rmSync(this.lockPath, { recursive: true, force: true });
  }

  private generateLockToken(): string {
    return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }

  private sleepSync(ms: number): void {
    const start = Date.now();
    while (Date.now() - start < ms) {
      // Busy wait
    }
  }

  /**
   * Persist a single entry to disk (append-only log).
   */
  private persistToDisk(entry: IdempotencyCacheEntry): void {
    try {
      const line = JSON.stringify({
        idempotencyKey: entry.idempotencyKey,
        requestFingerprint: entry.requestFingerprint,
        state: entry.state,
        jobId: entry.jobId,
        requestTime: entry.requestTime,
        responsePayload: entry.responsePayload,
        expiresAt: entry.expiresAt,
      });

      fs.appendFileSync(this.persistencePath, `${line}\n`, 'utf-8');
    } catch (error) {
      this.logger.error('Failed to persist idempotency entry', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Load idempotency entries from disk.
   */
  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.persistencePath)) {
        return;
      }

      const stats = fs.statSync(this.persistencePath);
      if (stats.size < this.lastReadPosition) {
        this.lastReadPosition = 0;
        this.readRemainder = '';
        this.cache.clear();
      }

      if (stats.size === this.lastReadPosition) {
        return;
      }

      const fileDescriptor = fs.openSync(this.persistencePath, 'r');
      let lines: string[] = [];
      try {
        const bytesToRead = stats.size - this.lastReadPosition;
        const buffer = Buffer.alloc(bytesToRead);
        fs.readSync(fileDescriptor, buffer, 0, bytesToRead, this.lastReadPosition);
        this.lastReadPosition = stats.size;

        const content = this.readRemainder + buffer.toString('utf-8');
        lines = content.split('\n');
        this.readRemainder = lines.pop() ?? '';
      } finally {
        fs.closeSync(fileDescriptor);
      }

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        try {
          const entry = JSON.parse(line) as PersistedIdempotencyEntry;

          // Skip expired entries
          if (Date.now() > entry.expiresAt) {
            continue;
          }

          const requestTime = entry.requestTime || '1970-01-01T00:00:00.000Z';
          const jobId = entry.jobId || entry.responsePayload?.id || '';
          const restoredResponse: RunResponse = entry.responsePayload || {
            id: jobId,
            status: 'queued',
            createdAt: requestTime,
            requestId: entry.requestId,
            correlationId: entry.correlationId,
          };

          // Store in cache
          this.cache.set(entry.idempotencyKey, {
            idempotencyKey: entry.idempotencyKey,
            requestFingerprint: entry.requestFingerprint || '',
            state: entry.state || 'fulfilled',
            jobId,
            requestTime,
            responsePayload: restoredResponse,
            expiresAt: entry.expiresAt,
          });
        } catch {
          // Skip invalid JSON lines
        }
      }

      this.logger.event('idempotency_loaded', {
        entriesLoaded: this.cache.size,
      });
    } catch (error) {
      this.logger.error('Failed to load idempotency store from disk', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Start periodic cleanup of expired entries.
   */
  private startCleanup(): void {
    if (this.cleanupInterval) {
      return;
    }

    // Run cleanup every hour (but allow process to exit even if interval is pending)
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 3600000);
    this.cleanupInterval.unref();
  }

  /**
   * Clean up expired entries and rewrite the log file.
   */
  private cleanup(): void {
    try {
      const now = Date.now();
      let removedCount = 0;

      // Remove expired entries from cache
      for (const [key, entry] of this.cache.entries()) {
        if (now > entry.expiresAt) {
          this.cache.delete(key);
          removedCount++;
        }
      }

      // Rewrite persistence file with only valid entries
      if (removedCount > 0) {
        const validEntries: string[] = [];
        for (const entry of this.cache.values()) {
          validEntries.push(
            JSON.stringify({
              idempotencyKey: entry.idempotencyKey,
              requestFingerprint: entry.requestFingerprint,
              state: entry.state,
              jobId: entry.jobId,
              requestTime: entry.requestTime,
              responsePayload: entry.responsePayload,
              expiresAt: entry.expiresAt,
            })
          );
        }

        fs.writeFileSync(this.persistencePath, validEntries.join('\n') + (validEntries.length > 0 ? '\n' : ''), 'utf-8');

        this.logger.event('idempotency_cleanup', {
          removedEntries: removedCount,
          remainingEntries: this.cache.size,
        });
      }
    } catch (error) {
      this.logger.error('Idempotency cleanup failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Gracefully shutdown the store.
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Run final cleanup
    this.cleanup();

    this.logger.event('idempotency_store_shutdown', {
      entriesRemaining: this.cache.size,
    });
  }
}
