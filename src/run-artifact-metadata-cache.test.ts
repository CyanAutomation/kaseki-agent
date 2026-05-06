import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RunArtifactMetadataCache } from './run-artifact-metadata-cache';

describe('RunArtifactMetadataCache', () => {
  let resultsDir: string;

  beforeEach(() => {
    resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-artifact-metadata-cache-'));
  });

  afterEach(() => {
    fs.rmSync(resultsDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  test('terminal metadata requests populate and reuse a cache entry', () => {
    const cache = new RunArtifactMetadataCache();
    const jobDir = path.join(resultsDir, 'kaseki-terminal-cache-hit');
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'metadata.json'), '{}');

    const first = cache.get('kaseki-terminal-cache-hit', jobDir, ['metadata.json'], true);
    const second = cache.get('kaseki-terminal-cache-hit', jobDir, ['metadata.json'], true);

    expect(first['metadata.json']).toEqual(second['metadata.json']);
    expect(second['metadata.json']).toMatchObject({ exists: true, size: 2 });
    expect(cache.getStats()).toEqual({ entries: 1 });
  });

  test('non-terminal metadata requests are not cached', () => {
    const cache = new RunArtifactMetadataCache();
    const jobDir = path.join(resultsDir, 'kaseki-running-no-cache');
    const metadataPath = path.join(jobDir, 'metadata.json');
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(metadataPath, '{}');

    const first = cache.get('kaseki-running-no-cache', jobDir, ['metadata.json'], false);
    fs.writeFileSync(metadataPath, '{"updated":true}');
    const second = cache.get('kaseki-running-no-cache', jobDir, ['metadata.json'], false);

    expect(first['metadata.json'].size).toBe(2);
    expect(second['metadata.json'].size).toBe(16);
    expect(cache.getStats()).toEqual({ entries: 0 });
  });

  test('terminal cache entries invalidate when artifact size and mtime change', () => {
    const cache = new RunArtifactMetadataCache();
    const jobDir = path.join(resultsDir, 'kaseki-terminal-cache-invalidate');
    const summaryPath = path.join(jobDir, 'result-summary.md');
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(summaryPath, 'one');

    const first = cache.get('kaseki-terminal-cache-invalidate', jobDir, ['result-summary.md'], true);
    const nextMtime = new Date(Date.now() + 10_000);
    fs.writeFileSync(summaryPath, 'one plus more');
    fs.utimesSync(summaryPath, nextMtime, nextMtime);
    const second = cache.get('kaseki-terminal-cache-invalidate', jobDir, ['result-summary.md'], true);

    expect(first['result-summary.md'].size).toBe(3);
    expect(second['result-summary.md'].size).toBe(13);
    expect(second['result-summary.md'].mtimeMs).not.toBe(first['result-summary.md'].mtimeMs);
    expect(cache.getStats()).toEqual({ entries: 1 });
  });

  test('clear removes a terminal cache entry for a job result directory', () => {
    const cache = new RunArtifactMetadataCache();
    const jobDir = path.join(resultsDir, 'kaseki-clear-cache');
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'failure.json'), '{}');

    cache.get('kaseki-clear-cache', jobDir, ['failure.json'], true);
    expect(cache.getStats()).toEqual({ entries: 1 });

    cache.clear('kaseki-clear-cache', jobDir);

    expect(cache.getStats()).toEqual({ entries: 0 });
  });
});
