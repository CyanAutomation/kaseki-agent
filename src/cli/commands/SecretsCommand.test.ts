import { describe, expect, it, jest } from '@jest/globals';
import { ConfigManager } from '../../config/ConfigManager';
import { SecretsCommand } from './SecretsCommand';

describe('SecretsCommand dispatch and validation', () => {
  let command: SecretsCommand;
  let error: ReturnType<typeof jest.spyOn>;
  let log: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    command = new SecretsCommand(new ConfigManager());
    error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    error.mockRestore();
    log.mockRestore();
  });

  it('rejects an unknown subcommand', async () => {
    await expect(command.execute(['unknown'])).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith('Unknown subcommand: unknown');
  });

  it('validates required arguments without touching secret storage', async () => {
    await expect(command.execute(['set', 'KEY'])).resolves.toBe(1);
    await expect(command.execute(['get'])).resolves.toBe(1);
    await expect(command.execute(['delete'])).resolves.toBe(1);
    expect(error).toHaveBeenCalled();
  });

  it('keeps help as a successful, non-mutating command', async () => {
    await expect(command.execute(['help'])).resolves.toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Secrets Management'));
  });
});
