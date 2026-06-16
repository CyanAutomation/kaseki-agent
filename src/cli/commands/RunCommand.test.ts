import { RunCommand, type RunApiClient } from './RunCommand';
import { ConfigManager } from '../../config/ConfigManager';
import type { RunRequest, RunResponse } from '../../kaseki-api-types';
import {
  clearEnv,
  INLINE_SECRET_ENV_VARS,
  restoreEnv,
  snapshotEnv,
} from '../../__test-utils/env';

/**
 * RunCommand Tests
 *
 * Validates the CLI run command that submits tasks to the kaseki-agent API.
 * Tests cover:
 * - Translating CLI arguments into RunRequest payload
 * - Error handling for deprecated flags
 * - Feature flag handling (KASEKI_DRY_RUN, etc.)
 * - Output formatting and user feedback
 */
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

  /**
   * Helper: Set up clean environment for each test
   * Captures current env vars, clears them, mocks console output
   */
  function setupTestEnvironment(): void {
    originalEnv = snapshotEnv(runCommandEnvVars);
    clearEnv(runCommandEnvVars);

    configManager = new ConfigManager();
    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  }

  /**
   * Helper: Clean up environment after test
   * Restores env vars and console mocks
   */
  function cleanupTestEnvironment(): void {
    consoleLog.mockRestore();
    consoleError.mockRestore();
    restoreEnv(originalEnv);
    jest.restoreAllMocks();
  }

  beforeEach(() => {
    setupTestEnvironment();
  });

  afterEach(() => {
    cleanupTestEnvironment();
  });

  test('should translate CLI args (repo, ref, prompt) into RunRequest and submit to API', async () => {
    // Spec: RunCommand constructs a RunRequest from CLI arguments
    // Expected behavior: Args → RunRequest fields, submit to API, return exit code 0
    // Config: Defaults include changedFilesAllowlist, validationCommands, maxDiffBytes, taskMode
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

  test('should reject deprecated --local-direct flag and return error', async () => {
    // Regression: GH#1234 — --local-direct was removed in 1.50.0
    // Expected behavior: Reject flag with exit code 1, don't submit to API, show helpful error
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

  test('should map KASEKI_DRY_RUN=1 to startup check request with boot mode', async () => {
    // Spec: KASEKI_DRY_RUN enables startup validation without actually running the agent
    // Expected behavior: Set startupCheck=true, startupCheckMode=boot, taskMode=inspect, publishMode=none
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
