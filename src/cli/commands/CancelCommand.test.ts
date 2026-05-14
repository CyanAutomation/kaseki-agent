import { CancelCommand, type CancelApiClient } from './CancelCommand';
import { ConfigManager } from '../../config/ConfigManager';
import type { StatusResponse } from '../../kaseki-api-types';

describe('CancelCommand', () => {
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

  test('cancels a run through the local API client', async () => {
    const cancelRun = jest.fn<Promise<StatusResponse>, [string]>().mockResolvedValue({
      id: 'kaseki-123',
      status: 'failed',
      failureClass: 'cancelled',
      error: 'Job cancelled by API request',
    });
    const apiClient: CancelApiClient = {
      baseUrl: 'http://localhost:8080/api',
      cancelRun,
    };
    const command = new CancelCommand(configManager, () => apiClient);

    const exitCode = await command.execute(['kaseki-123']);

    expect(exitCode).toBe(0);
    expect(cancelRun).toHaveBeenCalledWith('kaseki-123');
    expect(consoleLog).toHaveBeenCalledWith('🛑 Cancellation requested for kaseki-123 through http://localhost:8080/api');
  });

  test('prints usage when run id is missing', async () => {
    const apiClient: CancelApiClient = {
      baseUrl: 'http://localhost:8080/api',
      cancelRun: jest.fn(),
    };
    const command = new CancelCommand(configManager, () => apiClient);

    const exitCode = await command.execute([]);

    expect(exitCode).toBe(1);
    expect(consoleError).toHaveBeenCalledWith('Usage: kaseki-agent cancel <RUN_ID> [--json]');
  });
});
