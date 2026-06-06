/**
 * Build capability detector tests
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  detectBuildCapabilityWithCache,
  clearBuildCapabilityCache,
} from './build-capability-detector';

describe('build-capability-detector', () => {
  let tempDir: string;
  let cacheDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-build-test-'));
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-cache-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  describe('detectBuildCapabilityWithCache', () => {
    it('should detect and cache TypeScript project', () => {
      fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), '{}');

      const info = detectBuildCapabilityWithCache(tempDir, cacheDir);

      expect(info).toEqual({
        language: 'typescript',
        command: 'npm run build',
        detected: true,
        detectedAt: expect.any(Number),
      });

      // Verify cache was written
      const cachePath = path.join(cacheDir, '.build-capability-cache.json');
      expect(fs.existsSync(cachePath)).toBe(true);
    });

    it('should return null values when nothing detected', () => {
      const info = detectBuildCapabilityWithCache(tempDir, cacheDir);

      expect(info).toEqual({
        language: null,
        command: null,
        detected: false,
        detectedAt: expect.any(Number),
      });
    });

    it('should use cache on subsequent calls', () => {
      fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), '{}');

      const info1 = detectBuildCapabilityWithCache(tempDir, cacheDir);
      const info2 = detectBuildCapabilityWithCache(tempDir, cacheDir);

      expect(info1).toEqual(info2);
      expect(info1.detectedAt).toBe(info2.detectedAt);
    });

    it('should detect fresh when cache is expired (>1 hour)', () => {
      fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), '{}');

      // Create stale cache
      const staleCacheTime = Date.now() - 61 * 60 * 1000; // 61 minutes ago
      const cachePath = path.join(cacheDir, '.build-capability-cache.json');
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(
        cachePath,
        JSON.stringify({
          language: 'go',
          command: 'go build',
          detected: true,
          detectedAt: staleCacheTime,
        }),
      );

      // Should detect fresh TypeScript, not use stale Go cache
      const info = detectBuildCapabilityWithCache(tempDir, cacheDir);

      expect(info.language).toBe('typescript');
      expect(info.command).toBe('npm run build');
      expect(info.detectedAt).toBeGreaterThan(staleCacheTime);
    });

    it('should work without cache directory', () => {
      fs.writeFileSync(path.join(tempDir, 'Cargo.toml'), '[package]\n');

      const info = detectBuildCapabilityWithCache(tempDir);

      expect(info).toEqual({
        language: 'rust',
        command: 'cargo build',
        detected: true,
        detectedAt: expect.any(Number),
      });
    });

    it('should handle concurrent detections gracefully', async () => {
      fs.writeFileSync(path.join(tempDir, 'go.mod'), 'module test\n');

      // Simulate concurrent calls
      const promises = [
        Promise.resolve(detectBuildCapabilityWithCache(tempDir, cacheDir)),
        Promise.resolve(detectBuildCapabilityWithCache(tempDir, cacheDir)),
        Promise.resolve(detectBuildCapabilityWithCache(tempDir, cacheDir)),
      ];

      const results = await Promise.all(promises);

      // All should return the same result
      expect(results[0]).toEqual(results[1]);
      expect(results[1]).toEqual(results[2]);
      expect(results[0].language).toBe('go');
    });
  });

  describe('clearBuildCapabilityCache', () => {
    it('should remove cache file', () => {
      fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), '{}');
      const info = detectBuildCapabilityWithCache(tempDir, cacheDir);
      expect(info.detected).toBe(true);

      const cachePath = path.join(cacheDir, '.build-capability-cache.json');
      expect(fs.existsSync(cachePath)).toBe(true);

      clearBuildCapabilityCache(cacheDir);

      expect(fs.existsSync(cachePath)).toBe(false);
    });

    it('should handle clearing non-existent cache gracefully', () => {
      // Should not throw
      clearBuildCapabilityCache(cacheDir);
    });

    it('should allow fresh detection after cache clear', () => {
      fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), '{}');
      const info1 = detectBuildCapabilityWithCache(tempDir, cacheDir);

      clearBuildCapabilityCache(cacheDir);

      fs.rmSync(path.join(tempDir, 'tsconfig.json'));
      fs.writeFileSync(path.join(tempDir, 'go.mod'), 'module test\n');

      const info2 = detectBuildCapabilityWithCache(tempDir, cacheDir);

      expect(info1.language).toBe('typescript');
      expect(info2.language).toBe('go');
    });
  });

  describe('cache format', () => {
    it('should save valid JSON cache', () => {
      fs.writeFileSync(path.join(tempDir, 'Cargo.toml'), '[package]\n');
      detectBuildCapabilityWithCache(tempDir, cacheDir);

      const cachePath = path.join(cacheDir, '.build-capability-cache.json');
      const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));

      expect(cache).toHaveProperty('language');
      expect(cache).toHaveProperty('command');
      expect(cache).toHaveProperty('detected');
      expect(cache).toHaveProperty('detectedAt');
    });

    it('should create cache directory if needed', () => {
      const deepCacheDir = path.join(cacheDir, 'nested', 'dirs');
      fs.writeFileSync(path.join(tempDir, 'go.mod'), 'module test\n');

      detectBuildCapabilityWithCache(tempDir, deepCacheDir);

      const cachePath = path.join(deepCacheDir, '.build-capability-cache.json');
      expect(fs.existsSync(cachePath)).toBe(true);
    });
  });
});
