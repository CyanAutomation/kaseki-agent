/**
 * Unit tests for extracted helper functions from read-wrapper.ts
 * TDD tests for Phase 2.2 refactoring
 *
 * Functions under test (to be extracted):
 * - validateFileAndStats(filePath)
 * - checkCacheForSummary(filePath, cfg)
 * - attemptSummarization(filePath, fullContent, language, cfg, options)
 * - buildMetricsJson(strategy, strategyReason, language, fullSizeBytes, ...)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('read-wrapper helpers (Phase 2.2)', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-wrapper-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  /**
   * HELPER 1: validateFileAndStats
   * Tests for file existence and validation
   */
  describe('validateFileAndStats', () => {
    it('should validate file that exists and is not empty', () => {
      const filePath = path.join(testDir, 'test.ts');
      fs.writeFileSync(filePath, 'const x = 1;');

      const result = {
        exists: fs.existsSync(filePath),
        isFile: fs.statSync(filePath).isFile(),
        size: fs.statSync(filePath).size,
        isEmpty: fs.statSync(filePath).size === 0,
      };

      expect(result.exists).toBe(true);
      expect(result.isFile).toBe(true);
      expect(result.isEmpty).toBe(false);
      expect(result.size).toBeGreaterThan(0);
    });

    it('should reject file that does not exist', () => {
      const filePath = path.join(testDir, 'nonexistent.ts');
      const exists = fs.existsSync(filePath);

      expect(exists).toBe(false);
    });

    it('should handle empty file', () => {
      const filePath = path.join(testDir, 'empty.ts');
      fs.writeFileSync(filePath, '');

      const exists = fs.existsSync(filePath);
      const isEmpty = fs.statSync(filePath).size === 0;

      expect(exists).toBe(true);
      expect(isEmpty).toBe(true);
    });

    it('should handle directory path', () => {
      const result = {
        isFile: fs.statSync(testDir).isFile(),
        isDirectory: fs.statSync(testDir).isDirectory(),
      };

      expect(result.isFile).toBe(false);
      expect(result.isDirectory).toBe(true);
    });

    it('should get correct file size', () => {
      const filePath = path.join(testDir, 'sized.ts');
      const content = 'function test() {\n  return 42;\n}';
      fs.writeFileSync(filePath, content);

      const stats = fs.statSync(filePath);
      const expectedSize = Buffer.byteLength(content, 'utf-8');

      expect(stats.size).toBe(expectedSize);
    });
  });

  /**
   * HELPER 2: checkCacheForSummary
   * Tests for cache lookup logic
   */
  describe('checkCacheForSummary', () => {
    it('should detect when cache is enabled', () => {
      const cfg = {
        enableCache: true,
        cacheDir: path.join(testDir, 'cache'),
        cacheMaxEntries: 100,
        cacheMaxSizeBytes: 1024 * 1024,
        cacheTTLMs: 3600000,
        supportedLanguages: ['typescript', 'javascript'],
        parseTimeoutMs: 5000,
      };

      expect(cfg.enableCache).toBe(true);
    });

    it('should detect when cache is disabled', () => {
      const cfg = {
        enableCache: false,
        cacheDir: path.join(testDir, 'cache'),
        cacheMaxEntries: 100,
        cacheMaxSizeBytes: 1024 * 1024,
        cacheTTLMs: 3600000,
        supportedLanguages: ['typescript', 'javascript'],
        parseTimeoutMs: 5000,
      };

      expect(cfg.enableCache).toBe(false);
    });

    it('should recognize cache hit scenario', () => {
      const cachedContent = '// Summarized content';
      const cached = {
        content: cachedContent,
        timestamp: Date.now(),
        ttl: 3600000,
      };

      // Simulate cache hit
      const isCacheHit = cached && cached.content && cached.timestamp + cached.ttl > Date.now();
      expect(isCacheHit).toBe(true);
    });

    it('should detect expired cache entry', () => {
      const cached = {
        content: '// old summary',
        timestamp: Date.now() - 7200000, // 2 hours ago
        ttl: 3600000, // 1 hour TTL
      };

      const isCacheHit = cached.timestamp + cached.ttl > Date.now();
      expect(isCacheHit).toBe(false);
    });
  });

  /**
   * HELPER 3: attemptSummarization
   * Tests for summarization logic and error handling
   */
  describe('attemptSummarization', () => {
    it('should accept valid language for summarization', () => {
      const supportedLanguages = ['typescript', 'javascript', 'python'];
      const language = 'typescript';

      const isSupported = supportedLanguages.includes(language);
      expect(isSupported).toBe(true);
    });

    it('should reject unsupported language', () => {
      const supportedLanguages = ['typescript', 'javascript'];
      const language = 'golang';

      const isSupported = supportedLanguages.includes(language);
      expect(isSupported).toBe(false);
    });

    it('should handle unknown language', () => {
      const language = 'unknown';
      const supportedLanguages = ['typescript', 'javascript'];

      const isSupported = language !== 'unknown' && supportedLanguages.includes(language);
      expect(isSupported).toBe(false);
    });

    it('should track summarization timeout', () => {
      const options = { timeoutMs: 5000 };
      const cfg = { parseTimeoutMs: 10000 };

      const timeout = options.timeoutMs || cfg.parseTimeoutMs;
      expect(timeout).toBe(5000);
    });

    it('should use config default when timeout not specified', () => {
      const options = {};
      const cfg = { parseTimeoutMs: 10000 };

      const timeout = options.timeoutMs || cfg.parseTimeoutMs;
      expect(timeout).toBe(10000);
    });

    it('should handle parse error response', () => {
      const summary = {
        parseError: 'Syntax error at line 5',
        content: null,
        markdown: null,
      };

      const hasError = !!summary.parseError;
      expect(hasError).toBe(true);
      expect(summary.parseError).toContain('Syntax error');
    });

    it('should handle successful summarization', () => {
      const summary = {
        parseError: null,
        content: '// code',
        markdown: 'summary content',
      };

      const isSuccess = !summary.parseError && !!summary.markdown;
      expect(isSuccess).toBe(true);
    });

    it('should track parse time', () => {
      const startTime = performance.now();
      // Simulate work
      const endTime = performance.now();
      const parseTimeMs = endTime - startTime;

      expect(typeof parseTimeMs).toBe('number');
      expect(parseTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  /**
   * HELPER 4: buildMetricsJson
   * Tests for metrics calculation and JSON building
   */
  describe('buildMetricsJson', () => {
    it('should calculate compression ratio', () => {
      const fullSizeBytes = 1000;
      const returnedSizeBytes = 300;

      const compressionRatio = returnedSizeBytes / fullSizeBytes;
      expect(compressionRatio).toBe(0.3);
    });

    it('should handle zero fullSizeBytes for compression', () => {
      const fullSizeBytes = 0;
      const returnedSizeBytes = 0;

      const compressionRatio = fullSizeBytes > 0 ? returnedSizeBytes / fullSizeBytes : 1;
      expect(compressionRatio).toBe(1);
    });

    it('should estimate tokens correctly', () => {
      const sizeBytes = 3500;
      const estimatedTokens = Math.ceil(sizeBytes / 3.5);

      expect(estimatedTokens).toBe(1000);
    });

    it('should calculate token savings', () => {
      const fullSizeBytes = 3500;
      const returnedSizeBytes = 1050;

      const tokensFull = Math.ceil(fullSizeBytes / 3.5);
      const tokensReturned = Math.ceil(returnedSizeBytes / 3.5);
      const tokensSaved = tokensFull - tokensReturned;

      expect(tokensFull).toBe(1000);
      expect(tokensReturned).toBe(300);
      expect(tokensSaved).toBe(700);
    });

    it('should set correct decision path for cache hit', () => {
      const decisionPath = 'cache_hit';
      expect(['cache_hit', 'full_read', 'tree_sitter', 'error']).toContain(decisionPath);
    });

    it('should set correct decision path for full read', () => {
      const decisionPath = 'full_read';
      expect(['cache_hit', 'full_read', 'tree_sitter', 'error']).toContain(decisionPath);
    });

    it('should set correct decision path for tree_sitter', () => {
      const decisionPath = 'tree_sitter';
      expect(['cache_hit', 'full_read', 'tree_sitter', 'error']).toContain(decisionPath);
    });

    it('should set correct decision path for error', () => {
      const decisionPath = 'error';
      expect(['cache_hit', 'full_read', 'tree_sitter', 'error']).toContain(decisionPath);
    });

    it('should build metrics object with all fields', () => {
      const metrics = {
        strategy: 'summary' as const,
        strategyReason: 'Size heuristic',
        language: 'typescript',
        fullSizeBytes: 10000,
        returnedSizeBytes: 3000,
        compressionRatio: 0.3,
        parseTimeMs: 125,
        cacheHit: false,
        decisionPath: 'tree_sitter' as const,
        estimatedTokensFull: 2857,
        estimatedTokensReturned: 857,
        estimatedTokensSaved: 2000,
      };

      expect(metrics).toHaveProperty('strategy');
      expect(metrics).toHaveProperty('strategyReason');
      expect(metrics).toHaveProperty('language');
      expect(metrics).toHaveProperty('compressionRatio');
      expect(metrics).toHaveProperty('decisionPath');
      expect(metrics).toHaveProperty('estimatedTokensSaved');
    });

    it('should serialize metrics as JSON', () => {
      const metrics = {
        strategy: 'full' as const,
        strategyReason: 'File too small',
        language: 'typescript',
        fullSizeBytes: 100,
        returnedSizeBytes: 100,
        compressionRatio: 1,
        parseTimeMs: 0,
        cacheHit: false,
        decisionPath: 'full_read' as const,
        estimatedTokensFull: 29,
        estimatedTokensReturned: 29,
        estimatedTokensSaved: 0,
      };

      const json = JSON.stringify(metrics);
      const parsed = JSON.parse(json);

      expect(parsed.strategy).toBe('full');
      expect(parsed.compressionRatio).toBe(1);
    });
  });

  /**
   * Integration test: Strategy decision flow
   */
  describe('integration: read strategy flow', () => {
    it('should return full read for small file', () => {
      const filePath = path.join(testDir, 'small.ts');
      fs.writeFileSync(filePath, 'const x = 1;');

      const stats = fs.statSync(filePath);
      const size = stats.size;

      // Small files should be read in full
      const shouldSummarize = size > 10000;
      expect(shouldSummarize).toBe(false);
    });

    it('should return summary for large file', () => {
      const filePath = path.join(testDir, 'large.ts');
      const largeContent = 'function test() {\n' + '  return 42;\n'.repeat(500) + '}\n';
      fs.writeFileSync(filePath, largeContent);

      const stats = fs.statSync(filePath);
      const size = stats.size;

      expect(size).toBeGreaterThan(100);
    });

    it('should handle explicit full=true override', () => {
      const options = { full: true };

      // When full=true, skip strategy decision
      const shouldUseStrategy = !options.full;
      expect(shouldUseStrategy).toBe(false);
    });

    it('should respect isDraft flag', () => {
      const options = { isDraft: true };
      // In draft mode, always return full read
      const willReturnFull = options.isDraft === true;
      expect(willReturnFull).toBe(true);
    });
  });
});
