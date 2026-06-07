/**
 * Tests for TreeSitterSummarizer
 * Real implementation tests with active assertions
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { TreeSitterSummarizer } from '../../src/summarization/tree-sitter-summarizer';

describe('TreeSitterSummarizer', () => {
  let summarizer: TreeSitterSummarizer;
  let fixturesDir: string;

  beforeEach(() => {
    fixturesDir = path.join(__dirname, '../fixtures/summarization');
    summarizer = new TreeSitterSummarizer('typescript');
  });

  describe('Basic Structure Extraction', () => {
    it('should extract class definitions', () => {
      const file = path.join(fixturesDir, 'medium-file.ts');
      const content = fs.readFileSync(file, 'utf-8');

      const summary = summarizer.summarize(content);
      expect(summary.classes).toBeDefined();
      expect(summary.classes.length).toBeGreaterThan(0);
      const authManager = summary.classes.find(c => c.name === 'AuthManager');
      expect(authManager).toBeDefined();
    });

    it('should extract function signatures', () => {
      const file = path.join(fixturesDir, 'small-file.ts');
      const content = fs.readFileSync(file, 'utf-8');

      const summary = summarizer.summarize(content);
      expect(summary.functions).toBeDefined();
      expect(summary.functions.length).toEqual(2);
      const names = summary.functions.map(f => f.name);
      expect(names).toContain('add');
      expect(names).toContain('subtract');
    });

    it('should extract imports', () => {
      const file = path.join(fixturesDir, 'medium-file.ts');
      const content = fs.readFileSync(file, 'utf-8');

      const summary = summarizer.summarize(content);
      expect(summary.imports).toBeDefined();
      expect(summary.imports.length).toBeGreaterThan(0);
    });

    it('should extract interface definitions', () => {
      const file = path.join(fixturesDir, 'medium-file.ts');
      const content = fs.readFileSync(file, 'utf-8');

      const summary = summarizer.summarize(content);
      expect(summary.interfaces).toBeDefined();
      expect(summary.interfaces.length).toBeGreaterThan(0);
      const interfaceNames = summary.interfaces.map(i => i.name);
      expect(interfaceNames).toContain('Token');
      expect(interfaceNames).toContain('Credentials');
    });

    it('should extract exports', () => {
      const file = path.join(fixturesDir, 'medium-file.ts');
      const content = fs.readFileSync(file, 'utf-8');

      const summary = summarizer.summarize(content);
      expect(summary.exports).toBeDefined();
      expect(summary.exports.length).toBeGreaterThan(0);
    });
  });

  describe('Size Reduction', () => {
    it('should record original file size', () => {
      const file = path.join(fixturesDir, 'large-file.ts');
      const fullContent = fs.readFileSync(file, 'utf-8');
      const fullSize = Buffer.byteLength(fullContent, 'utf-8');

      const summary = summarizer.summarize(fullContent);
      expect(summary).toBeDefined();
      expect(summary.originalSizeBytes).toEqual(fullSize);
      expect(summary.parseError).toBeUndefined();
    });

    it('should preserve key information in summary', () => {
      const file = path.join(fixturesDir, 'large-file.ts');
      const content = fs.readFileSync(file, 'utf-8');

      const summary = summarizer.summarize(content);
      expect(summary).toBeDefined();
      expect(summary.classes).toBeDefined();
      expect(summary.classes.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle syntax errors gracefully', () => {
      const invalidCode = `
        export class Broken {
          method(): void {
            this.notClosed();
      `;

      const summary = summarizer.summarize(invalidCode);
      // Tree-sitter is resilient and provides partial results
      expect(summary).toBeDefined();
    });

    it('should handle empty files', () => {
      const summary = summarizer.summarize('');
      expect(summary.classes.length).toEqual(0);
      expect(summary.functions.length).toEqual(0);
    });

    it('should handle files with only comments', () => {
      const commentOnly = `
        // This is a comment
        /* Multi-line comment
           describing nothing */
        // Another comment
      `;

      const summary = summarizer.summarize(commentOnly);
      expect(summary.classes.length).toEqual(0);
      expect(summary.functions.length).toEqual(0);
    });
  });

  describe('Language Support', () => {
    it('should support TypeScript', () => {
      const file = path.join(fixturesDir, 'medium-file.ts');
      const content = fs.readFileSync(file, 'utf-8');

      const ts = new TreeSitterSummarizer('typescript');
      const summary = ts.summarize(content);
      expect(summary.classes.length).toBeGreaterThan(0);
    });

    it('should support JavaScript', () => {
      const file = path.join(fixturesDir, 'small-file.ts');
      const content = fs.readFileSync(file, 'utf-8');

      const js = new TreeSitterSummarizer('javascript');
      const summary = js.summarize(content);
      expect(summary.functions.length).toBeGreaterThan(0);
    });

    it('should support Go', () => {
      const file = path.join(fixturesDir, 'handler.go');
      const content = fs.readFileSync(file, 'utf-8');

      const go = new TreeSitterSummarizer('go');
      const summary = go.summarize(content);
      expect(summary).toBeDefined();
    });
  });

  describe('Summary Metadata', () => {
    it('should include original size bytes', () => {
      const file = path.join(fixturesDir, 'medium-file.ts');
      const content = fs.readFileSync(file, 'utf-8');

      const summary = summarizer.summarize(content);
      expect(summary.originalSizeBytes).toBeGreaterThan(0);
    });

    it('should include summary time in milliseconds', () => {
      const file = path.join(fixturesDir, 'medium-file.ts');
      const content = fs.readFileSync(file, 'utf-8');

      const summary = summarizer.summarize(content);
      expect(summary.summaryTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should track language', () => {
      const file = path.join(fixturesDir, 'medium-file.ts');
      const content = fs.readFileSync(file, 'utf-8');

      const summary = summarizer.summarize(content);
      expect(summary.language).toEqual('typescript');
    });
  });

  describe('Performance', () => {
    it('should parse files in reasonable time', () => {
      const file = path.join(fixturesDir, 'large-file.ts');
      const content = fs.readFileSync(file, 'utf-8');

      const start = performance.now();
      const summary = summarizer.summarize(content);
      const elapsed = performance.now() - start;

      expect(summary).toBeDefined();
      expect(elapsed).toBeLessThan(1000);
    });

    it('should handle small files quickly', () => {
      const file = path.join(fixturesDir, 'small-file.ts');
      const content = fs.readFileSync(file, 'utf-8');

      const start = performance.now();
      const summary = summarizer.summarize(content);
      const elapsed = performance.now() - start;

      expect(summary).toBeDefined();
      expect(elapsed).toBeLessThan(100);
    });
  });
});
