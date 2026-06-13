import { ResultCache } from './result-cache';
import * as fs from 'fs';
import * as path from 'path';

describe('ResultCache', () => {
  let cache: ResultCache;
  let testFile: string;
  let testDir: string;

  beforeEach(() => {
    cache = new ResultCache(3, 1000); // 3 entries, 1 sec TTL
    testDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-cache-test-'));
    testFile = path.join(testDir, 'test.txt');
    fs.writeFileSync(testFile, 'test content');
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('API contract: cache miss returns null and increments miss counter', () => {
    const statsBefore = cache.getStats();

    const content = cache.getOrLoad('/non/existent/file');

    expect(content).toBeNull();
    const statsAfter = cache.getStats();
    expect(statsAfter.misses).toBe(statsBefore.misses + 1);
  });

  test('returns cached content on cache hit', () => {
    const initialContent = cache.getOrLoad(testFile);
    expect(initialContent).toBe('test content');

    const cachedContent = cache.getOrLoad(testFile);
    expect(cachedContent).toBe('test content');

    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
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
    fs.writeFileSync(files[0], 'modified content');
    const content = cache.getOrLoad(files[0]);
    expect(content).toBe('modified content');
  });

  test('clears cache for a job', () => {
    const file = path.join(testDir, 'kaseki-1/data.txt');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'job data');

    cache.getOrLoad(file);
    cache.clearForJob('kaseki-1');

    // Reload should get fresh content from disk
    fs.writeFileSync(file, 'modified job data');
    const content = cache.getOrLoad(file);
    expect(content).toBe('modified job data');
  });

  test('clears cache entries for POSIX-style path strings by job segment', () => {
    const internalCache = (cache as unknown as { cache: Map<string, { content: string; timestamp: number; size: number; mtimeMs?: number; inode?: number }> }).cache;
    internalCache.set('/tmp/jobs/kaseki-1/result.txt', { content: 'a', timestamp: Date.now(), size: 1 });
    internalCache.set('/tmp/jobs/kaseki-10/result.txt', { content: 'b', timestamp: Date.now(), size: 1 });

    cache.clearForJob('kaseki-1');

    expect(internalCache.has('/tmp/jobs/kaseki-1/result.txt')).toBe(false);
    expect(internalCache.has('/tmp/jobs/kaseki-10/result.txt')).toBe(true);
  });

  test('clears cache entries for Windows-style path strings by job segment', () => {
    const internalCache = (cache as unknown as { cache: Map<string, { content: string; timestamp: number; size: number; mtimeMs?: number; inode?: number }> }).cache;
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
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(1);
    expect(stats.maxEntries).toBe(3);
    expect(stats.ttlMs).toBe(1000);
    expect(stats.maxFileBytes).toBe(10 * 1024 * 1024);
  });

  test('honors configured max file bytes by not caching oversized files', () => {
    const smallCache = new ResultCache({ maxEntries: 3, ttlMs: 1000, maxFileBytes: 4 });
    const content = smallCache.getOrLoad(testFile);
    expect(content).toBe('test content');
    expect(smallCache.getStats()).toMatchObject({ entries: 0, bytes: 0, hits: 0, misses: 1 });
  });

  test('honors zero max entries by disabling caching', () => {
    const disabledCache = new ResultCache({ maxEntries: 0, ttlMs: 1000, maxFileBytes: 100 });
    expect(disabledCache.getOrLoad(testFile)).toBe('test content');
    expect(disabledCache.getOrLoad(testFile)).toBe('test content');
    expect(disabledCache.getStats()).toMatchObject({ entries: 0, hits: 0, misses: 2, maxEntries: 0 });
  });

  test('clears all cache', () => {
    const initialContent = cache.getOrLoad(testFile);
    expect(initialContent).toBe('test content');

    cache.clearAll();

    const stats = cache.getStats();
    expect(stats.entries).toBe(0);
    expect(stats.bytes).toBe(0);

    // Modify file after clearAll to prove subsequent load comes from disk
    fs.writeFileSync(testFile, 'content after clear');
    const reloadedContent = cache.getOrLoad(testFile);
    expect(reloadedContent).toBe('content after clear');
  });
});
