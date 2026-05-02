import { EventEmitter } from 'events';
import { JobScheduler } from './job-scheduler';

const mockSpawn = jest.fn();

jest.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

class MockProcess extends EventEmitter {
  pid = 12345;
  kill = jest.fn();
}

describe('JobScheduler finalization guard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('timeout followed by exit finalizes only once', () => {
    const proc = new MockProcess();
    mockSpawn.mockReturnValue(proc);

    const scheduler = new JobScheduler({
      port: 8080,
      apiKeys: ['test-key'],
      resultsDir: '/tmp/kaseki-results',
      logDir: '/tmp/kaseki-api',
      maxConcurrentRuns: 1,
      defaultTaskMode: 'patch',
      maxDiffBytes: 200000,
      agentTimeoutSeconds: 1,
      logLevel: 'info',
    });

    const processQueueSpy = jest.spyOn(scheduler as unknown as { processQueue: () => void }, 'processQueue');

    const job = scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
    });

    expect(job.status).toBe('running');

    jest.advanceTimersByTime(1000);

    expect(job.status).toBe('failed');
    expect(job.exitCode).toBe(124);
    expect(job.error).toMatch(/Agent timeout/);
    expect(job.completedAt).toBeDefined();

    const completedAt = job.completedAt;
    const status = job.status;
    const exitCode = job.exitCode;
    const error = job.error;

    proc.emit('exit', 0);

    expect(job.status).toBe(status);
    expect(job.exitCode).toBe(exitCode);
    expect(job.error).toBe(error);
    expect(job.completedAt).toBe(completedAt);

    // Once from submit, once from single guarded completion.
    expect(processQueueSpy).toHaveBeenCalledTimes(2);
  });
});
