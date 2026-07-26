import * as fs from 'fs';
import * as path from 'path';
import {
  JobIndexUnavailableError,
  JobPersistenceManager,
  type PersistedJob,
} from './job-persistence-manager';

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
  ctime: number;
  birthtime: number;
  dev: number;
  ino: number;
}

export interface CleanupPlan {
  allRuns: RunInfo[];
  activeRunNames: Set<string>;
  runsToDelete: RunInfo[];
  retainedRunNames: Set<string>;
}

const JOBS_INDEX_NAME = '.kaseki-api-jobs.json';

/** Indicates that cleanup cannot safely determine which scheduler runs are active. */
export class SchedulerStateUnavailableError extends Error {
  constructor(indexPath: string, cause?: unknown) {
    super(`Unable to establish active-job safety from ${indexPath}`, { cause });
    this.name = 'SchedulerStateUnavailableError';
  }
}

function schedulerIndexChanged(before: fs.Stats, after: fs.Stats): boolean {
  return (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  );
}

/** Read the scheduler-owned durable index and return every queued or running run ID. */
export function getActiveRunNames(resultsDir: string): Set<string> {
  const indexPath = path.join(resultsDir, JOBS_INDEX_NAME);
  let descriptor: number;

  try {
    descriptor = fs.openSync(indexPath, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set();
    throw new SchedulerStateUnavailableError(indexPath, error);
  }

  try {
    const before = fs.fstatSync(descriptor);
    const content = fs.readFileSync(descriptor, 'utf-8');
    const after = fs.fstatSync(descriptor);
    const currentPath = fs.statSync(indexPath);
    if (
      schedulerIndexChanged(before, after) ||
      schedulerIndexChanged(after, currentPath)
    ) {
      throw new Error('scheduler index changed while it was being read');
    }

    const parsed = JSON.parse(content) as {
      jobs?: Array<{ id?: unknown; status?: unknown }>;
    };
    if (parsed === null || typeof parsed !== 'object') {
      throw new Error('scheduler index must be an object');
    }
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
    throw new SchedulerStateUnavailableError(indexPath, error);
  } finally {
    try {
      fs.closeSync(descriptor);
    } catch (closeError) {
      console.debug(`Failed to close descriptor for ${indexPath}:`, closeError);
    }
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
    const stats = fs.lstatSync(fullPath);

    if (stats.isDirectory()) {
      runs.push({
        name: entry,
        path: fullPath,
        mtime: stats.mtimeMs,
        ctime: stats.ctimeMs,
        birthtime: stats.birthtimeMs,
        dev: stats.dev,
        ino: stats.ino,
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
        const identity = fs.lstatSync(cacheEntryPath);
        if (!identity.isDirectory() || identity.isSymbolicLink()) continue;
        if (shouldRemoveCacheEntry(cacheEntryPath, retainedRunNames)) {
          if (!dryRun) {
            safelyClaimAndRemoveDirectory(
              cacheDir,
              cacheEntryPath,
              `.kaseki-cache-cleanup-${process.pid}-${Date.now()}`,
              identity,
            );
          }
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
  options: { afterPlanning?: () => void | Promise<void> } = {},
): Promise<CleanupResult> {
  const result: CleanupResult = {
    deletedCount: 0,
    freedBytes: 0,
    cachedEntriesRemoved: 0,
    dryRun,
  };

  const plan = createCleanupPlan(resultsDir, retentionCount);
  if (plan.runsToDelete.length === 0) return result;

  const plannedDescriptors = new Map<string, number>();
  for (const run of plan.runsToDelete) {
    try {
      plannedDescriptors.set(
        run.name,
        fs.openSync(
          run.path,
          fs.constants.O_RDONLY |
            (fs.constants.O_DIRECTORY ?? 0) |
            (fs.constants.O_NOFOLLOW ?? 0),
        ),
      );
    } catch {
      // The lock-scoped identity check will conservatively skip this run.
    }
  }

  try {
    await options.afterPlanning?.();
    const persistence = new JobPersistenceManager({ resultsDir });
    await persistence.withLockedJobsIndex((jobs) => {
      const activeRunNames = activeNamesFromJobs(jobs);
      const retainedRunNames = new Set(plan.retainedRunNames);
      for (const name of activeRunNames) retainedRunNames.add(name);

      for (const run of plan.runsToDelete) {
        if (activeRunNames.has(run.name)) continue;
        try {
          result.freedBytes += getDirectorySize(run.path);
          if (!dryRun) {
            safelyRemovePlannedRun(
              resultsDir,
              run,
              plannedDescriptors.get(run.name),
            );
          }
          result.deletedCount++;
        } catch (error) {
          console.error(`Error deleting run ${run.name}:`, error);
          retainedRunNames.add(run.name);
        }
      }

      result.cachedEntriesRemoved = cleanupCacheDir(
        cacheDir,
        retainedRunNames,
        dryRun,
      );
    });
  } catch (error) {
    if (error instanceof JobIndexUnavailableError) {
      throw new SchedulerStateUnavailableError(
        path.join(resultsDir, JOBS_INDEX_NAME),
        error,
      );
    }
    throw error;
  } finally {
    for (const descriptor of plannedDescriptors.values()) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Best-effort descriptor cleanup.
      }
    }
  }

  return result;
}

function activeNamesFromJobs(jobs: readonly PersistedJob[]): Set<string> {
  return new Set(
    jobs
      .filter((job) => job.status === 'queued' || job.status === 'running')
      .map((job) => job.id)
      .filter((id) => /^kaseki-\d+$/.test(id)),
  );
}

/** Revalidate identity, atomically claim the directory, then remove the claim. */
function safelyRemovePlannedRun(
  resultsDir: string,
  run: RunInfo,
  plannedDescriptor?: number,
): void {
  if (plannedDescriptor === undefined) {
    throw new Error('planned run descriptor is unavailable');
  }
  const before = fs.lstatSync(run.path);
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw new Error('planned run is no longer a real directory');
  }

  safelyClaimAndRemoveDirectory(
    resultsDir,
    run.path,
    `.kaseki-cleanup-${run.name}-${process.pid}-${Date.now()}`,
    before,
    run,
    plannedDescriptor,
  );
}

function safelyClaimAndRemoveDirectory(
  parentDir: string,
  directoryPath: string,
  claimName: string,
  before: fs.Stats,
  planned?: Pick<RunInfo, 'dev' | 'ino' | 'ctime' | 'birthtime'>,
  existingDescriptor?: number,
): void {
  const descriptor =
    existingDescriptor ??
    fs.openSync(
      directoryPath,
      fs.constants.O_RDONLY |
        (fs.constants.O_DIRECTORY ?? 0) |
        (fs.constants.O_NOFOLLOW ?? 0),
    );
  try {
    const opened = fs.fstatSync(descriptor);
    if (
      (planned !== undefined &&
        (before.dev !== planned.dev ||
          before.ino !== planned.ino ||
          before.ctimeMs !== planned.ctime ||
          before.birthtimeMs !== planned.birthtime)) ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      !opened.isDirectory()
    ) {
      throw new Error('planned run identity changed before deletion');
    }

    const claimedPath = path.join(parentDir, claimName);
    fs.renameSync(directoryPath, claimedPath);
    const claimed = fs.lstatSync(claimedPath);
    if (claimed.dev !== opened.dev || claimed.ino !== opened.ino) {
      if (!fs.existsSync(directoryPath)) {
        fs.renameSync(claimedPath, directoryPath);
      }
      throw new Error('cleanup claim identity changed');
    }
    fs.rmSync(claimedPath, { recursive: true, force: true });
  } finally {
    if (existingDescriptor === undefined) fs.closeSync(descriptor);
  }
}
