import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  cleanupCacheDir,
  cleanupOldRuns,
  createCleanupPlan,
  getActiveRunNames,
  getCacheEntryRuns,
  getDirectorySize,
  listRuns,
  shouldRemoveCacheEntry,
} from '../src/cleanup-manager';

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
      expect(runs.map((r) => r.name)).toEqual([
        'kaseki-2',
        'kaseki-5',
        'kaseki-1',
        'kaseki-3',
      ]);
    });
  });

  describe('cleanupOldRuns()', () => {
    it('keeps the most recent N runs', async () => {
      // Create 5 runs
      const now = Date.now() / 1000; // Convert to seconds
      for (let i = 1; i <= 5; i++) {
        const runPath = path.join(resultsDir, `kaseki-${i}`);
        fs.mkdirSync(runPath);
        fs.writeFileSync(
          path.join(runPath, 'metadata.json'),
          '{"instance":"kaseki-' + i + '"}',
        );
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
        fs.writeFileSync(
          path.join(runPath, 'metadata.json'),
          JSON.stringify({ instance: `kaseki-${i}` }, null, 2),
        );
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
      fs.writeFileSync(
        path.join(cacheEntry1, '.used-by-runs'),
        'kaseki-1\nkaseki-2',
      );
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
      fs.writeFileSync(
        path.join(cacheEntry1, '.used-by-runs'),
        'kaseki-1\nkaseki-2',
      );

      // Create cache entry used by kaseki-1 and kaseki-4 (kaseki-4 is kept)
      const cacheEntry2 = path.join(cacheDir, 'cache-def456');
      fs.mkdirSync(cacheEntry2, { recursive: true });
      fs.writeFileSync(
        path.join(cacheEntry2, '.used-by-runs'),
        'kaseki-1\nkaseki-4',
      );

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

    it('excludes an old active run and preserves its cache with retention count 0', async () => {
      const now = Date.now() / 1000;
      for (let i = 1; i <= 3; i++) {
        const runPath = path.join(resultsDir, `kaseki-${i}`);
        fs.mkdirSync(runPath);
        fs.utimesSync(runPath, now - (4 - i) * 1000, now - (4 - i) * 1000);
      }
      fs.writeFileSync(
        path.join(resultsDir, '.kaseki-api-jobs.json'),
        JSON.stringify({
          jobs: [
            { id: 'kaseki-1', status: 'running' },
            { id: 'kaseki-2', status: 'completed' },
            { id: 'kaseki-3', status: 'failed' },
          ],
        }),
      );
      const activeCache = path.join(cacheDir, 'active-cache');
      const terminalCache = path.join(cacheDir, 'terminal-cache');
      fs.mkdirSync(activeCache);
      fs.mkdirSync(terminalCache);
      fs.writeFileSync(path.join(activeCache, '.used-by-runs'), 'kaseki-1\n');
      fs.writeFileSync(
        path.join(terminalCache, '.used-by-runs'),
        'kaseki-2\nkaseki-3\n',
      );

      const plan = createCleanupPlan(resultsDir, 0);
      expect(getActiveRunNames(resultsDir)).toEqual(new Set(['kaseki-1']));
      expect(plan.runsToDelete.map((run) => run.name)).toEqual([
        'kaseki-3',
        'kaseki-2',
      ]);
      expect(plan.retainedRunNames).toEqual(new Set(['kaseki-1']));

      const result = await cleanupOldRuns(resultsDir, cacheDir, 0, false);

      expect(result.deletedCount).toBe(2);
      expect(fs.existsSync(path.join(resultsDir, 'kaseki-1'))).toBe(true);
      expect(fs.existsSync(path.join(resultsDir, 'kaseki-2'))).toBe(false);
      expect(fs.existsSync(path.join(resultsDir, 'kaseki-3'))).toBe(false);
      expect(fs.existsSync(activeCache)).toBe(true);
      expect(fs.existsSync(terminalCache)).toBe(false);
      expect(result.cachedEntriesRemoved).toBe(1);
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

// ─── Extracted helper unit tests ─────────────────────────────────────────────

describe('getDirectorySize', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'getdirsize-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns 0 for empty directory', () => {
    expect(getDirectorySize(tmp)).toBe(0);
  });

  it('sums file sizes recursively', () => {
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'hello'); // 5 bytes
    const sub = path.join(tmp, 'sub');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'b.txt'), 'world!'); // 6 bytes
    expect(getDirectorySize(tmp)).toBe(11);
  });

  it('returns 0 for non-existent directory (error silently caught)', () => {
    expect(getDirectorySize(path.join(tmp, 'nope'))).toBe(0);
  });
});

describe('getCacheEntryRuns', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cacheentry-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns empty set when .used-by-runs absent', () => {
    expect(getCacheEntryRuns(tmp).size).toBe(0);
  });

  it('parses run names from .used-by-runs file', () => {
    fs.writeFileSync(path.join(tmp, '.used-by-runs'), 'kaseki-1\nkaseki-2\n');
    const result = getCacheEntryRuns(tmp);
    expect(result.has('kaseki-1')).toBe(true);
    expect(result.has('kaseki-2')).toBe(true);
    expect(result.size).toBe(2);
  });

  it('ignores blank lines', () => {
    fs.writeFileSync(path.join(tmp, '.used-by-runs'), 'kaseki-3\n\n\n');
    expect(getCacheEntryRuns(tmp).size).toBe(1);
  });
});

describe('shouldRemoveCacheEntry', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shouldremove-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns false when no .used-by-runs file (unknown origin)', () => {
    expect(shouldRemoveCacheEntry(tmp, new Set(['kaseki-1']))).toBe(false);
  });

  it('returns false when one associated run is still retained', () => {
    fs.writeFileSync(path.join(tmp, '.used-by-runs'), 'kaseki-1\nkaseki-2');
    expect(shouldRemoveCacheEntry(tmp, new Set(['kaseki-2']))).toBe(false);
  });

  it('returns true when all associated runs have been deleted', () => {
    fs.writeFileSync(path.join(tmp, '.used-by-runs'), 'kaseki-1\nkaseki-2');
    expect(shouldRemoveCacheEntry(tmp, new Set(['kaseki-3']))).toBe(true);
  });

  it('returns false for empty retained set when runs listed', () => {
    fs.writeFileSync(path.join(tmp, '.used-by-runs'), 'kaseki-1');
    expect(shouldRemoveCacheEntry(tmp, new Set())).toBe(true);
  });
});

describe('cleanupCacheDir', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanupcache-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns 0 when cache dir does not exist', () => {
    expect(cleanupCacheDir(path.join(tmp, 'missing'), new Set(), false)).toBe(
      0,
    );
  });

  it('removes cache entries whose runs are all deleted', () => {
    const entry = path.join(tmp, 'entry1');
    fs.mkdirSync(entry);
    fs.writeFileSync(path.join(entry, '.used-by-runs'), 'kaseki-1');
    const removed = cleanupCacheDir(tmp, new Set(['kaseki-2']), false);
    expect(removed).toBe(1);
    expect(fs.existsSync(entry)).toBe(false);
  });

  it('keeps cache entries with retained runs', () => {
    const entry = path.join(tmp, 'entry1');
    fs.mkdirSync(entry);
    fs.writeFileSync(path.join(entry, '.used-by-runs'), 'kaseki-1');
    const removed = cleanupCacheDir(tmp, new Set(['kaseki-1']), false);
    expect(removed).toBe(0);
    expect(fs.existsSync(entry)).toBe(true);
  });

  it('respects dryRun=true (does not delete)', () => {
    const entry = path.join(tmp, 'entry1');
    fs.mkdirSync(entry);
    fs.writeFileSync(path.join(entry, '.used-by-runs'), 'kaseki-1');
    const removed = cleanupCacheDir(tmp, new Set(), true);
    expect(removed).toBe(1); // counted
    expect(fs.existsSync(entry)).toBe(true); // not deleted
  });
});
