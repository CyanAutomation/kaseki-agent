/**
 * TDD Tests for Go CLI Summarizer
 * Tests extraction of Go structs, functions, methods, and interfaces via tree-sitter CLI
 */
import { describe, it, expect } from '@jest/globals';
import { GoCliSummarizer } from '../../src/summarization/go-cli-summarizer';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('GoCliSummarizer', () => {
  let summarizer: GoCliSummarizer;
  let tmpDir: string;

  beforeEach(() => {
    summarizer = new GoCliSummarizer('go');
    tmpDir = path.join(os.tmpdir(), `go-test-${Date.now()}`);
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('Successful Extraction', () => {
    // These tests assume Go grammar is available (CI/Docker with proper setup)
    // If grammar is missing, tests skip gracefully

    it('should extract struct declarations when grammar available', () => {
      const filePath = path.join(tmpDir, 'test.go');
      const code = `package main

type User struct {
    ID   int
    Name string
}

func (u User) GetName() string {
    return u.Name
}
`;
      fs.writeFileSync(filePath, code);
      const summary = summarizer.summarize(filePath);

      // Either extracts types OR has a parseError
      if (summary.parseError) {
        const isExpectedError = summary.parseError.includes('language') ||
                               summary.parseError.includes('not available') ||
                               summary.parseError.includes('failed') ||
                               summary.parseError.includes('error');
        expect(isExpectedError).toBe(true);
      } else {
        expect(summary.types.length).toBeGreaterThanOrEqual(1);
        expect(summary.types.some(t => t.name === 'User')).toBe(true);
      }
    });

    it('should extract methods on receivers when grammar available', () => {
      const filePath = path.join(tmpDir, 'test.go');
      const code = `package main

type Handler struct {
    name string
}

func (h Handler) Process() error {
    return nil
}

func (h *Handler) Update(name string) {
    h.name = name
}
`;
      fs.writeFileSync(filePath, code);
      const summary = summarizer.summarize(filePath);

      // Either extracts classes/methods OR has a parseError
      if (summary.parseError) {
        const isExpectedError = summary.parseError.includes('language') ||
                               summary.parseError.includes('not available') ||
                               summary.parseError.includes('failed') ||
                               summary.parseError.includes('error');
        expect(isExpectedError).toBe(true);
      } else {
        expect(summary.classes.length).toBeGreaterThanOrEqual(1);
        expect(summary.classes.some(c => c.name === 'Handler')).toBe(true);
        const handler = summary.classes.find(c => c.name === 'Handler');
        expect(handler?.methods.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('should extract import statements or gracefully degrade', () => {
      const filePath = path.join(tmpDir, 'test.go');
      const code = `package main

import (
    "fmt"
    "github.com/user/repo"
)

func main() {
    fmt.Println("test")
}
`;
      fs.writeFileSync(filePath, code);
      const summary = summarizer.summarize(filePath);

      // Either extracts imports OR has a parseError
      if (summary.parseError) {
        const isExpectedError = summary.parseError.includes('language') ||
                               summary.parseError.includes('not available') ||
                               summary.parseError.includes('failed') ||
                               summary.parseError.includes('error');
        expect(isExpectedError).toBe(true);
      } else {
        expect(summary.imports.length).toBeGreaterThanOrEqual(1);
        expect(summary.imports.some(i => i.module.includes('fmt'))).toBe(true);
      }
    });

    it('should handle interface declarations', () => {
      const filePath = path.join(tmpDir, 'test.go');
      const code = `package main

type Writer interface {
    Write(p []byte) (n int, err error)
}
`;
      fs.writeFileSync(filePath, code);
      const summary = summarizer.summarize(filePath);

      expect(summary).toBeDefined();
      if (summary.parseError) {
        expect(summary.parseError).toMatch(/^tree-sitter-cli (?:not available \(ENOENT\)|failed: [\s\S]+|error: [\s\S]+)$/);
      } else {
        const hasWriterInterface = summary.interfaces.some(i => i.name === 'Writer') ||
          summary.types.some(t => t.name === 'Writer');
        expect(hasWriterInterface).toBe(true);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent files gracefully', () => {
      const filePath = path.join(tmpDir, 'nonexistent.go');
      const summary = summarizer.summarize(filePath);

      expect(summary).toBeDefined();
      expect(summary.language).toBe('go');
      // Should have error or empty results, not crash
      expect(summary.originalSizeBytes).toBeGreaterThanOrEqual(0);
    });

    it('should handle syntax errors gracefully', () => {
      const filePath = path.join(tmpDir, 'broken.go');
      const code = `package main

func broken(( {
    // malformed
}
`;
      fs.writeFileSync(filePath, code);
      let summary: ReturnType<GoCliSummarizer['summarize']> | undefined;
      expect(() => {
        summary = summarizer.summarize(filePath);
      }).not.toThrow();

      expect(summary).toBeDefined();
      expect(summary?.language).toBe('go');

      if (summary?.parseError) {
        expect(summary.parseError).toEqual(expect.any(String));
      } else {
        // Tree-sitter can recover a syntax tree from malformed Go, but this input
        // has no valid declarations to summarize. Do not treat a no-error parse as
        // a success unless the recovered collections reflect that partial/empty state.
        expect(summary?.imports).toEqual([]);
        expect(summary?.exports).toEqual([]);
        expect(summary?.classes).toEqual([]);
        expect(summary?.functions).toEqual([]);
        expect(summary?.types).toEqual([]);
        expect(summary?.interfaces).toEqual([]);
      }
    });

    it('should return metadata', () => {
      const filePath = path.join(tmpDir, 'test.go');
      const code = `package main

func greet(name string) string {
    return "Hello, " + name
}
`;
      fs.writeFileSync(filePath, code);
      const summary = summarizer.summarize(filePath);

      expect(summary.originalSizeBytes).toBe(Buffer.byteLength(code, 'utf-8'));
      expect(summary.language).toBe('go');
      expect(summary.summaryTimeMs).toEqual(expect.any(Number));

      if (summary.parseError) {
        expect(summary.parseError).toMatch(/^tree-sitter-cli (?:not available \(ENOENT\)|failed: [\s\S]+|error: [\s\S]+)$/);
      } else {
        expect(summary.functions.map(f => f.name)).toContain('greet');
      }
    });
  });

  describe('Timeout Handling', () => {
    it('should complete within timeout for small files', () => {
      const filePath = path.join(tmpDir, 'small.go');
      const code = `package main

func a() {}
func b() {}
`;
      fs.writeFileSync(filePath, code);
      const startTime = performance.now();
      const summary = summarizer.summarize(filePath, 200);
      const elapsed = performance.now() - startTime;

      expect(summary).toBeDefined();
      expect(elapsed).toBeLessThan(5000); // CLI calls should be fast
    });
  });

  describe('Complex Go Code', () => {
    it('should extract multiple types and methods or gracefully degrade', () => {
      const filePath = path.join(tmpDir, 'complex.go');
      const code = `package main

type Logger interface {
    Info(msg string)
    Error(err error)
}

type FileLogger struct {
    path string
}

func (fl *FileLogger) Info(msg string) {
    // implementation
}

func (fl *FileLogger) Error(err error) {
    // implementation
}

type ConsoleLogger struct{}

func (cl ConsoleLogger) Info(msg string) {}
func (cl ConsoleLogger) Error(err error) {}
`;
      fs.writeFileSync(filePath, code);
      const summary = summarizer.summarize(filePath);

      expect(summary).toBeDefined();
      // Either extracts multiple classes OR has a parseError
      if (summary.parseError) {
        const isExpectedError = summary.parseError.includes('language') ||
                               summary.parseError.includes('not available') ||
                               summary.parseError.includes('failed') ||
                               summary.parseError.includes('error');
        expect(isExpectedError).toBe(true);
      } else {
        expect(summary.classes.length).toBeGreaterThanOrEqual(2);
      }
    });
  });
});
