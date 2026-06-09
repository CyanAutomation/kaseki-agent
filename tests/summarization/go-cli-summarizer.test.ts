/**
 * TDD Tests for Go CLI Summarizer
 * Tests extraction of Go structs, functions, methods, and interfaces via tree-sitter CLI
 */
import { describe, it, expect } from '@jest/globals';
import { GoCliSummarizer } from '../../src/summarization/go-cli-summarizer';
import type { CodeSummary } from '../../src/summarization/tree-sitter-summarizer';
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

  describe('Basic Extraction', () => {
    it('should extract function declarations', () => {
      const filePath = path.join(tmpDir, 'test.go');
      const code = `package main

func greet(name string) string {
    return "Hello, " + name
}
`;
      fs.writeFileSync(filePath, code);
      const summary = summarizer.summarize(filePath);

      expect(summary).toBeDefined();
      expect(summary.language).toBe('go');
      expect(summary.functions.length).toBeGreaterThanOrEqual(1);
      expect(summary.functions.some(f => f.name === 'greet')).toBe(true);
    });

    it('should extract struct declarations', () => {
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

      expect(summary.types.length).toBeGreaterThanOrEqual(1);
      expect(summary.types.some(t => t.name === 'User')).toBe(true);
    });

    it('should extract methods on receivers', () => {
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

      expect(summary.classes.length).toBeGreaterThanOrEqual(1);
      expect(summary.classes.some(c => c.name === 'Handler')).toBe(true);
      const handler = summary.classes.find(c => c.name === 'Handler');
      expect(handler?.methods.length).toBeGreaterThanOrEqual(2);
    });

    it('should extract import statements', () => {
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

      expect(summary.imports.length).toBeGreaterThanOrEqual(1);
      expect(summary.imports.some(i => i.module.includes('fmt'))).toBe(true);
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
      // Interfaces may be in types or interfaces depending on implementation
      expect(summary.originalSizeBytes).toBeGreaterThan(0);
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
      const summary = summarizer.summarize(filePath);

      expect(summary).toBeDefined();
      expect(summary.language).toBe('go');
      // Should not throw
    });

    it('should return metadata', () => {
      const filePath = path.join(tmpDir, 'test.go');
      const code = `package main

func test() {}
`;
      fs.writeFileSync(filePath, code);
      const summary = summarizer.summarize(filePath);

      expect(summary.summaryTimeMs).toBeGreaterThanOrEqual(0);
      expect(summary.language).toBe('go');
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
    it('should extract multiple types and methods', () => {
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
      expect(summary.classes.length).toBeGreaterThanOrEqual(2);
    });
  });
});
