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

  function commandWith(getRunStatus: StatusApiClient['getRunStatus']): StatusCommand {
    return new StatusCommand(configManager, () => ({
      baseUrl: 'http://localhost:8080/api',
      getRunStatus,
    }));
  }

  test('polls run status through the local API client', async () => {
    const getRunStatus = jest.fn<Promise<StatusResponse>, [string]>().mockResolvedValue({
      id: 'kaseki-123',
      status: 'running',
      elapsedSeconds: 5,
    });
    const command = commandWith(getRunStatus);

    const exitCode = await command.execute(['kaseki-123']);

    expect(exitCode).toBe(0);
    expect(getRunStatus).toHaveBeenCalledWith('kaseki-123');
    expect(consoleLog).toHaveBeenCalledWith('Status for kaseki-123 (via http://localhost:8080/api)');
  });

  test('returns an error when the status run is not found', async () => {
    const getRunStatus = jest.fn<Promise<StatusResponse>, [string]>()
      .mockRejectedValue(new Error('Failed to fetch run status from local Kaseki API: Run not found'));
    const command = commandWith(getRunStatus);

    const exitCode = await command.execute(['missing-run']);

    expect(exitCode).toBe(1);
    expect(getRunStatus).toHaveBeenCalledWith('missing-run');
    expect(consoleError).toHaveBeenCalledWith(
      '❌ Unable to fetch run status from local Kaseki API: Failed to fetch run status from local Kaseki API: Run not found'
    );
  });

  test('returns an error when the local API is unavailable during status polling', async () => {
    const getRunStatus = jest.fn<Promise<StatusResponse>, [string]>()
      .mockRejectedValue(new Error('Failed to fetch run status from local Kaseki API: fetch failed'));
    const command = commandWith(getRunStatus);

    const exitCode = await command.execute(['kaseki-123']);

    expect(exitCode).toBe(1);
    expect(getRunStatus).toHaveBeenCalledWith('kaseki-123');
    expect(consoleError).toHaveBeenCalledWith(
      '❌ Unable to fetch run status from local Kaseki API: Failed to fetch run status from local Kaseki API: fetch failed'
    );
  });

  test('prints usage when run id is missing', async () => {
    const command = commandWith(jest.fn());

    const exitCode = await command.execute([]);

    expect(exitCode).toBe(1);
    expect(consoleError).toHaveBeenCalledWith('Usage: kaseki-agent status <RUN_ID> [--json]');
  });
});
