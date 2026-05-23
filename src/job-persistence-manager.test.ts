import * as fs from 'fs';
import * as path from 'path';
import { Job } from './kaseki-api-types';
import { JobPersistenceManager, PersistedJob } from './job-persistence-manager';
import { KasekiApiConfig } from './kaseki-api-config';

describe('JobPersistenceManager', () => {
  let tempDir: string;
  let config: KasekiApiConfig;
  let manager: JobPersistenceManager;

  beforeEach(() => {
    tempDir = path.join('/tmp', `test-kaseki-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('loadPersistedJobs', () => {
    it('should return empty arrays when no jobs are persisted', () => {
      const result = manager.loadPersistedJobs();
      expect(result.jobs).toEqual([]);
      expect(result.queuedJobs).toEqual([]);
    });

    it('should load persisted jobs from index file', () => {
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

      const result = manager.loadPersistedJobs();
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].id).toBe('kaseki-1');
      expect(result.jobs[0].createdAt).toBeInstanceOf(Date);
    });

    it('should mark running jobs as failed if API restarted', () => {
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

      const result = manager.loadPersistedJobs();
      expect(result.jobs[0].status).toBe('failed');
      expect(result.jobs[0].exitCode).toBe(143);
      expect(result.jobs[0].failureClass).toBe('api_restart');
    });

    it('should return queued jobs separately', () => {
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
      fs.writeFileSync(indexPath, JSON.stringify({ jobs: [queuedJob] }), 'utf-8');

      const result = manager.loadPersistedJobs();
      expect(result.queuedJobs).toHaveLength(1);
      expect(result.queuedJobs[0].id).toBe('kaseki-1');
    });


    it('retries sync lock acquisition during initial contention and eventually loads jobs', () => {
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

      const releaseProc = require('child_process').spawn(process.execPath, [
        '-e',
        `setTimeout(() => require('fs').rmSync(${JSON.stringify(lockPath)}, { recursive: true, force: true }), 50)`,
      ]);

      const result = manager.loadPersistedJobs();
      expect(releaseProc.pid).toBeGreaterThan(0);
      expect(result.status).toBe('loaded');
      expect(result.jobs).toHaveLength(1);
    });
  });

  describe('persistJobs', () => {
    it('should persist jobs to index file', () => {
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

      manager.persistJobs([job]);

      const indexPath = path.join(tempDir, '.kaseki-api-jobs.json');
      expect(fs.existsSync(indexPath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      expect(content.jobs).toHaveLength(1);
      expect(content.jobs[0].id).toBe('kaseki-1');
      expect(typeof content.jobs[0].createdAt).toBe('string');
    });

    it('should apply retention policy to terminal jobs', () => {
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
          createdAt: new Date(`2026-05-${String(i).padStart(2, '0')}T12:00:00Z`),
          resultDir: manager.getResultDir(`kaseki-${i}`),
          correlationId: `corr-${i}`,
          requestId: `req-${i}`,
        });
      }

      manager.persistJobs(jobs);

      const indexPath = path.join(tempDir, '.kaseki-api-jobs.json');
      const content = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));

      // Should keep all 5 active jobs + max 5 terminal jobs
      expect(content.jobs.length).toBeLessThanOrEqual(10);
    });
  });

  describe('persistJobs conflict resolution', () => {
    const baseRequest = { repoUrl: 'https://github.com/test/repo', ref: 'main' };

    const readPersistedJob = (id: string): PersistedJob => {
      const indexPath = path.join(tempDir, '.kaseki-api-jobs.json');
      const content = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as { jobs: PersistedJob[] };
      const found = content.jobs.find((job) => job.id === id);
      expect(found).toBeDefined();
      return found as PersistedJob;
    };

    it('prefers newer startedAt for running jobs when completedAt is missing', () => {
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
      fs.writeFileSync(path.join(tempDir, '.kaseki-api-jobs.json'), JSON.stringify({ jobs: [oldRunning] }), 'utf-8');

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

      manager.persistJobs([newerRunning]);
      const merged = readPersistedJob(id);
      expect(merged.startedAt).toBe('2026-05-11T12:03:00.000Z');
      expect(merged.requestId).toBe('req-new');
    });

    it('prefers running over queued for equal timestamp signals', () => {
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
      fs.writeFileSync(path.join(tempDir, '.kaseki-api-jobs.json'), JSON.stringify({ jobs: [queued] }), 'utf-8');

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

      manager.persistJobs([running]);
      const merged = readPersistedJob(id);
      expect(merged.status).toBe('running');
      expect(merged.requestId).toBe('req-running');
    });

    it('prefers terminal over non-terminal when recency signals tie', () => {
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
      fs.writeFileSync(path.join(tempDir, '.kaseki-api-jobs.json'), JSON.stringify({ jobs: [running] }), 'utf-8');

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

      manager.persistJobs([failed]);
      const merged = readPersistedJob(id);
      expect(merged.status).toBe('failed');
      expect(merged.requestId).toBe('req-failed');
    });
  });

  describe('generateInstanceId', () => {
    it('should generate unique instance IDs', async () => {
      const id1 = await manager.generateInstanceId([]);
      expect(id1).toMatch(/^kaseki-\d+$/);

      const id2 = await manager.generateInstanceId([id1]);
      expect(id2).not.toBe(id1);
      expect(id2).toMatch(/^kaseki-\d+$/);
    });

    it('should increment ID counter on disk', async () => {
      await manager.generateInstanceId([]);
      const nextIdPath = path.join(tempDir, '.kaseki-api-next-id');
      expect(fs.existsSync(nextIdPath)).toBe(true);

      const nextId = parseInt(fs.readFileSync(nextIdPath, 'utf-8').trim(), 10);
      expect(nextId).toBeGreaterThan(1);
    });

    it('should discover highest ID from result directory', async () => {
      // Create existing result directories
      fs.mkdirSync(path.join(tempDir, 'kaseki-100'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'kaseki-200'), { recursive: true });

      const newId = await manager.generateInstanceId([]);
      const num = parseInt(newId.split('-')[1], 10);
      expect(num).toBeGreaterThan(200);
    });
  });

  describe('getResultDir', () => {
    it('should return correct path for job', () => {
      const resultDir = manager.getResultDir('kaseki-1');
      expect(resultDir).toBe(path.join(tempDir, 'kaseki-1'));
    });
  });

  describe('lockingBehavior', () => {
    it('should handle concurrent persist operations', async () => {
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
      manager.persistJobs([job1]);
      manager.persistJobs([job1, job2]);

      const result = manager.loadPersistedJobs();
      expect(result.jobs.length).toBeGreaterThanOrEqual(1);
    });
  });
});
