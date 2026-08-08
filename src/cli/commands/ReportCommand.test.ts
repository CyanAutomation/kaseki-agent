import { describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ConfigManager } from '../../config/ConfigManager';
import { ReportCommand } from './ReportCommand';

describe('ReportCommand disk reports', () => {
  it('renders metadata, stages, summary, and the successful exit code', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kaseki-report-'));
    const runDir = path.join(root, 'kaseki-results', 'run-1');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, 'metadata.json'), JSON.stringify({
      id: 'run-1', status: 'completed', createdAt: '2026-01-01T00:00:00Z',
      repoUrl: 'https://example.test/repo', gitRef: 'main', model: 'test-model',
      stages: { validation: { duration: 1.5, exitCode: 0 } }, exitCode: 0,
    }));
    await fs.writeFile(path.join(runDir, 'result-summary.md'), '# Summary\n\npassed');

    const config = new ConfigManager();
    await config.load();
    config.set('directories.root', root);
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const command = new ReportCommand(config);

    await expect(command.execute(['run-1', '--from-disk'])).resolves.toBe(0);
    const output = log.mock.calls.flat().join('\n');
    expect(output).toContain('https://example.test/repo');
    expect(output).toContain('validation');
    expect(output).toContain('# Summary');
    log.mockRestore();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('returns an error for a missing disk report', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kaseki-report-'));
    const config = new ConfigManager();
    await config.load();
    config.set('directories.root', root);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(new ReportCommand(config).execute(['missing', '--from-disk'])).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith('Instance not found on disk: missing');
    error.mockRestore();
    await fs.rm(root, { recursive: true, force: true });
  });
});
