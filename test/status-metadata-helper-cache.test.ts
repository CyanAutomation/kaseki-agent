import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StatusMetadataHelper } from '../src/utils/status-response-metadata-helper';
import { CachedArtifactReader } from '../src/utils/cached-artifact-reader';
import type { Job } from '../src/kaseki-api-types';

describe('StatusMetadataHelper with CachedArtifactReader', () => {
  let tempDir: string;
  let helper: StatusMetadataHelper;
  let reader: CachedArtifactReader;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'status-metadata-helper-test-'));
    reader = new CachedArtifactReader();
    helper = new StatusMetadataHelper(reader);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('readMetadata with cache', () => {
    it('should read metadata through cache', () => {
      const metadataPath = join(tempDir, 'metadata.json');
      const metadata = { instance_name: 'kaseki-test', exit_code: 0 };
      writeFileSync(metadataPath, JSON.stringify(metadata));

      const result = helper.readMetadata(tempDir);

      expect(result.instance_name).toBe('kaseki-test');
      expect(result.exit_code).toBe(0);
    });

    it('should use cache on second read', () => {
      const metadataPath = join(tempDir, 'metadata.json');
      const metadata = { instance_name: 'kaseki-cache', exit_code: 0 };
      writeFileSync(metadataPath, JSON.stringify(metadata));

      // First read - cache miss
      helper.readMetadata(tempDir);
      const stats1 = reader.getStats();

      // Second read - cache hit
      helper.readMetadata(tempDir);
      const stats2 = reader.getStats();

      expect(stats1.misses).toBe(1);
      expect(stats1.hits).toBe(0);
      expect(stats2.hits).toBe(1);
    });

    it('should return empty object for missing metadata', () => {
      const result = helper.readMetadata(join(tempDir, 'nonexistent'));

      expect(result).toEqual({});
    });
  });

  describe('resolveExitCode with cache', () => {
    it('should resolve exit code from metadata through cache', () => {
      const runDir = join(tempDir, 'kaseki-1');
      const metadataPath = join(runDir, 'metadata.json');
      const metadata = { exit_code: 42 };
      writeFileSync(runDir, '', { flag: 'wx' });
      rmSync(runDir);
      const { mkdirSync } = require('node:fs');
      mkdirSync(runDir, { recursive: true });
      writeFileSync(metadataPath, JSON.stringify(metadata));

      const job: Partial<Job> = {
        id: 'kaseki-1',
        status: 'completed',
      };

      const exitCode = helper.resolveExitCode(job as Job, runDir);

      expect(exitCode).toBe(42);
    });

    it('should prefer job exitCode over metadata', () => {
      const runDir = join(tempDir, 'kaseki-2');
      const job: Partial<Job> = {
        id: 'kaseki-2',
        status: 'completed',
        exitCode: 100,
      };

      const exitCode = helper.resolveExitCode(job as Job, runDir);

      expect(exitCode).toBe(100);
    });

    it('should return null for running jobs', () => {
      const runDir = join(tempDir, 'kaseki-3');
      const job: Partial<Job> = {
        id: 'kaseki-3',
        status: 'running',
      };

      const exitCode = helper.resolveExitCode(job as Job, runDir);

      expect(exitCode).toBeNull();
    });
  });

  describe('cache statistics', () => {
    it('should track cache usage across multiple calls', () => {
      const dir1 = join(tempDir, 'job1');
      const dir2 = join(tempDir, 'job2');
      const { mkdirSync } = require('node:fs');
      mkdirSync(dir1, { recursive: true });
      mkdirSync(dir2, { recursive: true });
      writeFileSync(join(dir1, 'metadata.json'), '{"exit_code": 1}');
      writeFileSync(join(dir2, 'metadata.json'), '{"exit_code": 2}');

      // Read both
      helper.readMetadata(dir1);
      helper.readMetadata(dir2);

      // Re-read first (cache hit)
      helper.readMetadata(dir1);

      const stats = reader.getStats();

      expect(stats.entries).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.hits).toBe(1);
    });
  });
});
