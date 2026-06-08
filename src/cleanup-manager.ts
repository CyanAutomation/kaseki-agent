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
function getDirectorySize(dirPath: string): number {
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
 * Get all runs associated with a cache entry
 */
function getCacheEntryRuns(cacheEntryPath: string): Set<string> {
  const runSet = new Set<string>();
  const usedByRunsFile = path.join(cacheEntryPath, '.used-by-runs');

  try {
    if (fs.existsSync(usedByRunsFile)) {
      const content = fs.readFileSync(usedByRunsFile, 'utf-8');
      const runNames = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

      for (const runName of runNames) {
        runSet.add(runName);
      }
    }
  } catch (error) {
    // Silently handle errors reading malformed files
    console.debug(`Error reading cache entry runs from ${usedByRunsFile}:`, error);
  }

  return runSet;
}

/**
 * Clean up old runs, keeping only the most recent N runs
 * Also removes cache entries that are no longer associated with any remaining run
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
  dryRun: boolean = false
): Promise<CleanupResult> {
  const result: CleanupResult = {
    deletedCount: 0,
    freedBytes: 0,
    cachedEntriesRemoved: 0,
    dryRun,
  };

  // List all runs
  const allRuns = listRuns(resultsDir);

  // Determine which runs to delete (all except the most recent N)
  const runsToDelete = allRuns.slice(retentionCount);

  if (runsToDelete.length === 0) {
    return result; // Nothing to delete
  }

  // Track which runs will still exist after cleanup
  const retainedRunNames = new Set(allRuns.slice(0, retentionCount).map(r => r.name));

  // Delete old runs
  for (const run of runsToDelete) {
    try {
      // Calculate size before deletion
      const runSize = getDirectorySize(run.path);
      result.freedBytes += runSize;

      if (!dryRun) {
        fs.rmSync(run.path, { recursive: true, force: true });
      }

      result.deletedCount++;
    } catch (error) {
      console.error(`Error deleting run ${run.name}:`, error);
      // Continue with next run instead of failing entirely
    }
  }

  // Clean up cache entries for deleted runs
  if (fs.existsSync(cacheDir)) {
    try {
      const cacheEntries = fs.readdirSync(cacheDir);

      for (const entry of cacheEntries) {
        const cacheEntryPath = path.join(cacheDir, entry);

        try {
          if (fs.statSync(cacheEntryPath).isDirectory()) {
            const associatedRuns = getCacheEntryRuns(cacheEntryPath);

            // Check if any associated run still exists
            let shouldDelete = false;

            if (associatedRuns.size === 0) {
              // Cache entry has no .used-by-runs file or is empty - leave it alone
              shouldDelete = false;
            } else {
              // Delete if all associated runs are gone
              shouldDelete = Array.from(associatedRuns).every(runName => !retainedRunNames.has(runName));
            }

            if (shouldDelete) {
              if (!dryRun) {
                fs.rmSync(cacheEntryPath, { recursive: true, force: true });
              }
              result.cachedEntriesRemoved++;
            }
          }
        } catch (error) {
          console.debug(`Error processing cache entry ${entry}:`, error);
          // Continue with next entry
        }
      }
    } catch (error) {
      console.debug('Error scanning cache directory:', error);
    }
  }

  return result;
}
