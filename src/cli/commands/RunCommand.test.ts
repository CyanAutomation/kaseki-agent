import { RunCommand, type RunApiClient } from './RunCommand';
import { ConfigManager } from '../../config/ConfigManager';
import type { RunRequest, RunResponse } from '../../kaseki-api-types';
import {
  clearEnv,
  INLINE_SECRET_ENV_VARS,
  restoreEnv,
  snapshotEnv,
} from '../../__test-utils/env';

describe('RunCommand', () => {
  let configManager: ConfigManager;
  let consoleLog: jest.SpyInstance;
  let consoleError: jest.SpyInstance;
  const runCommandEnvVars = [
    'KASEKI_API_KEY',
    'KASEKI_API_KEYS',
    'KASEKI_API_BASE_URL',
    'KASEKI_API_URL',
    'KASEKI_DRY_RUN',
    'KASEKI_AGENT_TIMEOUT_SECONDS',
    'KASEKI_VALIDATION_COMMANDS',
    ...INLINE_SECRET_ENV_VARS,
  ] as const;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = snapshotEnv(runCommandEnvVars);
    clearEnv(runCommandEnvVars);

    configManager = new ConfigManager();
    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleLog.mockRestore();
    consoleError.mockRestore();
    restoreEnv(originalEnv);
    jest.restoreAllMocks();
  });

  test('translates CLI args into a RunRequest and submits it to the local API client', async () => {
    process.env.KASEKI_AGENT_TIMEOUT_SECONDS = '10800';
    const createRun = jest.fn<Promise<RunResponse>, [RunRequest]>().mockResolvedValue({
      id: 'kaseki-123',
      status: 'queued',
      createdAt: '2026-05-14T00:00:00.000Z',
    });
    const apiClient: RunApiClient = {
      baseUrl: 'http://localhost:8080/api',
      createRun,
      getRunStatusUrl: (runId) => `http://localhost:8080/api/runs/${runId}/status`,
    };
    const command = new RunCommand(configManager, () => apiClient);

    const exitCode = await command.execute([
      'https://github.com/org/repo',
      'feature/test',
      'Implement the requested API refactor',
    ]);

    expect(exitCode).toBe(0);
    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({
      repoUrl: 'https://github.com/org/repo',
      ref: 'feature/test',
      taskPrompt: 'Implement the requested API refactor',
      changedFilesAllowlist: ['src/lib/parser.ts', 'tests/parser.validation.ts'],
      validationCommands: ['npm run check', 'npm run test', 'npm run build'],
      maxDiffBytes: 400000,
      taskMode: 'patch',
      publishMode: 'auto',
      timeoutSeconds: 10800,
    }));
    expect(consoleLog).toHaveBeenCalledWith('Job ID: kaseki-123');
    expect(consoleLog).toHaveBeenCalledWith('Status URL: http://localhost:8080/api/runs/kaseki-123/status');
    expect(consoleLog).toHaveBeenCalledWith('  kaseki-agent status kaseki-123');
  });

  test('rejects the removed direct Docker escape hatch without submitting to the API', async () => {
    const createRun = jest.fn<Promise<RunResponse>, [RunRequest]>();
    const apiClient: RunApiClient = {
      baseUrl: 'http://localhost:8080/api',
      createRun,
      getRunStatusUrl: (runId) => `http://localhost:8080/api/runs/${runId}/status`,
    };
    const command = new RunCommand(configManager, () => apiClient);

    const exitCode = await command.execute(['--local-direct', 'https://github.com/org/repo', 'main']);

    expect(exitCode).toBe(1);
    expect(createRun).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('--local-direct is no longer supported'));
  });

  test('maps KASEKI_DRY_RUN into an API startup check request', async () => {
    process.env.KASEKI_DRY_RUN = '1';
    const createRun = jest.fn<Promise<RunResponse>, [RunRequest]>().mockResolvedValue({
      id: 'kaseki-124',
      status: 'queued',
      createdAt: '2026-05-14T00:00:00.000Z',
    });
    const apiClient: RunApiClient = {
      baseUrl: 'http://localhost:8080/api',
      createRun,
      getRunStatusUrl: (runId) => `http://localhost:8080/api/runs/${runId}/status`,
    };
    const command = new RunCommand(configManager, () => apiClient);

    const exitCode = await command.execute(['https://github.com/org/repo', 'main']);

    expect(exitCode).toBe(0);
    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({
      startupCheck: true,
      startupCheckMode: 'boot',
      taskMode: 'inspect',
      publishMode: 'none',
    }));
  });
});
