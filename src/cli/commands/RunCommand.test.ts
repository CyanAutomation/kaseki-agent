import { RunCommand, type RunApiClient } from './RunCommand';
import { ConfigManager } from '../../config/ConfigManager';
import type { RunRequest, RunResponse } from '../../kaseki-api-types';

describe('RunCommand', () => {
  let configManager: ConfigManager;
  let consoleLog: jest.SpyInstance;
  let consoleError: jest.SpyInstance;
  const originalApiKey = process.env.KASEKI_API_KEY;
  const originalApiKeys = process.env.KASEKI_API_KEYS;
  const originalApiBaseUrl = process.env.KASEKI_API_BASE_URL;
  const originalApiUrl = process.env.KASEKI_API_URL;

  beforeEach(() => {
    delete process.env.KASEKI_API_KEY;
    delete process.env.KASEKI_API_KEYS;
    delete process.env.KASEKI_API_BASE_URL;
    delete process.env.KASEKI_API_URL;

    configManager = new ConfigManager();
    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleLog.mockRestore();
    consoleError.mockRestore();
    if (originalApiKey === undefined) delete process.env.KASEKI_API_KEY;
    else process.env.KASEKI_API_KEY = originalApiKey;
    if (originalApiKeys === undefined) delete process.env.KASEKI_API_KEYS;
    else process.env.KASEKI_API_KEYS = originalApiKeys;
    if (originalApiBaseUrl === undefined) delete process.env.KASEKI_API_BASE_URL;
    else process.env.KASEKI_API_BASE_URL = originalApiBaseUrl;
    if (originalApiUrl === undefined) delete process.env.KASEKI_API_URL;
    else process.env.KASEKI_API_URL = originalApiUrl;
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
});
