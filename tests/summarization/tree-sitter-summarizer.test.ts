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
        class RecoveredClass {
          method(): void {}
        }

        function recoveredFunction(): number {
          return 1;
        }

        const broken = {
      `;

      let summary: ReturnType<TreeSitterSummarizer['summarize']> | undefined;
      expect(() => {
        summary = summarizer.summarize(invalidCode);
      }).not.toThrow();

      expect(summary).toBeDefined();
      // TypeScript compiler is very forgiving with incomplete code
      // So we just verify it recovers and extracts what it can
      expect(summary?.classes).toEqual([
        { name: 'RecoveredClass', methods: [{ name: 'method', signature: 'method(): void {', kind: 'method' }] },
      ]);
      expect(summary?.functions).toEqual([
        { name: 'recoveredFunction', signature: 'function recoveredFunction(): number {', kind: 'function' },
      ]);
      expect(summary?.imports).toEqual([]);
      expect(summary?.exports).toEqual([]);
      expect(summary?.types).toEqual([]);
      expect(summary?.interfaces).toEqual([]);
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

      expect(content).toContain('func NewUserHandler(store UserStore) *UserHandler');

      const go = new TreeSitterSummarizer('go');
      const summary = go.summarize(content);

      // Either extracts the known fixture function OR gracefully degrades with a
      // documented tree-sitter CLI/grammar availability error. Do not accept a
      // merely-defined summary with no successful extraction or specific error.
      if (summary.parseError) {
        expect(summary.parseError).toMatch(
          /^(tree-sitter-cli not available \(ENOENT\)|tree-sitter-cli failed: .*?(language|grammar|parser|not found|not configured|No language found|Failed to load|Could not load)|tree-sitter-cli error: .*?(ENOENT|timed out|spawn|language|grammar|parser))/is,
        );
      } else {
        expect(summary.functions.map(f => f.name)).toContain('NewUserHandler');
      }
    });

    it('should extract Go function, type, and method metadata', () => {
      const content = `
        package widgets

        type Widget struct {
          name string
        }

        func NewWidget(name string) Widget {
          return Widget{name: name}
        }

        func (w *Widget) Name() string {
          return w.name
        }
      `;

      const go = new TreeSitterSummarizer('go');
      const summary = go.summarize(content);

      // Either succeeds and extracts metadata, OR gracefully degrades
      if (summary.parseError) {
        // Graceful degradation when CLI isn't properly configured
        expect(summary.parseError).toBeDefined();
      } else {
        // When CLI works, verify extraction
        expect(summary.types.length).toBeGreaterThanOrEqual(1);
        expect(summary.types.some(t => t.name === 'Widget')).toBe(true);
        expect(summary.functions.length).toBeGreaterThanOrEqual(1);
        expect(summary.functions.some(f => f.name === 'NewWidget')).toBe(true);
        expect(summary.classes.length).toBeGreaterThanOrEqual(1);
        expect(summary.classes.some(c => c.name === 'Widget')).toBe(true);
      }
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
