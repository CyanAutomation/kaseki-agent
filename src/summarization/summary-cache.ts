/**
 * Summary cache with file hash validation
 * Ensures no stale summaries - invalidates on file change
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface CachedSummary {
  content: string;
  fileHash: string;
  timestamp: number;
  language: string;
  sizeBytes: number;
}

export interface SummaryCacheOptions {
  /** Maximum number of summaries to retain. */
  maxEntries?: number;

  /** Maximum total cached summary content size in bytes. */
  maxSizeBytes?: number;

  /** Time-to-live for cache entries in milliseconds. */
  ttlMs?: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  entries: number;
  sizeBytes: number;
  evictions: number;
  maxEntries: number;
  maxSizeBytes: number;
  ttlMs: number;
}

const DEFAULT_MAX_ENTRIES = 1000;
const DEFAULT_MAX_SIZE_BYTES = 50 * 1024 * 1024;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Summary cache with file hash-based invalidation
 */
export class SummaryCache {
  private cache: Map<string, CachedSummary> = new Map();
  private stats = { hits: 0, misses: 0, evictions: 0 };
  private cacheDir: string;
  private dirty = false;
  private maxEntries: number;
  private maxSizeBytes: number;
  private ttlMs: number;

  constructor(cacheDir: string, options: SummaryCacheOptions = {}) {
    this.cacheDir = cacheDir;
    this.maxEntries = this.normalizeLimit(options.maxEntries, DEFAULT_MAX_ENTRIES);
    this.maxSizeBytes = this.normalizeLimit(options.maxSizeBytes, DEFAULT_MAX_SIZE_BYTES);
    this.ttlMs = this.normalizeLimit(options.ttlMs, DEFAULT_TTL_MS);
    this.ensureCacheDir();
  }

  private ensureCacheDir(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private normalizeLimit(value: number | undefined, defaultValue: number): number {
    if (value === undefined || !Number.isFinite(value) || value < 0) {
      return defaultValue;
    }
    return Math.floor(value);
  }

  private isExpired(entry: CachedSummary, now = Date.now()): boolean {
    return this.ttlMs > 0 && now - entry.timestamp > this.ttlMs;
  }

  private getTotalSizeBytes(): number {
    let sizeBytes = 0;

    for (const entry of this.cache.values()) {
      sizeBytes += entry.sizeBytes;
    }

    return sizeBytes;
  }

  private evictEntry(key: string): void {
    if (this.cache.delete(key)) {
      this.stats.evictions++;
      this.dirty = true;
    }
  }

  private evictExpired(now = Date.now()): void {
    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry, now)) {
        this.evictEntry(key);
      }
    }
  }

  private enforceLimits(): void {
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) return;
      this.evictEntry(oldestKey);
    }

    while (this.getTotalSizeBytes() > this.maxSizeBytes) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) return;
      this.evictEntry(oldestKey);
    }
  }

  /**
   * Get cached summary if valid (file hash matches)
   * Returns null if not cached or file has changed
   */
  get(filePath: string): CachedSummary | null {
    const normalized = path.normalize(filePath);
    const cached = this.cache.get(normalized);

    if (!cached) {
      this.stats.misses++;
      return null;
    }

    if (this.isExpired(cached)) {
      this.evictEntry(normalized);
      this.stats.misses++;
      return null;
    }

    // Validate file hash (no stale summaries)
    const currentHash = this.getFileHash(filePath);
    if (currentHash !== cached.fileHash) {
      // File changed - invalidate
      this.evictEntry(normalized);
      this.stats.misses++;
      return null;
    }

    this.cache.delete(normalized);
    this.cache.set(normalized, cached);
    this.dirty = true;
    this.stats.hits++;
    return cached;
  }

  /**
   * Store summary in cache
   */
  set(filePath: string, summary: string, language: string): void {
    const normalized = path.normalize(filePath);
    const fileHash = this.getFileHash(filePath);
    const sizeBytes = Buffer.byteLength(summary, 'utf-8');

    this.evictExpired();
    if (this.cache.has(normalized)) {
      this.cache.delete(normalized);
    }
    this.enforceLimits();

    this.cache.set(normalized, {
      content: summary,
      fileHash,
      timestamp: Date.now(),
      language,
      sizeBytes,
    });

    this.dirty = true;
    this.enforceLimits();
  }

  /**
   * Compute file hash (first + last 5KB for speed)
   * Detects content changes reliably without full parse
   */
  getFileHash(filePath: string): string {
    try {
      const stats = fs.statSync(filePath);
      const fileSize = stats.size;

      if (fileSize === 0) {
        return crypto.createHash('sha256').update('').digest('hex').substring(0, 16);
      }

      // Read the whole file for hashing (simple and reliable)
      // For performance, we could sample first+last 5KB, but for now use full file
      const content = fs.readFileSync(filePath);
      return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
    } catch {
      // If file can't be read, use modification time as hash
      try {
        const stats = fs.statSync(filePath);
        return crypto.createHash('sha256').update(String(stats.mtimeMs)).digest('hex').substring(0, 16);
      } catch {
        return 'error-' + Date.now();
      }
    }
  }

  /**
   * Invalidate specific entry
   */
  invalidate(filePath: string): void {
    this.cache.delete(path.normalize(filePath));
    this.dirty = true;
  }

  /**
   * Cleanup stale entries (older than TTL)
   */
  cleanup(ttlMs: number): number {
    const now = Date.now();
    const before = this.cache.size;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > ttlMs) {
        this.evictEntry(key);
      }
    }

    const removed = before - this.cache.size;
    if (removed > 0) {
      this.dirty = true;
    }

    return removed;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0, evictions: 0 };
    this.dirty = true;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const entries = this.cache.size;
    const sizeBytes = this.getTotalSizeBytes();

    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? this.stats.hits / totalRequests : 0;

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate,
      entries,
      sizeBytes,
      evictions: this.stats.evictions,
      maxEntries: this.maxEntries,
      maxSizeBytes: this.maxSizeBytes,
      ttlMs: this.ttlMs,
    };
  }

  /**
   * Persist cache to disk
   */
  flush(): void {
    if (!this.dirty) return;

    try {
      const data = Array.from(this.cache.entries()).map(([key, entry]) => ({
        file: key,
        ...entry,
      }));

      const cacheFile = path.join(this.cacheDir, 'cache.json');
      fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
      this.dirty = false;
    } catch (error) {
      console.error('Failed to flush cache:', error);
    }
  }

  /**
   * Load cache from disk
   */
  load(): void {
    try {
      const cacheFile = path.join(this.cacheDir, 'cache.json');
      if (!fs.existsSync(cacheFile)) return;

      const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      this.cache.clear();
      for (const entry of data) {
        const { file, ...cached } = entry;
        this.cache.set(file, cached as CachedSummary);
      }

      this.evictExpired();
      this.enforceLimits();
      this.dirty = false;
    } catch (error) {
      console.error('Failed to load cache:', error);
    }
  }
}
