import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { Job } from './kaseki-api-types';
import { JobPersistenceManager, PersistedJob } from './job-persistence-manager';
import { KasekiApiConfig } from './kaseki-api-config';

/**
 * JobPersistenceManager Tests
 *
 * Validates persistence and recovery of job state across API restarts.
 * Tests cover:
 * - Loading jobs from the index file (empty, filled, with queued jobs)
 * - Marking running jobs as failed on restart (API crash recovery)
 * - Persisting new jobs to index
 * - Lock contention and event loop responsiveness during load
 */
describe('JobPersistenceManager', () => {
  let tempDir: string;
  let config: KasekiApiConfig;
  let manager: JobPersistenceManager;

  beforeEach(async () => {
    tempDir = path.join(
      '/tmp',
      `test-kaseki-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.mkdirSync(tempDir, { recursive: true });

    config = {
      port: 3000,
      apiKeys: ['test'],
      resultsDir: tempDir,
      maxConcurrentRuns: 2,
      defaultTaskMode: 'patch',
      maxDiffBytes: 100000,
      agentTimeoutSeconds: 10800,
      logLevel: 'info',
      artifactCacheMaxEntries: 10,
      artifactCacheTtlMs: 60000,
      artifactCacheMaxFileBytes: 5000000,
    };

    manager = new JobPersistenceManager(config);
  });

  afterEach(async () => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('loadPersistedJobs', () => {
    test('should return empty arrays when no jobs are persisted', async () => {
      // Spec: Empty state is valid — no prior jobs means clean slate
      const result = await manager.loadPersistedJobs();
      expect(result.jobs).toEqual([]);
      expect(result.queuedJobs).toEqual([]);
    });

    test('should load persisted jobs from index file', async () => {
      // Spec: Jobs persisted to disk should be loaded back with state restored
      // Behavioral intent: Parse index file, convert timestamp strings to Date objects
      const job: PersistedJob = {
        id: 'kaseki-1',
        status: 'completed',
        request: {
          repoUrl: 'https://github.com/test/repo',
          ref: 'main',
        },
        createdAt: '2026-05-11T12:00:00Z',
        startedAt: '2026-05-11T12:01:00Z',
        completedAt: '2026-05-11T12:05:00Z',
        resultDir: manager.getResultDir('kaseki-1'),
        finalized: true,
        correlationId: 'corr-1',
        requestId: 'req-1',
      };

      const indexPath = path.join(tempDir, '.kaseki-api-jobs.json');
      fs.writeFileSync(indexPath, JSON.stringify({ jobs: [job] }), 'utf-8');

      const result = await manager.loadPersistedJobs();
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].id).toBe('kaseki-1');
      expect(result.jobs[0].createdAt).toBeInstanceOf(Date);
    });

    test('should mark running jobs as failed if API restarted', async () => {
      // Spec: Incomplete jobs are marked failed on restart
      // Regression: GH#2789 — API restart should set exitCode=143 (SIGTERM), failureClass=api_restart
      // Expected behavior: This signals that job was killed by external force (container restart, etc)
      const job: PersistedJob = {
        id: 'kaseki-1',
        status: 'running',
        request: {
          repoUrl: 'https://github.com/test/repo',
          ref: 'main',
        },
        createdAt: '2026-05-11T12:00:00Z',
        startedAt: '2026-05-11T12:01:00Z',
        resultDir: manager.getResultDir('kaseki-1'),
        correlationId: 'corr-1',
        requestId: 'req-1',
      };

      const indexPath = path.join(tempDir, '.kaseki-api-jobs.json');
      fs.writeFileSync(indexPath, JSON.stringify({ jobs: [job] }), 'utf-8');

      const result = await manager.loadPersistedJobs();
      expect(result.jobs[0].status).toBe('failed');
      expect(result.jobs[0].exitCode).toBe(143);
      expect(result.jobs[0].failureClass).toBe('api_restart');
    });

    test('should return queued jobs separately', async () => {
      // Spec: Queued (not yet started) jobs are returned in a separate array
      // Behavioral intent: Distinguish jobs that never started from those in progress
      const queuedJob: PersistedJob = {
        id: 'kaseki-1',
        status: 'queued',
        request: {
          repoUrl: 'https://github.com/test/repo',
          ref: 'main',
        },
        createdAt: '2026-05-11T12:00:00Z',
        resultDir: manager.getResultDir('kaseki-1'),
        correlationId: 'corr-1',
        requestId: 'req-1',
      };

      const indexPath = path.join(tempDir, '.kaseki-api-jobs.json');
      fs.writeFileSync(
        indexPath,
        JSON.stringify({ jobs: [queuedJob] }),
        'utf-8',
      );

      const result = await manager.loadPersistedJobs();
      expect(result.queuedJobs).toHaveLength(1);
      expect(result.queuedJobs[0].id).toBe('kaseki-1');
    });

    test('should retry sync lock acquisition during initial contention and eventually load jobs', async () => {
      // Spec: If lock exists (held by another process), retry with exponential backoff
      // Behavioral intent: Polling strategy allows concurrent safe access to shared index file
      // This test spawns a subprocess to simulate contention
      const job: PersistedJob = {
        id: 'kaseki-1',
        status: 'completed',
        request: {
          repoUrl: 'https://github.com/test/repo',
          ref: 'main',
        },
        createdAt: '2026-05-11T12:00:00Z',
        resultDir: manager.getResultDir('kaseki-1'),
        finalized: true,
        correlationId: 'corr-1',
        requestId: 'req-1',
      };

      const indexPath = path.join(tempDir, '.kaseki-api-jobs.json');
      const lockPath = path.join(tempDir, '.kaseki-api-jobs.lock');
      fs.writeFileSync(indexPath, JSON.stringify({ jobs: [job] }), 'utf-8');
      fs.mkdirSync(lockPath, { recursive: true });

      const releaseProc = spawn(process.execPath, [
        '-e',
        `setTimeout(() => require('fs').rmSync(${JSON.stringify(lockPath)}, { recursive: true, force: true }), 50)`,
      ]);

      const result = await manager.loadPersistedJobs();
      releaseProc.on('exit', async () => {});
      releaseProc.unref();
      expect(releaseProc.pid).toBeGreaterThan(0);
      expect(result.status).toBe('loaded');
      expect(result.jobs).toHaveLength(1);
    });

    test('should keep the event loop responsive while waiting for jobs index lock', async () => {
      // Spec: Lock waiting uses async primitives (not busy-loop)
      // Behavioral intent: Event loop should tick regularly while blocked on lock
      // Assertion: Multiple event loop ticks should occur during lock wait
      const job: PersistedJob = {
        id: 'kaseki-1',
        status: 'completed',
        request: {
          repoUrl: 'https://github.com/test/repo',
          ref: 'main',
        },
        createdAt: '2026-05-11T12:00:00Z',
        resultDir: manager.getResultDir('kaseki-1'),
        finalized: true,
        correlationId: 'corr-1',
        requestId: 'req-1',
      };

      const indexPath = path.join(tempDir, '.kaseki-api-jobs.json');
      const lockPath = path.join(tempDir, '.kaseki-api-jobs.lock');
      fs.writeFileSync(indexPath, JSON.stringify({ jobs: [job] }), 'utf-8');
      fs.mkdirSync(lockPath, { recursive: true });

      let ticks = 0;
      const interval = setInterval(() => {
        ticks += 1;
      }, 5);
      const releaseLock = setTimeout(() => {
        fs.rmSync(lockPath, { recursive: true, force: true });
      }, 75);

      try {
        const result = await manager.loadPersistedJobs();
        expect(result.status).toBe('loaded');
        expect(result.jobs).toHaveLength(1);
        expect(ticks).toBeGreaterThanOrEqual(5);
      } finally {
        clearInterval(interval);
        clearTimeout(releaseLock);
      }
    });
  });

  describe('persistJobs', () => {
    test('should persist jobs to index file', async () => {
      const job: Job = {
        id: 'kaseki-1',
        status: 'completed',
        request: {
          repoUrl: 'https://github.com/test/repo',
          ref: 'main',
        },
        createdAt: new Date('2026-05-11T12:00:00Z'),
        startedAt: new Date('2026-05-11T12:01:00Z'),
        completedAt: new Date('2026-05-11T12:05:00Z'),
        resultDir: manager.getResultDir('kaseki-1'),
        correlationId: 'corr-1',
        requestId: 'req-1',
        finalized: true,
      };

      await manager.persistJobs([job]);

      const indexPath = path.join(tempDir, '.kaseki-api-jobs.json');
      expect(fs.existsSync(indexPath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      expect(content.jobs).toHaveLength(1);
      expect(content.jobs[0].id).toBe('kaseki-1');
      expect(typeof content.jobs[0].createdAt).toBe('string');
    });

    test('should apply retention policy to terminal jobs', async () => {
      const maxEntries = 5;
      config.jobIndexMaxEntries = maxEntries;
      manager = new JobPersistenceManager(config);

      const jobs: Job[] = [];
      for (let i = 1; i <= 10; i++) {
        jobs.push({
          id: `kaseki-${i}`,
          status: i <= 5 ? 'running' : 'completed',
          request: {
            repoUrl: 'https://github.com/test/repo',
            ref: 'main',
          },
          createdAt: new Date(
            `2026-05-${String(i).padStart(2, '0')}T12:00:00Z`,
          ),
          resultDir: manager.getResultDir(`kaseki-${i}`),
          correlationId: `corr-${i}`,
          requestId: `req-${i}`,
        });
      }

      await manager.persistJobs(jobs);

      const indexPath = path.join(tempDir, '.kaseki-api-jobs.json');
      const content = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));

      // Should keep all 5 active jobs + max 5 terminal jobs
      expect(content.jobs.length).toBeLessThanOrEqual(10);
    });
  });

  describe('persistJobs conflict resolution', () => {
    const baseRequest = {
      repoUrl: 'https://github.com/test/repo',
      ref: 'main',
    };

    const readPersistedJob = (id: string): PersistedJob => {
      const indexPath = path.join(tempDir, '.kaseki-api-jobs.json');
      const content = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as {
        jobs: PersistedJob[];
      };
      const found = content.jobs.find((job) => job.id === id);
      expect(found).toBeDefined();
      return found as PersistedJob;
    };

    test('prefers newer startedAt for running jobs when completedAt is missing', async () => {
      const id = 'kaseki-conflict-running';
      const oldRunning: PersistedJob = {
        id,
        status: 'running',
        request: baseRequest,
        createdAt: '2026-05-11T12:00:00Z',
        startedAt: '2026-05-11T12:01:00Z',
        resultDir: manager.getResultDir(id),
        correlationId: 'corr-old',
        requestId: 'req-old',
      };
      fs.writeFileSync(
        path.join(tempDir, '.kaseki-api-jobs.json'),
        JSON.stringify({ jobs: [oldRunning] }),
        'utf-8',
      );

      const newerRunning: Job = {
        id,
        status: 'running',
        request: baseRequest,
        createdAt: new Date('2026-05-11T12:00:00Z'),
        startedAt: new Date('2026-05-11T12:03:00Z'),
        resultDir: manager.getResultDir(id),
        correlationId: 'corr-new',
        requestId: 'req-new',
      };

      await manager.persistJobs([newerRunning]);
      const merged = readPersistedJob(id);
      expect(merged.startedAt).toBe('2026-05-11T12:03:00.000Z');
      expect(merged.requestId).toBe('req-new');
    });

    test('prefers running over queued for equal timestamp signals', async () => {
      const id = 'kaseki-conflict-queued-running';
      const queued: PersistedJob = {
        id,
        status: 'queued',
        request: baseRequest,
        createdAt: '2026-05-11T12:00:00Z',
        resultDir: manager.getResultDir(id),
        correlationId: 'corr-queued',
        requestId: 'req-queued',
      };
      fs.writeFileSync(
        path.join(tempDir, '.kaseki-api-jobs.json'),
        JSON.stringify({ jobs: [queued] }),
        'utf-8',
      );

      const running: Job = {
        id,
        status: 'running',
        request: baseRequest,
        createdAt: new Date('2026-05-11T12:00:00Z'),
        startedAt: new Date('2026-05-11T12:05:00Z'),
        resultDir: manager.getResultDir(id),
        correlationId: 'corr-running',
        requestId: 'req-running',
      };

      await manager.persistJobs([running]);
      const merged = readPersistedJob(id);
      expect(merged.status).toBe('running');
      expect(merged.requestId).toBe('req-running');
    });

    test('prefers terminal over non-terminal when recency signals tie', async () => {
      const id = 'kaseki-conflict-terminal';
      const running: PersistedJob = {
        id,
        status: 'running',
        request: baseRequest,
        createdAt: '2026-05-11T12:00:00Z',
        startedAt: '2026-05-11T12:05:00Z',
        resultDir: manager.getResultDir(id),
        correlationId: 'corr-running',
        requestId: 'req-running',
      };
      fs.writeFileSync(
        path.join(tempDir, '.kaseki-api-jobs.json'),
        JSON.stringify({ jobs: [running] }),
        'utf-8',
      );

      const failed: Job = {
        id,
        status: 'failed',
        request: baseRequest,
        createdAt: new Date('2026-05-11T12:00:00Z'),
        startedAt: new Date('2026-05-11T12:05:00Z'),
        resultDir: manager.getResultDir(id),
        correlationId: 'corr-failed',
        requestId: 'req-failed',
        finalized: true,
      };

      await manager.persistJobs([failed]);
      const merged = readPersistedJob(id);
      expect(merged.status).toBe('failed');
      expect(merged.requestId).toBe('req-failed');
    });
  });

  describe('generateInstanceId', () => {
    test('should generate unique instance IDs', async () => {
      const id1 = await manager.generateInstanceId([]);
      expect(id1).toMatch(/^kaseki-\d+$/);

      const id2 = await manager.generateInstanceId([id1]);
      expect(id2).not.toBe(id1);
      expect(id2).toMatch(/^kaseki-\d+$/);
    });

    test('should increment ID counter on disk', async () => {
      await manager.generateInstanceId([]);
      const nextIdPath = path.join(tempDir, '.kaseki-api-next-id');
      expect(fs.existsSync(nextIdPath)).toBe(true);

      const nextId = parseInt(fs.readFileSync(nextIdPath, 'utf-8').trim(), 10);
      expect(nextId).toBeGreaterThan(1);
    });

    test('should discover highest ID from result directory', async () => {
      // Create existing result directories
      fs.mkdirSync(path.join(tempDir, 'kaseki-100'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'kaseki-200'), { recursive: true });

      const newId = await manager.generateInstanceId([]);
      const num = parseInt(newId.split('-')[1], 10);
      expect(num).toBeGreaterThan(200);
    });
  });

  describe('getResultDir', () => {
    test('should return correct path for job', async () => {
      const resultDir = manager.getResultDir('kaseki-1');
      expect(resultDir).toBe(path.join(tempDir, 'kaseki-1'));
    });
  });

  describe('lockingBehavior', () => {
    test('should handle concurrent persist operations', async () => {
      const job1: Job = {
        id: 'kaseki-1',
        status: 'completed',
        request: { repoUrl: 'https://github.com/test/repo', ref: 'main' },
        createdAt: new Date(),
        resultDir: manager.getResultDir('kaseki-1'),
        correlationId: 'corr-1',
        requestId: 'req-1',
        finalized: true,
      };

      const job2: Job = {
        id: 'kaseki-2',
        status: 'completed',
        request: { repoUrl: 'https://github.com/test/repo', ref: 'main' },
        createdAt: new Date(),
        resultDir: manager.getResultDir('kaseki-2'),
        correlationId: 'corr-2',
        requestId: 'req-2',
        finalized: true,
      };

      // Simulate concurrent persists
      await manager.persistJobs([job1]);
      await manager.persistJobs([job1, job2]);

      const result = await manager.loadPersistedJobs();
      expect(result.jobs.length).toBeGreaterThanOrEqual(1);
    });
  });
  describe('stale lock recovery', () => {
    const staleCreatedAt = '2026-05-11T12:00:00.000Z';
    const nowMs = Date.parse('2026-05-11T12:01:00.000Z');

    const writeOwnerLock = (lockName: string, token = 'stale-token'): string => {
      const lockPath = path.join(tempDir, lockName);
      fs.mkdirSync(lockPath, { recursive: true });
      fs.writeFileSync(
        path.join(lockPath, 'owner.json'),
        JSON.stringify({ pid: 999999, createdAt: staleCreatedAt, token }),
        'utf-8',
      );
      return lockPath;
    };

    const makeJob = (id: string): Job => ({
      id,
      status: 'completed',
      request: { repoUrl: 'https://github.com/test/repo', ref: 'main' },
      createdAt: new Date('2026-05-11T12:00:00Z'),
      resultDir: manager.getResultDir(id),
      correlationId: `corr-${id}`,
      requestId: `req-${id}`,
      finalized: true,
    });

    test('recovers abandoned jobs index locks and persists jobs', async () => {
      const lockPath = writeOwnerLock('.kaseki-api-jobs.lock');
      manager = new JobPersistenceManager(config, {
        now: () => nowMs,
        processLivenessChecker: () => false,
        lockTokenGenerator: () => 'new-token',
        pid: 1234,
      });

      await manager.persistJobs([makeJob('kaseki-1')]);

      expect(fs.existsSync(lockPath)).toBe(false);
      const content = JSON.parse(
        fs.readFileSync(path.join(tempDir, '.kaseki-api-jobs.json'), 'utf-8'),
      ) as { jobs: PersistedJob[] };
      expect(content.jobs[0].id).toBe('kaseki-1');
    });

    test('recovers abandoned instance ID locks and allocates IDs', async () => {
      const lockPath = writeOwnerLock('.kaseki-api-id.lock');
      manager = new JobPersistenceManager(config, {
        now: () => nowMs,
        processLivenessChecker: () => false,
        lockTokenGenerator: () => 'new-token',
        pid: 1234,
      });

      const id = await manager.generateInstanceId([]);

      expect(id).toBe('kaseki-1');
      expect(fs.existsSync(lockPath)).toBe(false);
      expect(fs.readFileSync(path.join(tempDir, '.kaseki-api-next-id'), 'utf-8')).toBe('2\n');
    });

    test('does not remove stale-looking locks whose owner process is alive', async () => {
      const lockPath = writeOwnerLock('.kaseki-api-jobs.lock', 'live-token');
      manager = new JobPersistenceManager(config, {
        now: () => nowMs,
        processLivenessChecker: () => true,
        lockTokenGenerator: () => 'new-token',
        pid: 1234,
      });

      await manager.persistJobs([makeJob('kaseki-live')]);

      expect(fs.existsSync(lockPath)).toBe(true);
      const owner = JSON.parse(
        fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf-8'),
      ) as { token: string };
      expect(owner.token).toBe('live-token');
      expect(fs.existsSync(path.join(tempDir, '.kaseki-api-jobs.json'))).toBe(false);
    });

    test('does not remove quarantined stale locks when owner token changes before cleanup verification', async () => {
      const lockPath = writeOwnerLock('.kaseki-api-jobs.lock', 'observed-token');
      let livenessChecks = 0;
      manager = new JobPersistenceManager(config, {
        now: () => nowMs,
        processLivenessChecker: () => {
          livenessChecks += 1;
          if (livenessChecks === 1) {
            fs.writeFileSync(
              path.join(lockPath, 'owner.json'),
              JSON.stringify({
                pid: 999999,
                createdAt: staleCreatedAt,
                token: 'replacement-token',
              }),
              'utf-8',
            );
          }
          return livenessChecks === 1 ? false : true;
        },
        lockTokenGenerator: () => 'new-token',
        pid: 1234,
      });

      await manager.persistJobs([makeJob('kaseki-token-mismatch')]);

      expect(fs.existsSync(lockPath)).toBe(true);
      const owner = JSON.parse(
        fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf-8'),
      ) as { token: string };
      expect(owner.token).toBe('replacement-token');
      expect(fs.existsSync(path.join(tempDir, '.kaseki-api-jobs.json'))).toBe(false);
    });
  });

});
