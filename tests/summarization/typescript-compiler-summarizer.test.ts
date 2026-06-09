/**
 * TDD Tests for TypeScript Compiler API Summarizer
 * Tests extraction of classes, functions, interfaces, types, exports, and imports
 */
import { describe, it, expect } from '@jest/globals';
import { TypeScriptCompilerSummarizer } from '../../src/summarization/typescript-compiler-summarizer';

describe('TypeScriptCompilerSummarizer', () => {
  let summarizer: TypeScriptCompilerSummarizer;

  beforeEach(() => {
    summarizer = new TypeScriptCompilerSummarizer('typescript');
  });

  describe('Basic Extraction', () => {
    it('should extract simple function declarations', () => {
      const code = `
        function greet(name: string): string {
          return \`Hello, \${name}\`;
        }
      `;
      const summary = summarizer.summarize(code);

      expect(summary).toBeDefined();
      expect(summary.language).toBe('typescript');
      expect(summary.functions).toHaveLength(1);
      expect(summary.functions[0].name).toBe('greet');
      expect(summary.functions[0].kind).toBe('function');
    });

    it('should extract class declarations', () => {
      const code = `
        class User {
          constructor(public id: number, public name: string) {}
          
          getName(): string {
            return this.name;
          }
        }
      `;
      const summary = summarizer.summarize(code);

      expect(summary.classes).toHaveLength(1);
      expect(summary.classes[0].name).toBe('User');
      expect(summary.classes[0].methods).toHaveLength(1);
      expect(summary.classes[0].methods[0].name).toBe('getName');
    });

    it('should extract interface declarations', () => {
      const code = `
        interface UserDTO {
          id: number;
          name: string;
          email: string;
        }
      `;
      const summary = summarizer.summarize(code);

      expect(summary.interfaces).toHaveLength(1);
      expect(summary.interfaces[0].name).toBe('UserDTO');
    });

    it('should extract type aliases', () => {
      const code = `
        type UUID = string;
        type Handler = (data: any) => Promise<void>;
      `;
      const summary = summarizer.summarize(code);

      expect(summary.types.length).toBeGreaterThanOrEqual(1);
      expect(summary.types.some(t => t.name === 'UUID')).toBe(true);
    });

    it('should extract import statements', () => {
      const code = `
        import { Repository } from './repo';
        import { Logger } from '@app/logger';
        import fs from 'fs';
      `;
      const summary = summarizer.summarize(code);

      expect(summary.imports.length).toBeGreaterThanOrEqual(1);
      expect(summary.imports.some(i => i.module === './repo')).toBe(true);
    });

    it('should extract export statements', () => {
      const code = `
        export class Service {}
        export interface Config {}
        export const version = '1.0';
      `;
      const summary = summarizer.summarize(code);

      expect(summary.exports.length).toBeGreaterThanOrEqual(1);
      expect(summary.exports.some(e => e.name === 'Service')).toBe(true);
    });
  });

  describe('Complex Structures', () => {
    it('should extract multiple classes with methods', () => {
      const code = `
        class UserRepository {
          async findById(id: number) { return null; }
          async create(data: any) { return null; }
        }
        
        class UserService {
          constructor(private repo: UserRepository) {}
          async getUser(id: number) { return this.repo.findById(id); }
        }
      `;
      const summary = summarizer.summarize(code);

      expect(summary.classes).toHaveLength(2);
      expect(summary.classes.some(c => c.name === 'UserService')).toBe(true);
    });

    it('should extract mixed exports', () => {
      const code = `
        export interface UserDTO { id: number; }
        export class User {}
        export type Status = 'active' | 'inactive';
        export async function getUser(id: number) { return null; }
      `;
      const summary = summarizer.summarize(code);

      expect(summary.exports.length).toBeGreaterThanOrEqual(3);
      expect(summary.interfaces.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle arrow functions', () => {
      const code = `
        const process = (data: string): void => {
          console.log(data);
        };
      `;
      const summary = summarizer.summarize(code);

      // Arrow functions declared with const may or may not be extracted
      // depending on implementation; test for robustness
      expect(summary).toBeDefined();
      expect(summary.parseError).toBeUndefined();
    });
  });

  describe('Language Support', () => {
    it('should support typescript language', () => {
      const summarizer = new TypeScriptCompilerSummarizer('typescript');
      const code = 'type MyType = string;';
      const summary = summarizer.summarize(code);
      expect(summary.language).toBe('typescript');
    });

    it('should support javascript language', () => {
      const summarizer = new TypeScriptCompilerSummarizer('javascript');
      const code = 'function test() {}';
      const summary = summarizer.summarize(code);
      expect(summary.language).toBe('javascript');
    });
  });

  describe('Error Handling', () => {
    it('should handle parse errors gracefully', () => {
      const code = 'function broken(( { // malformed code';
      const summary = summarizer.summarize(code);

      expect(summary).toBeDefined();
      // Should not throw, may have parseError or empty results
      expect(summary.originalSizeBytes).toBeGreaterThan(0);
    });

    it('should return metadata', () => {
      const code = 'class Test {}';
      const summary = summarizer.summarize(code);

      expect(summary.originalSizeBytes).toBeGreaterThan(0);
      expect(summary.summaryTimeMs).toBeGreaterThanOrEqual(0);
      expect(summary.language).toBe('typescript');
    });

    it('should handle empty code', () => {
      const summary = summarizer.summarize('');
      expect(summary).toBeDefined();
      expect(summary.language).toBe('typescript');
    });
  });

  describe('Timeout Handling', () => {
    it('should complete within timeout', () => {
      const code = `
        function a() {}
        function b() {}
        function c() {}
      `;
      const startTime = performance.now();
      const summary = summarizer.summarize(code, 200);
      const elapsed = performance.now() - startTime;

      expect(summary).toBeDefined();
      expect(elapsed).toBeLessThan(1000); // Should be very fast
    });
  });
});
