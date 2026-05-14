import * as fs from 'fs';
import * as path from 'path';

export interface RunArtifactFileSnapshot {
  exists: boolean;
  size: number;
  mtimeMs?: number;
}

export type RunArtifactMetadata = Record<string, RunArtifactFileSnapshot>;

interface CacheEntry {
  timestamp: number;
  files: Map<string, RunArtifactFileSnapshot>;
}

export interface RunArtifactMetadataCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 250;

/**
 * Shared cache for terminal run artifact metadata.
 *
 * Entries are keyed by job id and result directory. Cached file snapshots are
 * validated against current size/mtime before reuse, so terminal status and
 * artifact routes can share availability metadata without diverging when an
 * artifact is rewritten after finalization.
 */
export class RunArtifactMetadataCache {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: RunArtifactMetadataCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  get(jobId: string, resultDir: string, fileNames: readonly string[], cacheable: boolean): RunArtifactMetadata {
    if (!cacheable) {
      return this.readMetadata(resultDir, fileNames);
    }

    const key = this.cacheKey(jobId, resultDir);
    const cached = this.cache.get(key);
    if (cached && this.isUsable(cached, resultDir, fileNames)) {
      cached.timestamp = Date.now();
      return this.project(cached.files, fileNames);
    }

    const metadata = this.readMetadata(resultDir, fileNames);
    this.set(key, metadata);
    return metadata;
  }

  clear(jobId?: string, resultDir?: string): void {
    if (!jobId && !resultDir) {
      this.cache.clear();
      return;
    }

    const normalizedResultDir = resultDir ? this.normalizeResultDir(resultDir) : undefined;
    for (const key of Array.from(this.cache.keys())) {
      const [entryJobId, entryResultDir] = this.parseKey(key);
      if (jobId && entryJobId !== jobId) {
        continue;
      }
      if (normalizedResultDir && entryResultDir !== normalizedResultDir) {
        continue;
      }
      this.cache.delete(key);
    }
  }

  getStats(): { entries: number } {
    return { entries: this.cache.size };
  }

  private isUsable(entry: CacheEntry, resultDir: string, fileNames: readonly string[]): boolean {
    if (Date.now() - entry.timestamp >= this.ttlMs) {
      return false;
    }

    for (const fileName of fileNames) {
      const cached = entry.files.get(fileName);
      if (!cached) {
        return false;
      }
      const current = this.readOne(resultDir, fileName);
      if (!this.sameSnapshot(cached, current)) {
        return false;
      }
    }

    return true;
  }

  private readMetadata(resultDir: string, fileNames: readonly string[]): RunArtifactMetadata {
    const metadata: RunArtifactMetadata = {};
    for (const fileName of fileNames) {
      metadata[fileName] = this.readOne(resultDir, fileName);
    }
    return metadata;
  }

  private readOne(resultDir: string, fileName: string): RunArtifactFileSnapshot {
    try {
      const stat = fs.statSync(path.join(resultDir, fileName));
      if (!stat.isFile()) {
        return { exists: false, size: 0 };
      }
      return { exists: true, size: stat.size, mtimeMs: stat.mtimeMs };
    } catch {
      return { exists: false, size: 0 };
    }
  }

  private sameSnapshot(a: RunArtifactFileSnapshot, b: RunArtifactFileSnapshot): boolean {
    if (a.exists !== b.exists || a.size !== b.size) {
      return false;
    }
    if (!a.exists && !b.exists) {
      return true;
    }
    return a.mtimeMs === b.mtimeMs;
  }

  private project(files: Map<string, RunArtifactFileSnapshot>, fileNames: readonly string[]): RunArtifactMetadata {
    const metadata: RunArtifactMetadata = {};
    for (const fileName of fileNames) {
      metadata[fileName] = files.get(fileName) ?? { exists: false, size: 0 };
    }
    return metadata;
  }

  private set(key: string, metadata: RunArtifactMetadata): void {
    if (!this.cache.has(key) && this.cache.size >= this.maxEntries) {
      const oldest = Array.from(this.cache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      if (oldest) {
        this.cache.delete(oldest[0]);
      }
    }

    this.cache.set(key, {
      timestamp: Date.now(),
      files: new Map(Object.entries(metadata)),
    });
  }

  private cacheKey(jobId: string, resultDir: string): string {
    return `${jobId}\0${this.normalizeResultDir(resultDir)}`;
  }

  private parseKey(key: string): [string, string] {
    const separatorIndex = key.indexOf('\0');
    if (separatorIndex === -1) {
      return [key, ''];
    }
    return [key.slice(0, separatorIndex), key.slice(separatorIndex + 1)];
  }

  private normalizeResultDir(resultDir: string): string {
    return path.resolve(resultDir);
  }
}

const runArtifactMetadataCache = new RunArtifactMetadataCache();

export function getRunArtifactMetadata(
  jobId: string,
  resultDir: string,
  fileNames: readonly string[],
  cacheable: boolean
): RunArtifactMetadata {
  return runArtifactMetadataCache.get(jobId, resultDir, fileNames, cacheable);
}

export function clearRunArtifactMetadataCache(jobId?: string, resultDir?: string): void {
  runArtifactMetadataCache.clear(jobId, resultDir);
}
