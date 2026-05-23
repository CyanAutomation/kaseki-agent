/**
 * Job persistence manager for kaseki-agent.
 * Encapsulates all file I/O, job index management, and locking logic.
 * Separates persistence concerns from job scheduling logic.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Job } from './kaseki-api-types';
import { DEFAULT_JOB_INDEX_MAX_ENTRIES, KasekiApiConfig } from './kaseki-api-config';

/**
 * Persisted job format (with dates as ISO strings instead of Date objects).
 */
export type PersistedJob = Omit<Job, 'createdAt' | 'startedAt' | 'completedAt' | 'timeout'> & {
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
};

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
  private jobs = new Map<string, Job>();

  constructor(config: KasekiApiConfig) {
    this.config = config;
    this.indexPath = path.join(config.resultsDir, '.kaseki-api-jobs.json');
    this.nextIdPath = path.join(config.resultsDir, '.kaseki-api-next-id');
    this.idLockPath = path.join(config.resultsDir, '.kaseki-api-id.lock');
    this.indexLockPath = path.join(config.resultsDir, '.kaseki-api-jobs.lock');
  }

  /**
   * Load persisted jobs from index file.
   * Returns array of loaded jobs and queued jobs that should be restarted.
   */
  loadPersistedJobs(): { jobs: Job[]; queuedJobs: Job[] } {
    const jobs: Job[] = [];
    const queuedJobs: Job[] = [];

    try {
      this.withSyncLock(this.indexLockPath, 'Kaseki jobs index', () => {
        if (!fs.existsSync(this.indexPath)) {
          return;
        }

        try {
          const parsed = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8')) as { jobs?: PersistedJob[] };
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
        }
      });
    } catch {
      // Lock contention during startup is best-effort; a future persist/load cycle will reconcile state.
    }

    return { jobs, queuedJobs };
  }

  /**
   * Persist all jobs to index file.
   * Merges with existing index, applies retention policy, and writes atomically.
   */
  persistJobs(allJobs: Job[]): void {
    try {
      this.withSyncLock(this.indexLockPath, 'Kaseki jobs index', () => {
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
        const json = this.shouldWriteCompactIndex(merged) ? JSON.stringify(payload) : JSON.stringify(payload, null, 2);
        fs.writeFileSync(tmpPath, `${json}\n`, { mode: 0o600 });
        fs.renameSync(tmpPath, this.indexPath);
      });
    } catch {
      // Keep scheduler progress alive even if persistence is unavailable.
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

      throw new Error(`Failed to allocate unique job ID after ${maxAttempts} attempts`);
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
      finalized: job.status === 'completed' || job.status === 'failed' ? true : job.finalized,
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
      return JSON.parse(fs.readFileSync(this.indexPath, 'utf-8')) as { jobs?: PersistedJob[] };
    } catch {
      return {};
    }
  }

  /**
   * Merge existing persisted jobs with incoming jobs, applying retention policy.
   */
  private mergePersistedJobs(existing: PersistedJob[], incoming: PersistedJob[]): PersistedJob[] {
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

    return [...activeJobs, ...retainedTerminalJobs].sort((a, b) => this.comparePersistedJobsByCreatedAt(a, b));
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
  private comparePersistedJobRecency(prev: PersistedJob, job: PersistedJob): number {
    const recencyDiff = this.persistedJobRecencyScore(job) - this.persistedJobRecencyScore(prev);
    if (recencyDiff !== 0) {
      return recencyDiff;
    }

    const terminalDiff = Number(this.isTerminalPersistedJob(job)) - Number(this.isTerminalPersistedJob(prev));
    if (terminalDiff !== 0) {
      return terminalDiff;
    }

    const diagnosticFields: ReadonlyArray<keyof PersistedJob> = ['failureClass', 'error', 'exitCode'];
    const diagnosticCount = (candidate: PersistedJob): number =>
      diagnosticFields.reduce((count, field) => (candidate[field] !== undefined ? count + 1 : count), 0);
    return diagnosticCount(job) - diagnosticCount(prev);
  }

  /**
   * Decide which of two persisted job versions is more recent.
   */
  private selectMostRecentPersistedJob(prev: PersistedJob, job: PersistedJob): PersistedJob {
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
  private comparePersistedJobsByTerminalRecency(a: PersistedJob, b: PersistedJob): number {
    const updatedDiff = this.persistedJobUpdatedAt(b) - this.persistedJobUpdatedAt(a);
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
  private comparePersistedJobsByCreatedAt(a: PersistedJob, b: PersistedJob): number {
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
      for (const entry of fs.readdirSync(this.config.resultsDir, { withFileTypes: true })) {
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
  private async withLock<T>(lockPath: string, lockName: string, callback: () => Promise<T>): Promise<T> {
    fs.mkdirSync(this.config.resultsDir, { recursive: true });
    let acquired = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        fs.mkdirSync(lockPath, { mode: 0o700 });
        acquired = true;
        break;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }

    if (!acquired) {
      throw new Error(`Failed to acquire ${lockName} lock: ${lockPath}`);
    }

    try {
      return await callback();
    } finally {
      fs.rmSync(lockPath, { recursive: true, force: true });
    }
  }

  /**
   * Acquire a lock and execute a callback synchronously.
   */
  private withSyncLock<T>(lockPath: string, lockName: string, callback: () => T): T {
    fs.mkdirSync(this.config.resultsDir, { recursive: true });
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        throw new Error(`Failed to acquire ${lockName} lock: ${lockPath}`);
      }
      throw err;
    }

    try {
      return callback();
    } finally {
      fs.rmSync(lockPath, { recursive: true, force: true });
    }
  }
}
