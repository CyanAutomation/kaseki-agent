/**
 * Tests for CachedArtifactReader integration in kaseki-cli-lib.ts
 * Phase 2, Step 4: Extend ResultCache to CLI utilities
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CachedArtifactReader } from '../src/utils/cached-artifact-reader';

// Mock fs module
jest.mock('fs');

describe('kaseki-cli-lib cache integration', () => {
  let tmpDir: string;
  let reader: CachedArtifactReader;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `kaseki-test-${Date.now()}`);
    reader = new CachedArtifactReader(); // Create new cache for CLI

    // Setup fs mocks
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.statSync as jest.Mock).mockReturnValue({ size: 100 });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('CLI artifact reading', () => {
    it('should cache metadata.json reads', () => {
      const metadataPath = path.join(tmpDir, 'kaseki-1', 'metadata.json');
      const metadata = {
        instance_name: 'kaseki-1',
        exit_code: 0,
        status: 'completed',
        duration_seconds: 120,
      };

      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(metadata));

      const result1 = reader.readMetadata(metadataPath);
      const result2 = reader.readMetadata(metadataPath);

      expect(result1).toEqual(metadata);
      expect(result2).toEqual(metadata);
      
      // Second call should hit cache
      const stats = reader.getStats();
      expect(stats.hits).toBeGreaterThan(0);
    });

    it('should cache pi-summary.json reads', () => {
      const piSummaryPath = path.join(tmpDir, 'kaseki-1', 'pi-summary.json');
      const piSummary = {
        total_events: 42,
        tool_executions: 10,
        tokens_used: 15000,
      };

      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(piSummary));

      const result1 = reader.readPiSummary(piSummaryPath);
      const result2 = reader.readPiSummary(piSummaryPath);

      expect(result1).toEqual(piSummary);
      expect(result2).toEqual(piSummary);
    });

    it('should cache changed-files.txt reads', () => {
      const changedFilesPath = path.join(tmpDir, 'kaseki-1', 'changed-files.txt');
      const changedFilesContent = 'src/parser.ts\ntests/parser.test.ts\n';

      (fs.readFileSync as jest.Mock).mockReturnValue(changedFilesContent);

      const result1 = reader.readChangedFiles(changedFilesPath);
      const result2 = reader.readChangedFiles(changedFilesPath);

      expect(result1).toEqual(['src/parser.ts', 'tests/parser.test.ts']);
      expect(result2).toEqual(['src/parser.ts', 'tests/parser.test.ts']);
    });

    it('should cache host-start.json reads', () => {
      const hostStartPath = path.join(tmpDir, 'kaseki-1', 'host-start.json');
      const hostStart = {
        instance_name: 'kaseki-1',
        start_time: '2026-07-28T10:00:00Z',
      };

      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(hostStart));

      const result1 = reader.readJsonArtifact(hostStartPath);
      const result2 = reader.readJsonArtifact(hostStartPath);

      expect(result1).toEqual(hostStart);
      expect(result2).toEqual(hostStart);
    });

    it('should handle missing artifacts gracefully', () => {
      const missingPath = path.join(tmpDir, 'kaseki-1', 'missing.json');

      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const result = reader.readMetadata(missingPath);
      expect(result).toBeNull();
    });

    it('should handle malformed JSON gracefully', () => {
      const malformedPath = path.join(tmpDir, 'kaseki-1', 'malformed.json');

      (fs.readFileSync as jest.Mock).mockReturnValue('{ invalid json }');

      const result = reader.readJsonArtifact(malformedPath);
      expect(result).toBeNull();
    });
  });

  describe('cross-instance cache isolation', () => {
    it('should cache artifacts per instance', () => {
      const metadata1Path = path.join(tmpDir, 'kaseki-1', 'metadata.json');
      const metadata2Path = path.join(tmpDir, 'kaseki-2', 'metadata.json');
      
      const metadata1 = { instance_name: 'kaseki-1' };
      const metadata2 = { instance_name: 'kaseki-2' };

      (fs.readFileSync as jest.Mock)
        .mockReturnValueOnce(JSON.stringify(metadata1))
        .mockReturnValueOnce(JSON.stringify(metadata2));

      const result1 = reader.readMetadata(metadata1Path);
      const result2 = reader.readMetadata(metadata2Path);

      expect(result1).toEqual(metadata1);
      expect(result2).toEqual(metadata2);
      expect(result1).not.toEqual(result2);
    });
  });

  describe('cache invalidation', () => {
    it('should clear cache for specific job', () => {
      const metadataPath = path.join(tmpDir, 'kaseki-1', 'metadata.json');
      const metadata = { instance_name: 'kaseki-1' };

      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(metadata));

      reader.readMetadata(metadataPath);
      reader.clearForJob('kaseki-1');
      
      const statsAfterClear = reader.getStats();
      expect(statsAfterClear.entries).toBe(0);
    });

    it('should clear all cache entries', () => {
      const metadata1Path = path.join(tmpDir, 'kaseki-1', 'metadata.json');
      const metadata2Path = path.join(tmpDir, 'kaseki-2', 'metadata.json');

      (fs.readFileSync as jest.Mock).mockReturnValue('{}');

      reader.readMetadata(metadata1Path);
      reader.readMetadata(metadata2Path);
      
      reader.clearAll();
      
      const statsAfterClear = reader.getStats();
      expect(statsAfterClear.entries).toBe(0);
    });
  });
});
