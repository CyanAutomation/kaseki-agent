/**
 * Job persistence manager for kaseki-agent.
 * Encapsulates all file I/O, job index management, and locking logic.
 * Separates persistence concerns from job scheduling logic.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Job } from './kaseki-api-types';
import {
  DEFAULT_JOB_INDEX_MAX_ENTRIES,
  KasekiApiConfig,
} from './kaseki-api-config';
import { createEventLogger, EventLogger } from './logger';

/**
 * Persisted job format (with dates as ISO strings instead of Date objects).
 */
export type PersistedJob = Omit<
  Job,
  'createdAt' | 'startedAt' | 'completedAt' | 'timeout'
> & {
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
};

type LoadPersistedJobsStatus = 'loaded' | 'lock_contention' | 'read_error';

interface LockOwnerMetadata {
  pid: number;
  createdAt: string;
  token: string;
}

export type JobPersistenceProcessLivenessChecker = (pid: number) => boolean;

export interface JobPersistenceManagerDependencies {
  now?: () => number;
  processLivenessChecker?: JobPersistenceProcessLivenessChecker;
  lockTokenGenerator?: () => string;
  pid?: number;
  staleLockQuarantineObserver?: (
    lockPath: string,
    quarantinePath: string,
  ) => void;
}

export function createJobPersistenceProcessLivenessChecker(
  kill: (pid: number, signal: 0) => unknown = process.kill,
  platform: NodeJS.Platform = process.platform,
): JobPersistenceProcessLivenessChecker {
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

class LockAcquisitionError extends Error {
  constructor(lockName: string, lockPath: string) {
    super(`Failed to acquire ${lockName} lock: ${lockPath}`);
    this.name = 'LockAcquisitionError';
  }
}

/**
 * Job persistence manager handles all file I/O and job index operations.
 * Manages unique instance ID allocation, job index persistence, and locking.
 */
export class JobPersistenceManager {
  private indexPath: string;
  private nextIdPath: string;
  private idLockPath: string;
  private indexLockPath: string;
  private config: KasekiApiConfig;
  private logger: EventLogger;
  private jobs = new Map<string, Job>();
  private activeLockOwners = new Map<string, LockOwnerMetadata>();
  private now: () => number;
  private processLivenessChecker: JobPersistenceProcessLivenessChecker;
  private lockTokenGenerator: () => string;
  private pid: number;
  private staleLockQuarantineObserver?: (
    lockPath: string,
    quarantinePath: string,
  ) => void;

  constructor(
    config: KasekiApiConfig,
    dependencies: JobPersistenceManagerDependencies = {},
  ) {
    this.config = config;
    this.indexPath = path.join(config.resultsDir, '.kaseki-api-jobs.json');
    this.nextIdPath = path.join(config.resultsDir, '.kaseki-api-next-id');
    this.idLockPath = path.join(config.resultsDir, '.kaseki-api-id.lock');
    this.indexLockPath = path.join(config.resultsDir, '.kaseki-api-jobs.lock');
    this.logger = createEventLogger('job-persistence-manager');
    this.now = dependencies.now ?? Date.now;
    this.processLivenessChecker =
      dependencies.processLivenessChecker ??
      createJobPersistenceProcessLivenessChecker();
    this.lockTokenGenerator =
      dependencies.lockTokenGenerator ?? (() => crypto.randomUUID());
    this.pid = dependencies.pid ?? process.pid;
    this.staleLockQuarantineObserver = dependencies.staleLockQuarantineObserver;
  }

  /**
   * Load persisted jobs from index file.
   * Returns array of loaded jobs and queued jobs that should be restarted.
   */
  async loadPersistedJobs(): Promise<{
    jobs: Job[];
    queuedJobs: Job[];
    status: LoadPersistedJobsStatus;
  }> {
    const jobs: Job[] = [];
    const queuedJobs: Job[] = [];
    let status: LoadPersistedJobsStatus = 'loaded';

    try {
      await this.withLock(this.indexLockPath, 'Kaseki jobs index', () => {
        if (!fs.existsSync(this.indexPath)) {
          return;
        }

        try {
          const parsed = JSON.parse(
            fs.readFileSync(this.indexPath, 'utf-8'),
          ) as { jobs?: PersistedJob[] };
          for (const persisted of parsed.jobs || []) {
            const job = this.deserializeJob(persisted);
            if (job.status === 'running') {
              job.status = 'failed';
              job.exitCode = 143;
              job.failureClass = 'api_restart';
              job.error = 'API service restarted while job was running';
              job.completedAt = job.completedAt || new Date();
              job.finalized = true;
            }
            if (job.status === 'queued') {
              queuedJobs.push(job);
            }
            jobs.push(job);
            this.jobs.set(job.id, job);
          }
        } catch {
          // A corrupt index should not prevent the API from starting; existing
          // artifacts remain available on disk for direct inspection.
          status = 'read_error';
        }
      });
    } catch (error) {
      // Lock contention during startup is best-effort; a future persist/load cycle will reconcile state.
      status =
        error instanceof LockAcquisitionError
          ? 'lock_contention'
          : 'read_error';
    }

    return { jobs, queuedJobs, status };
  }

  /**
   * Persist all jobs to index file.
   * Merges with existing index, applies retention policy, and writes atomically.
   */
  async persistJobs(allJobs: Job[]): Promise<void> {
    try {
      await this.withLock(this.indexLockPath, 'Kaseki jobs index', () => {
        fs.mkdirSync(this.config.resultsDir, { recursive: true });
        const current = this.readPersistedJobsIndex();
        const merged = this.mergePersistedJobs(
          current.jobs || [],
          allJobs.map((job) => this.serializeJob(job)),
        );
        const payload = {
          version: 1,
          updatedAt: new Date().toISOString(),
          jobs: merged,
        };
        const tmpPath = `${this.indexPath}.tmp`;
        const json = this.shouldWriteCompactIndex(merged)
          ? JSON.stringify(payload)
          : JSON.stringify(payload, null, 2);
        fs.writeFileSync(tmpPath, `${json}\n`, { mode: 0o600 });
        fs.renameSync(tmpPath, this.indexPath);
      });
    } catch (error) {
      // Keep scheduler progress alive even if persistence is unavailable, but
      // surface enough context for readiness/preflight diagnostics.
      this.logger.error('Failed to persist jobs index', {
        error: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : undefined,
        lockPath: this.indexLockPath,
        indexPath: this.indexPath,
        jobCount: allJobs.length,
      });
      this.logger.event('job_persistence_degraded', {
        reason:
          error instanceof LockAcquisitionError
            ? 'lock_acquisition_failed'
            : 'persist_failed',
        lockPath: this.indexLockPath,
        indexPath: this.indexPath,
        jobCount: allJobs.length,
      });
    }
  }

  /**
   * Generate a unique, durable instance ID.
   * Format: `kaseki-N`, matching run-kaseki.sh and result directory names.
   */
  async generateInstanceId(existingIds: string[]): Promise<string> {
    return this.withIdLock(async () => {
      const jobIds = new Set(existingIds);
      let nextId = this.readNextId(jobIds);
      const maxAttempts = 10000;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const id = `kaseki-${nextId}`;
        if (!jobIds.has(id) && !fs.existsSync(this.getResultDir(id))) {
          fs.writeFileSync(this.nextIdPath, `${nextId + 1}\n`, { mode: 0o600 });
          return id;
        }
        nextId += 1;
      }

      throw new Error(
        `Failed to allocate unique job ID after ${maxAttempts} attempts`,
      );
    });
  }

  /**
   * Get result directory path for a job.
   */
  getResultDir(id: string): string {
    return path.join(this.config.resultsDir, id);
  }

  /**
   * Serialize a job for persistence (dates → ISO strings, remove non-persistent fields).
   */
  private serializeJob(job: Job): PersistedJob {
    const serializableJob = { ...job };
    delete serializableJob.timeout;
    return {
      ...serializableJob,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString(),
      completedAt: job.completedAt?.toISOString(),
    };
  }

  /**
   * Deserialize a persisted job (ISO strings → dates).
   */
  private deserializeJob(job: PersistedJob): Job {
    return {
      ...job,
      createdAt: new Date(job.createdAt),
      startedAt: job.startedAt ? new Date(job.startedAt) : undefined,
      completedAt: job.completedAt ? new Date(job.completedAt) : undefined,
      resultDir: job.resultDir || this.getResultDir(job.id),
      finalized:
        job.status === 'completed' || job.status === 'failed'
          ? true
          : job.finalized,
    };
  }

  /**
   * Read the current job index from disk.
   */
  private readPersistedJobsIndex(): { jobs?: PersistedJob[] } {
    if (!fs.existsSync(this.indexPath)) {
      return {};
    }
    try {
      return JSON.parse(fs.readFileSync(this.indexPath, 'utf-8')) as {
        jobs?: PersistedJob[];
      };
    } catch {
      return {};
    }
  }

  /**
   * Merge existing persisted jobs with incoming jobs, applying retention policy.
   */
  private mergePersistedJobs(
    existing: PersistedJob[],
    incoming: PersistedJob[],
  ): PersistedJob[] {
    const byId = new Map<string, PersistedJob>();
    for (const job of existing) {
      byId.set(job.id, job);
    }
    for (const job of incoming) {
      const prev = byId.get(job.id);
      if (!prev) {
        byId.set(job.id, job);
        continue;
      }
      byId.set(job.id, this.selectMostRecentPersistedJob(prev, job));
    }

    const activeJobs: PersistedJob[] = [];
    const terminalJobs: PersistedJob[] = [];
    for (const job of byId.values()) {
      if (this.isTerminalPersistedJob(job)) {
        terminalJobs.push(job);
      } else {
        activeJobs.push(job);
      }
    }

    const retainedTerminalJobs = terminalJobs
      .sort((a, b) => this.comparePersistedJobsByTerminalRecency(a, b))
      .slice(0, this.getJobIndexMaxEntries());

    return [...activeJobs, ...retainedTerminalJobs].sort((a, b) =>
      this.comparePersistedJobsByCreatedAt(a, b),
    );
  }

  /**
   * Build a monotonic recency score (completedAt → startedAt → createdAt).
   */
  private persistedJobRecencyScore(job: PersistedJob): number {
    if (job.completedAt) {
      return new Date(job.completedAt).getTime();
    }
    if (job.startedAt) {
      return new Date(job.startedAt).getTime();
    }
    return new Date(job.createdAt).getTime();
  }

  /**
   * Compare two persisted jobs by recency conflict resolution heuristics.
   */
  private comparePersistedJobRecency(
    prev: PersistedJob,
    job: PersistedJob,
  ): number {
    const prevIsTerminal = this.isTerminalPersistedJob(prev);
    const jobIsTerminal = this.isTerminalPersistedJob(job);
    if (prevIsTerminal !== jobIsTerminal) {
      return jobIsTerminal ? 1 : -1;
    }

    const recencyDiff =
      this.persistedJobRecencyScore(job) - this.persistedJobRecencyScore(prev);
    if (recencyDiff !== 0) {
      return recencyDiff;
    }

    const diagnosticFields: ReadonlyArray<keyof PersistedJob> = [
      'failureClass',
      'error',
      'exitCode',
    ];
    const diagnosticCount = (candidate: PersistedJob): number =>
      diagnosticFields.reduce(
        (count, field) => (candidate[field] !== undefined ? count + 1 : count),
        0,
      );
    return diagnosticCount(job) - diagnosticCount(prev);
  }

  /**
   * Decide which of two persisted job versions is more recent.
   */
  private selectMostRecentPersistedJob(
    prev: PersistedJob,
    job: PersistedJob,
  ): PersistedJob {
    return this.comparePersistedJobRecency(prev, job) > 0 ? job : prev;
  }

  /**
   * Check if a persisted job is in a terminal state.
   */
  private isTerminalPersistedJob(job: PersistedJob): boolean {
    return job.status === 'completed' || job.status === 'failed';
  }

  /**
   * Compare persisted jobs by terminal recency (most recent first).
   */
  private comparePersistedJobsByTerminalRecency(
    a: PersistedJob,
    b: PersistedJob,
  ): number {
    const updatedDiff =
      this.persistedJobUpdatedAt(b) - this.persistedJobUpdatedAt(a);
    if (updatedDiff !== 0) {
      return updatedDiff;
    }
    return this.comparePersistedJobsByCreatedAt(a, b);
  }

  /**
   * Get the "updated at" timestamp for a persisted job (completed → started → created).
   */
  private persistedJobUpdatedAt(job: PersistedJob): number {
    const completed = job.completedAt ? new Date(job.completedAt).getTime() : 0;
    const started = job.startedAt ? new Date(job.startedAt).getTime() : 0;
    return Math.max(completed, started);
  }

  /**
   * Compare persisted jobs by creation time (newest first).
   */
  private comparePersistedJobsByCreatedAt(
    a: PersistedJob,
    b: PersistedJob,
  ): number {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  }

  /**
   * Check if index should be written in compact form (single-line JSON).
   */
  private shouldWriteCompactIndex(jobs: PersistedJob[]): boolean {
    return jobs.length >= this.getJobIndexMaxEntries();
  }

  /**
   * Get the configured max entries for job index.
   */
  private getJobIndexMaxEntries(): number {
    return this.config.jobIndexMaxEntries ?? DEFAULT_JOB_INDEX_MAX_ENTRIES;
  }

  /**
   * Read the next instance ID to allocate from persisted state.
   */
  private readNextId(jobIds: Set<string>): number {
    const persisted = this.readPositiveIntFile(this.nextIdPath);
    const discovered = this.discoverNextId(jobIds);
    return Math.max(persisted ?? 1, discovered);
  }

  /**
   * Read a positive integer from a file.
   */
  private readPositiveIntFile(filePath: string): number | undefined {
    try {
      const value = parseInt(fs.readFileSync(filePath, 'utf-8').trim(), 10);
      return Number.isInteger(value) && value > 0 ? value : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Discover the next instance number by scanning job IDs and result directory.
   */
  private discoverNextId(jobIds: Set<string>): number {
    let maxId = 0;
    for (const id of jobIds) {
      maxId = Math.max(maxId, this.parseInstanceNumber(id) ?? 0);
    }
    try {
      for (const entry of fs.readdirSync(this.config.resultsDir, {
        withFileTypes: true,
      })) {
        if (entry.isDirectory()) {
          maxId = Math.max(maxId, this.parseInstanceNumber(entry.name) ?? 0);
        }
      }
    } catch {
      // Missing/unreadable results dir is handled elsewhere; keep allocation best-effort.
    }
    return maxId + 1;
  }

  /**
   * Parse instance number from kaseki ID (e.g., "kaseki-42" → 42).
   */
  private parseInstanceNumber(id: string): number | null {
    const match = /^kaseki-(\d+)$/.exec(id);
    if (!match) {
      return null;
    }
    const value = Number.parseInt(match[1], 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  /**
   * Acquire a lock and execute a callback asynchronously.
   */
  private withIdLock<T>(callback: () => Promise<T>): Promise<T> {
    return this.withLock(this.idLockPath, 'Kaseki instance ID', callback);
  }

  /**
   * Acquire a lock and execute a callback asynchronously.
   */
  private async withLock<T>(
    lockPath: string,
    lockName: string,
    callback: () => T | Promise<T>,
  ): Promise<T> {
    fs.mkdirSync(this.config.resultsDir, { recursive: true });
    const maxRetries = 100;
    const retryDelayMs = 25;
    const staleThresholdMs = 30000;

    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      const owner = this.createLockOwner();
      try {
        fs.mkdirSync(lockPath, { mode: 0o700 });
        try {
          fs.writeFileSync(
            this.getLockOwnerPath(lockPath),
            JSON.stringify(owner),
            {
              encoding: 'utf-8',
              flag: 'wx',
            },
          );
        } catch (ownerWriteError) {
          this.releaseLock(lockPath, owner, true);
          throw ownerWriteError;
        }
        this.activeLockOwners.set(lockPath, owner);
        try {
          return await callback();
        } finally {
          this.releaseLock(lockPath, owner);
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        this.releaseLock(lockPath, owner);
        if (code !== 'EEXIST' && code !== 'ENOTEMPTY') {
          throw err;
        }

        const ownerMetadata = this.readLockOwner(lockPath);
        if (this.isLockStale(lockPath, staleThresholdMs, ownerMetadata)) {
          if (
            this.removeStaleLock(
              lockPath,
              lockName,
              ownerMetadata,
              staleThresholdMs,
            )
          ) {
            continue;
          }
        }

        this.logLockContention(lockName, lockPath, attempt + 1, maxRetries);
        await this.delay(retryDelayMs);
      }
    }

    throw new LockAcquisitionError(lockName, lockPath);
  }

  private getLockOwnerPath(lockPath: string): string {
    return path.join(lockPath, 'owner.json');
  }

  private createLockOwner(): LockOwnerMetadata {
    return {
      pid: this.pid,
      createdAt: new Date(this.now()).toISOString(),
      token: `${this.pid}-${this.now()}-${this.lockTokenGenerator()}`,
    };
  }

  private readLockOwner(lockPath: string): LockOwnerMetadata | null {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(this.getLockOwnerPath(lockPath), 'utf-8'),
      ) as Partial<LockOwnerMetadata>;
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
      return ownerMetadata?.pid
        ? !this.processLivenessChecker(ownerMetadata.pid)
        : true;
    } catch {
      return false;
    }
  }

  private removeStaleLock(
    lockPath: string,
    lockName: string,
    ownerMetadata: LockOwnerMetadata | null,
    staleThresholdMs: number,
  ): boolean {
    const quarantinePath = `${lockPath}.stale-${this.pid}-${this.now()}-${this.lockTokenGenerator()}`;
    try {
      fs.renameSync(lockPath, quarantinePath);
      this.staleLockQuarantineObserver?.(lockPath, quarantinePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EEXIST') {
        return false;
      }
      throw error;
    }

    const quarantinedOwner = this.readLockOwner(quarantinePath);
    const replacementLockExists = fs.existsSync(lockPath);
    const ownerTokenMatches = ownerMetadata?.token
      ? quarantinedOwner?.token === ownerMetadata.token
      : quarantinedOwner === null;
    const stillStale = this.isLockStale(
      quarantinePath,
      staleThresholdMs,
      quarantinedOwner,
    );

    if (replacementLockExists || !ownerTokenMatches || !stillStale) {
      if (!replacementLockExists) {
        this.restoreQuarantinedLock(lockPath, quarantinePath);
      }
      this.logger.event('job_persistence_stale_lock_cleanup_skipped', {
        lockName,
        lockPath,
        replacementLockExists,
        ownerTokenMatches,
        stillStale,
      });
      return false;
    }

    fs.rmSync(quarantinePath, { recursive: true, force: true });
    this.logger.event('job_persistence_stale_lock_removed', {
      lockName,
      lockPath,
      ownerPid: quarantinedOwner?.pid,
      ownerCreatedAt: quarantinedOwner?.createdAt,
    });
    return true;
  }

  private restoreQuarantinedLock(
    lockPath: string,
    quarantinePath: string,
  ): void {
    try {
      fs.renameSync(quarantinePath, lockPath);
    } catch {
      // Leave the quarantined directory untouched rather than deleting a lock
      // that could not be verified as the stale owner observed before rename.
    }
  }

  private releaseLock(
    lockPath: string,
    owner: LockOwnerMetadata,
    allowEmptyOwnerlessDirectory = false,
  ): void {
    const activeOwner = this.activeLockOwners.get(lockPath) ?? owner;
    const ownerMetadata = this.readLockOwner(lockPath);
    if (ownerMetadata?.token === activeOwner.token) {
      try {
        fs.rmSync(this.getLockOwnerPath(lockPath), { force: true });
        fs.rmdirSync(lockPath);
      } catch {
        // Ignore lock release races; token verification prevents removing a
        // replacement lock owned by another process.
      }
      this.activeLockOwners.delete(lockPath);
      return;
    }

    if (allowEmptyOwnerlessDirectory && !ownerMetadata) {
      try {
        fs.rmdirSync(lockPath);
      } catch {
        // Ignore cleanup races.
      }
    }
    this.activeLockOwners.delete(lockPath);
  }

  private logLockContention(
    lockName: string,
    lockPath: string,
    attempt: number,
    maxRetries: number,
  ): void {
    if (attempt === 1 || attempt === maxRetries || attempt % 20 === 0) {
      this.logger.event('job_persistence_lock_contention', {
        lockName,
        lockPath,
        attempt,
        maxRetries,
      });
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
