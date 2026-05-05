import { EventEmitter } from 'events';
import * as fs from 'fs';
import { JobScheduler } from './job-scheduler';
import { WebhookManager } from './webhook-manager';

const mockSpawn = jest.fn();
const mockSpawnSync = jest.fn();

jest.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}));

class MockProcess extends EventEmitter {
  pid = 12345;
  kill = jest.fn((_signal?: NodeJS.Signals) => true);
  unref = jest.fn(() => this);
}

const tempDirs: string[] = [];

function createResultsDir(): string {
  const dir = fs.mkdtempSync('/tmp/kaseki-job-scheduler-test-');
  tempDirs.push(dir);
  return dir;
}

function cleanupResultsDirs(): void {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

function createMockWebhookManager(): WebhookManager {
  return new WebhookManager(createResultsDir());
}

describe('JobScheduler timeout lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
    cleanupResultsDirs();
  });

  test('timeout followed by quick exit sets timeout failure on exit', async () => {
    const proc = new MockProcess();
    mockSpawn.mockReturnValue(proc);
    mockSpawnSync.mockReturnValue({ stdout: '', stderr: '', status: 0 });

    const scheduler = new JobScheduler(
      {
        port: 8080,
        apiKeys: ['test-key'],
        resultsDir: createResultsDir(),

        maxConcurrentRuns: 1,
        defaultTaskMode: 'patch',
        maxDiffBytes: 200000,
        agentTimeoutSeconds: 1,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    const job = await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
    });

    expect(job.status).toBe('running');

    jest.advanceTimersByTime(1000);

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(job.status).toBe('running');
    expect(job.completedAt).toBeUndefined();

    proc.emit('exit', 0);

    expect(job.status).toBe('failed');
    expect(job.exitCode).toBe(124);
    expect(job.error).toMatch(/Agent timeout/);
    expect(job.failureClass).toBe('timeout');
    expect(job.completedAt).toBeDefined();
  });

  test('passes parent results directory as host log directory', async () => {
    const proc = new MockProcess();
    mockSpawn.mockReturnValue(proc);
    mockSpawnSync.mockReturnValue({ stdout: '', stderr: '', status: 0 });
    const resultsDir = createResultsDir();

    const scheduler = new JobScheduler(
      {
        port: 8080,
        apiKeys: ['test-key'],
        resultsDir,
        maxConcurrentRuns: 1,
        defaultTaskMode: 'patch',
        maxDiffBytes: 200000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    const job = await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      'bash',
      expect.arrayContaining(['--controller', 'run', 'https://github.com/org/repo', 'main', job.id]),
      expect.objectContaining({
        env: expect.objectContaining({
          KASEKI_LOG_DIR: resultsDir,
        }),
      }),
    );
    expect(fs.existsSync(job.resultDir || '')).toBe(false);
  });

  test('startup check requests run the worker in dry-run inspect mode', async () => {
    const proc = new MockProcess();
    mockSpawn.mockReturnValue(proc);
    mockSpawnSync.mockReturnValue({ stdout: '', stderr: '', status: 0 });
    const resultsDir = createResultsDir();

    const scheduler = new JobScheduler(
      {
        port: 8080,
        apiKeys: ['test-key'],
        resultsDir,
        maxConcurrentRuns: 1,
        defaultTaskMode: 'patch',
        maxDiffBytes: 200000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
      startupCheck: true,
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      'bash',
      expect.arrayContaining(['--controller', 'run', 'https://github.com/org/repo', 'main']),
      expect.objectContaining({
        env: expect.objectContaining({
          KASEKI_DRY_RUN: '1',
          KASEKI_TASK_MODE: 'inspect',
          KASEKI_VALIDATION_COMMANDS: 'none',
        }),
      }),
    );
  });

  test('cancelled running jobs get non-empty API failure artifacts', async () => {
    const proc = new MockProcess();
    mockSpawn.mockReturnValue(proc);
    mockSpawnSync.mockReturnValue({ stdout: 'kaseki-1\n', stderr: '', status: 0 });
    const resultsDir = createResultsDir();

    const scheduler = new JobScheduler(
      {
        port: 8080,
        apiKeys: ['test-key'],
        resultsDir,
        maxConcurrentRuns: 1,
        defaultTaskMode: 'patch',
        maxDiffBytes: 200000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    const job = await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
    });

    scheduler.cancelJob(job.id);

    const failurePath = `${resultsDir}/${job.id}/failure.json`;
    const summaryPath = `${resultsDir}/${job.id}/result-summary.md`;
    expect(fs.statSync(failurePath).size).toBeGreaterThan(0);
    expect(fs.statSync(summaryPath).size).toBeGreaterThan(0);
    expect(JSON.parse(fs.readFileSync(failurePath, 'utf-8'))).toMatchObject({
      failureClass: 'cancelled',
      exitCode: 143,
      apiFinalized: true,
      cleanup: {
        attempted: true,
        ok: true,
      },
    });
  });

  test('timeout escalates to SIGKILL when process hangs', async () => {
    const proc = new MockProcess();
    mockSpawn.mockReturnValue(proc);
    mockSpawnSync.mockReturnValue({ stdout: '', stderr: '', status: 0 });

    const scheduler = new JobScheduler(
      {
        port: 8080,
        apiKeys: ['test-key'],
        resultsDir: createResultsDir(),
        maxConcurrentRuns: 1,
        defaultTaskMode: 'patch',
        maxDiffBytes: 200000,
        agentTimeoutSeconds: 1,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
    });

    jest.advanceTimersByTime(1000);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    jest.advanceTimersByTime(5000);
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  test('timeout path does not double-finalize when kill then exit race', async () => {
    const proc = new MockProcess();
    mockSpawn.mockReturnValue(proc);
    mockSpawnSync.mockReturnValue({ stdout: '', stderr: '', status: 0 });

    const scheduler = new JobScheduler(
      {
        port: 8080,
        apiKeys: ['test-key'],
        resultsDir: createResultsDir(),
        maxConcurrentRuns: 1,
        defaultTaskMode: 'patch',
        maxDiffBytes: 200000,
        agentTimeoutSeconds: 1,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    const processQueueSpy = jest.spyOn(scheduler as unknown as { processQueue: () => void }, 'processQueue');
    const job = await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
    });

    jest.advanceTimersByTime(1000);
    jest.advanceTimersByTime(5000);
    proc.emit('exit', null);

    expect(job.finalized).toBe(true);

    // Once from submit, once from single guarded completion.
    expect(processQueueSpy).toHaveBeenCalledTimes(2);
  });
});

describe('JobScheduler instance allocation and live progress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSpawn.mockReturnValue(new MockProcess());
  });

  afterEach(() => {
    cleanupResultsDirs();
  });

  test('allocates after existing result directories and persists monotonic next id', async () => {
    const resultsDir = createResultsDir();
    fs.mkdirSync(`${resultsDir}/kaseki-12`);

    const scheduler = new JobScheduler(
      {
        port: 8080,
        apiKeys: ['test-key'],
        resultsDir,
        maxConcurrentRuns: 1,
        defaultTaskMode: 'patch',
        maxDiffBytes: 200000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    const first = await scheduler.submitJob({ repoUrl: 'https://github.com/org/repo', ref: 'main' });
    const second = await scheduler.submitJob({ repoUrl: 'https://github.com/org/repo', ref: 'main' });

    expect(first.id).toBe('kaseki-13');
    expect(second.id).toBe('kaseki-14');
    expect(fs.readFileSync(`${resultsDir}/.kaseki-api-next-id`, 'utf-8').trim()).toBe('15');

    scheduler.shutdown();
  });

  test('parses live docker progress lines', async () => {
    mockSpawnSync.mockReturnValue({
      stdout: '[progress] clone repository info: started\n[progress] pi coding agent: working; events=42\n',
      stderr: '',
      status: 0,
    });

    const scheduler = new JobScheduler(
      {
        port: 8080,
        apiKeys: ['test-key'],
        resultsDir: createResultsDir(),
        maxConcurrentRuns: 1,
        defaultTaskMode: 'patch',
        maxDiffBytes: 200000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    expect(scheduler.getLiveProgressEvents('kaseki-7', 1)).toEqual([
      {
        source: 'docker-logs',
        stage: 'pi coding agent',
        message: 'working; events=42',
      },
    ]);
  });
});

describe('JobScheduler shutdown lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
    cleanupResultsDirs();
  });

  test('shutdown terminates running children and marks jobs as shutdown-aborted', async () => {
    const proc = new MockProcess();
    mockSpawn.mockReturnValue(proc);
    mockSpawnSync.mockReturnValue({ stdout: '', stderr: '', status: 0 });

    const scheduler = new JobScheduler(
      {
        port: 8080,
        apiKeys: ['test-key'],
        resultsDir: createResultsDir(),
        maxConcurrentRuns: 1,
        defaultTaskMode: 'patch',
        maxDiffBytes: 200000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    const job = await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
    });

    scheduler.shutdown();

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(job.status).toBe('failed');
    expect(job.failureClass).toBe('shutdown_aborted');
    expect(job.error).toBe('Job aborted during scheduler shutdown');
    expect(job.exitCode).toBe(143);
    expect(job.finalized).toBe(true);

    jest.advanceTimersByTime(5000);
    expect(proc.kill).toHaveBeenCalledTimes(1);
  });

  test('shutdown does not escalate if child exits during grace period', async () => {
    const proc = new MockProcess();
    mockSpawn.mockReturnValue(proc);
    mockSpawnSync.mockReturnValue({ stdout: '', stderr: '', status: 0 });

    const scheduler = new JobScheduler(
      {
        port: 8080,
        apiKeys: ['test-key'],
        resultsDir: createResultsDir(),
        maxConcurrentRuns: 1,
        defaultTaskMode: 'patch',
        maxDiffBytes: 200000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
    });

    scheduler.shutdown();
    proc.emit('exit', 0);

    jest.advanceTimersByTime(5000);

    expect(proc.kill).toHaveBeenCalledTimes(1);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });
});

describe('JobScheduler persistence merge safety', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSpawn.mockReturnValue(new MockProcess());
    mockSpawnSync.mockReturnValue({ stdout: '', stderr: '', status: 0 });
  });

  afterEach(() => {
    cleanupResultsDirs();
  });

  
  test('persistJobs skips writes when index lock is already held', async () => {
    const resultsDir = createResultsDir();
    const config = {
      port: 8080,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 0,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 200000,
      agentTimeoutSeconds: 30,
      logLevel: 'info' as const,
    };

    const scheduler = new JobScheduler(config, createMockWebhookManager());
    await scheduler.submitJob({ repoUrl: 'https://github.com/org/repo', ref: 'main' });
    const indexPath = `${resultsDir}/.kaseki-api-jobs.json`;
    const before = fs.readFileSync(indexPath, 'utf-8');

    fs.mkdirSync(`${resultsDir}/.kaseki-api-jobs.lock`, { mode: 0o700 });
    await scheduler.submitJob({ repoUrl: 'https://github.com/org/repo', ref: 'feature/locked' });
    (scheduler as unknown as { persistJobs: () => void }).persistJobs();

    const after = fs.readFileSync(indexPath, 'utf-8');
    expect(after).toBe(before);
  });

  test('loadPersistedJobs does not read index when lock is already held', async () => {
    const resultsDir = createResultsDir();
    const indexPath = `${resultsDir}/.kaseki-api-jobs.json`;
    fs.writeFileSync(
      indexPath,
      `${JSON.stringify({ version: 1, updatedAt: '2026-05-04T00:00:00.000Z', jobs: [{ id: 'kaseki-1', status: 'queued', request: { repoUrl: 'https://github.com/org/repo', ref: 'main' }, createdAt: '2026-05-04T00:00:00.000Z', resultDir: `${resultsDir}/kaseki-1`, correlationId: 'c1', requestId: 'r1' }] }, null, 2)}
`,
      'utf-8'
    );
    fs.mkdirSync(`${resultsDir}/.kaseki-api-jobs.lock`, { mode: 0o700 });

    const scheduler = new JobScheduler(
      {
        port: 8080,
        apiKeys: ['test-key'],
        resultsDir,
        maxConcurrentRuns: 0,
        defaultTaskMode: 'patch',
        maxDiffBytes: 200000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    expect(scheduler.getJob('kaseki-1')).toBeUndefined();
  });
test('interleaved persist writes do not regress newer job state', async () => {
    const resultsDir = createResultsDir();
    const config = {
      port: 8080,
      apiKeys: ['test-key'],
      resultsDir,
      maxConcurrentRuns: 0,
      defaultTaskMode: 'patch' as const,
      maxDiffBytes: 200000,
      agentTimeoutSeconds: 30,
      logLevel: 'info' as const,
    };

    const schedulerA = new JobScheduler(config, createMockWebhookManager());
    const first = await schedulerA.submitJob({ repoUrl: 'https://github.com/org/repo', ref: 'main' });

    const schedulerB = new JobScheduler(config, createMockWebhookManager());
    const staleCopy = schedulerB.getJob(first.id);
    expect(staleCopy?.status).toBe('queued');

    const firstFromA = schedulerA.getJob(first.id);
    expect(firstFromA).toBeDefined();
    if (!firstFromA) {
      throw new Error('Expected first job from scheduler A');
    }
    firstFromA.status = 'completed';
    firstFromA.exitCode = 0;
    firstFromA.completedAt = new Date('2026-05-04T00:00:01.000Z');
    (schedulerA as unknown as { persistJobs: () => void }).persistJobs();

    await schedulerB.submitJob({ repoUrl: 'https://github.com/org/repo', ref: 'feature/branch' });
    (schedulerB as unknown as { persistJobs: () => void }).persistJobs();

    const raw = JSON.parse(fs.readFileSync(`${resultsDir}/.kaseki-api-jobs.json`, 'utf-8')) as {
      jobs: Array<{ id: string; status: string; completedAt?: string; exitCode?: number }>;
    };
    const mergedFirst = raw.jobs.find((job) => job.id === first.id);
    expect(mergedFirst?.status).toBe('completed');
    expect(mergedFirst?.exitCode).toBe(0);
    expect(mergedFirst?.completedAt).toBe('2026-05-04T00:00:01.000Z');
  });
});
