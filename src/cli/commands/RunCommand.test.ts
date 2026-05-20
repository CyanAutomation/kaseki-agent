import { RunCommand, type RunApiClient } from './RunCommand';
import { ConfigManager } from '../../config/ConfigManager';
import type { RunRequest, RunResponse } from '../../kaseki-api-types';

describe('RunCommand', () => {
  let configManager: ConfigManager;
  let consoleLog: jest.SpyInstance;
  let consoleError: jest.SpyInstance;
  const restoreEnvVar = (key: string, originalValue: string | undefined): void => {
    if (originalValue === undefined) {
      delete process.env[key];
      return;
    }

    process.env[key] = originalValue;
  };

  const originalApiKey = process.env.KASEKI_API_KEY;
  const originalApiKeys = process.env.KASEKI_API_KEYS;
  const originalApiBaseUrl = process.env.KASEKI_API_BASE_URL;
  const originalApiUrl = process.env.KASEKI_API_URL;
  const originalDryRun = process.env.KASEKI_DRY_RUN;
  const originalOpenRouterApiKey = process.env.OPENROUTER_API_KEY;
  const originalGitHubAppId = process.env.GITHUB_APP_ID;
  const originalGitHubAppClientId = process.env.GITHUB_APP_CLIENT_ID;
  const originalGitHubAppPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY;

  beforeEach(() => {
    delete process.env.KASEKI_API_KEY;
    delete process.env.KASEKI_API_KEYS;
    delete process.env.KASEKI_API_BASE_URL;
    delete process.env.KASEKI_API_URL;
    delete process.env.KASEKI_DRY_RUN;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_CLIENT_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;

    configManager = new ConfigManager();
    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleLog.mockRestore();
    consoleError.mockRestore();
    restoreEnvVar('KASEKI_API_KEY', originalApiKey);
    restoreEnvVar('KASEKI_API_KEYS', originalApiKeys);
    restoreEnvVar('KASEKI_API_BASE_URL', originalApiBaseUrl);
    restoreEnvVar('KASEKI_API_URL', originalApiUrl);
    restoreEnvVar('KASEKI_DRY_RUN', originalDryRun);
    restoreEnvVar('OPENROUTER_API_KEY', originalOpenRouterApiKey);
    restoreEnvVar('GITHUB_APP_ID', originalGitHubAppId);
    restoreEnvVar('GITHUB_APP_CLIENT_ID', originalGitHubAppClientId);
    restoreEnvVar('GITHUB_APP_PRIVATE_KEY', originalGitHubAppPrivateKey);
    jest.restoreAllMocks();
  });

  test('translates CLI args into a RunRequest and submits it to the local API client', async () => {
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
      maxDiffBytes: 200000,
      taskMode: 'patch',
      publishMode: 'auto',
      timeoutSeconds: 1200,
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
