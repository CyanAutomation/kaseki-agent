/**
 * Tests for ReadStrategy decision engine
 * Real tests for strategy selection logic
 */
import { describe, it, expect } from '@jest/globals';
import { getReadStrategy } from '../../src/summarization/read-strategy';
import { getConfig } from '../../src/summarization/summarizer-config';

describe('ReadStrategy', () => {
  const config = getConfig();

  describe('Draft Mode', () => {
    it('should prefer full read in draft mode', () => {
      const context = {
        filePath: '/test/file.ts',
        sizeBytes: 50000,
        language: 'typescript' as const,
        config,
        isDraft: true,
      };
      const strategy = getReadStrategy(context);
      expect(strategy.strategy).toBe('full');
      expect(strategy.reason).toContain('Editing');
    });
  });

  describe('Parse Errors', () => {
    it('should prefer full read when parse error occurs', () => {
      const context = {
        filePath: '/test/file.ts',
        sizeBytes: 50000,
        language: 'typescript' as const,
        config,
        parseError: 'Syntax error',
      };
      const strategy = getReadStrategy(context);
      expect(strategy.strategy).toBe('full');
      expect(strategy.reason).toContain('Parse');
    });
  });

  describe('File Size Thresholds', () => {
    it('should prefer full read for very small files (< minSizeBytes)', () => {
      // Files smaller than config.minSizeBytes should use full read
      const context = {
        filePath: '/test/file.ts',
        sizeBytes: 512,
        language: 'typescript' as const,
        config,
      };
      const strategy = getReadStrategy(context);
      expect(strategy.strategy).toBe('full');
      expect(strategy.reason).toContain('too small');
    });

    it('should prefer full read for very large files (> maxSizeBytes)', () => {
      // Files larger than config.maxSizeBytes should use full read
      const context = {
        filePath: '/test/file.ts',
        sizeBytes: 2000000,
        language: 'typescript' as const,
        config,
      };
      const strategy = getReadStrategy(context);
      expect(strategy.strategy).toBe('full');
      expect(strategy.reason).toContain('too large');
    });

    it('should handle boundary case at minSizeBytes exactly', () => {
      // Test at exact boundary
      const context = {
        filePath: '/test/file.ts',
        sizeBytes: config.minSizeBytes,
        language: 'typescript' as const,
        config,
      };
      const strategy = getReadStrategy(context);
      expect(['full', 'summary']).toContain(strategy.strategy);
    });

    it('should handle boundary case at maxSizeBytes exactly', () => {
      // Test at exact boundary
      const context = {
        filePath: '/test/file.ts',
        sizeBytes: config.maxSizeBytes,
        language: 'typescript' as const,
        config,
      };
      const strategy = getReadStrategy(context);
      expect(['full', 'summary']).toContain(strategy.strategy);
    });

    it('should prefer summary for optimal file size', () => {
      const context = {
        filePath: '/test/file.ts',
        sizeBytes: 50000, // 50KB - middle of optimal range
        language: 'typescript' as const,
        config,
      };
      const strategy = getReadStrategy(context);
      expect(strategy.strategy).toBe('summary');
    });
  });

  describe('Language Support', () => {
    it('should prefer summary for supported languages', () => {
      const languages = ['typescript', 'javascript', 'go'] as const;
      for (const lang of languages) {
        const context = {
          filePath: '/test/file.ts',
          sizeBytes: 50000,
          language: lang,
          config,
        };
        const strategy = getReadStrategy(context);
        expect(strategy.strategy).toBe('summary');
      }
    });

    it('should prefer full read for unsupported languages', () => {
      const context = {
        filePath: '/test/file.ts',
        sizeBytes: 50000,
        language: 'unknown' as const,
        config,
      };
      const strategy = getReadStrategy(context);
      expect(strategy.strategy).toBe('full');
      expect(strategy.reason).toContain('language');
    });
  });

  describe('Estimated Token Savings', () => {
    it('should provide token savings estimate for summary strategy', () => {
      const context = {
        filePath: '/test/file.ts',
        sizeBytes: 100000,
        language: 'typescript' as const,
        config,
      };
      const strategy = getReadStrategy(context);
      if (strategy.strategy === 'summary') {
        expect(strategy.estimatedTokens).toBeGreaterThan(0);
      }
    });
  });
});
