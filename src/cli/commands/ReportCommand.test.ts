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

  it('renders an incomplete disk report and maps a non-zero exit code to failure', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kaseki-report-'));
    const runDir = path.join(root, 'kaseki-results', 'run-failed');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, 'metadata.json'), JSON.stringify({
      status: 'completed', exitCode: 2,
      stages: { coding: { duration: 0, exitCode: 2 }, validation: {} },
    }));

    const config = new ConfigManager();
    await config.load();
    config.set('directories.root', root);
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(new ReportCommand(config).execute(['run-failed', '--from-disk'])).resolves.toBe(1);
    const output = log.mock.calls.flat().join('\n');
    expect(output).toContain('Status:    completed');
    expect(output).toContain('coding:');
    expect(output).toContain('❌ Instance failed with exit code 2');
    expect(error).not.toHaveBeenCalled();

    log.mockRestore();
    error.mockRestore();
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe('ReportCommand API reports', () => {
  it('renders status, analysis, artifacts, summary, and optional-call failures', async () => {
    const config = new ConfigManager();
    await config.load();
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const api = {
      baseUrl: 'http://localhost',
      getRunStatus: jest.fn().mockResolvedValue({
        id: 'run-api', status: 'failed', elapsedSeconds: 12, exitCode: 3,
        progress: { stage: 'validation', percentComplete: 80, message: 'running checks' },
        artifacts: { availableFiles: ['metadata.json'] },
        failureClass: 'validation', error: 'checks failed',
        resultSummaryContent: 'summary from status',
        validationFailureReason: 'test failed', qualityFailureReason: 'diff too large',
      }),
      getRunAnalysis: jest.fn().mockResolvedValue({
        id: 'run-api', status: 'failed', createdAt: '2026-01-01T00:00:00Z',
        completedAt: '2026-01-01T00:01:00Z', elapsedSeconds: 60,
        metadata: { repo: 'https://example.test/repo', ref: 'main', model: 'model-a' },
        changes: { diffSize: 12, changedFiles: ['src/a.ts'] },
        validation: { passed: false, commandResults: [{ command: 'npm test', exitCode: 1, elapsed: 2 }] },
        errors: ['first error'],
      }),
      getRunArtifacts: jest.fn().mockResolvedValue({
        id: 'run-api', runStatus: 'failed', artifacts: [{ name: 'stderr.log', size: 4, contentType: 'text/plain', available: true }],
        recommended: ['stderr.log'], artifactCount: 1,
      }),
      getRunLog: jest.fn().mockRejectedValue(new Error('log unavailable')),
    };

    await expect(new ReportCommand(config, () => api).execute(['run-api'])).resolves.toBe(1);
    const output = log.mock.calls.flat().join('\n');
    expect(output).toContain('ID:        run-api');
    expect(output).toContain('Created:');
    expect(output).toContain('Diff Size: 12 bytes');
    expect(output).toContain('Changed Files:');
    expect(output).toContain('npm test: exit 1 (2s)');
    expect(output).toContain('Recommended: stderr.log');
    expect(output).toContain('Validation Failure: test failed');
    expect(output).toContain('Quality Failure: diff too large');
    expect(output).toContain('Instance failed with exit code 3');
    expect(error).not.toHaveBeenCalled();

    log.mockRestore();
    error.mockRestore();
  });

  it('handles usage errors and optional empty API sections', async () => {
    const config = new ConfigManager();
    await config.load();
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const api = {
      baseUrl: 'http://localhost',
      getRunStatus: jest.fn().mockResolvedValue({ id: 'queued', status: 'queued' }),
      getRunAnalysis: jest.fn().mockRejectedValue(new Error('analysis unavailable')),
      getRunArtifacts: jest.fn().mockResolvedValue({ id: 'queued', runStatus: 'queued', artifacts: [], recommended: [], artifactCount: 0 }),
      getRunLog: jest.fn().mockResolvedValue({ logType: 'stderr', content: '', size: 0 }),
    };

    await expect(new ReportCommand(config, () => api).execute([])).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith('Usage: kaseki-agent report <INSTANCE_ID> [--from-disk]');
    await expect(new ReportCommand(config, () => api).execute(['queued'])).resolves.toBe(0);
    expect(log.mock.calls.flat().join('\n')).toContain('Instance status: queued');

    error.mockRestore();
    log.mockRestore();
  });
});
