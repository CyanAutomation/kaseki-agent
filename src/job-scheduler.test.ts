import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { JobScheduler } from './job-scheduler';
import { WebhookManager } from './webhook-manager';
import { secretValueCache } from './secret-value-cache';
import * as hostSecretsReader from './secrets/host-secrets-reader';

// Mock the host-secrets-reader module
jest.mock('./secrets/host-secrets-reader', () => ({
  readHostSecret: jest.fn(),
  getSecretLocations: jest.fn((name) => ({
    primary: `/agents/secrets/${name}`,
  })),
  getSecretFilePath: jest.fn((name) => `/agents/secrets/${name}`),
  clearSecretCache: jest.fn(),
}));

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
  stdout = new EventEmitter();
  stderr = new EventEmitter();
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

type TestPersistedStatus = 'queued' | 'running' | 'completed' | 'failed';

function persistedRuntimeJob(resultsDir: string, id: string, status: TestPersistedStatus, createdAt: string): unknown {
  const completedAt = status === 'completed' || status === 'failed' ? new Date(createdAt) : undefined;
  return {
    id,
    status,
    request: { repoUrl: 'https://github.com/org/repo', ref: 'main' },
    createdAt: new Date(createdAt),
    completedAt,
    resultDir: path.join(resultsDir, id),
    correlationId: `${id}-correlation`,
    requestId: `${id}-request`,
    finalized: status === 'completed' || status === 'failed',
  };
}

describe('JobScheduler timeout lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    secretValueCache.clear();
  });

  afterEach(() => {
    secretValueCache.clear();
    delete process.env.KASEKI_LIVE_PROGRESS_CACHE_TTL_MS;
    delete process.env.GITHUB_APP_ID_FILE;
    delete process.env.GITHUB_APP_CLIENT_ID_FILE;
    delete process.env.GITHUB_APP_PRIVATE_KEY_FILE;
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

        maxConcurrentRuns: 2,
        defaultTaskMode: 'patch',
        maxDiffBytes: 400000,
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
    const runDir = `${scheduler['config'].resultsDir}/${job.id}`;
    expect(fs.readFileSync(`${runDir}/analysis.md`, 'utf-8').trim().length).toBeGreaterThan(0);
    expect(fs.readFileSync(`${runDir}/metadata.json`, 'utf-8').trim().length).toBeGreaterThan(0);
    expect(fs.readFileSync(`${runDir}/stderr.log`, 'utf-8').trim().length).toBeGreaterThan(0);
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
        maxDiffBytes: 400000,
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

  test('passes GitHub App secret file paths for controller runs', async () => {
    const secretsDir = fs.mkdtempSync('/tmp/kaseki-job-secrets-test-');
    tempDirs.push(secretsDir);
    const { getSecretFilePath } = jest.mocked(hostSecretsReader);
    (getSecretFilePath as jest.Mock).mockImplementation((name: string) => path.join(secretsDir, name));

    const proc = new MockProcess();
    mockSpawn.mockReturnValue(proc);
    mockSpawnSync.mockReturnValue({ stdout: '', stderr: '', status: 0 });
    const resultsDir = createResultsDir();
    fs.writeFileSync(path.join(secretsDir, 'github_app_id'), '12345');
    fs.writeFileSync(path.join(secretsDir, 'github_app_client_id'), 'Iv123client');
    fs.writeFileSync(path.join(secretsDir, 'github_app_private_key'), 'private-key');

    try {
      const scheduler = new JobScheduler(
        {
          port: 8080,
          apiKeys: ['test-key'],
          resultsDir,
          maxConcurrentRuns: 1,
          defaultTaskMode: 'patch',
          maxDiffBytes: 400000,
          agentTimeoutSeconds: 30,
          logLevel: 'info',
        },
        createMockWebhookManager()
      );

      await scheduler.submitJob({
        repoUrl: 'https://github.com/org/repo',
        ref: 'main',
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'bash',
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            GITHUB_APP_ID_FILE: path.join(secretsDir, 'github_app_id'),
            GITHUB_APP_CLIENT_ID_FILE: path.join(secretsDir, 'github_app_client_id'),
            GITHUB_APP_PRIVATE_KEY_FILE: path.join(secretsDir, 'github_app_private_key'),
          }),
        }),
      );
    } finally {
      // Cleanup handled by afterEach
    }
  });

  test('preserves explicitly configured GitHub App secret file paths for controller runs', async () => {
    process.env.GITHUB_APP_ID_FILE = '/configured/github_app_id';
    process.env.GITHUB_APP_CLIENT_ID_FILE = '/configured/github_app_client_id';
    process.env.GITHUB_APP_PRIVATE_KEY_FILE = '/configured/github_app_private_key';

    const proc = new MockProcess();
    mockSpawn.mockReturnValue(proc);
    mockSpawnSync.mockReturnValue({ stdout: '', stderr: '', status: 0 });
    const resultsDir = createResultsDir();

    try {
      const scheduler = new JobScheduler(
        {
          port: 8080,
          apiKeys: ['test-key'],
          resultsDir,
          maxConcurrentRuns: 1,
          defaultTaskMode: 'patch',
          maxDiffBytes: 400000,
          agentTimeoutSeconds: 30,
          logLevel: 'info',
        },
        createMockWebhookManager()
      );

      await scheduler.submitJob({
        repoUrl: 'https://github.com/org/repo',
        ref: 'main',
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'bash',
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            GITHUB_APP_ID_FILE: '/configured/github_app_id',
            GITHUB_APP_CLIENT_ID_FILE: '/configured/github_app_client_id',
            GITHUB_APP_PRIVATE_KEY_FILE: '/configured/github_app_private_key',
          }),
        }),
      );
    } finally {
      // Cleanup handled by afterEach
    }
  });

  test('uses configured default timeout when request timeoutSeconds is omitted', async () => {
    const proc = new MockProcess();
    mockSpawn.mockReturnValue(proc);
    mockSpawnSync.mockReturnValue({ stdout: '', stderr: '', status: 0 });

    const scheduler = new JobScheduler(
      {
        port: 8080,
        apiKeys: ['test-key'],
        resultsDir: createResultsDir(),
        maxConcurrentRuns: 2,
        defaultTaskMode: 'patch',
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 42,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    const job = await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
    });

    expect(job.effectiveTimeoutSeconds).toBe(42);
    expect(mockSpawn).toHaveBeenCalledWith(
      'bash',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          KASEKI_AGENT_TIMEOUT_SECONDS: '42',
        }),
      }),
    );
  });

  test('passes inspect mode and publish-none controls to worker environment', async () => {
    const originalAllowEmptyDiff = process.env.KASEKI_ALLOW_EMPTY_DIFF;
    process.env.KASEKI_ALLOW_EMPTY_DIFF = '0';

    const proc = new MockProcess();
    mockSpawn.mockReturnValue(proc);
    mockSpawnSync.mockReturnValue({ stdout: '', stderr: '', status: 0 });

    try {
      const scheduler = new JobScheduler(
        {
          port: 8080,
          apiKeys: ['test-key'],
          resultsDir: createResultsDir(),
          maxConcurrentRuns: 1,
          defaultTaskMode: 'patch',
          maxDiffBytes: 400000,
          agentTimeoutSeconds: 30,
          logLevel: 'info',
        },
        createMockWebhookManager()
      );

      await scheduler.submitJob({
        repoUrl: 'https://github.com/org/repo',
        ref: 'main',
        taskMode: 'inspect',
        publishMode: 'none',
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'bash',
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            KASEKI_TASK_MODE: 'inspect',
            KASEKI_PUBLISH_MODE: 'none',
            KASEKI_PRE_AGENT_VALIDATION: '0',
            KASEKI_ALLOW_EMPTY_DIFF: '1',
            KASEKI_SCOUTING: '0',
            KASEKI_GOAL_CHECK: '0',
            GITHUB_APP_ENABLED: '0',
          }),
        }),
      );
    } finally {
      if (originalAllowEmptyDiff === undefined) {
        delete process.env.KASEKI_ALLOW_EMPTY_DIFF;
      } else {
        process.env.KASEKI_ALLOW_EMPTY_DIFF = originalAllowEmptyDiff;
      }
    }
  });

  test('inspect mode always skips pre-agent validation', async () => {
    const proc = new MockProcess();
    mockSpawn.mockReturnValue(proc);
    mockSpawnSync.mockReturnValue({ stdout: '', stderr: '', status: 0 });

    const scheduler = new JobScheduler(
      {
        port: 8080,
        apiKeys: ['test-key'],
        resultsDir: createResultsDir(),
        maxConcurrentRuns: 2,
        defaultTaskMode: 'patch',
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
      taskMode: 'inspect',
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      'bash',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          KASEKI_TASK_MODE: 'inspect',
          KASEKI_PRE_AGENT_VALIDATION: '0',
          KASEKI_ALLOW_EMPTY_DIFF: '1',
        }),
      }),
    );
  });

  test('passes goal check controls to worker environment', async () => {
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
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
      goalCheck: {
        enabled: true,
        maxRetries: 2,
        model: 'openrouter/free',
        timeoutSeconds: 300,
      },
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      'bash',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          KASEKI_GOAL_CHECK: '1',
          KASEKI_GOAL_CHECK_MAX_RETRIES: '2',
          KASEKI_GOAL_CHECK_MODEL: 'openrouter/free',
          KASEKI_GOAL_CHECK_TIMEOUT_SECONDS: '300',
        }),
      }),
    );
  });

  test('uses explicit request timeoutSeconds when provided', async () => {
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
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 42,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    const job = await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
      timeoutSeconds: 90,
    });

    expect(job.effectiveTimeoutSeconds).toBe(90);
    expect(mockSpawn).toHaveBeenCalledWith(
      'bash',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          KASEKI_AGENT_TIMEOUT_SECONDS: '90',
        }),
      }),
    );
  });

  test('defaults omitted publish mode to normal PR for controller runs', async () => {
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
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      'bash',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          KASEKI_PUBLISH_MODE: 'pr',
        }),
      }),
    );
  });

  test('passes requested publish mode to controller runs', async () => {
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
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
      publishMode: 'draft_pr',
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      'bash',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          KASEKI_PUBLISH_MODE: 'draft_pr',
        }),
      }),
    );
  });

  test('passes controller-style allowlist and validation aliases to worker env', async () => {
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
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
      allowlist: { include: ['src/lib/network-safety.ts', 'src/lib/network-safety.test.ts'] },
      validation: { commands: ['npm test -- src/lib/network-safety.test.ts'] },
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      'bash',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          KASEKI_CHANGED_FILES_ALLOWLIST: 'src/lib/network-safety.ts src/lib/network-safety.test.ts',
          KASEKI_VALIDATION_COMMANDS: 'npm test -- src/lib/network-safety.test.ts',
        }),
      }),
    );
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
        maxDiffBytes: 400000,
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

  test('startup validation checks preserve request validation commands', async () => {
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
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
      startupCheck: true,
      startupCheckMode: 'baseline-validation',
      validationCommands: ['npm run lint', 'npm test'],
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      'bash',
      expect.arrayContaining(['--controller', 'run', 'https://github.com/org/repo', 'main']),
      expect.objectContaining({
        env: expect.objectContaining({
          KASEKI_DRY_RUN: '1',
          KASEKI_TASK_MODE: 'inspect',
          KASEKI_STARTUP_CHECK_MODE: 'baseline-validation',
          KASEKI_BASELINE_VALIDATION_DRY_RUN: '1',
          KASEKI_VALIDATION_COMMANDS: 'npm run lint;npm test',
        }),
      }),
    );
  });

  test('passes scouting request controls to the worker environment', async () => {
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
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
      scouting: { enabled: false, model: 'scout-model', timeoutSeconds: 120 },
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      'bash',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          KASEKI_SCOUTING: '0',
          KASEKI_SCOUTING_MODEL: 'scout-model',
          KASEKI_SCOUTING_TIMEOUT_SECONDS: '120',
        }),
      }),
    );
  });

  test('passes run evaluation request controls to the worker environment', async () => {
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
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
      publishMode: 'none',
      runEvaluation: { enabled: true, model: 'eval-model', timeoutSeconds: 180 },
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      'bash',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          KASEKI_RUN_EVALUATION: '1',
          KASEKI_RUN_EVALUATION_MODEL: 'eval-model',
          KASEKI_RUN_EVALUATION_TIMEOUT_SECONDS: '180',
        }),
      }),
    );
  });

  test('defaults run evaluation on for PR publishing and off for branch publishing', async () => {
    const proc = new MockProcess();
    mockSpawn.mockReturnValue(proc);
    mockSpawnSync.mockReturnValue({ stdout: '', stderr: '', status: 0 });

    const prScheduler = new JobScheduler(
      {
        port: 8080,
        apiKeys: ['test-key'],
        resultsDir: createResultsDir(),
        maxConcurrentRuns: 1,
        defaultTaskMode: 'patch',
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    await prScheduler.submitJob({ repoUrl: 'https://github.com/org/repo', ref: 'main', publishMode: 'draft_pr' });

    expect(mockSpawn).toHaveBeenCalledWith(
      'bash',
      expect.any(Array),
      expect.objectContaining({ env: expect.objectContaining({ KASEKI_RUN_EVALUATION: '1' }) }),
    );

    mockSpawn.mockClear();
    const branchScheduler = new JobScheduler(
      {
        port: 8080,
        apiKeys: ['test-key'],
        resultsDir: createResultsDir(),
        maxConcurrentRuns: 1,
        defaultTaskMode: 'patch',
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    await branchScheduler.submitJob({ repoUrl: 'https://github.com/org/repo', ref: 'main', publishMode: 'branch' });

    expect(mockSpawn).toHaveBeenCalledWith(
      'bash',
      expect.any(Array),
      expect.objectContaining({ env: expect.objectContaining({ KASEKI_RUN_EVALUATION: '0' }) }),
    );
  });

  test('startup validation checks can be requested by providing validation commands', async () => {
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
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
      startupCheck: true,
      validation: { commands: ['npm run check'] },
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      'bash',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          KASEKI_STARTUP_CHECK_MODE: 'baseline-validation',
          KASEKI_BASELINE_VALIDATION_DRY_RUN: '1',
          KASEKI_VALIDATION_COMMANDS: 'npm run check',
        }),
      }),
    );
  });

  test('idempotency store creates a missing results directory', () => {
    const parent = fs.mkdtempSync('/tmp/kaseki-idempotency-parent-');
    const resultsDir = path.join(parent, 'missing-results');

    try {
      const { IdempotencyStore } = jest.requireActual('./idempotency-store') as typeof import('./idempotency-store');
      const store = new IdempotencyStore(resultsDir, 24);
      store.shutdown();

      expect(fs.statSync(resultsDir).isDirectory()).toBe(true);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
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
        maxDiffBytes: 400000,
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
    const analysisPath = `${resultsDir}/${job.id}/analysis.md`;
    const metadataPath = `${resultsDir}/${job.id}/metadata.json`;
    const stderrPath = `${resultsDir}/${job.id}/stderr.log`;
    expect(fs.statSync(failurePath).size).toBeGreaterThan(0);
    expect(fs.statSync(summaryPath).size).toBeGreaterThan(0);
    expect(fs.statSync(analysisPath).size).toBeGreaterThan(0);
    expect(fs.statSync(metadataPath).size).toBeGreaterThan(0);
    expect(fs.statSync(stderrPath).size).toBeGreaterThan(0);
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
        maxDiffBytes: 400000,
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
        maxDiffBytes: 400000,
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

  test('cancel immediately before process exit emits one terminal webhook', async () => {
    const proc = new MockProcess();
    mockSpawn.mockReturnValue(proc);
    mockSpawnSync.mockReturnValue({ stdout: '', stderr: '', status: 0 });
    const webhookManager = {
      enqueueWebhook: jest.fn(),
    } as unknown as WebhookManager;

    const scheduler = new JobScheduler(
      {
        port: 8080,
        apiKeys: ['test-key'],
        resultsDir: createResultsDir(),
        maxConcurrentRuns: 1,
        defaultTaskMode: 'patch',
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      webhookManager
    );

    const job = await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
      webhookConfig: { url: 'https://example.com/webhook' },
    });

    scheduler.cancelJob(job.id);
    proc.emit('exit', 0);

    expect(job.status).toBe('failed');
    expect(job.failureClass).toBe('cancelled');
    const terminalEvents = (webhookManager.enqueueWebhook as jest.Mock).mock.calls
      .map((call) => call[1].eventType)
      .filter((eventType) => ['job.completed', 'job.failed', 'job.cancelled'].includes(eventType));
    expect(terminalEvents).toEqual(['job.cancelled']);
  });

  test('cancel immediately after process exit keeps one terminal webhook', async () => {
    const proc = new MockProcess();
    mockSpawn.mockReturnValue(proc);
    mockSpawnSync.mockReturnValue({ stdout: '', stderr: '', status: 0 });
    const webhookManager = {
      enqueueWebhook: jest.fn(),
    } as unknown as WebhookManager;

    const scheduler = new JobScheduler(
      {
        port: 8080,
        apiKeys: ['test-key'],
        resultsDir: createResultsDir(),
        maxConcurrentRuns: 1,
        defaultTaskMode: 'patch',
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      webhookManager
    );

    const job = await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
      webhookConfig: { url: 'https://example.com/webhook' },
    });

    proc.emit('exit', 0);
    scheduler.cancelJob(job.id);

    expect(job.status).toBe('completed');
    const terminalEvents = (webhookManager.enqueueWebhook as jest.Mock).mock.calls
      .map((call) => call[1].eventType)
      .filter((eventType) => ['job.completed', 'job.failed', 'job.cancelled'].includes(eventType));
    expect(terminalEvents).toEqual(['job.completed']);
  });
});

describe('JobScheduler instance allocation and live progress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSpawn.mockReturnValue(new MockProcess());
  });

  afterEach(() => {
    secretValueCache.clear();
    delete process.env.KASEKI_LIVE_PROGRESS_CACHE_TTL_MS;
    cleanupResultsDirs();
  });

  test('run timeout timers do not keep the event loop alive', async () => {
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
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    const job = await scheduler.submitJob({ repoUrl: 'https://github.com/org/repo', ref: 'main' });

    expect(job.timeout?.hasRef()).toBe(false);

    scheduler.shutdown();
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
        maxDiffBytes: 400000,
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
      stdout: '[progress] clone repository info: started\n[progress] pi agent: working; events=42\n',
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
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    expect(scheduler.getLiveProgressEvents('kaseki-7', 1)).toEqual([
      expect.objectContaining({
        source: 'docker-logs',
        stage: 'pi agent',
        message: 'working; events=42',
      }),
    ]);
  });

  test('reuses fresh live docker progress cache entries', async () => {
    mockSpawnSync.mockReset();
    process.env.KASEKI_LIVE_PROGRESS_CACHE_TTL_MS = '2000';
    mockSpawnSync.mockReturnValue({
      stdout: '[progress] clone repository info: started\n',
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
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    const first = scheduler.getLiveProgressEvents('kaseki-7', 25);
    const second = scheduler.getLiveProgressEvents('kaseki-7', 25);

    expect(first).toEqual([
      expect.objectContaining({
        stage: 'clone repository info',
        message: 'started',
      }),
    ]);
    expect(second).toEqual(first);
    expect(mockSpawnSync).toHaveBeenCalledTimes(1);
    expect(mockSpawnSync).toHaveBeenCalledWith('docker', ['logs', '--tail', '200', 'kaseki-7'], expect.any(Object));
    delete process.env.KASEKI_LIVE_PROGRESS_CACHE_TTL_MS;
  });

  test('refreshes live docker progress cache entries after TTL expiry', async () => {
    mockSpawnSync.mockReset();
    process.env.KASEKI_LIVE_PROGRESS_CACHE_TTL_MS = '0';
    mockSpawnSync
      .mockReturnValueOnce({
        stdout: '[progress] clone repository info: started\n',
        stderr: '',
        status: 0,
      })
      .mockReturnValueOnce({
        stdout: '[progress] pi agent: refreshed\n',
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
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    expect(scheduler.getLiveProgressEvents('kaseki-7', 25)).toEqual([
      expect.objectContaining({
        stage: 'clone repository info',
        message: 'started',
      }),
    ]);

    expect(scheduler.getLiveProgressEvents('kaseki-7', 25)).toEqual([
      expect.objectContaining({
        stage: 'pi agent',
        message: 'refreshed',
      }),
    ]);
    expect(mockSpawnSync).toHaveBeenCalledTimes(2);
    delete process.env.KASEKI_LIVE_PROGRESS_CACHE_TTL_MS;
  });

  test('returns no live progress events immediately after transition to terminal state', async () => {
    mockSpawnSync.mockReset();
    process.env.KASEKI_LIVE_PROGRESS_CACHE_TTL_MS = '2000';
    const proc = new MockProcess();
    mockSpawn.mockReturnValue(proc);
    mockSpawnSync.mockImplementation((command: string, args: string[]) => {
      if (command === 'docker' && args[0] === 'logs') {
        return { stdout: '[progress] clone repository info: started\n', stderr: '', status: 0 };
      }
      return { stdout: '', stderr: '', status: 0 };
    });

    const scheduler = new JobScheduler(
      {
        port: 8080,
        apiKeys: ['test-key'],
        resultsDir: createResultsDir(),
        maxConcurrentRuns: 1,
        defaultTaskMode: 'patch',
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );
    const job = await scheduler.submitJob({ repoUrl: 'https://github.com/org/repo', ref: 'main' });

    expect(scheduler.getLiveProgressEvents(job.id, 25)).toEqual([
      expect.objectContaining({
        stage: 'clone repository info',
        message: 'started',
      }),
    ]);

    scheduler.cancelJob(job.id);

    expect(scheduler.getLiveProgressEvents(job.id, 25)).toEqual([]);
    expect(mockSpawnSync.mock.calls.filter((call) => call[1]?.[0] === 'logs')).toHaveLength(1);
    delete process.env.KASEKI_LIVE_PROGRESS_CACHE_TTL_MS;
  });

  test('invalidates live progress cache at job start', async () => {
    mockSpawnSync.mockReset();
    process.env.KASEKI_LIVE_PROGRESS_CACHE_TTL_MS = '2000';
    const proc = new MockProcess();
    mockSpawn.mockReturnValue(proc);
    mockSpawnSync.mockImplementation((command: string, args: string[]) => {
      if (command === 'docker' && args[0] === 'logs') {
        return {
          stdout: mockSpawnSync.mock.calls.filter((call) => call[1]?.[0] === 'logs').length === 1
            ? '[progress] queued job: cached-before-start\n'
            : '[progress] running job: fresh-after-start\n',
          stderr: '',
          status: 0,
        };
      }
      return { stdout: '', stderr: '', status: 0 };
    });

    const scheduler = new JobScheduler(
      {
        port: 8080,
        apiKeys: ['test-key'],
        resultsDir: createResultsDir(),
        maxConcurrentRuns: 1,
        defaultTaskMode: 'patch',
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    const id = 'kaseki-1';
    expect(scheduler.getLiveProgressEvents(id, 25)).toEqual([
      expect.objectContaining({
        stage: 'queued job',
        message: 'cached-before-start',
      }),
    ]);

    await scheduler.submitJob({ repoUrl: 'https://github.com/org/repo', ref: 'main' });

    expect(scheduler.getLiveProgressEvents(id, 25)).toEqual([
      expect.objectContaining({
        stage: 'running job',
        message: 'fresh-after-start',
      }),
    ]);
    expect(mockSpawnSync.mock.calls.filter((call) => call[1]?.[0] === 'logs')).toHaveLength(2);
    delete process.env.KASEKI_LIVE_PROGRESS_CACHE_TTL_MS;
  });
});

describe('JobScheduler shutdown lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    secretValueCache.clear();
  });

  afterEach(() => {
    secretValueCache.clear();
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
        maxDiffBytes: 400000,
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
        maxDiffBytes: 400000,
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

  test('shutdown emits failed terminal webhook for queued jobs aborted before execution', async () => {
    mockSpawn.mockReturnValue(new MockProcess());
    mockSpawnSync.mockReturnValue({ stdout: '', stderr: '', status: 0 });

    const webhookManager = createMockWebhookManager();
    const enqueueWebhookSpy = jest.spyOn(webhookManager, 'enqueueWebhook');
    const scheduler = new JobScheduler(
      {
        port: 8080,
        apiKeys: ['test-key'],
        resultsDir: createResultsDir(),
        maxConcurrentRuns: 0,
        defaultTaskMode: 'patch',
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      webhookManager
    );

    const job = await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
      webhookConfig: {
        url: 'https://example.com/webhook',
      },
    });

    expect(job.status).toBe('queued');
    expect(scheduler.getQueueStatus().pending).toBe(1);
    enqueueWebhookSpy.mockClear();

    scheduler.shutdown();
    scheduler.shutdown();

    expect(job.finalized).toBe(true);
    expect(job.status).toBe('failed');
    expect(job.failureClass).toBe('shutdown_aborted');
    expect(job.completedAt).toBeInstanceOf(Date);
    expect(scheduler.getQueueStatus().pending).toBe(0);
    expect(enqueueWebhookSpy).toHaveBeenCalledTimes(1);
    expect(enqueueWebhookSpy).toHaveBeenCalledWith(
      job.id,
      expect.objectContaining({
        eventType: 'job.failed',
        data: expect.objectContaining({
          status: 'failed',
          failureClass: 'shutdown_aborted',
        }),
      }),
      job.webhookConfig
    );
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
      maxDiffBytes: 400000,
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
        maxDiffBytes: 400000,
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
      maxDiffBytes: 400000,
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
  test('persistJobs truncates old terminal jobs and writes compact JSON at the retention limit', () => {
    const resultsDir = createResultsDir();
    const scheduler = new JobScheduler(
      {
        port: 8080,
        apiKeys: ['test-key'],
        resultsDir,
        maxConcurrentRuns: 0,
        defaultTaskMode: 'patch',
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
        jobIndexMaxEntries: 2,
      },
      createMockWebhookManager()
    );
    const jobMap = (scheduler as unknown as { jobs: Map<string, unknown> }).jobs;
    jobMap.set('kaseki-1', persistedRuntimeJob(resultsDir, 'kaseki-1', 'completed', '2026-05-01T00:00:00.000Z'));
    jobMap.set('kaseki-2', persistedRuntimeJob(resultsDir, 'kaseki-2', 'failed', '2026-05-02T00:00:00.000Z'));
    jobMap.set('kaseki-3', persistedRuntimeJob(resultsDir, 'kaseki-3', 'completed', '2026-05-03T00:00:00.000Z'));
    (scheduler as unknown as { persistJobs: () => void }).persistJobs();

    const rawIndex = fs.readFileSync(`${resultsDir}/.kaseki-api-jobs.json`, 'utf-8');
    const parsed = JSON.parse(rawIndex) as { jobs: Array<{ id: string }> };
    expect(parsed.jobs.map((job) => job.id)).toEqual(['kaseki-3', 'kaseki-2']);
    expect(rawIndex).not.toContain('\n  "');
  });

});

describe('JobScheduler artifact cache invalidation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    secretValueCache.clear();
  });

  afterEach(() => {
    secretValueCache.clear();
    cleanupResultsDirs();
  });

  test('clears artifact content cache when queued jobs are cancelled', async () => {
    const resultsDir = createResultsDir();
    const artifactCache = { clearForJob: jest.fn() };
    const scheduler = new JobScheduler(
      {
        port: 8080,
        apiKeys: ['test-key'],
        resultsDir,
        maxConcurrentRuns: 0,
        defaultTaskMode: 'patch',
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 1,
        logLevel: 'info',
      },
      createMockWebhookManager(),
      artifactCache
    );

    const job = await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
    });

    scheduler.cancelJob(job.id);

    expect(artifactCache.clearForJob).toHaveBeenCalledWith(job.id);
  });
});

describe('JobScheduler readiness repair', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    secretValueCache.clear();
  });

  afterEach(() => {
    secretValueCache.clear();
    cleanupResultsDirs();
  });

  test('recreates a missing results directory during readiness checks', () => {
    const parent = createResultsDir();
    const resultsDir = path.join(parent, 'nested-results');
    const scheduler = new JobScheduler(
      {
        port: 8080,
        apiKeys: ['test-key'],
        resultsDir,
        maxConcurrentRuns: 1,
        defaultTaskMode: 'patch',
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    fs.rmSync(resultsDir, { recursive: true, force: true });

    expect(scheduler.getReadiness()).toEqual({ ready: true, reasons: [] });
    expect(fs.statSync(resultsDir).isDirectory()).toBe(true);
  });
});

describe('JobScheduler attachProcessListeners - stderr/stdout separation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    secretValueCache.clear();
  });

  afterEach(() => {
    secretValueCache.clear();
    delete process.env.KASEKI_LIVE_PROGRESS_CACHE_TTL_MS;
    jest.useRealTimers();
    cleanupResultsDirs();
  });

  test('simultaneous stdout and stderr events are processed without mixing buffers', async () => {
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
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    const job = await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
    });

    expect(job.status).toBe('running');

    // Emit stdout data
    if (proc.stdout) {
      proc.stdout.emit('data', 'STDOUT_CONTENT_1\n');
    }
    // Emit stderr data
    if (proc.stderr) {
      proc.stderr.emit('data', 'STDERR_CONTENT_1\n');
    }
    // Emit more stdout
    if (proc.stdout) {
      proc.stdout.emit('data', 'STDOUT_CONTENT_2\n');
    }

    // Emit exit to complete the process
    proc.emit('exit', 0);

    expect(job.status).toBe('completed');
    expect(job.exitCode).toBe(0);
  });

  test('interleaved stdout and stderr events are processed separately', async () => {
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
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    const job = await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
    });

    // Emit interleaved data: stdout -> stderr -> stdout -> stderr
    if (proc.stdout) {
      proc.stdout.emit('data', 'OUT1');
    }
    if (proc.stderr) {
      proc.stderr.emit('data', 'ERR1');
    }
    if (proc.stdout) {
      proc.stdout.emit('data', 'OUT2');
    }
    if (proc.stderr) {
      proc.stderr.emit('data', 'ERR2');
    }
    if (proc.stdout) {
      proc.stdout.emit('data', 'OUT3');
    }

    proc.emit('exit', 0);

    expect(job.status).toBe('completed');
  });

  test('large stdout and stderr data each apply bounded tail limit independently', async () => {
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
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    const job = await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
    });

    // Emit large stdout data (100 KB - exceeds 64 KB default tail limit)
    const largeStdout = Buffer.alloc(102400, 'A');
    const largeStderr = Buffer.alloc(102400, 'B');

    if (proc.stdout) {
      proc.stdout.emit('data', largeStdout);
    }
    if (proc.stderr) {
      proc.stderr.emit('data', largeStderr);
    }

    proc.emit('exit', 0);

    expect(job.status).toBe('completed');
  });

  test('process timeout failure with stdout and stderr creates failure artifacts with separate buffers', async () => {
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
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 1,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    const job = await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
    });

    // Emit data to both streams before timeout
    if (proc.stdout) {
      proc.stdout.emit('data', Buffer.from('stdout content before timeout'));
    }
    if (proc.stderr) {
      proc.stderr.emit('data', Buffer.from('stderr content before timeout'));
    }

    // Trigger timeout
    jest.advanceTimersByTime(1000);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    // Process exits after timeout
    proc.emit('exit', 0);

    expect(job.status).toBe('failed');
    expect(job.failureClass).toBe('timeout');
    expect(job.exitCode).toBe(124);

    // Verify failure artifacts were created
    const stderrLogPath = path.join(scheduler['config'].resultsDir, job.id, 'stderr.log');
    expect(fs.existsSync(stderrLogPath)).toBe(true);
  });

  test('stdout and stderr buffers remain separate across many alternating events', async () => {
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
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 30,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    const job = await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
    });

    // Emit many alternating events
    for (let i = 0; i < 50; i++) {
      if (proc.stdout) {
        proc.stdout.emit('data', Buffer.from(`stdout line ${i}\n`));
      }
      if (proc.stderr) {
        proc.stderr.emit('data', Buffer.from(`stderr line ${i}\n`));
      }
    }

    proc.emit('exit', 0);

    expect(job.status).toBe('completed');
  });

  test('process failure with only stderr data creates artifacts correctly', async () => {
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
        maxDiffBytes: 400000,
        agentTimeoutSeconds: 1,
        logLevel: 'info',
      },
      createMockWebhookManager()
    );

    const job = await scheduler.submitJob({
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
    });

    // Emit only stderr data
    if (proc.stderr) {
      proc.stderr.emit('data', Buffer.from('error output'));
    }

    // Trigger timeout to create failure artifacts
    jest.advanceTimersByTime(1000);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    // Process exits
    proc.emit('exit', 0);

    expect(job.status).toBe('failed');
    expect(job.failureClass).toBe('timeout');

    // Verify failure artifacts exist
    const stderrLogPath = path.join(scheduler['config'].resultsDir, job.id, 'stderr.log');
    expect(fs.existsSync(stderrLogPath)).toBe(true);
  });
});
