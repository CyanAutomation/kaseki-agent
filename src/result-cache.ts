import * as fs from 'fs';
import * as path from 'path';

/**
 * Cached artifact entry.
 */
export interface ResultCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
  maxFileBytes?: number;
}

export interface ResultCacheStats {
  entries: number;
  bytes: number;
  hits: number;
  misses: number;
  maxEntries: number;
  ttlMs: number;
  maxFileBytes: number;
}

interface CacheEntry {
  content: string;
  timestamp: number;
  size: number;
  mtimeMs: number;
  inode?: number;
}

/**
 * Result cache for lazily loading and caching kaseki artifacts.
 * Reduces filesystem reads for frequently accessed files.
 */
export class ResultCache {
  private cache = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly maxFileBytes: number;
  private hits = 0;
  private misses = 0;

  constructor(maxEntries?: number, ttlMs?: number, maxFileBytes?: number);
  constructor(options?: ResultCacheOptions);
  constructor(
    maxEntriesOrOptions: number | ResultCacheOptions = 20,
    ttlMs = 5 * 60 * 1000,
    maxFileBytes = 10 * 1024 * 1024
  ) {
    if (typeof maxEntriesOrOptions === 'object') {
      this.maxEntries = maxEntriesOrOptions.maxEntries ?? 20;
      this.ttlMs = maxEntriesOrOptions.ttlMs ?? 5 * 60 * 1000;
      this.maxFileBytes = maxEntriesOrOptions.maxFileBytes ?? 10 * 1024 * 1024;
    } else {
      this.maxEntries = maxEntriesOrOptions;
      this.ttlMs = ttlMs;
      this.maxFileBytes = maxFileBytes;
    }
  }

  /**
   * Get or load a file from disk.
   */
  getOrLoad(filePath: string): string | null {
    let fileStat: fs.Stats | undefined;

    // Check cache
    const cached = this.cache.get(filePath);
    if (cached) {
      const age = Date.now() - cached.timestamp;
      if (age < this.ttlMs) {
        try {
          fileStat = fs.statSync(filePath);
          const inode = typeof fileStat.ino === 'number' ? fileStat.ino : undefined;
          const unchanged =
            fileStat.mtimeMs === cached.mtimeMs &&
            fileStat.size === cached.size &&
            (cached.inode === undefined || inode === cached.inode);

          if (unchanged) {
            this.hits += 1;
            return cached.content;
          }
        } catch {
          // Fall through to reload from disk
        }
      } else {
        // Expired, remove from cache
        this.cache.delete(filePath);
      }
    }

    this.misses += 1;

    // Load from disk
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const stat = fileStat ?? fs.statSync(filePath);
      const content = fs.readFileSync(filePath, 'utf-8');

      if (this.maxEntries > 0 && stat.size <= this.maxFileBytes) {
        this.set(filePath, content, stat.size, stat.mtimeMs, typeof stat.ino === 'number' ? stat.ino : undefined);
      }

      return content;
    } catch {
      return null;
    }
  }

  /**
   * Set a cache entry.
   */
  private set(filePath: string, content: string, size: number, mtimeMs: number, inode?: number): void {
    if (this.maxEntries <= 0) {
      return;
    }

    // Evict oldest entry if cache is full
    if (this.cache.size >= this.maxEntries) {
      const oldest = Array.from(this.cache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      if (oldest) {
        this.cache.delete(oldest[0]);
      }
    }

    this.cache.set(filePath, {
      content,
      timestamp: Date.now(),
      size,
      mtimeMs,
      inode,
    });
  }

  /**
   * Clear cache for a job (e.g., when cleaning up after completion).
   */
  clearForJob(jobId: string): void {
    const normalizedJobId = path.basename(path.normalize(jobId));

    for (const key of this.cache.keys()) {
      const normalizedKey = path.normalize(key);
      const keySegments = normalizedKey.split(/[\\/]+/).filter(Boolean);
      const hasJobSegment = keySegments.includes(normalizedJobId);

      if (hasJobSegment) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cache.
   */
  clearAll(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics.
   */
  getStats(): ResultCacheStats {
    let bytes = 0;
    for (const entry of this.cache.values()) {
      bytes += entry.size;
    }
    return {
      entries: this.cache.size,
      bytes,
      hits: this.hits,
      misses: this.misses,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
      maxFileBytes: this.maxFileBytes,
    };
  }
}
