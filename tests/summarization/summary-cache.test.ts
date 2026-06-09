/**
 * Tests for SummaryCache
 * Real tests for cache invalidation and no stale summaries
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SummaryCache } from '../../src/summarization/summary-cache';

describe('SummaryCache', () => {
  let cacheDir: string;
  let cache: SummaryCache;

  beforeEach(() => {
    // Create temporary cache directory
    cacheDir = path.join(os.tmpdir(), `kaseki-cache-test-${Date.now()}`);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    cache = new SummaryCache(cacheDir);
  });

  afterEach(() => {
    jest.useRealTimers();

    // Cleanup
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  describe('Cache Storage & Retrieval', () => {
    it('should store and retrieve a summary', () => {
      const testFile = path.join(cacheDir, 'test-file.ts');
      fs.writeFileSync(testFile, 'export class A {}');

      const summaryContent = JSON.stringify({ classes: ['A'] });
      cache.set(testFile, summaryContent, 'typescript');
      const retrieved = cache.get(testFile);

      expect(retrieved).toBeDefined();
      expect(retrieved?.content).toEqual(summaryContent);
      expect(retrieved?.language).toEqual('typescript');
    });

    it('should return null for missing cache entry', () => {
      const filePath = '/test/missing-file-' + Date.now() + '.ts';
      const retrieved = cache.get(filePath);
      expect(retrieved).toBeNull();
    });
  });

  describe('File Hash Validation (No Stale Summaries)', () => {
    it('should invalidate cache when file content changes', () => {
      const testFile = path.join(cacheDir, `test-${Date.now()}.ts`);
      fs.writeFileSync(testFile, 'export class A {}');

      const summaryContent = JSON.stringify({ classes: ['A'] });
      cache.set(testFile, summaryContent, 'typescript');
      expect(cache.get(testFile)).toBeDefined();

      // Modify file
      fs.writeFileSync(testFile, 'export class A {}\nexport class B {}');

      // Cache should be invalidated
      expect(cache.get(testFile)).toBeNull();
    });

    it('should detect all file changes via hash', () => {
      const testFile = path.join(cacheDir, `test-hash-${Date.now()}.ts`);
      const content1 = 'export function foo() {}';
      fs.writeFileSync(testFile, content1);

      const summaryContent = JSON.stringify({ functions: ['foo'] });
      cache.set(testFile, summaryContent, 'typescript');
      const hash1 = cache.getFileHash(testFile);

      // Change content
      const content2 = 'export function foo() {}\nexport function bar() {}';
      fs.writeFileSync(testFile, content2);
      const hash2 = cache.getFileHash(testFile);

      expect(hash1).not.toEqual(hash2);
    });

    it('should detect beginning changes', () => {
      const testFile = path.join(cacheDir, `test-beginning-${Date.now()}.ts`);
      fs.writeFileSync(testFile, 'export class A {}');

      const summaryContent = JSON.stringify({ classes: ['A'] });
      cache.set(testFile, summaryContent, 'typescript');

      // Change beginning
      fs.writeFileSync(testFile, 'export class B {}');
      expect(cache.get(testFile)).toBeNull();
    });
  });

  describe('Bounded Cache Eviction', () => {
    function writeTestFile(name: string, content = 'export class Example {}'): string {
      const filePath = path.join(cacheDir, name);
      fs.writeFileSync(filePath, content);
      return filePath;
    }

    it('should evict least-recently-used entries when maxEntries is exceeded', () => {
      cache = new SummaryCache(cacheDir, { maxEntries: 2 });
      const file1 = writeTestFile('lru-1.ts', 'export class A {}');
      const file2 = writeTestFile('lru-2.ts', 'export class B {}');
      const file3 = writeTestFile('lru-3.ts', 'export class C {}');

      cache.set(file1, 'summary-1', 'typescript');
      cache.set(file2, 'summary-2', 'typescript');

      // Refresh file1 recency, making file2 the least-recently-used entry.
      expect(cache.get(file1)?.content).toEqual('summary-1');
      cache.set(file3, 'summary-3', 'typescript');

      expect(cache.get(file1)?.content).toEqual('summary-1');
      expect(cache.get(file2)).toBeNull();
      expect(cache.get(file3)?.content).toEqual('summary-3');

      const stats = cache.getStats();
      expect(stats.entries).toEqual(2);
      expect(stats.evictions).toBeGreaterThanOrEqual(1);
      expect(stats.maxEntries).toEqual(2);
    });

    it('should evict least-recently-used entries when maxSizeBytes is exceeded', () => {
      cache = new SummaryCache(cacheDir, { maxSizeBytes: 10 });
      const file1 = writeTestFile('size-1.ts', 'export class A {}');
      const file2 = writeTestFile('size-2.ts', 'export class B {}');
      const file3 = writeTestFile('size-3.ts', 'export class C {}');

      cache.set(file1, '1234', 'typescript');
      cache.set(file2, '5678', 'typescript');
      cache.set(file3, 'abcd', 'typescript');

      expect(cache.get(file1)).toBeNull();
      expect(cache.get(file2)?.content).toEqual('5678');
      expect(cache.get(file3)?.content).toEqual('abcd');

      const stats = cache.getStats();
      expect(stats.entries).toEqual(2);
      expect(stats.sizeBytes).toBeLessThanOrEqual(10);
      expect(stats.maxSizeBytes).toEqual(10);
      expect(stats.evictions).toBeGreaterThanOrEqual(1);
    });

    it('should expire entries on get without explicit external cleanup', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));

      cache = new SummaryCache(cacheDir, { ttlMs: 1000 });
      const file1 = writeTestFile('ttl-1.ts', 'export class A {}');

      cache.set(file1, 'ttl-summary', 'typescript');
      expect(cache.get(file1)?.content).toEqual('ttl-summary');

      jest.setSystemTime(new Date('2026-01-01T00:00:02Z'));

      expect(cache.get(file1)).toBeNull();
      const stats = cache.getStats();
      expect(stats.entries).toEqual(0);
      expect(stats.misses).toBeGreaterThanOrEqual(1);
      expect(stats.evictions).toBeGreaterThanOrEqual(1);
      expect(stats.ttlMs).toEqual(1000);
    });

    it('should persist retained entries after evictions', () => {
      cache = new SummaryCache(cacheDir, { maxEntries: 2 });
      const file1 = writeTestFile('persist-1.ts', 'export class A {}');
      const file2 = writeTestFile('persist-2.ts', 'export class B {}');
      const file3 = writeTestFile('persist-3.ts', 'export class C {}');

      cache.set(file1, 'persist-summary-1', 'typescript');
      cache.set(file2, 'persist-summary-2', 'typescript');
      expect(cache.get(file1)?.content).toEqual('persist-summary-1');
      cache.set(file3, 'persist-summary-3', 'typescript');
      cache.flush();

      const restored = new SummaryCache(cacheDir, { maxEntries: 2 });
      restored.load();

      expect(restored.get(file1)?.content).toEqual('persist-summary-1');
      expect(restored.get(file2)).toBeNull();
      expect(restored.get(file3)?.content).toEqual('persist-summary-3');
      expect(restored.getStats().entries).toEqual(2);
    });
  });

  describe('Cache Stats', () => {
    it('should track cache entries', () => {
      const file1 = path.join(cacheDir, 'file1.ts');
      const file2 = path.join(cacheDir, 'file2.ts');
      fs.writeFileSync(file1, 'export class A {}');
      fs.writeFileSync(file2, 'export class B {}');

      const summaryContent = JSON.stringify({ classes: ['A'] });
      cache.set(file1, summaryContent, 'typescript');
      cache.set(file2, summaryContent, 'typescript');

      const stats = cache.getStats();
      expect(stats.entries).toEqual(2);
      expect(stats.sizeBytes).toBeGreaterThan(0);
    });

    it('should track hit rate', () => {
      const testFile = path.join(cacheDir, 'test-stats.ts');
      fs.writeFileSync(testFile, 'export class A {}');

      const summaryContent = JSON.stringify({ classes: ['A'] });
      cache.set(testFile, summaryContent, 'typescript');

      cache.get(testFile); // hit
      cache.get(testFile); // hit
      cache.get('/nonexistent.ts'); // miss

      const stats = cache.getStats();
      expect(stats.hitRate).toBeGreaterThan(0);
    });
  });
});
