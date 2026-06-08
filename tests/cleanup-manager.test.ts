import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { cleanupOldRuns, listRuns } from '../src/cleanup-manager';

describe('cleanup-manager', () => {
  let tempDir: string;
  let resultsDir: string;
  let cacheDir: string;

  beforeEach(() => {
    // Create temporary directory structure for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-test-'));
    resultsDir = path.join(tempDir, 'kaseki-results');
    cacheDir = path.join(tempDir, 'kaseki-cache');
    fs.mkdirSync(resultsDir, { recursive: true });
    fs.mkdirSync(cacheDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('listRuns()', () => {
    it('returns empty array when no runs exist', () => {
      const runs = listRuns(resultsDir);
      expect(runs).toEqual([]);
    });

    it('lists runs with their mtimes', () => {
      // Create test runs with controlled mtimes
      const run1 = path.join(resultsDir, 'kaseki-1');
      const run2 = path.join(resultsDir, 'kaseki-2');
      fs.mkdirSync(run1);
      fs.mkdirSync(run2);

      // Set mtime: kaseki-1 older, kaseki-2 newer
      const now = Date.now();
      fs.utimesSync(run1, (now - 100000) / 1000, (now - 100000) / 1000);
      fs.utimesSync(run2, now / 1000, now / 1000);

      const runs = listRuns(resultsDir);
      expect(runs.length).toBe(2);
      // Should be sorted newest first
      expect(runs[0].name).toBe('kaseki-2');
      expect(runs[1].name).toBe('kaseki-1');
    });

    it('ignores non-run directories and files', () => {
      fs.mkdirSync(path.join(resultsDir, 'kaseki-1'));
      fs.mkdirSync(path.join(resultsDir, 'other-dir'));
      fs.writeFileSync(path.join(resultsDir, 'file.txt'), 'test');

      const runs = listRuns(resultsDir);
      expect(runs.length).toBe(1);
      expect(runs[0].name).toBe('kaseki-1');
    });

    it('sorts runs by mtime descending (newest first)', () => {
      const now = Date.now() / 1000; // Convert to seconds
      const runNames = ['kaseki-3', 'kaseki-1', 'kaseki-5', 'kaseki-2'];

      runNames.forEach((name, index) => {
        const runPath = path.join(resultsDir, name);
        fs.mkdirSync(runPath);
        // Set mtimes: kaseki-3 oldest, kaseki-2 newest
        const mtime = now - 400000 + index * 100000;
        fs.utimesSync(runPath, mtime, mtime);
      });

      const runs = listRuns(resultsDir);
      // kaseki-2 newest (now - 100000), kaseki-5 (now - 200000), kaseki-1 (now - 300000), kaseki-3 oldest (now - 400000)
      expect(runs.map(r => r.name)).toEqual(['kaseki-2', 'kaseki-5', 'kaseki-1', 'kaseki-3']);
    });
  });

  describe('cleanupOldRuns()', () => {
    it('keeps the most recent N runs', async () => {
      // Create 5 runs
      const now = Date.now() / 1000; // Convert to seconds
      for (let i = 1; i <= 5; i++) {
        const runPath = path.join(resultsDir, `kaseki-${i}`);
        fs.mkdirSync(runPath);
        fs.writeFileSync(path.join(runPath, 'metadata.json'), '{"instance":"kaseki-' + i + '"}');
        const mtime = now - 500000 + i * 100000;
        fs.utimesSync(runPath, mtime, mtime);
      }

      const result = await cleanupOldRuns(resultsDir, cacheDir, 3, false);

      expect(result.deletedCount).toBe(2);
      expect(fs.existsSync(path.join(resultsDir, 'kaseki-5'))).toBe(true);
      expect(fs.existsSync(path.join(resultsDir, 'kaseki-4'))).toBe(true);
      expect(fs.existsSync(path.join(resultsDir, 'kaseki-3'))).toBe(true);
      expect(fs.existsSync(path.join(resultsDir, 'kaseki-2'))).toBe(false);
      expect(fs.existsSync(path.join(resultsDir, 'kaseki-1'))).toBe(false);
    });

    it('does nothing when run count is at or below retention limit', async () => {
      const now = Date.now() / 1000; // Convert to seconds
      for (let i = 1; i <= 3; i++) {
        const runPath = path.join(resultsDir, `kaseki-${i}`);
        fs.mkdirSync(runPath);
        const mtime = now - 400000 + i * 100000;
        fs.utimesSync(runPath, mtime, mtime);
      }

      const result = await cleanupOldRuns(resultsDir, cacheDir, 5, false);

      expect(result.deletedCount).toBe(0);
      expect(fs.existsSync(path.join(resultsDir, 'kaseki-1'))).toBe(true);
      expect(fs.existsSync(path.join(resultsDir, 'kaseki-2'))).toBe(true);
      expect(fs.existsSync(path.join(resultsDir, 'kaseki-3'))).toBe(true);
    });

    it('respects dryRun flag and does not delete when true', async () => {
      const now = Date.now() / 1000; // Convert to seconds
      for (let i = 1; i <= 5; i++) {
        const runPath = path.join(resultsDir, `kaseki-${i}`);
        fs.mkdirSync(runPath);
        const mtime = now - 500000 + i * 100000;
        fs.utimesSync(runPath, mtime, mtime);
      }

      const result = await cleanupOldRuns(resultsDir, cacheDir, 2, true);

      expect(result.dryRun).toBe(true);
      expect(result.deletedCount).toBe(3);
      // Verify nothing was actually deleted
      expect(fs.existsSync(path.join(resultsDir, 'kaseki-1'))).toBe(true);
      expect(fs.existsSync(path.join(resultsDir, 'kaseki-5'))).toBe(true);
    });

    it('calculates freed bytes estimate from deleted runs', async () => {
      const now = Date.now() / 1000; // Convert to seconds
      for (let i = 1; i <= 3; i++) {
        const runPath = path.join(resultsDir, `kaseki-${i}`);
        fs.mkdirSync(runPath);
        // Write test files with known sizes
        fs.writeFileSync(path.join(runPath, 'metadata.json'), JSON.stringify({ instance: `kaseki-${i}` }, null, 2));
        fs.writeFileSync(path.join(runPath, 'git.diff'), 'x'.repeat(100000)); // 100KB
        const mtime = now - 300000 + i * 100000;
        fs.utimesSync(runPath, mtime, mtime);
      }

      const result = await cleanupOldRuns(resultsDir, cacheDir, 1, false);

      expect(result.deletedCount).toBe(2);
      expect(result.freedBytes).toBeGreaterThan(0);
      expect(result.freedBytes).toBeGreaterThanOrEqual(200000); // At least 200KB
    });

    it('removes cache entries linked to deleted runs', async () => {
      // Create runs
      const now = Date.now() / 1000; // Convert to seconds
      for (let i = 1; i <= 3; i++) {
        const runPath = path.join(resultsDir, `kaseki-${i}`);
        fs.mkdirSync(runPath);
        const mtime = now - 300000 + i * 100000;
        fs.utimesSync(runPath, mtime, mtime);
      }

      // Create cache entries with run associations
      const cacheEntry1 = path.join(cacheDir, 'cache-abc123');
      const cacheEntry2 = path.join(cacheDir, 'cache-def456');
      fs.mkdirSync(cacheEntry1, { recursive: true });
      fs.mkdirSync(cacheEntry2, { recursive: true });
      fs.writeFileSync(path.join(cacheEntry1, '.used-by-runs'), 'kaseki-1\nkaseki-2');
      fs.writeFileSync(path.join(cacheEntry2, '.used-by-runs'), 'kaseki-3');

      const result = await cleanupOldRuns(resultsDir, cacheDir, 1, false);

      expect(result.deletedCount).toBe(2);
      // Cache entries for deleted runs (kaseki-1, kaseki-2) should be removed
      expect(fs.existsSync(cacheEntry1)).toBe(false);
      // Cache entry for retained run (kaseki-3) should remain
      expect(fs.existsSync(cacheEntry2)).toBe(true);
      expect(result.cachedEntriesRemoved).toBe(1);
    });

    it('handles cache entries shared by multiple runs correctly', async () => {
      // Create runs
      const now = Date.now() / 1000; // Convert to seconds
      for (let i = 1; i <= 4; i++) {
        const runPath = path.join(resultsDir, `kaseki-${i}`);
        fs.mkdirSync(runPath);
        const mtime = now - 400000 + i * 100000;
        fs.utimesSync(runPath, mtime, mtime);
      }

      // Create cache entry used by kaseki-1 and kaseki-2 (both will be deleted)
      const cacheEntry1 = path.join(cacheDir, 'cache-abc123');
      fs.mkdirSync(cacheEntry1, { recursive: true });
      fs.writeFileSync(path.join(cacheEntry1, '.used-by-runs'), 'kaseki-1\nkaseki-2');

      // Create cache entry used by kaseki-1 and kaseki-4 (kaseki-4 is kept)
      const cacheEntry2 = path.join(cacheDir, 'cache-def456');
      fs.mkdirSync(cacheEntry2, { recursive: true });
      fs.writeFileSync(path.join(cacheEntry2, '.used-by-runs'), 'kaseki-1\nkaseki-4');

      const result = await cleanupOldRuns(resultsDir, cacheDir, 2, false);

      // Only the first cache entry should be deleted (both its runs are gone)
      expect(fs.existsSync(cacheEntry1)).toBe(false);
      // The second cache entry should remain (kaseki-4 is kept)
      expect(fs.existsSync(cacheEntry2)).toBe(true);
      expect(result.cachedEntriesRemoved).toBe(1);
    });

    it('handles malformed .used-by-runs files gracefully', async () => {
      // Create a run
      const now = Date.now();
      const runPath = path.join(resultsDir, 'kaseki-1');
      fs.mkdirSync(runPath);
      fs.utimesSync(runPath, now - 1000, now - 1000);

      // Create cache entry with malformed .used-by-runs
      const cacheEntry = path.join(cacheDir, 'cache-abc');
      fs.mkdirSync(cacheEntry, { recursive: true });
      fs.writeFileSync(path.join(cacheEntry, '.used-by-runs'), 'invalid data');

      // Should not throw, should handle gracefully
      const result = await cleanupOldRuns(resultsDir, cacheDir, 5, false);
      expect(result).toBeDefined();
      expect(result.deletedCount).toBe(0);
    });

    it('returns correct structure with all required fields', async () => {
      const now = Date.now();
      for (let i = 1; i <= 3; i++) {
        const runPath = path.join(resultsDir, `kaseki-${i}`);
        fs.mkdirSync(runPath);
        fs.utimesSync(runPath, now - (4 - i) * 1000, now - (4 - i) * 1000);
      }

      const result = await cleanupOldRuns(resultsDir, cacheDir, 1, false);

      expect(result).toHaveProperty('deletedCount');
      expect(result).toHaveProperty('freedBytes');
      expect(result).toHaveProperty('cachedEntriesRemoved');
      expect(result).toHaveProperty('dryRun');
      expect(result.deletedCount).toBeGreaterThan(0);
      expect(result.freedBytes).toBeGreaterThanOrEqual(0);
      expect(result.cachedEntriesRemoved).toBeGreaterThanOrEqual(0);
      expect(result.dryRun).toBe(false);
    });

    it('handles retention count of 0 (delete all)', async () => {
      const now = Date.now() / 1000; // Convert to seconds
      for (let i = 1; i <= 3; i++) {
        const runPath = path.join(resultsDir, `kaseki-${i}`);
        fs.mkdirSync(runPath);
        const mtime = now - 300000 + i * 100000;
        fs.utimesSync(runPath, mtime, mtime);
      }

      const result = await cleanupOldRuns(resultsDir, cacheDir, 0, false);

      expect(result.deletedCount).toBe(3);
      expect(fs.existsSync(path.join(resultsDir, 'kaseki-1'))).toBe(false);
      expect(fs.existsSync(path.join(resultsDir, 'kaseki-2'))).toBe(false);
      expect(fs.existsSync(path.join(resultsDir, 'kaseki-3'))).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles missing results directory gracefully', async () => {
      const nonexistent = path.join(tempDir, 'nonexistent');
      const result = await cleanupOldRuns(nonexistent, cacheDir, 3, false);
      expect(result.deletedCount).toBe(0);
    });

    it('handles permission errors gracefully (dry-run does not require write)', async () => {
      const now = Date.now() / 1000; // Convert to seconds
      for (let i = 1; i <= 3; i++) {
        const runPath = path.join(resultsDir, `kaseki-${i}`);
        fs.mkdirSync(runPath);
        const mtime = now - 300000 + i * 100000;
        fs.utimesSync(runPath, mtime, mtime);
      }

      // Dry run should always succeed
      const result = await cleanupOldRuns(resultsDir, cacheDir, 1, true);
      expect(result.dryRun).toBe(true);
      expect(result.deletedCount).toBe(2);
    });

    it('handles runs with special characters in names', () => {
      // kaseki-N naming should be consistent, but test robustness
      const run1 = path.join(resultsDir, 'kaseki-1');
      const run2 = path.join(resultsDir, 'kaseki-999');
      fs.mkdirSync(run1);
      fs.mkdirSync(run2);

      const runs = listRuns(resultsDir);
      expect(runs.length).toBe(2);
    });
  });
});
