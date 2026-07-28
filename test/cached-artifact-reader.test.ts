import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CachedArtifactReader } from '../src/utils/cached-artifact-reader';
import type { KasekiMetadata } from '../src/types/kaseki-metadata';

describe('CachedArtifactReader', () => {
  let tempDir: string;
  let reader: CachedArtifactReader;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cached-artifact-reader-test-'));
    reader = new CachedArtifactReader();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('readMetadata', () => {
    it('should read and parse metadata.json successfully', () => {
      const metadataPath = join(tempDir, 'metadata.json');
      const metadata: Partial<KasekiMetadata> = {
        instance_name: 'kaseki-test',
        exit_code: 0,
        status: 'success',
      };
      writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

      const result = reader.readMetadata(metadataPath);

      expect(result).not.toBeNull();
      expect(result?.instance_name).toBe('kaseki-test');
      expect(result?.exit_code).toBe(0);
      expect(result?.status).toBe('success');
    });

    it('should return null for missing metadata.json', () => {
      const metadataPath = join(tempDir, 'missing-metadata.json');

      const result = reader.readMetadata(metadataPath);

      expect(result).toBeNull();
    });

    it('should return null for invalid JSON in metadata.json', () => {
      const metadataPath = join(tempDir, 'metadata.json');
      writeFileSync(metadataPath, 'invalid json{');

      const result = reader.readMetadata(metadataPath);

      expect(result).toBeNull();
    });

    it('should cache metadata.json and return from cache on second read', () => {
      const metadataPath = join(tempDir, 'metadata.json');
      const metadata: Partial<KasekiMetadata> = {
        instance_name: 'kaseki-cache-test',
        exit_code: 0,
      };
      writeFileSync(metadataPath, JSON.stringify(metadata));

      // First read - cache miss
      const result1 = reader.readMetadata(metadataPath);
      const stats1 = reader.getStats();

      // Second read - cache hit
      const result2 = reader.readMetadata(metadataPath);
      const stats2 = reader.getStats();

      expect(result1?.instance_name).toBe('kaseki-cache-test');
      expect(result2?.instance_name).toBe('kaseki-cache-test');
      expect(stats1.misses).toBe(1);
      expect(stats1.hits).toBe(0);
      expect(stats2.misses).toBe(1);
      expect(stats2.hits).toBe(1);
    });

    it('should invalidate cache when file is modified', () => {
      const metadataPath = join(tempDir, 'metadata.json');
      const metadata1: Partial<KasekiMetadata> = {
        instance_name: 'kaseki-v1',
        exit_code: 0,
      };
      writeFileSync(metadataPath, JSON.stringify(metadata1));

      // First read
      const result1 = reader.readMetadata(metadataPath);

      // Modify file (need to wait to ensure mtime changes)
      const metadata2: Partial<KasekiMetadata> = {
        instance_name: 'kaseki-v2',
        exit_code: 1,
      };
      // Sleep for 10ms to ensure mtime difference
      const futureTime = Date.now() + 100;
      writeFileSync(metadataPath, JSON.stringify(metadata2));
      utimesSync(metadataPath, futureTime / 1000, futureTime / 1000);

      // Second read - should detect file change
      const result2 = reader.readMetadata(metadataPath);

      expect(result1?.instance_name).toBe('kaseki-v1');
      expect(result2?.instance_name).toBe('kaseki-v2');
    });
  });

  describe('readPiSummary', () => {
    it('should read and parse pi-summary.json successfully', () => {
      const summaryPath = join(tempDir, 'pi-summary.json');
      const summary = {
        total_events: 42,
        duration_ms: 1500,
        exit_code: 0,
      };
      writeFileSync(summaryPath, JSON.stringify(summary));

      const result = reader.readPiSummary(summaryPath);

      expect(result).not.toBeNull();
      expect(result?.total_events).toBe(42);
      expect(result?.duration_ms).toBe(1500);
    });

    it('should return null for missing pi-summary.json', () => {
      const summaryPath = join(tempDir, 'missing-summary.json');

      const result = reader.readPiSummary(summaryPath);

      expect(result).toBeNull();
    });
  });

  describe('readTextArtifact', () => {
    it('should read text artifact successfully', () => {
      const logPath = join(tempDir, 'validation.log');
      writeFileSync(logPath, 'validation passed\nall tests ok');

      const result = reader.readTextArtifact(logPath);

      expect(result).toBe('validation passed\nall tests ok');
    });

    it('should return null for missing text artifact', () => {
      const logPath = join(tempDir, 'missing.log');

      const result = reader.readTextArtifact(logPath);

      expect(result).toBeNull();
    });

    it('should cache text artifacts', () => {
      const logPath = join(tempDir, 'test.log');
      writeFileSync(logPath, 'cached content');

      // First read
      reader.readTextArtifact(logPath);
      const stats1 = reader.getStats();

      // Second read
      reader.readTextArtifact(logPath);
      const stats2 = reader.getStats();

      expect(stats1.misses).toBe(1);
      expect(stats1.hits).toBe(0);
      expect(stats2.hits).toBe(1);
    });
  });

  describe('readJsonArtifact', () => {
    it('should read and parse generic JSON artifact', () => {
      const jsonPath = join(tempDir, 'custom.json');
      const data = { foo: 'bar', count: 123 };
      writeFileSync(jsonPath, JSON.stringify(data));

      const result = reader.readJsonArtifact(jsonPath);

      expect(result).not.toBeNull();
      expect(result?.foo).toBe('bar');
      expect(result?.count).toBe(123);
    });

    it('should return null for invalid JSON', () => {
      const jsonPath = join(tempDir, 'invalid.json');
      writeFileSync(jsonPath, '{invalid');

      const result = reader.readJsonArtifact(jsonPath);

      expect(result).toBeNull();
    });
  });

  describe('readChangedFiles', () => {
    it('should read and parse changed-files.txt as array', () => {
      const changedPath = join(tempDir, 'changed-files.txt');
      writeFileSync(changedPath, 'src/file1.ts\nsrc/file2.ts\ntest/file1.test.ts\n');

      const result = reader.readChangedFiles(changedPath);

      expect(result).toEqual(['src/file1.ts', 'src/file2.ts', 'test/file1.test.ts']);
    });

    it('should handle empty changed-files.txt', () => {
      const changedPath = join(tempDir, 'changed-files.txt');
      writeFileSync(changedPath, '');

      const result = reader.readChangedFiles(changedPath);

      expect(result).toEqual([]);
    });

    it('should trim whitespace from filenames', () => {
      const changedPath = join(tempDir, 'changed-files.txt');
      writeFileSync(changedPath, '  src/file1.ts  \n  src/file2.ts\n\n');

      const result = reader.readChangedFiles(changedPath);

      expect(result).toEqual(['src/file1.ts', 'src/file2.ts']);
    });

    it('should return null for missing changed-files.txt', () => {
      const changedPath = join(tempDir, 'missing.txt');

      const result = reader.readChangedFiles(changedPath);

      expect(result).toBeNull();
    });
  });

  describe('clearForJob', () => {
    it('should clear cache entries for a specific job', () => {
      const job1Dir = join(tempDir, 'kaseki-1');
      const job2Dir = join(tempDir, 'kaseki-2');
      mkdirSync(job1Dir, { recursive: true });
      mkdirSync(job2Dir, { recursive: true });
      const job1Path = join(job1Dir, 'metadata.json');
      const job2Path = join(job2Dir, 'metadata.json');
      writeFileSync(job1Path, '{"instance_name": "kaseki-1"}');
      writeFileSync(job2Path, '{"instance_name": "kaseki-2"}');

      // Populate cache
      reader.readMetadata(job1Path);
      reader.readMetadata(job2Path);
      expect(reader.getStats().entries).toBe(2);

      // Clear job1 cache
      reader.clearForJob('kaseki-1');

      // Job1 should be cache miss, job2 should be cache hit
      const stats1 = reader.getStats();
      expect(stats1.entries).toBe(1);

      reader.readMetadata(job1Path); // cache miss
      reader.readMetadata(job2Path); // cache hit

      const stats2 = reader.getStats();
      expect(stats2.misses).toBe(3); // Initial 2 + job1 re-read
      expect(stats2.hits).toBe(1); // job2 re-read
    });
  });

  describe('clearAll', () => {
    it('should clear entire cache', () => {
      const path1 = join(tempDir, 'file1.json');
      const path2 = join(tempDir, 'file2.json');
      writeFileSync(path1, '{"test": 1}');
      writeFileSync(path2, '{"test": 2}');

      reader.readJsonArtifact(path1);
      reader.readJsonArtifact(path2);
      expect(reader.getStats().entries).toBe(2);

      reader.clearAll();

      expect(reader.getStats().entries).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return accurate cache statistics', () => {
      const path1 = join(tempDir, 'small.txt');
      const path2 = join(tempDir, 'large.txt');
      writeFileSync(path1, 'small');
      writeFileSync(path2, 'a'.repeat(1000));

      reader.readTextArtifact(path1); // miss
      reader.readTextArtifact(path1); // hit
      reader.readTextArtifact(path2); // miss

      const stats = reader.getStats();

      expect(stats.entries).toBe(2);
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(2);
      expect(stats.bytes).toBeGreaterThan(1000);
    });

    it('should track evictions when cache is full', () => {
      const smallCache = new CachedArtifactReader({ maxEntries: 2 });

      const path1 = join(tempDir, '1.txt');
      const path2 = join(tempDir, '2.txt');
      const path3 = join(tempDir, '3.txt');
      writeFileSync(path1, 'one');
      writeFileSync(path2, 'two');
      writeFileSync(path3, 'three');

      smallCache.readTextArtifact(path1);
      smallCache.readTextArtifact(path2);
      smallCache.readTextArtifact(path3); // Should evict path1

      const stats = smallCache.getStats();

      expect(stats.entries).toBe(2);
      expect(stats.evictions).toBe(1);
    });
  });

  describe('TTL behavior', () => {
    it('should respect TTL and expire old entries', async () => {
      const shortTtlReader = new CachedArtifactReader({ ttlMs: 50 });
      const filePath = join(tempDir, 'ttl-test.txt');
      writeFileSync(filePath, 'content');

      // First read - cache miss
      shortTtlReader.readTextArtifact(filePath);

      // Second read within TTL - cache hit
      shortTtlReader.readTextArtifact(filePath);
      const stats1 = shortTtlReader.getStats();
      expect(stats1.hits).toBe(1);

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 100));

      // Third read after TTL - cache miss
      shortTtlReader.readTextArtifact(filePath);
      const stats2 = shortTtlReader.getStats();
      expect(stats2.misses).toBe(2);
    });
  });

  describe('size limits', () => {
    it('should not cache files exceeding maxFileBytes', () => {
      const limitedReader = new CachedArtifactReader({ maxFileBytes: 100 });
      const smallPath = join(tempDir, 'small.txt');
      const largePath = join(tempDir, 'large.txt');
      writeFileSync(smallPath, 'a'.repeat(50));
      writeFileSync(largePath, 'b'.repeat(200));

      limitedReader.readTextArtifact(smallPath); // Should cache
      limitedReader.readTextArtifact(largePath); // Should NOT cache

      const stats = limitedReader.getStats();

      expect(stats.entries).toBe(1); // Only small file cached
    });
  });
});
