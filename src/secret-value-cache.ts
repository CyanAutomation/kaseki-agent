import * as fs from 'fs';

type SecretCacheEntry = {
  value: string;
  mtimeMs: number;
  size: number;
};

/**
 * Small synchronous cache for secret files that are read repeatedly while the
 * process stays alive. Entries are keyed by file path and invalidated whenever
 * the file metadata changes.
 */
class SecretValueCache {
  private entries = new Map<string, SecretCacheEntry>();

  readFile(filePath: string): string {
    const stat = fs.statSync(filePath);
    const cached = this.entries.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.value;
    }

    const value = fs.readFileSync(filePath, 'utf-8');
    this.entries.set(filePath, {
      value,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    });
    return value;
  }

  readSecretValue(inlineValue?: string, filePath?: string): string | undefined {
    const trimmedInline = inlineValue?.trim();
    if (trimmedInline) {
      return trimmedInline;
    }
    if (!filePath) {
      return undefined;
    }

    try {
      const value = this.readFile(filePath).replace(/^\uFEFF/, '').trim();
      return value || undefined;
    } catch {
      return undefined;
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

const secretValueCache = new SecretValueCache();
