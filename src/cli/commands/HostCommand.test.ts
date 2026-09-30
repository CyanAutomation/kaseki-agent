import { spawnSync } from 'child_process';

interface HostCommandResult {
  exitCode: number;
  stdout: string[];
  stderr: string[];
}

function runHostCommand(args: string[]): HostCommandResult {
  const script = `
    const { HostCommand } = await import('./src/cli/commands/HostCommand.ts');
    const { ConfigManager } = await import('./src/config/ConfigManager.ts');
    const stdout = [];
    const stderr = [];
    const write = console.log.bind(console);
    console.log = (...parts) => stdout.push(parts.join(' '));
    console.error = (...parts) => stderr.push(parts.join(' '));
    const command = new HostCommand(new ConfigManager());
    const exitCode = await command.execute(${JSON.stringify(args)});
    write(JSON.stringify({ exitCode, stdout, stderr }));
  `;
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script],
    { cwd: process.cwd(), encoding: 'utf8' },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || `Host command process exited with ${result.status}`);
  }
  return JSON.parse(result.stdout) as HostCommandResult;
}

describe('HostCommand', () => {
  it('shows help when no command is supplied', () => {
    const result = runHostCommand([]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.join('\n')).toContain('kaseki-agent host setup');
  });

  it('rejects unsupported commands and setup flags', () => {
    const unknownCommand = runHostCommand(['unknown']);
    const unknownFlag = runHostCommand(['setup', '--unknown']);

    expect(unknownCommand.exitCode).toBe(1);
    expect(unknownFlag.exitCode).toBe(1);
    expect(unknownFlag.stderr.join('\n')).toContain('Usage: kaseki-agent host setup');
  });

  it('handles setup help without invoking the host setup script', () => {
    const result = runHostCommand(['setup', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.join('\n')).toContain('OPTIONS');
  });

  it('rejects unknown preflight options before reading host secrets', () => {
    const result = runHostCommand(['preflight', '--unknown']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown host preflight option: --unknown');
  });
});
