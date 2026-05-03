// fallow-ignore-next-line unused-files
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

  test('timeout followed by quick exit sets timeout failure on exit', () => {
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

    const job = scheduler.submitJob({
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

  test('passes parent results directory as host log directory', () => {
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

    const job = scheduler.submitJob({
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

  test('timeout escalates to SIGKILL when process hangs', () => {
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

    scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
    });

    jest.advanceTimersByTime(1000);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    jest.advanceTimersByTime(5000);
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  test('timeout path does not double-finalize when kill then exit race', () => {
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
    const job = scheduler.submitJob({
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

  test('allocates after existing result directories and persists monotonic next id', () => {
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

    const first = scheduler.submitJob({ repoUrl: 'https://github.com/org/repo', ref: 'main' });
    const second = scheduler.submitJob({ repoUrl: 'https://github.com/org/repo', ref: 'main' });

    expect(first.id).toBe('kaseki-13');
    expect(second.id).toBe('kaseki-14');
    expect(fs.readFileSync(`${resultsDir}/.kaseki-api-next-id`, 'utf-8').trim()).toBe('15');

    scheduler.shutdown();
  });

  test('parses live docker progress lines', () => {
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

  test('shutdown terminates running children and marks jobs as shutdown-aborted', () => {
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

    const job = scheduler.submitJob({
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

  test('shutdown does not escalate if child exits during grace period', () => {
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

    scheduler.submitJob({
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
