/**
 * Tests for ReadWrapper orchestration layer
 * Real tests for end-to-end file read with summarization
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

jest.unmock('tree-sitter');
jest.unmock('tree-sitter-typescript');
jest.unmock('tree-sitter-go');

import {
  clearSummaryCache,
  readFileWithSummary,
  readFileWithSummaryAndMetrics,
} from '../../src/summarization/read-wrapper';
import {
  detectLanguage,
  getReadStrategy,
} from '../../src/summarization/read-strategy';
import { getConfig } from '../../src/summarization/summarizer-config';

describe('ReadWrapper', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `kaseki-wrap-test-${Date.now()}`);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    clearSummaryCache();
  });

  afterEach(() => {
    clearSummaryCache();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  function expectMetricsDerivedFromActualResult(
    result: NonNullable<
      Awaited<ReturnType<typeof readFileWithSummaryAndMetrics>>
    >,
    filePath: string,
    decisionPath: 'cache_hit' | 'full_read' | 'tree_sitter' | 'error',
  ): void {
    const fullSizeBytes = fs.statSync(filePath).size;
    const returnedSizeBytes = Buffer.byteLength(result.content, 'utf-8');

    expect(result.metrics?.fullSizeBytes).toBe(fullSizeBytes);
    expect(result.metrics?.returnedSizeBytes).toBe(returnedSizeBytes);
    expect(result.metrics?.compressionRatio).toBe(
      fullSizeBytes > 0 ? returnedSizeBytes / fullSizeBytes : 1,
    );
    expect(result.metrics?.estimatedTokensFull).toBe(
      Math.ceil(fullSizeBytes / 3.5),
    );
    expect(result.metrics?.estimatedTokensReturned).toBe(
      Math.ceil(returnedSizeBytes / 3.5),
    );
    expect(result.metrics?.estimatedTokensSaved).toBe(
      Math.ceil(fullSizeBytes / 3.5) - Math.ceil(returnedSizeBytes / 3.5),
    );
    expect(result.metrics?.decisionPath).toBe(decisionPath);
  }

  function writeLargeTypeScriptFile(filePath: string): string {
    const repeatedMethods = Array.from({ length: 180 }, (_, index) => {
      return `  method${index}(value: number): number {\n    return value + ${index};\n  }`;
    }).join('\n');
    const content = [
      'export interface LargeFixture {',
      '  id: string;',
      '  count: number;',
      '}',
      '',
      'export class LargeReaderFixture {',
      repeatedMethods,
      '}',
      '',
      'export function makeLargeFixture(id: string): LargeFixture {',
      '  return { id, count: id.length };',
      '}',
      '',
    ].join('\n');
    fs.writeFileSync(filePath, content);
    expect(content).toContain(
      '  method0(value: number): number {\n    return value + 0;\n  }',
    );
    expect(content).not.toContain('\\n');
    return content;
  }

  describe('debug scenario coverage', () => {
    it('asserts the former debug TypeScript scenario through Jest', async () => {
      const filePath = path.join(testDir, 'test.ts');
      const content = `export class User {
  id: string;
  name: string;
}
`;
      fs.writeFileSync(filePath, content);

      const sizeBytes = fs.statSync(filePath).size;
      const language = detectLanguage(filePath);
      expect(language).toBe('typescript');

      const config = getConfig();
      const strategy = getReadStrategy({
        filePath,
        sizeBytes,
        language,
        config,
      });
      expect(strategy).toEqual({
        strategy: 'full',
        reason: strategy.reason,
        estimatedTokens: strategy.estimatedTokens,
      });

      const readContent = await readFileWithSummary(filePath);
      expect(readContent).toBe(content);

      const result = await readFileWithSummaryAndMetrics(filePath);
      expect(result).not.toBeNull();
      expect(result?.content).toBe(content);
      expect(result?.metrics).toMatchObject({
        strategy: 'full',
        strategyReason: strategy.reason,
        language: 'typescript',
        fullSizeBytes: sizeBytes,
        returnedSizeBytes: sizeBytes,
        compressionRatio: 1,
        cacheHit: false,
        decisionPath: 'full_read',
        estimatedTokensFull: strategy.estimatedTokens,
        estimatedTokensReturned: strategy.estimatedTokens,
        estimatedTokensSaved: 0,
      });
      expect(result?.metrics?.parseTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('readFileWithSummary', () => {
    it('should return content for small files (full read)', async () => {
      const filePath = path.join(testDir, 'small.ts');
      const content = 'export class A {}';
      fs.writeFileSync(filePath, content);

      const result = await readFileWithSummary(filePath);
      expect(result).toBe(content);

      const metricsResult = await readFileWithSummaryAndMetrics(filePath);
      expect(metricsResult?.content).toBe(content);
      expect(metricsResult?.metrics).toMatchObject({
        language: 'typescript',
        strategy: 'full',
        cacheHit: false,
        decisionPath: 'full_read',
      });
    });

    it.each([
      {
        name: 'should handle TypeScript files',
        fileName: 'test.ts',
        content: 'export interface User { name: string; age: number; }',
        language: 'typescript',
      },
      {
        name: 'should handle JavaScript files',
        fileName: 'test.js',
        content: 'export const myFunc = () => console.log("test");',
        language: 'javascript',
      },
      {
        name: 'should handle Go files',
        fileName: 'test.go',
        content: 'func main() { }',
        language: 'go',
      },
    ])('$name', async ({ fileName, content, language }) => {
      const filePath = path.join(testDir, fileName);
      fs.writeFileSync(filePath, content);

      const result = await readFileWithSummary(filePath);
      expect(result).toBe(content);

      const metricsResult = await readFileWithSummaryAndMetrics(filePath);
      expect(metricsResult?.content).toBe(content);
      expect(metricsResult?.metrics).toMatchObject({
        language,
        strategy: 'full',
        cacheHit: false,
        decisionPath: 'full_read',
      });
    });

    it('should return null for missing files', async () => {
      const filePath = path.join(testDir, 'missing.ts');
      const result = await readFileWithSummary(filePath);
      expect(result).toBeNull();
    });

    it('should handle JSON files', async () => {
      const filePath = path.join(testDir, 'config.json');
      const content = '{"key": "value"}';
      fs.writeFileSync(filePath, content);

      const result = await readFileWithSummary(filePath);
      expect(result).toBe(content);

      const sizeBytes = fs.statSync(filePath).size;
      const metricsResult = await readFileWithSummaryAndMetrics(filePath);
      expect(metricsResult).toEqual({
        content,
        metrics: {
          strategy: 'full',
          strategyReason: `File too small (${sizeBytes} < ${getConfig().minSizeBytes} bytes)`,
          language: 'unknown',
          fullSizeBytes: sizeBytes,
          returnedSizeBytes: sizeBytes,
          compressionRatio: 1,
          parseTimeMs: 0,
          cacheHit: false,
          decisionPath: 'full_read',
          estimatedTokensFull: Math.ceil(sizeBytes / 3.5),
          estimatedTokensReturned: Math.ceil(sizeBytes / 3.5),
          estimatedTokensSaved: 0,
        },
      });
    });
  });

  describe('readFileWithSummaryAndMetrics', () => {
    it('should report size, compression, token, and decision metrics for full reads', async () => {
      const filePath = path.join(testDir, 'test.ts');
      const content =
        'export class A {}\nexport function b() {}\nexport interface C {}';
      fs.writeFileSync(filePath, content);
      expect(content.split('\n')).toEqual([
        'export class A {}',
        'export function b() {}',
        'export interface C {}',
      ]);
      expect(content).not.toContain('\\n');

      const result = await readFileWithSummaryAndMetrics(filePath);
      if (!result) {
        throw new Error('Expected a full-read result');
      }
      if (!result.metrics) {
        throw new Error('Expected full-read metrics');
      }

      expect(result.content).toBe(content);
      expect(result.metrics.strategy).toBe('full');
      expect(result.metrics.language).toBe('typescript');
      expect(Number.isFinite(result.metrics.parseTimeMs)).toBe(true);
      expect(result.metrics.parseTimeMs).toBeGreaterThanOrEqual(0);
      expectMetricsDerivedFromActualResult(result, filePath, 'full_read');
    });

    it('should report size, compression, token, and decision metrics for tree-sitter summaries and cache hits', async () => {
      const filePath = path.join(testDir, 'large.ts');
      writeLargeTypeScriptFile(filePath);

      const firstRead = await readFileWithSummaryAndMetrics(filePath);
      const secondRead = await readFileWithSummaryAndMetrics(filePath);

      expect(firstRead).not.toBeNull();
      expect(firstRead?.metrics?.strategy).toBe('summary');
      expect(firstRead?.metrics?.cacheHit).toBe(false);
      expect(firstRead?.content).toContain('<!-- SUMMARY: typescript');
      expectMetricsDerivedFromActualResult(firstRead!, filePath, 'tree_sitter');

      expect(secondRead).not.toBeNull();
      expect(secondRead?.content).toBe(firstRead?.content);
      expect(secondRead?.metrics?.strategy).toBe('summary');
      expect(secondRead?.metrics?.cacheHit).toBe(true);
      expectMetricsDerivedFromActualResult(secondRead!, filePath, 'cache_hit');
    });

    it('should report the full-read path strategy and rationale', async () => {
      const filePath = path.join(testDir, 'test.ts');
      fs.writeFileSync(filePath, 'export class A {}');
      const sizeBytes = fs.statSync(filePath).size;

      const result = await readFileWithSummaryAndMetrics(filePath);
      expect(result).not.toBeNull();
      if (result === null) {
        throw new Error('Expected a read result');
      }

      expect(result.metrics).toBeDefined();
      if (!result.metrics) {
        throw new Error('Expected read metrics');
      }

      expect(result.metrics.strategy).toBe('full');
      expect(result.metrics.decisionPath).toBe('full_read');
      expect(result.metrics.strategyReason).toBe(
        `File too small (${sizeBytes} < ${getConfig().minSizeBytes} bytes)`,
      );
    });

    it('should return complete error metrics for missing files', async () => {
      const filePath = path.join(testDir, 'missing.ts');
      const result = await readFileWithSummaryAndMetrics(filePath);

      expect(result).toEqual({
        error: 'File not found',
        content: null,
        metrics: {
          strategy: 'full',
          strategyReason: 'File not found',
          language: 'typescript',
          fullSizeBytes: 0,
          returnedSizeBytes: 0,
          compressionRatio: 1,
          parseTimeMs: expect.any(Number),
          cacheHit: false,
          decisionPath: 'error',
          estimatedTokensFull: 0,
          estimatedTokensReturned: 0,
          estimatedTokensSaved: 0,
        },
      });
      expect(result?.metrics?.parseTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle very large files gracefully', async () => {
      const filePath = path.join(testDir, 'large.ts');
      const config = getConfig();
      const content = 'x'.repeat(config.maxSizeBytes + 1);
      fs.writeFileSync(filePath, content);

      const fullSizeBytes = fs.statSync(filePath).size;
      const estimatedTokens = Math.ceil(fullSizeBytes / 3.5);

      const result = await readFileWithSummaryAndMetrics(filePath);
      expect(result).toEqual({
        content,
        metrics: {
          strategy: 'full',
          strategyReason: `File too large (${fullSizeBytes} > ${config.maxSizeBytes} bytes)`,
          language: 'typescript',
          fullSizeBytes,
          returnedSizeBytes: fullSizeBytes,
          compressionRatio: 1,
          parseTimeMs: 0,
          cacheHit: false,
          decisionPath: 'full_read',
          estimatedTokensFull: estimatedTokens,
          estimatedTokensReturned: estimatedTokens,
          estimatedTokensSaved: 0,
        },
      });
    });

  });

  describe('Graceful Degradation', () => {
    it('should fall back to full read on syntax errors', async () => {
      const filePath = path.join(testDir, 'syntax-error.ts');
      const content = 'export class A { invalid syntax }}}';
      fs.writeFileSync(filePath, content);

      const result = await readFileWithSummary(filePath);
      expect(result).toBe(content);

      const metricsResult = await readFileWithSummaryAndMetrics(filePath);
      expect(metricsResult?.content).toBe(content);
      expect(metricsResult?.metrics).toMatchObject({
        language: 'typescript',
        strategy: 'full',
        cacheHit: false,
        decisionPath: 'full_read',
      });
    });

    it('should handle symlinks', async () => {
      const targetFile = path.join(testDir, 'target.ts');
      const linkFile = path.join(testDir, 'link.ts');
      const content = 'export class A {}';
      fs.writeFileSync(targetFile, content);

      try {
        fs.symlinkSync(targetFile, linkFile);
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? error.code
            : undefined;
        if (
          ['EACCES', 'EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM'].includes(
            String(code),
          )
        ) {
          return;
        }
        throw error;
      }

      const result = await readFileWithSummary(linkFile);
      expect(result).toBe(content);
    });
  });
});
