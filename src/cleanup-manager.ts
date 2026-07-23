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
export interface RunInfo {
  name: string;
  path: string;
  mtime: number;
}

export interface CleanupPlan {
  allRuns: RunInfo[];
  activeRunNames: Set<string>;
  runsToDelete: RunInfo[];
  retainedRunNames: Set<string>;
}

const JOBS_INDEX_NAME = '.kaseki-api-jobs.json';

/** Read the scheduler-owned durable index and return every queued or running run ID. */
export function getActiveRunNames(resultsDir: string): Set<string> {
  const indexPath = path.join(resultsDir, JOBS_INDEX_NAME);
  if (!fs.existsSync(indexPath)) return new Set();

  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as {
      jobs?: Array<{ id?: unknown; status?: unknown }>;
    };
    if (parsed.jobs !== undefined && !Array.isArray(parsed.jobs)) {
      throw new Error('jobs must be an array');
    }

    return new Set(
      (parsed.jobs ?? [])
        .filter((job) => job.status === 'queued' || job.status === 'running')
        .map((job) => job.id)
        .filter(
          (id): id is string =>
            typeof id === 'string' && /^kaseki-\d+$/.test(id),
        ),
    );
  } catch (error) {
    // If the scheduler state is unreadable, fail open to allow terminal run cleanup
    // while avoiding deletion of potentially active runs.
    console.error(`Unable to read active runs from ${indexPath}:`, error);
    return new Set();
  }
}

/** Build a retention plan after excluding active scheduler jobs. */
export function createCleanupPlan(
  resultsDir: string,
  retentionCount: number,
): CleanupPlan {
  const allRuns = listRuns(resultsDir);
  const activeRunNames = getActiveRunNames(resultsDir);
  const terminalRuns = allRuns.filter((run) => !activeRunNames.has(run.name));
  const runsToDelete = terminalRuns.slice(retentionCount);
  const deletedRunNames = new Set(runsToDelete.map((run) => run.name));
  // Calculate this after active-run exclusion so their cache associations survive.
  const retainedRunNames = new Set(
    allRuns
      .filter((run) => !deletedRunNames.has(run.name))
      .map((run) => run.name),
  );
  for (const activeRunName of activeRunNames) {
    retainedRunNames.add(activeRunName);
  }

  return { allRuns, activeRunNames, runsToDelete, retainedRunNames };
}

/** Refresh active scheduler state and remove newly active runs from a plan. */
export function refreshCleanupPlanActiveRuns(
  resultsDir: string,
  plan: CleanupPlan,
): CleanupPlan {
  const activeRunNames = getActiveRunNames(resultsDir);
  const retainedRunNames = new Set(plan.retainedRunNames);
  for (const activeRunName of activeRunNames) {
    retainedRunNames.add(activeRunName);
  }

  return {
    ...plan,
    activeRunNames,
    runsToDelete: plan.runsToDelete.filter(
      (run) => !activeRunNames.has(run.name),
    ),
    retainedRunNames,
  };
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
    console.debug(
      `Error reading cache entry runs from ${usedByRunsFile}:`,
      error,
    );
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
  return Array.from(associatedRuns).every(
    (runName) => !retainedRunNames.has(runName),
  );
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
          if (!dryRun)
            fs.rmSync(cacheEntryPath, { recursive: true, force: true });
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

  let plan = createCleanupPlan(
    resultsDir,
    retentionCount,
  );
  if (plan.runsToDelete.length === 0) return result;

  // The scheduler index may have changed since the retention plan was built.
  // Refresh it immediately before deletion so a run that became queued or
  // running in that window is neither removed nor allowed to lose its cache.
  plan = refreshCleanupPlanActiveRuns(resultsDir, plan);

  for (const run of plan.runsToDelete) {
    try {
      result.freedBytes += getDirectorySize(run.path);
      if (!dryRun) fs.rmSync(run.path, { recursive: true, force: true });
      result.deletedCount++;
    } catch (error) {
      console.error(`Error deleting run ${run.name}:`, error);
    }
  }

  result.cachedEntriesRemoved = cleanupCacheDir(
    cacheDir,
    plan.retainedRunNames,
    dryRun,
  );

  return result;
}
