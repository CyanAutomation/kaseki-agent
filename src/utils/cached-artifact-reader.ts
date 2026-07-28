import { ResultCache, ResultCacheOptions, ResultCacheStats } from '../result-cache';
import type { KasekiMetadata } from '../types/kaseki-metadata';

/**
 * Typed wrapper around ResultCache for reading common kaseki artifacts.
 * Provides convenience methods with JSON parsing and type safety.
 */
export class CachedArtifactReader {
  private cache: ResultCache;

  constructor(options?: ResultCacheOptions) {
    this.cache = new ResultCache(options);
  }

  /**
   * Read and parse metadata.json.
   * Returns null if file doesn't exist or JSON is invalid.
   */
  readMetadata(filePath: string): KasekiMetadata | null {
    const content = this.cache.getOrLoad(filePath);
    if (content === null) {
      return null;
    }

    try {
      return JSON.parse(content) as KasekiMetadata;
    } catch {
      return null;
    }
  }

  /**
   * Read and parse pi-summary.json.
   * Returns null if file doesn't exist or JSON is invalid.
   */
  readPiSummary(filePath: string): Record<string, unknown> | null {
    const content = this.cache.getOrLoad(filePath);
    if (content === null) {
      return null;
    }

    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /**
   * Read and parse any JSON artifact.
   * Returns null if file doesn't exist or JSON is invalid.
   */
  readJsonArtifact<T = Record<string, unknown>>(filePath: string): T | null {
    const content = this.cache.getOrLoad(filePath);
    if (content === null) {
      return null;
    }

    try {
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  /**
   * Read a text artifact (logs, diffs, etc.).
   * Returns null if file doesn't exist.
   */
  readTextArtifact(filePath: string): string | null {
    return this.cache.getOrLoad(filePath);
  }

  /**
   * Read and parse changed-files.txt as array of file paths.
   * Returns null if file doesn't exist.
   * Returns empty array if file is empty.
   */
  readChangedFiles(filePath: string): string[] | null {
    const content = this.cache.getOrLoad(filePath);
    if (content === null) {
      return null;
    }

    if (content.trim() === '') {
      return [];
    }

    return content
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0);
  }

  /**
   * Clear cache entries for a specific job.
   */
  clearForJob(jobId: string): void {
    this.cache.clearForJob(jobId);
  }

  /**
   * Clear all cache entries.
   */
  clearAll(): void {
    this.cache.clearAll();
  }

  /**
   * Get cache statistics.
   */
  getStats(): ResultCacheStats {
    return this.cache.getStats();
  }
}
