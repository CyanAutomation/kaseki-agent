import { describe, expect, it, jest } from '@jest/globals';
import { ConfigManager } from '../../config/ConfigManager';
import { StatusCommand, type StatusApiClient } from './StatusCommand';

const status = {
  id: 'run-1',
  status: 'completed',
  progress: { stage: 'validation', percentComplete: 100, message: 'done' },
  elapsedSeconds: 12,
  timeoutRiskPercent: 0,
  exitCode: 0,
};

describe('StatusCommand', () => {
  it('returns a usage error when the run id is missing', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const command = new StatusCommand(new ConfigManager(), () => ({
      baseUrl: 'http://api',
      getRunStatus: jest.fn(),
    }));

    await expect(command.execute([])).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith('Usage: kaseki-agent status <RUN_ID> [--json]');
    error.mockRestore();
  });

  it('prints valid JSON and maps a successful exit code', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const client: StatusApiClient = { baseUrl: 'http://api', getRunStatus: jest.fn().mockResolvedValue(status) };
    const command = new StatusCommand(new ConfigManager(), () => client);

    await expect(command.execute(['run-1', '--json'])).resolves.toBe(0);
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ id: 'run-1', status: 'completed' });
    log.mockRestore();
  });

  it('maps failed API status and renders the human-readable fields', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const client: StatusApiClient = {
      baseUrl: 'http://api',
      getRunStatus: jest.fn().mockResolvedValue({ ...status, status: 'failed', exitCode: 7, error: 'validation failed' }),
    };
    const command = new StatusCommand(new ConfigManager(), () => client);

    await expect(command.execute(['run-1'])).resolves.toBe(1);
    expect(log.mock.calls.flat().join('\n')).toContain('validation failed');
    log.mockRestore();
  });
});
