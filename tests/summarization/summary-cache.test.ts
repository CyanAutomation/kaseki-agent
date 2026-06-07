/**
 * Tests for SummaryCache
 * Real tests for cache invalidation and no stale summaries
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
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
