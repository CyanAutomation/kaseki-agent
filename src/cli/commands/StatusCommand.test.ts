import { StatusCommand, type StatusApiClient } from './StatusCommand';
import { ConfigManager } from '../../config/ConfigManager';
import type { StatusResponse } from '../../kaseki-api-types';

describe('StatusCommand', () => {
  let configManager: ConfigManager;
  let consoleLog: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    configManager = new ConfigManager();
    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleLog.mockRestore();
    consoleError.mockRestore();
    jest.restoreAllMocks();
  });

  test('polls run status through the local API client', async () => {
    const getRunStatus = jest.fn<Promise<StatusResponse>, [string]>().mockResolvedValue({
      id: 'kaseki-123',
      status: 'running',
      elapsedSeconds: 5,
    });
    const apiClient: StatusApiClient = {
      baseUrl: 'http://localhost:8080/api',
      getRunStatus,
    };
    const command = new StatusCommand(configManager, () => apiClient);

    const exitCode = await command.execute(['kaseki-123']);

    expect(exitCode).toBe(0);
    expect(getRunStatus).toHaveBeenCalledWith('kaseki-123');
    expect(consoleLog).toHaveBeenCalledWith('Status for kaseki-123 (via http://localhost:8080/api)');
  });

  test('prints usage when run id is missing', async () => {
    const apiClient: StatusApiClient = {
      baseUrl: 'http://localhost:8080/api',
      getRunStatus: jest.fn(),
    };
    const command = new StatusCommand(configManager, () => apiClient);

    const exitCode = await command.execute([]);

    expect(exitCode).toBe(1);
    expect(consoleError).toHaveBeenCalledWith('Usage: kaseki-agent status <RUN_ID> [--json]');
  });
});
