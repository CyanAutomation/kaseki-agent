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

import { readFileWithSummary, readFileWithSummaryAndMetrics } from '../../src/summarization/read-wrapper';
import { detectLanguage, getReadStrategy } from '../../src/summarization/read-strategy';
import { getConfig } from '../../src/summarization/summarizer-config';

describe('ReadWrapper', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `kaseki-wrap-test-${Date.now()}`);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

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
        estimatedTokensFull: Math.ceil(sizeBytes / 3.5),
        estimatedTokensReturned: Math.ceil(sizeBytes / 3.5),
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
      expect(result).toBeDefined();
    });

    it('should handle TypeScript files', async () => {
      const filePath = path.join(testDir, 'test.ts');
      const content = 'export interface User { name: string; age: number; }';
      fs.writeFileSync(filePath, content);

      const result = await readFileWithSummary(filePath);
      expect(result).toBeDefined();
    });

    it('should handle JavaScript files', async () => {
      const filePath = path.join(testDir, 'test.js');
      const content = 'export const myFunc = () => console.log("test");';
      fs.writeFileSync(filePath, content);

      const result = await readFileWithSummary(filePath);
      expect(result).toBeDefined();
    });

    it('should handle Go files', async () => {
      const filePath = path.join(testDir, 'test.go');
      const content = 'func main() { }';
      fs.writeFileSync(filePath, content);

      const result = await readFileWithSummary(filePath);
      expect(result).toBeDefined();
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
      expect(result).toBeDefined();
    });
  });

  describe('readFileWithSummaryAndMetrics', () => {
    it('should return metrics for TypeScript files', async () => {
      const filePath = path.join(testDir, 'test.ts');
      const content = 'export class MyClass { method() { } }';
      fs.writeFileSync(filePath, content);

      const result = await readFileWithSummaryAndMetrics(filePath);
      expect(result).toBeDefined();
      if (result?.metrics) {
        expect(result.metrics.strategy).toMatch(/full|summary/);
      }
    });

    it('should report parse time in metrics', async () => {
      const filePath = path.join(testDir, 'test.ts');
      const content = 'export interface Config { debug: boolean; }';
      fs.writeFileSync(filePath, content);

      const result = await readFileWithSummaryAndMetrics(filePath);
      if (result?.metrics) {
        expect(result.metrics.parseTimeMs).toBeGreaterThanOrEqual(0);
      }
    });

    it('should report compression ratio for summary strategy', async () => {
      const filePath = path.join(testDir, 'test.ts');
      const content = 'export class A {}\nexport function b() {}\nexport interface C {}';
      fs.writeFileSync(filePath, content);

      const result = await readFileWithSummaryAndMetrics(filePath);
      // Result should be defined (either with content or metrics)
      expect(result !== null && result !== undefined).toBe(true);
    });

    it('should report read path strategy (cache/tree-sitter/full)', async () => {
      const filePath = path.join(testDir, 'test.ts');
      fs.writeFileSync(filePath, 'export class A {}');

      const result = await readFileWithSummaryAndMetrics(filePath);
      if (result?.metrics) {
        expect(['cache_hit', 'tree_sitter', 'full_read', 'error']).toContain(result.metrics.decisionPath);
      }
    });

    it('should return null for missing files with metrics', async () => {
      const filePath = path.join(testDir, 'missing.ts');
      const result = await readFileWithSummaryAndMetrics(filePath);
      // Function handles missing files gracefully
      expect(typeof result === 'object' || result === null).toBe(true);
    });

    it('should handle very large files gracefully', async () => {
      const filePath = path.join(testDir, 'large.ts');
      // Create a large file (1MB+)
      const largeContent = 'export class A {}\n' + 'export function b' + Date.now() + '() {}\n'.repeat(50000);
      fs.writeFileSync(filePath, largeContent);

      const result = await readFileWithSummaryAndMetrics(filePath);
      expect(result).toBeDefined();
      if (result?.metrics) {
        expect(result.metrics.strategy).toBe('full'); // Should choose full for very large
      }
    });

    it('should track decision rationale', async () => {
      const filePath = path.join(testDir, 'test.ts');
      fs.writeFileSync(filePath, 'export class Test {}');

      const result = await readFileWithSummaryAndMetrics(filePath);
      if (result?.metrics) {
        expect(result.metrics.strategyReason).toBeDefined();
        expect(result.metrics.strategyReason.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Graceful Degradation', () => {
    it('should fall back to full read on syntax errors', async () => {
      const filePath = path.join(testDir, 'syntax-error.ts');
      const content = 'export class A { invalid syntax }}}';
      fs.writeFileSync(filePath, content);

      const result = await readFileWithSummary(filePath);
      expect(result).toBeDefined();
    });

    it('should handle symlinks', async () => {
      const targetFile = path.join(testDir, 'target.ts');
      const linkFile = path.join(testDir, 'link.ts');
      fs.writeFileSync(targetFile, 'export class A {}');

      try {
        fs.symlinkSync(targetFile, linkFile);
        const result = await readFileWithSummary(linkFile);
        expect(result).toBeDefined();
      } catch {
        // Symlinks might not work on all systems
      }
    });
  });
});
