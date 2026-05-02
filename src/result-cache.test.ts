import { ResultCache } from './result-cache';
import * as fs from 'fs';
import * as path from 'path';

describe('ResultCache', () => {
  let cache: ResultCache;
  let testFile: string;
  let testDir: string;

  beforeEach(() => {
    cache = new ResultCache(3, 1000); // 3 entries, 1 sec TTL for testing
    testDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-cache-test-'));
    testFile = path.join(testDir, 'test.txt');
    fs.writeFileSync(testFile, 'test content');
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('loads file on first access', () => {
    const content = cache.getOrLoad(testFile);
    expect(content).toBe('test content');
  });

  test('returns null for non-existent file', () => {
    const content = cache.getOrLoad('/non/existent/file');
    expect(content).toBeNull();
  });

  test('returns cached content on subsequent accesses', () => {
    cache.getOrLoad(testFile);

    // Modify file on disk
    fs.writeFileSync(testFile, 'modified content');

    // Cache should return original content
    const content = cache.getOrLoad(testFile);
    expect(content).toBe('test content');
  });

  test('expires cached entries after TTL using deterministic time control', () => {
    jest.useFakeTimers();
    const baseTime = new Date('2026-01-01T00:00:00.000Z');
    jest.setSystemTime(baseTime);

    cache.getOrLoad(testFile);

    // Change file on disk while cache is still valid.
    fs.writeFileSync(testFile, 'modified content');

    // Before TTL boundary, cached content should still be served.
    jest.advanceTimersByTime(999);
    const cachedContent = cache.getOrLoad(testFile);
    expect(cachedContent).toBe('test content');

    // Move past TTL boundary and verify cache miss/reload behavior.
    jest.advanceTimersByTime(2);
    const reloadedContent = cache.getOrLoad(testFile);
    expect(reloadedContent).toBe('modified content');

    jest.useRealTimers();
  });

  test('evicts oldest entry when cache is full', () => {
    const files = [];
    for (let i = 0; i < 4; i++) {
      const file = path.join(testDir, `file-${i}.txt`);
      fs.writeFileSync(file, `content-${i}`);
      cache.getOrLoad(file);
      files.push(file);
    }

    // First file should be evicted
    fs.writeFileSync(files[0], 'evicted content');
    const content = cache.getOrLoad(files[0]);
    expect(content).toBe('evicted content');
  });

  test('clears cache for a job', () => {
    const file = path.join(testDir, 'kaseki-1/data.txt');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'job data');

    cache.getOrLoad(file);
    cache.clearForJob('kaseki-1');

    // Modify file and reload
    fs.writeFileSync(file, 'modified job data');
    const content = cache.getOrLoad(file);
    expect(content).toBe('modified job data');
  });

  test('clears cache entries for POSIX-style path strings by job segment', () => {
    const internalCache = (cache as unknown as { cache: Map<string, { content: string; timestamp: number; size: number }> }).cache;
    internalCache.set('/tmp/jobs/kaseki-1/result.txt', { content: 'a', timestamp: Date.now(), size: 1 });
    internalCache.set('/tmp/jobs/kaseki-10/result.txt', { content: 'b', timestamp: Date.now(), size: 1 });

    cache.clearForJob('kaseki-1');

    expect(internalCache.has('/tmp/jobs/kaseki-1/result.txt')).toBe(false);
    expect(internalCache.has('/tmp/jobs/kaseki-10/result.txt')).toBe(true);
  });

  test('clears cache entries for Windows-style path strings by job segment', () => {
    const internalCache = (cache as unknown as { cache: Map<string, { content: string; timestamp: number; size: number }> }).cache;
    internalCache.set('C:\\kaseki\\runs\\kaseki-1\\result.txt', {
      content: 'a',
      timestamp: Date.now(),
      size: 1,
    });
    internalCache.set('C:\\kaseki\\runs\\kaseki-10\\result.txt', {
      content: 'b',
      timestamp: Date.now(),
      size: 1,
    });

    cache.clearForJob('kaseki-1');

    expect(internalCache.has('C:\\kaseki\\runs\\kaseki-1\\result.txt')).toBe(false);
    expect(internalCache.has('C:\\kaseki\\runs\\kaseki-10\\result.txt')).toBe(true);
  });

  test('provides cache statistics', () => {
    cache.getOrLoad(testFile);

    const stats = cache.getStats();
    expect(stats.entries).toBe(1);
    expect(stats.bytes).toBeGreaterThan(0);
  });

  test('clears all cache', () => {
    cache.getOrLoad(testFile);

    cache.clearAll();
    const stats = cache.getStats();
    expect(stats.entries).toBe(0);
  });
});
