import * as crypto from 'crypto';
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

interface LockOwnerMetadata {
  pid: number;
  createdAt: string;
  token: string;
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

export type ProcessLivenessChecker = (pid: number) => boolean;

export interface IdempotencyStoreDependencies {
  now?: () => number;
  processLivenessChecker?: ProcessLivenessChecker;
  lockTokenGenerator?: () => string;
  pid?: number;
}

export function createProcessLivenessChecker(
  kill: (pid: number, signal: 0) => unknown = process.kill,
  platform: NodeJS.Platform = process.platform,
): ProcessLivenessChecker {
  return (pid: number): boolean => {
    try {
      kill(pid, 0);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (platform === 'win32') {
        return false;
      }

      return code === 'EPERM';
    }
  };
}

/**
 * Idempotency store manages request deduplication with persistent storage.
 * Ensures safe retries: same idempotency key always returns the same job ID.
 */
export class IdempotencyStore {
  private cache = new Map<string, IdempotencyCacheEntry>();
  private persistencePath: string;
  private lockPath: string;
  private lockOwnerPath: string;
  private activeLockOwner: LockOwnerMetadata | null = null;
  private logger: EventLogger;
  private ttlHours: number;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private lastReadPosition = 0;
  private readRemainder = '';
  private now: () => number;
  private processLivenessChecker: ProcessLivenessChecker;
  private lockTokenGenerator: () => string;
  private pid: number;

  constructor(
    resultsDir: string,
    ttlHours: number = 24,
    dependencies: IdempotencyStoreDependencies = {},
  ) {
    fs.mkdirSync(resultsDir, { recursive: true });
    this.persistencePath = path.join(
      resultsDir,
      '.kaseki-api-idempotency.jsonl',
    );
    this.lockPath = path.join(resultsDir, '.kaseki-api-idempotency.lock');
    this.lockOwnerPath = path.join(this.lockPath, 'owner.json');
    this.logger = createEventLogger('idempotency-store');
    this.ttlHours = ttlHours;
    this.now = dependencies.now ?? Date.now;
    this.processLivenessChecker =
      dependencies.processLivenessChecker ?? createProcessLivenessChecker();
    this.lockTokenGenerator =
      dependencies.lockTokenGenerator ?? (() => crypto.randomUUID());
    this.pid = dependencies.pid ?? process.pid;
    this.loadFromDisk();
    this.startCleanup();
  }

  /**
   * Check if idempotency key has been seen before and return cached response.
   */
  async claimOrGet(
    idempotencyKey: string,
    requestFingerprint: string,
  ): Promise<ClaimResult> {
    return this.withLock(() => {
      this.loadFromDisk();
      const entry = this.cache.get(idempotencyKey);
      if (!entry || this.now() > entry.expiresAt) {
        const pendingEntry: IdempotencyCacheEntry = {
          idempotencyKey,
          requestFingerprint,
          state: 'pending',
          jobId: '',
          requestTime: this.currentIsoString(),
          responsePayload: {
            id: '',
            status: 'queued',
            createdAt: this.currentIsoString(),
          },
          expiresAt: this.now() + this.ttlHours * 3600 * 1000,
        };

        this.cache.set(idempotencyKey, pendingEntry);
        this.persistToDisk(pendingEntry);
        return { kind: 'claimed' };
      }

      if (entry.requestFingerprint !== requestFingerprint) {
        throw new Error(
          'Idempotency key has already been used with a different request payload',
        );
      }

      if (entry.state === 'pending') {
        return { kind: 'pending' };
      }

      this.logger.event('idempotency_cache_hit', {
        idempotencyKey,
        jobId: entry.jobId,
        ageSeconds: Math.round(
          (this.now() - new Date(entry.requestTime).getTime()) / 1000,
        ),
      });

      return { kind: 'fulfilled', response: entry.responsePayload };
    });
  }

  /**
   * Store a new idempotency entry.
   */
  async storeResponse(
    idempotencyKey: string,
    response: RunResponse,
    requestFingerprint: string,
  ): Promise<void> {
    await this.withLock(() => {
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
          requestTime: this.currentIsoString(),
          responsePayload: response,
          expiresAt: this.now() + this.ttlHours * 3600 * 1000,
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

  async runWithIdempotencyLock<T>(fn: () => T | Promise<T>): Promise<T> {
    return this.withLock(fn);
  }

  private async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    await this.acquireLock();
    try {
      return await fn();
    } finally {
      this.releaseLock();
    }
  }

  private async acquireLock(): Promise<void> {
    const maxRetries = 600; // 3 seconds total (600 * 5ms)
    const staleThresholdMs = 30000; // 30 seconds
    let retries = 0;

    while (retries < maxRetries) {
      const owner = this.createLockOwner();
      try {
        // Atomic mkdir gives us the same exclusive-create property as an
        // open(..., 'wx') lock file while still leaving room for owner metadata.
        fs.mkdirSync(this.lockPath, { mode: 0o700 });
        try {
          fs.writeFileSync(this.lockOwnerPath, JSON.stringify(owner), {
            encoding: 'utf-8',
            flag: 'wx',
          });
        } catch (ownerWriteError) {
          this.releasePartiallyAcquiredLock(owner.token, true);
          throw ownerWriteError;
        }
        this.activeLockOwner = owner;
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        this.releasePartiallyAcquiredLock(owner.token);

        if (code === 'EEXIST' || code === 'ENOTEMPTY') {
          const ownerMetadata = this.readLockOwner();
          if (this.isLockStale(this.lockPath, staleThresholdMs, ownerMetadata)) {
            if (this.removeStaleLock(ownerMetadata, staleThresholdMs)) {
              continue;
            }
          }
        } else if (code !== 'ENOENT') {
          throw error;
        }

        this.logLockContention(retries + 1, maxRetries);
        await this.delay(5);
        retries++;
      }
    }

    throw new Error('Failed to acquire lock after maximum retries');
  }

  private releaseLock(): void {
    const activeLockOwner = this.activeLockOwner;
    if (!activeLockOwner) {
      return;
    }

    const ownerMetadata = this.readLockOwner();
    if (!ownerMetadata || ownerMetadata.token !== activeLockOwner.token) {
      this.activeLockOwner = null;
      return;
    }

    try {
      fs.rmSync(this.lockOwnerPath, { force: true });
      fs.rmdirSync(this.lockPath);
    } catch {
      // Ignore lock release failures.
    } finally {
      this.activeLockOwner = null;
    }
  }

  private readLockOwner(
    lockOwnerPath = this.lockOwnerPath,
  ): LockOwnerMetadata | null {
    try {
      const content = fs.readFileSync(lockOwnerPath, 'utf-8');
      const parsed = JSON.parse(content) as Partial<LockOwnerMetadata>;
      if (
        typeof parsed.pid !== 'number' ||
        typeof parsed.createdAt !== 'string' ||
        typeof parsed.token !== 'string'
      ) {
        return null;
      }
      return parsed as LockOwnerMetadata;
    } catch {
      return null;
    }
  }

  private isLockStale(
    lockPath: string,
    staleThresholdMs: number,
    ownerMetadata: LockOwnerMetadata | null,
  ): boolean {
    try {
      const createdAtMs = ownerMetadata
        ? Date.parse(ownerMetadata.createdAt)
        : Number.NaN;
      const lockAgeMs = Number.isFinite(createdAtMs)
        ? this.now() - createdAtMs
        : this.now() - fs.statSync(lockPath).mtimeMs;
      if (lockAgeMs <= staleThresholdMs) {
        return false;
      }

      return ownerMetadata?.pid ? !this.isProcessAlive(ownerMetadata.pid) : true;
    } catch {
      return false;
    }
  }

  private isProcessAlive(pid: number): boolean {
    return this.processLivenessChecker(pid);
  }

  private releasePartiallyAcquiredLock(
    token: string,
    allowEmptyOwnerlessDirectory = false,
  ): void {
    const ownerMetadata = this.readLockOwner();
    if (ownerMetadata?.token === token) {
      this.forceRemoveLockDir(this.lockPath);
      return;
    }

    if (allowEmptyOwnerlessDirectory && !ownerMetadata) {
      try {
        fs.rmdirSync(this.lockPath);
      } catch {
        // Ignore cleanup races; acquisition retry/stale handling will recover.
      }
    }
  }

  private removeStaleLock(
    ownerMetadata: LockOwnerMetadata | null,
    staleThresholdMs: number,
  ): boolean {
    const quarantinePath = `${this.lockPath}.stale-${this.pid}-${this.now()}-${this.generateLockToken()}`;
    try {
      fs.renameSync(this.lockPath, quarantinePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return false;
      }
      if (code === 'EEXIST') {
        return false;
      }
      throw error;
    }

    const quarantinedOwnerPath = path.join(quarantinePath, 'owner.json');
    const quarantinedOwner = this.readLockOwner(quarantinedOwnerPath);
    const ownerTokenMatches = ownerMetadata?.token
      ? quarantinedOwner?.token === ownerMetadata.token
      : quarantinedOwner === null;
    const stillStale = this.isLockStale(
      quarantinePath,
      staleThresholdMs,
      quarantinedOwner,
    );

    if (!ownerTokenMatches || !stillStale) {
      this.restoreQuarantinedLock(quarantinePath);
      return false;
    }

    this.forceRemoveLockDir(quarantinePath);
    this.logger.event('idempotency_stale_lock_removed', {
      lockPath: this.lockPath,
      ownerPid: quarantinedOwner?.pid,
      ownerCreatedAt: quarantinedOwner?.createdAt,
    });
    return true;
  }

  private restoreQuarantinedLock(quarantinePath: string): void {
    try {
      fs.renameSync(quarantinePath, this.lockPath);
    } catch {
      // If another process acquired the canonical lock path first, leave the
      // quarantined directory in place so this process never removes a lock it
      // could not verify as stale and owned by the observed token.
    }
  }

  private forceRemoveLockDir(lockPath: string): void {
    fs.rmSync(lockPath, { recursive: true, force: true });
  }

  private createLockOwner(): LockOwnerMetadata {
    return {
      pid: this.pid,
      createdAt: this.currentIsoString(),
      token: this.generateLockToken(),
    };
  }

  private currentIsoString(): string {
    return new Date(this.now()).toISOString();
  }

  private generateLockToken(): string {
    return `${this.pid}-${this.now()}-${this.lockTokenGenerator()}`;
  }

  private logLockContention(attempt: number, maxRetries: number): void {
    if (attempt === 1 || attempt === maxRetries || attempt % 100 === 0) {
      this.logger.event('idempotency_lock_contention', {
        lockPath: this.lockPath,
        attempt,
        maxRetries,
      });
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
        fs.readSync(
          fileDescriptor,
          buffer,
          0,
          bytesToRead,
          this.lastReadPosition,
        );
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
          if (this.now() > entry.expiresAt) {
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
      const now = this.now();
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
            }),
          );
        }

        fs.writeFileSync(
          this.persistencePath,
          validEntries.join('\n') + (validEntries.length > 0 ? '\n' : ''),
          'utf-8',
        );

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

export function withIdempotencyStoreLock<T>(
  store: IdempotencyStore,
  fn: () => T | Promise<T>,
): Promise<T> {
  return store.runWithIdempotencyLock(fn);
}
