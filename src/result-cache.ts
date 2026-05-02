import * as fs from 'fs';
import * as path from 'path';

/**
 * Cached artifact entry.
 */
interface CacheEntry {
  content: string;
  timestamp: number;
  size: number;
}

/**
 * Result cache for lazily loading and caching kaseki artifacts.
 * Reduces filesystem reads for frequently accessed files.
 */
export class ResultCache {
  private cache = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(maxEntries = 20, ttlMs = 5 * 60 * 1000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  /**
   * Get or load a file from disk.
   */
  getOrLoad(filePath: string): string | null {
    // Check cache
    const cached = this.cache.get(filePath);
    if (cached) {
      const age = Date.now() - cached.timestamp;
      if (age < this.ttlMs) {
        return cached.content;
      }
      // Expired, remove from cache
      this.cache.delete(filePath);
    }

    // Load from disk
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const stat = fs.statSync(filePath);

      // Only cache reasonable-sized files to avoid memory bloat
      if (stat.size < 10 * 1024 * 1024) {
        // 10 MB limit per file
        this.set(filePath, content, stat.size);
      }

      return content;
    } catch {
      return null;
    }
  }

  /**
   * Set a cache entry.
   */
  private set(filePath: string, content: string, size: number): void {
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
    });
  }

  /**
   * Clear cache for a job (e.g., when cleaning up after completion).
   */
  clearForJob(jobId: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(`/${jobId}/`)) {
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
  getStats(): { entries: number; bytes: number } {
    let bytes = 0;
    for (const entry of this.cache.values()) {
      bytes += entry.size;
    }
    return {
      entries: this.cache.size,
      bytes,
    };
  }
}
