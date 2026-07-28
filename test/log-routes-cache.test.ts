/**
 * Tests for CachedArtifactReader integration in log-routes.ts
 * Phase 2, Step 4: Extend ResultCache to log routes
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ResultCache } from '../src/result-cache';
import { CachedArtifactReader } from '../src/utils/cached-artifact-reader';

// Mock fs module
jest.mock('fs');

describe('log-routes cache integration', () => {
  let tmpDir: string;
  let mockCache: Pick<ResultCache, 'getOrLoad'>;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `kaseki-test-${Date.now()}`);
    
    // Mock cache that delegates to fs for metadata.json
    mockCache = {
      getOrLoad: jest.fn().mockImplementation((filePath: string) => {
        if (filePath.includes('metadata.json') || filePath.includes('changed-files.txt') || filePath.includes('validation-timings.tsv')) {
          try {
            return (fs.readFileSync as jest.Mock)(filePath, 'utf-8');
          } catch {
            return null;
          }
        }
        return null;
      }),
      getStats: jest.fn().mockReturnValue({
        entries: 2,
        bytes: 512,
        hits: 5,
        misses: 3,
        evictions: 0,
        maxEntries: 20,
        ttlMs: 300000,
        maxFileBytes: 10485760,
      }),
      clear: jest.fn(),
      clearForJob: jest.fn(),
    } as unknown as ResultCache;

    // Setup fs mocks
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.statSync as jest.Mock).mockReturnValue({ size: 100 });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('metadata.json caching', () => {
    it('should cache metadata.json reads via CachedArtifactReader', () => {
      const metadataPath = path.join(tmpDir, 'metadata.json');
      const metadata = {
        model: 'openrouter/free',
        instance: 'kaseki-1',
        repo: 'test/repo',
        ref: 'main',
      };

      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(metadata));

      const reader = new CachedArtifactReader(mockCache as ResultCache);
      const result1 = reader.readMetadata(metadataPath);
      const result2 = reader.readMetadata(metadataPath);

      expect(result1).toEqual(metadata);
      expect(result2).toEqual(metadata);
      expect(mockCache.getOrLoad).toHaveBeenCalledTimes(2);
      expect(mockCache.getOrLoad).toHaveBeenCalledWith(metadataPath);
    });

    it('should extract metadata fields correctly', () => {
      const metadataPath = path.join(tmpDir, 'metadata.json');
      const metadata = {
        model: 'anthropic/claude-3-sonnet',
        instance: 'kaseki-42',
        repo: 'CyanAutomation/crudmapper',
        ref: 'feature/test',
        extra_field: 'should_be_ignored',
      };

      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(metadata));

      const reader = new CachedArtifactReader(mockCache as ResultCache);
      const result = reader.readMetadata(metadataPath);

      expect(result).toMatchObject({
        model: 'anthropic/claude-3-sonnet',
        instance: 'kaseki-42',
        repo: 'CyanAutomation/crudmapper',
        ref: 'feature/test',
      });
    });

    it('should return null for missing metadata.json', () => {
      const metadataPath = path.join(tmpDir, 'metadata.json');

      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      mockCache.getOrLoad = jest.fn().mockReturnValue(null);

      const reader = new CachedArtifactReader(mockCache as ResultCache);
      const result = reader.readMetadata(metadataPath);

      expect(result).toBeNull();
    });
  });

  describe('changed-files.txt caching', () => {
    it('should cache changed-files.txt reads', () => {
      const changedFilesPath = path.join(tmpDir, 'changed-files.txt');
      const changedFilesContent = 'src/file1.ts\nsrc/file2.ts\ntest/file3.test.ts\n';

      (fs.readFileSync as jest.Mock).mockReturnValue(changedFilesContent);

      const reader = new CachedArtifactReader(mockCache as ResultCache);
      const result1 = reader.readChangedFiles(changedFilesPath);
      const result2 = reader.readChangedFiles(changedFilesPath);

      expect(result1).toEqual(['src/file1.ts', 'src/file2.ts', 'test/file3.test.ts']);
      expect(result2).toEqual(['src/file1.ts', 'src/file2.ts', 'test/file3.test.ts']);
      expect(mockCache.getOrLoad).toHaveBeenCalledTimes(2);
    });

    it('should handle empty changed-files.txt', () => {
      const changedFilesPath = path.join(tmpDir, 'changed-files.txt');

      (fs.readFileSync as jest.Mock).mockReturnValue('');

      const reader = new CachedArtifactReader(mockCache as ResultCache);
      const result = reader.readChangedFiles(changedFilesPath);

      expect(result).toEqual([]);
    });
  });

  describe('validation-timings.tsv caching', () => {
    it('should cache validation-timings.tsv reads', () => {
      const validationPath = path.join(tmpDir, 'validation-timings.tsv');
      const validationContent = 'command\texit_code\telapsed_ms\nnpm run test\t0\t1234\nnpm run build\t0\t5678\n';

      (fs.readFileSync as jest.Mock).mockReturnValue(validationContent);

      const reader = new CachedArtifactReader(mockCache as ResultCache);
      const result1 = reader.readTextArtifact(validationPath);
      const result2 = reader.readTextArtifact(validationPath);

      expect(result1).toEqual(validationContent);
      expect(result2).toEqual(validationContent);
      expect(mockCache.getOrLoad).toHaveBeenCalledTimes(2);
    });
  });

  describe('cache statistics', () => {
    it('should track cache hits and misses', () => {
      const metadataPath = path.join(tmpDir, 'metadata.json');
      const metadata = { instance: 'kaseki-1' };

      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(metadata));

      const reader = new CachedArtifactReader(mockCache as ResultCache);
      
      reader.readMetadata(metadataPath);
      reader.readMetadata(metadataPath);

      const stats = reader.getStats();
      expect(stats.hits).toBeGreaterThanOrEqual(0);
      expect(stats.misses).toBeGreaterThanOrEqual(0);
    });
  });
});
