import { ListCommand, type ListApiClient } from './ListCommand';
import { ConfigManager } from '../../config/ConfigManager';
import type { RunsListResponse } from '../../kaseki-api-types';

describe('ListCommand', () => {
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

  test('lists runs from the local API and applies --status filtering to API response data', async () => {
    const listRuns = jest.fn<Promise<RunsListResponse>, []>().mockResolvedValue({
      runs: [
        {
          id: 'kaseki-running',
          status: 'running',
          createdAt: '2026-05-14T00:01:00.000Z',
        },
        {
          id: 'kaseki-done',
          status: 'completed',
          createdAt: '2026-05-14T00:00:00.000Z',
          completedAt: '2026-05-14T00:00:10.000Z',
          exitCode: 0,
        },
      ],
      total: 2,
    });
    const apiClient: ListApiClient = {
      baseUrl: 'http://localhost:8080/api',
      listRuns,
    };
    const command = new ListCommand(configManager, () => apiClient);

    const exitCode = await command.execute(['--status', 'completed']);

    expect(exitCode).toBe(0);
    expect(listRuns).toHaveBeenCalledTimes(1);
    const output = consoleLog.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('kaseki-done');
    expect(output).not.toContain('kaseki-running');
    expect(output).toContain('Total: 1 instance(s)');
  });

  test('returns a failure when the local API is unavailable', async () => {
    const apiClient: ListApiClient = {
      baseUrl: 'http://localhost:8080/api',
      listRuns: jest.fn<Promise<RunsListResponse>, []>().mockRejectedValue(new Error('connect ECONNREFUSED')),
    };
    const command = new ListCommand(configManager, () => apiClient);

    const exitCode = await command.execute([]);

    expect(exitCode).toBe(1);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Unable to list runs from local Kaseki API'));
  });
});
