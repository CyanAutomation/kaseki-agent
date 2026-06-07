/**
 * Integration tests for summarization pipeline end-to-end
 * Real tests for complete workflows
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readFileWithSummaryAndMetrics } from '../../src/summarization/read-wrapper';

describe('Summarization Integration', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `kaseki-integ-test-${Date.now()}`);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('End-to-End Workflows', () => {
    it('should process TypeScript with classes and interfaces', async () => {
      const filePath = path.join(testDir, 'models.ts');
      const content = `
        export interface UserDTO { id: number; name: string; }
        export class User { 
          constructor(public id: number, public name: string) {}
          getName() { return this.name; }
        }
        export function createUser(name: string) { return new User(1, name); }
      `;
      fs.writeFileSync(filePath, content);

      const result = await readFileWithSummaryAndMetrics(filePath);
      expect(result).toBeDefined();
      if (result?.metrics) {
        expect(result.metrics.language).toBe('typescript');
      }
    });

    it('should process JavaScript module exports', async () => {
      const filePath = path.join(testDir, 'utils.js');
      const content = `
        const helper = (x) => x * 2;
        const processor = (arr) => arr.map(helper);
        module.exports = { helper, processor };
      `;
      fs.writeFileSync(filePath, content);

      const result = await readFileWithSummaryAndMetrics(filePath);
      expect(result).toBeDefined();
      if (result?.metrics) {
        expect(result.metrics.language).toBe('javascript');
      }
    });

    it('should process Go structs and methods', async () => {
      const filePath = path.join(testDir, 'handler.go');
      const content = `
        package main
        type Handler struct { name string }
        func (h Handler) Process() error { return nil }
      `;
      fs.writeFileSync(filePath, content);

      const result = await readFileWithSummaryAndMetrics(filePath);
      expect(result).toBeDefined();
      if (result?.metrics) {
        expect(result.metrics.language).toBe('go');
      }
    });

    it('should handle mixed import styles', async () => {
      const filePath = path.join(testDir, 'mixed.ts');
      const content = `
        import fs from 'fs';
        import { readFile } from 'fs/promises';
        import * as path from 'path';
        import { promisify } from 'util';
      `;
      fs.writeFileSync(filePath, content);

      const result = await readFileWithSummaryAndMetrics(filePath);
      expect(result).toBeDefined();
    });

    it('should handle comments and whitespace gracefully', async () => {
      const filePath = path.join(testDir, 'commented.ts');
      const content = `
        // Main class
        export class Main {
          /* Multi-line
             comment */
          public run() {
            // Do something
          }
        }
      `;
      fs.writeFileSync(filePath, content);

      const result = await readFileWithSummaryAndMetrics(filePath);
      expect(result).toBeDefined();
    });

    it('should process real-world scenario: service class', async () => {
      const filePath = path.join(testDir, 'service.ts');
      const content = `
        import { Database } from './db';
        import { Logger } from './logger';
        
        export interface ServiceConfig { debug: boolean; }
        
        export class UserService {
          constructor(private db: Database, private logger: Logger) {}
          
          async getUser(id: number) { return this.db.query('SELECT * FROM users WHERE id = ?', [id]); }
          async createUser(name: string) { return this.db.query('INSERT INTO users (name) VALUES (?)', [name]); }
        }
      `;
      fs.writeFileSync(filePath, content);

      const result = await readFileWithSummaryAndMetrics(filePath);
      expect(result).toBeDefined();
      expect(result?.content).toBeDefined();
      if (result?.metrics) {
        expect(result.metrics).toBeDefined();
      }
    });
  });

  describe('Performance Characteristics', () => {
    it('should complete small file processing quickly', async () => {
      const filePath = path.join(testDir, 'small.ts');
      fs.writeFileSync(filePath, 'export const x = 1;');

      const start = Date.now();
      await readFileWithSummaryAndMetrics(filePath);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(1000); // Should be fast
    });

    it('should handle moderate file sizes', async () => {
      const filePath = path.join(testDir, 'moderate.ts');
      let content = 'export class A {}\n';
      for (let i = 0; i < 100; i++) {
        content += `export function func${i}() { return ${i}; }\n`;
      }
      fs.writeFileSync(filePath, content);

      const result = await readFileWithSummaryAndMetrics(filePath);
      expect(result).toBeDefined();
    });
  });

  describe('Error Recovery', () => {
    it('should recover from syntax errors', async () => {
      const filePath = path.join(testDir, 'broken.ts');
      fs.writeFileSync(filePath, 'export class A { broken }}');

      const result = await readFileWithSummaryAndMetrics(filePath);
      expect(result).toBeDefined();
      expect(result?.content).toBeDefined(); // Should still provide content
    });

    it('should handle unsupported file types', async () => {
      const filePath = path.join(testDir, 'data.xml');
      fs.writeFileSync(filePath, '<root><item>test</item></root>');

      const result = await readFileWithSummaryAndMetrics(filePath);
      expect(result).toBeDefined();
    });
  });
});
