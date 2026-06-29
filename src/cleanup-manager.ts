import * as fs from 'fs';
import * as path from 'path';

/**
 * Result structure returned by cleanupOldRuns
 */
export interface CleanupResult {
  deletedCount: number;
  freedBytes: number;
  cachedEntriesRemoved: number;
  dryRun: boolean;
}

/**
 * Run metadata with directory path and mtime
 */
interface RunInfo {
  name: string;
  path: string;
  mtime: number;
}

/**
 * List all kaseki runs in the results directory, sorted by mtime (newest first)
 */
export function listRuns(resultsDir: string): RunInfo[] {
  if (!fs.existsSync(resultsDir)) {
    return [];
  }

  const entries = fs.readdirSync(resultsDir);
  const runs: RunInfo[] = [];

  for (const entry of entries) {
    // Only process kaseki-N directories
    if (!entry.match(/^kaseki-\d+$/)) {
      continue;
    }

    const fullPath = path.join(resultsDir, entry);
    const stats = fs.statSync(fullPath);

    if (stats.isDirectory()) {
      runs.push({
        name: entry,
        path: fullPath,
        mtime: stats.mtimeMs,
      });
    }
  }

  // Sort by mtime descending (newest first)
  runs.sort((a, b) => b.mtime - a.mtime);

  return runs;
}

/**
 * Calculate total size of a directory recursively
 */
export function getDirectorySize(dirPath: string): number {
  let totalSize = 0;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        totalSize += getDirectorySize(fullPath);
      } else {
        const stats = fs.statSync(fullPath);
        totalSize += stats.size;
      }
    }
  } catch (error) {
    // Silently handle errors (e.g., permission denied)
    console.debug(`Error calculating size for ${dirPath}:`, error);
  }

  return totalSize;
}

/**
 * Read the set of run names associated with a cache entry from its .used-by-runs file.
 * Returns an empty set if the file is absent or unreadable.
 */
export function getCacheEntryRuns(cacheEntryPath: string): Set<string> {
  const runSet = new Set<string>();
  const usedByRunsFile = path.join(cacheEntryPath, '.used-by-runs');

  try {
    if (fs.existsSync(usedByRunsFile)) {
      const content = fs.readFileSync(usedByRunsFile, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length > 0) runSet.add(trimmed);
      }
    }
  } catch (error) {
    console.debug(`Error reading cache entry runs from ${usedByRunsFile}:`, error);
  }

  return runSet;
}

/**
 * Determine whether a cache directory entry should be removed.
 * Returns true only when the entry has a non-empty .used-by-runs file and
 * every referenced run has been deleted (i.e., is absent from retainedRunNames).
 */
export function shouldRemoveCacheEntry(
  cacheEntryPath: string,
  retainedRunNames: Set<string>,
): boolean {
  const associatedRuns = getCacheEntryRuns(cacheEntryPath);
  if (associatedRuns.size === 0) return false;
  return Array.from(associatedRuns).every((runName) => !retainedRunNames.has(runName));
}

/**
 * Sweep the cache directory and remove entries whose associated runs are all deleted.
 * Returns the number of cache entries removed.
 */
export function cleanupCacheDir(
  cacheDir: string,
  retainedRunNames: Set<string>,
  dryRun: boolean,
): number {
  if (!fs.existsSync(cacheDir)) return 0;

  let removed = 0;
  try {
    const entries = fs.readdirSync(cacheDir);
    for (const entry of entries) {
      const cacheEntryPath = path.join(cacheDir, entry);
      try {
        if (!fs.statSync(cacheEntryPath).isDirectory()) continue;
        if (shouldRemoveCacheEntry(cacheEntryPath, retainedRunNames)) {
          if (!dryRun) fs.rmSync(cacheEntryPath, { recursive: true, force: true });
          removed++;
        }
      } catch (error) {
        console.debug(`Error processing cache entry ${entry}:`, error);
      }
    }
  } catch (error) {
    console.debug('Error scanning cache directory:', error);
  }

  return removed;
}

/**
 * Clean up old runs, keeping only the most recent N runs.
 * Also removes cache entries that are no longer associated with any remaining run.
 *
 * @param resultsDir - Path to /agents/kaseki-results directory
 * @param cacheDir - Path to /agents/kaseki-cache directory
 * @param retentionCount - Number of recent runs to keep
 * @param dryRun - If true, report what would be deleted without actually deleting
 * @returns CleanupResult with deletion stats
 */
export async function cleanupOldRuns(
  resultsDir: string,
  cacheDir: string,
  retentionCount: number,
  dryRun: boolean = false,
): Promise<CleanupResult> {
  const result: CleanupResult = {
    deletedCount: 0,
    freedBytes: 0,
    cachedEntriesRemoved: 0,
    dryRun,
  };

  const allRuns = listRuns(resultsDir);
  const runsToDelete = allRuns.slice(retentionCount);
  if (runsToDelete.length === 0) return result;

  const retainedRunNames = new Set(allRuns.slice(0, retentionCount).map((r) => r.name));

  for (const run of runsToDelete) {
    try {
      result.freedBytes += getDirectorySize(run.path);
      if (!dryRun) fs.rmSync(run.path, { recursive: true, force: true });
      result.deletedCount++;
    } catch (error) {
      console.error(`Error deleting run ${run.name}:`, error);
    }
  }

  result.cachedEntriesRemoved = cleanupCacheDir(cacheDir, retainedRunNames, dryRun);

  return result;
}
