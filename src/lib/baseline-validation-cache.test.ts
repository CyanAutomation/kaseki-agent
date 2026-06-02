import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  generateBaselineValidationCacheKey,
  getBaselineValidationCacheDir,
  isBaselineValidationCacheValid,
  restoreBaselineValidationFromCache,
  saveBaselineValidationToCache,
  getBaselineValidationCacheStats,
  clearBaselineValidationCache,
  pruneExpiredBaselineValidationCache,
} from './baseline-validation-cache';

describe('baseline-validation-cache', () => {
  let tempDir: string;
  let cacheDir: string;
  let resultsDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-cache-test-'));
    cacheDir = path.join(tempDir, 'cache');
    resultsDir = path.join(tempDir, 'results');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.mkdirSync(resultsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('generateBaselineValidationCacheKey', () => {
    it('should generate a consistent hash for same inputs', () => {
      const key1 = generateBaselineValidationCacheKey('https://github.com/org/repo', 'npm test');
      const key2 = generateBaselineValidationCacheKey('https://github.com/org/repo', 'npm test');
      expect(key1).toBe(key2);
      expect(key1.length).toBe(64); // SHA256 hex length
    });

    it('should generate different hashes for different repos', () => {
      const key1 = generateBaselineValidationCacheKey('https://github.com/org/repo1', 'npm test');
      const key2 = generateBaselineValidationCacheKey('https://github.com/org/repo2', 'npm test');
      expect(key1).not.toBe(key2);
    });

    it('should generate different hashes for different commands', () => {
      const key1 = generateBaselineValidationCacheKey('https://github.com/org/repo', 'npm test');
      const key2 = generateBaselineValidationCacheKey('https://github.com/org/repo', 'npm lint');
      expect(key1).not.toBe(key2);
    });
  });

  describe('getBaselineValidationCacheDir', () => {
    it('should return correct cache directory path', () => {
      const cacheKey = 'abc123';
      const dir = getBaselineValidationCacheDir(cacheKey, { cacheRoot: cacheDir });
      expect(dir).toBe(path.join(cacheDir, cacheKey));
    });

    it('should use KASEKI_BASELINE_CACHE_ROOT env var', () => {
      const envCache = path.join(tempDir, 'env-cache');
      process.env.KASEKI_BASELINE_CACHE_ROOT = envCache;
      const dir = getBaselineValidationCacheDir('abc123');
      expect(dir).toContain('env-cache');
      delete process.env.KASEKI_BASELINE_CACHE_ROOT;
    });
  });

  describe('isBaselineValidationCacheValid', () => {
    it('should return invalid if cache directory does not exist', () => {
      const metadata = isBaselineValidationCacheValid(path.join(cacheDir, 'nonexistent'));
      expect(metadata.isValid).toBe(false);
    });

    it('should return invalid if required files are missing', () => {
      const testCacheDir = path.join(cacheDir, 'test');
      fs.mkdirSync(testCacheDir);
      fs.writeFileSync(path.join(testCacheDir, 'validation.log'), 'test');
      // Missing validation-timings.tsv
      const metadata = isBaselineValidationCacheValid(testCacheDir);
      expect(metadata.isValid).toBe(false);
    });

    it('should return valid if all files exist and cache is fresh', () => {
      const testCacheDir = path.join(cacheDir, 'test');
      fs.mkdirSync(testCacheDir);
      fs.writeFileSync(path.join(testCacheDir, 'validation.log'), 'test');
      fs.writeFileSync(path.join(testCacheDir, 'validation-timings.tsv'), 'test');

      const metadata = isBaselineValidationCacheValid(testCacheDir, { maxAgeHours: 24 });
      expect(metadata.isValid).toBe(true);
      expect(metadata.ageHours).toBeLessThan(1);
    });

    it('should return invalid if cache is too old', () => {
      const testCacheDir = path.join(cacheDir, 'test');
      fs.mkdirSync(testCacheDir);

      // Create files with old timestamp (25 hours ago)
      const oldTime = Date.now() - 25 * 60 * 60 * 1000;
      fs.writeFileSync(path.join(testCacheDir, 'validation.log'), 'test');
      fs.writeFileSync(path.join(testCacheDir, 'validation-timings.tsv'), 'test');
      fs.utimesSync(path.join(testCacheDir, 'validation.log'), oldTime / 1000, oldTime / 1000);

      const metadata = isBaselineValidationCacheValid(testCacheDir, { maxAgeHours: 24 });
      expect(metadata.isValid).toBe(false);
      expect(metadata.ageHours).toBeGreaterThan(24);
    });
  });

  describe('saveBaselineValidationToCache', () => {
    it('should copy validation files to cache', () => {
      const testCacheDir = path.join(cacheDir, 'test');
      fs.writeFileSync(path.join(resultsDir, 'validation-baseline.log'), 'log content');
      fs.writeFileSync(path.join(resultsDir, 'validation-baseline-raw.log'), 'raw content');
      fs.writeFileSync(path.join(resultsDir, 'validation-baseline-timings.tsv'), 'timings');

      const result = saveBaselineValidationToCache(testCacheDir, resultsDir);
      expect(result).toBe(true);
      expect(fs.existsSync(path.join(testCacheDir, 'validation.log'))).toBe(true);
      expect(fs.existsSync(path.join(testCacheDir, 'validation-raw.log'))).toBe(true);
      expect(fs.existsSync(path.join(testCacheDir, 'validation-timings.tsv'))).toBe(true);
    });

    it('should handle optional files gracefully', () => {
      const testCacheDir = path.join(cacheDir, 'test');
      fs.writeFileSync(path.join(resultsDir, 'validation-baseline.log'), 'log content');
      fs.writeFileSync(path.join(resultsDir, 'validation-baseline-raw.log'), 'raw content');
      fs.writeFileSync(path.join(resultsDir, 'validation-baseline-timings.tsv'), 'timings');
      // No validation-baseline-env.log (optional)

      const result = saveBaselineValidationToCache(testCacheDir, resultsDir);
      expect(result).toBe(true);
    });

    it('should return false if required files missing', () => {
      const testCacheDir = path.join(cacheDir, 'test');
      fs.writeFileSync(path.join(resultsDir, 'validation-baseline.log'), 'log content');
      // Missing validation-baseline-raw.log and validation-baseline-timings.tsv

      const result = saveBaselineValidationToCache(testCacheDir, resultsDir);
      expect(result).toBe(false);
    });

    it('should respect disabled option', () => {
      const testCacheDir = path.join(cacheDir, 'test');
      fs.writeFileSync(path.join(resultsDir, 'validation-baseline.log'), 'log content');

      const result = saveBaselineValidationToCache(testCacheDir, resultsDir, { disabled: true });
      expect(result).toBe(false);
      expect(fs.existsSync(testCacheDir)).toBe(false);
    });
  });

  describe('restoreBaselineValidationFromCache', () => {
    it('should copy cached files to results directory', () => {
      const testCacheDir = path.join(cacheDir, 'test');
      fs.mkdirSync(testCacheDir);
      fs.writeFileSync(path.join(testCacheDir, 'validation.log'), 'log content');
      fs.writeFileSync(path.join(testCacheDir, 'validation-raw.log'), 'raw content');
      fs.writeFileSync(path.join(testCacheDir, 'validation-timings.tsv'), 'timings');

      const result = restoreBaselineValidationFromCache(testCacheDir, resultsDir);
      expect(result).toBe(true);
      expect(fs.existsSync(path.join(resultsDir, 'validation-baseline.log'))).toBe(true);
      expect(fs.existsSync(path.join(resultsDir, 'validation-baseline-raw.log'))).toBe(true);
      expect(fs.existsSync(path.join(resultsDir, 'validation-baseline-timings.tsv'))).toBe(true);
    });

    it('should return false if cache is invalid', () => {
      const testCacheDir = path.join(cacheDir, 'nonexistent');
      const result = restoreBaselineValidationFromCache(testCacheDir, resultsDir);
      expect(result).toBe(false);
    });

    it('should respect disabled option', () => {
      const testCacheDir = path.join(cacheDir, 'test');
      fs.mkdirSync(testCacheDir);
      fs.writeFileSync(path.join(testCacheDir, 'validation.log'), 'log');
      fs.writeFileSync(path.join(testCacheDir, 'validation-raw.log'), 'raw');
      fs.writeFileSync(path.join(testCacheDir, 'validation-timings.tsv'), 'timings');

      const result = restoreBaselineValidationFromCache(testCacheDir, resultsDir, { disabled: true });
      expect(result).toBe(false);
    });
  });

  describe('getBaselineValidationCacheStats', () => {
    it('should return stats for valid cache', () => {
      const testCacheDir = path.join(cacheDir, 'test');
      fs.mkdirSync(testCacheDir);
      fs.writeFileSync(path.join(testCacheDir, 'validation.log'), 'log content');
      fs.writeFileSync(path.join(testCacheDir, 'validation-timings.tsv'), 'timings');

      const stats = getBaselineValidationCacheStats(testCacheDir);
      expect(stats.exists).toBe(true);
      expect(stats.valid).toBe(true);
      expect(stats.sizeBytes).toBeGreaterThan(0);
    });

    it('should return zero size for nonexistent cache', () => {
      const stats = getBaselineValidationCacheStats(path.join(cacheDir, 'nonexistent'));
      expect(stats.exists).toBe(false);
      expect(stats.sizeBytes).toBe(0);
    });
  });

  describe('clearBaselineValidationCache', () => {
    it('should remove all cache entries', () => {
      const testCacheRoot = path.join(cacheDir, 'multi');
      fs.mkdirSync(path.join(testCacheRoot, 'cache1'), { recursive: true });
      fs.mkdirSync(path.join(testCacheRoot, 'cache2'), { recursive: true });
      fs.writeFileSync(path.join(testCacheRoot, 'cache1', 'file.txt'), 'content');
      fs.writeFileSync(path.join(testCacheRoot, 'cache2', 'file.txt'), 'content');

      const cleared = clearBaselineValidationCache(testCacheRoot);
      expect(cleared).toBe(2);
      expect(fs.readdirSync(testCacheRoot)).toHaveLength(0);
    });

    it('should handle empty cache root', () => {
      const cleared = clearBaselineValidationCache(path.join(cacheDir, 'empty'));
      expect(cleared).toBe(0);
    });
  });

  describe('pruneExpiredBaselineValidationCache', () => {
    it('should remove only expired entries', () => {
      const testCacheRoot = path.join(cacheDir, 'multi');
      fs.mkdirSync(testCacheRoot, { recursive: true });

      // Fresh cache
      const freshCacheDir = path.join(testCacheRoot, 'fresh');
      fs.mkdirSync(freshCacheDir);
      fs.writeFileSync(path.join(freshCacheDir, 'validation.log'), 'fresh');
      fs.writeFileSync(path.join(freshCacheDir, 'validation-timings.tsv'), 'fresh');

      // Expired cache (25 hours old)
      const expiredCacheDir = path.join(testCacheRoot, 'expired');
      fs.mkdirSync(expiredCacheDir);
      const oldTime = Date.now() - 25 * 60 * 60 * 1000;
      fs.writeFileSync(path.join(expiredCacheDir, 'validation.log'), 'old');
      fs.writeFileSync(path.join(expiredCacheDir, 'validation-timings.tsv'), 'old');
      fs.utimesSync(
        path.join(expiredCacheDir, 'validation.log'),
        oldTime / 1000,
        oldTime / 1000
      );

      const result = pruneExpiredBaselineValidationCache(testCacheRoot, 24);
      expect(result.total).toBe(2);
      expect(result.pruned).toBe(1);
      expect(fs.existsSync(freshCacheDir)).toBe(true);
      expect(fs.existsSync(expiredCacheDir)).toBe(false);
    });
  });
});
