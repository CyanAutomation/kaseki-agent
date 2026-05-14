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

  function commandWith(cancelRun: CancelApiClient['cancelRun'], commandName = 'cancel'): CancelCommand {
    return new CancelCommand(configManager, () => ({
      baseUrl: 'http://localhost:8080/api',
      cancelRun,
    }), commandName);
  }

  test('cancels a run through the local API client', async () => {
    const cancelRun = jest.fn<Promise<StatusResponse>, [string]>().mockResolvedValue({
      id: 'kaseki-123',
      status: 'failed',
      failureClass: 'cancelled',
      error: 'Job cancelled by API request',
    });
    const command = commandWith(cancelRun);

    const exitCode = await command.execute(['kaseki-123']);

    expect(exitCode).toBe(0);
    expect(cancelRun).toHaveBeenCalledWith('kaseki-123');
    expect(consoleLog).toHaveBeenCalledWith('🛑 Cancellation requested for kaseki-123 through http://localhost:8080/api');
  });

  test('returns an error when the cancel run is not found', async () => {
    const cancelRun = jest.fn<Promise<StatusResponse>, [string]>()
      .mockRejectedValue(new Error('Failed to cancel run through local Kaseki API: Run not found'));
    const command = commandWith(cancelRun);

    const exitCode = await command.execute(['missing-run']);

    expect(exitCode).toBe(1);
    expect(cancelRun).toHaveBeenCalledWith('missing-run');
    expect(consoleError).toHaveBeenCalledWith(
      '❌ Unable to cancel run through local Kaseki API: Failed to cancel run through local Kaseki API: Run not found'
    );
  });

  test('returns an error when the local API is unavailable during cancellation', async () => {
    const cancelRun = jest.fn<Promise<StatusResponse>, [string]>()
      .mockRejectedValue(new Error('Failed to cancel run through local Kaseki API: fetch failed'));
    const command = commandWith(cancelRun);

    const exitCode = await command.execute(['kaseki-123']);

    expect(exitCode).toBe(1);
    expect(cancelRun).toHaveBeenCalledWith('kaseki-123');
    expect(consoleError).toHaveBeenCalledWith(
      '❌ Unable to cancel run through local Kaseki API: Failed to cancel run through local Kaseki API: fetch failed'
    );
  });

  test('prints usage when run id is missing', async () => {
    const command = commandWith(jest.fn());

    const exitCode = await command.execute([]);

    expect(exitCode).toBe(1);
    expect(consoleError).toHaveBeenCalledWith('Usage: kaseki-agent cancel <RUN_ID> [--json]');
  });

  test('prints stop usage when invoked through the stop alias', async () => {
    const command = commandWith(jest.fn(), 'stop');

    const exitCode = await command.execute([]);

    expect(exitCode).toBe(1);
    expect(consoleError).toHaveBeenCalledWith('Usage: kaseki-agent stop <RUN_ID> [--json]');
  });
});
