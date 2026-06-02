import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Baseline validation cache management utilities.
 *
 * Caches baseline validation results (from running tests on the original code)
 * to avoid redundant checkout + validation on retries. Cache key includes
 * validation commands so different command sets get different entries.
 *
 * Default: 24-hour expiration
 */

export interface BaselineValidationCacheOptions {
  cacheRoot?: string;
  maxAgeHours?: number;
  disabled?: boolean;
}

export interface CacheMetadata {
  createdAt: number;
  expiresAt: number;
  isValid: boolean;
  ageHours: number;
}

/**
 * Generate cache key based on repo URL, target ref, and validation commands.
 * This ensures different validation command sets don't share cache entries.
 */
export function generateBaselineValidationCacheKey(
  repoUrl: string,
  validationCommands: string
): string {
  const hash = crypto.createHash('sha256');
  hash.update(`${repoUrl}\nmain\n${validationCommands}`);
  return hash.digest('hex');
}

/**
 * Get the cache directory for baseline validation results.
 */
export function getBaselineValidationCacheDir(
  cacheKey: string,
  options: BaselineValidationCacheOptions = {}
): string {
  const cacheRoot =
    options.cacheRoot || process.env.KASEKI_BASELINE_CACHE_ROOT || '/cache/kaseki-baseline';
  return path.join(cacheRoot, cacheKey);
}

/**
 * Check if a cache entry exists and is still valid.
 */
export function isBaselineValidationCacheValid(
  cacheDir: string,
  options: BaselineValidationCacheOptions = {}
): CacheMetadata {
  const maxAgeHours = options.maxAgeHours ?? 24;
  const now = Date.now();
  const metadata: CacheMetadata = {
    createdAt: 0,
    expiresAt: 0,
    isValid: false,
    ageHours: 0,
  };

  // Check required files exist
  const requiredFiles = ['validation.log', 'validation-timings.tsv'];
  for (const file of requiredFiles) {
    if (!fs.existsSync(path.join(cacheDir, file))) {
      return metadata;
    }
  }

  // Check age
  try {
    const stats = fs.statSync(path.join(cacheDir, 'validation.log'));
    const ageMs = now - stats.mtimeMs;
    const ageHours = ageMs / (1000 * 60 * 60);

    metadata.createdAt = stats.mtimeMs;
    metadata.expiresAt = stats.mtimeMs + maxAgeHours * 60 * 60 * 1000;
    metadata.ageHours = ageHours;
    metadata.isValid = ageHours < maxAgeHours;
  } catch {
    return metadata;
  }

  return metadata;
}

/**
 * Restore baseline validation results from cache.
 * Returns true if successful, false if cache doesn't exist or is invalid.
 */
export function restoreBaselineValidationFromCache(
  cacheDir: string,
  resultsDir: string = '/results',
  options: BaselineValidationCacheOptions = {}
): boolean {
  if (options.disabled) {
    return false;
  }

  const metadata = isBaselineValidationCacheValid(cacheDir, options);
  if (!metadata.isValid) {
    return false;
  }

  // Copy cached files to results directory
  const filesToRestore = [
    { src: 'validation.log', dst: 'validation-baseline.log' },
    { src: 'validation-raw.log', dst: 'validation-baseline-raw.log' },
    { src: 'validation-timings.tsv', dst: 'validation-baseline-timings.tsv' },
    { src: 'validation-env.log', dst: 'validation-baseline-env.log', optional: true },
  ];

  try {
    fs.mkdirSync(resultsDir, { recursive: true });

    for (const file of filesToRestore) {
      const srcPath = path.join(cacheDir, file.src);
      const dstPath = path.join(resultsDir, file.dst);

      if (!fs.existsSync(srcPath)) {
        if (!file.optional) {
          return false;
        }
        continue;
      }

      fs.copyFileSync(srcPath, dstPath);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Save baseline validation results to cache.
 * Returns true if successful, false if save fails (non-blocking).
 */
export function saveBaselineValidationToCache(
  cacheDir: string,
  resultsDir: string = '/results',
  options: BaselineValidationCacheOptions = {}
): boolean {
  if (options.disabled) {
    return false;
  }

  const filesToSave = [
    { src: 'validation-baseline.log', dst: 'validation.log' },
    { src: 'validation-baseline-raw.log', dst: 'validation-raw.log' },
    { src: 'validation-baseline-timings.tsv', dst: 'validation-timings.tsv' },
    { src: 'validation-baseline-env.log', dst: 'validation-env.log', optional: true },
  ];

  try {
    fs.mkdirSync(cacheDir, { recursive: true });

    for (const file of filesToSave) {
      const srcPath = path.join(resultsDir, file.src);
      const dstPath = path.join(cacheDir, file.dst);

      if (!fs.existsSync(srcPath)) {
        if (!file.optional) {
          return false;
        }
        continue;
      }

      fs.copyFileSync(srcPath, dstPath);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Get cache statistics for display/logging.
 */
export function getBaselineValidationCacheStats(
  cacheDir: string,
  options: BaselineValidationCacheOptions = {}
): {
  exists: boolean;
  valid: boolean;
  metadata: CacheMetadata;
  sizeBytes: number;
} {
  const metadata = isBaselineValidationCacheValid(cacheDir, options);
  let sizeBytes = 0;

  if (fs.existsSync(cacheDir)) {
    try {
      const files = fs.readdirSync(cacheDir);
      for (const file of files) {
        const filePath = path.join(cacheDir, file);
        const stats = fs.statSync(filePath);
        if (stats.isFile()) {
          sizeBytes += stats.size;
        }
      }
    } catch {
      // Ignore errors
    }
  }

  return {
    exists: fs.existsSync(cacheDir),
    valid: metadata.isValid,
    metadata,
    sizeBytes,
  };
}

/**
 * Clear all baseline validation cache entries (for maintenance).
 */
export function clearBaselineValidationCache(
  cacheRoot: string = process.env.KASEKI_BASELINE_CACHE_ROOT || '/cache/kaseki-baseline'
): number {
  if (!fs.existsSync(cacheRoot)) {
    return 0;
  }

  let cleared = 0;
  try {
    const entries = fs.readdirSync(cacheRoot);
    for (const entry of entries) {
      const entryPath = path.join(cacheRoot, entry);
      const stats = fs.statSync(entryPath);
      if (stats.isDirectory()) {
        fs.rmSync(entryPath, { recursive: true, force: true });
        cleared++;
      }
    }
  } catch {
    // Ignore errors
  }

  return cleared;
}

/**
 * Prune expired cache entries (older than maxAgeHours).
 */
export function pruneExpiredBaselineValidationCache(
  cacheRoot: string = process.env.KASEKI_BASELINE_CACHE_ROOT || '/cache/kaseki-baseline',
  maxAgeHours: number = 24
): { total: number; pruned: number } {
  if (!fs.existsSync(cacheRoot)) {
    return { total: 0, pruned: 0 };
  }

  let total = 0;
  let pruned = 0;

  try {
    const entries = fs.readdirSync(cacheRoot);
    for (const entry of entries) {
      const entryPath = path.join(cacheRoot, entry);
      const stats = fs.statSync(entryPath);
      if (stats.isDirectory()) {
        total++;
        const metadata = isBaselineValidationCacheValid(entryPath, { maxAgeHours });
        if (!metadata.isValid) {
          fs.rmSync(entryPath, { recursive: true, force: true });
          pruned++;
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return { total, pruned };
}
