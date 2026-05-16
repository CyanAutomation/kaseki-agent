import { execFileSync, execSync } from 'child_process';
import { accessSync, existsSync, readFileSync } from 'fs';
import { DoctorCommand } from './DoctorCommand';
import type { ConfigManager } from '../../config/ConfigManager';

jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
  execSync: jest.fn(),
}));

jest.mock('fs', () => ({
  constants: { R_OK: 4 },
  accessSync: jest.fn(),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

describe('DoctorCommand', () => {
  let consoleLog: jest.SpyInstance;
  let stderrWrite: jest.SpyInstance;
  let configManager: Pick<ConfigManager, 'load' | 'get'>;

  beforeEach(() => {
    jest.clearAllMocks();

    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    stderrWrite = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const getConfigValue = <T = any>(key: string, defaultValue?: T): T => {
      const values: Record<string, string> = {
        'docker.image': 'kaseki:test;touch /tmp/pwned',
        'directories.root': '/agents;touch /tmp/pwned',
        'auth.openrouter_api_key_file': '/tmp/openrouter_api_key',
        'auth.github_app_id_file': '/tmp/github_app_id',
        'auth.github_app_client_id_file': '/tmp/github_app_client_id',
        'auth.github_app_private_key_file': '/tmp/github_app_private_key',
      };
      return (values[key] ?? defaultValue ?? '') as T;
    };

    configManager = {
      load: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(getConfigValue),
    };

    (existsSync as jest.Mock).mockReturnValue(true);
    (accessSync as jest.Mock).mockReturnValue(undefined);
    (readFileSync as jest.Mock).mockReturnValue('secret\n');
    (execSync as jest.Mock).mockImplementation((command: string) => {
      if (command === 'node --version') return 'v24.0.0\n';
      if (command === 'npm --version') return '11.0.0\n';
      if (command === 'git --version') return 'git version 2.45.0\n';
      return '';
    });
    (execFileSync as jest.Mock).mockImplementation((command: string) => {
      if (command === 'df') {
        return 'Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/root 100 10 90000000000 1% /\n';
      }
      return '';
    });
  });

  afterEach(() => {
    consoleLog.mockRestore();
    stderrWrite.mockRestore();
  });

  test('keeps JSON stdout pure by suppressing child-process stderr for output commands', async () => {
    const command = new DoctorCommand(configManager as ConfigManager);

    const exitCode = await command.execute(['--json']);

    expect(exitCode).toBe(0);
    expect(stderrWrite).toHaveBeenCalledWith('🏥 Kaseki Agent Health Check\n\n');
    expect(consoleLog).toHaveBeenCalledTimes(1);
    expect(() => JSON.parse(consoleLog.mock.calls[0][0])).not.toThrow();
    expect(execSync).toHaveBeenCalledWith('node --version', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    expect(execSync).toHaveBeenCalledWith('npm --version', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    expect(execSync).toHaveBeenCalledWith('git --version', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  });

  test('uses argv-based child processes for docker image and disk checks', async () => {
    const command = new DoctorCommand(configManager as ConfigManager);

    const exitCode = await command.execute(['--json']);

    expect(exitCode).toBe(0);
    expect(execFileSync).toHaveBeenCalledWith('docker', ['inspect', 'kaseki:test;touch /tmp/pwned'], { stdio: 'ignore' });
    expect(execFileSync).toHaveBeenCalledWith('docker', [
      'run',
      '--rm',
      '--entrypoint',
      '/bin/test',
      'kaseki:test;touch /tmp/pwned',
      '-x',
      '/usr/local/bin/kaseki-entrypoint',
    ], {
      stdio: 'ignore',
      timeout: 5000,
    });
    expect(execFileSync).toHaveBeenCalledWith('df', ['-B1', '/agents;touch /tmp/pwned'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  });
});
