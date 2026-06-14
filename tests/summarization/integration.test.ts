/**
 * Integration tests for summarization pipeline end-to-end
 * Real tests for complete workflows
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { clearSummaryCache, readFileWithSummary, readFileWithSummaryAndMetrics } from '../../src/summarization/read-wrapper';
import type { ReadResult } from '../../src/summarization/read-wrapper';

type ReadErrorResult = {
  error?: string;
  content: string | null;
  metrics?: ReadResult['metrics'];
};

function expectSuccessfulRead(result: ReadResult | null): asserts result is ReadResult {
  expect(result).not.toBeNull();
  const maybeError = result as ReadErrorResult | null;
  expect(maybeError?.error).toBeUndefined();
  expect(result?.content).not.toBeNull();
  expect(result?.content).toEqual(expect.any(String));
  expect(result?.metrics).toBeDefined();
}

function writeGeneratedServiceFile(filePath: string): string {
  const content = `
import { Repository } from './repository';
import { Logger } from './logger';

/**
 * User service handles all user-related operations
 */
export interface UserRequest {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'user';
}

export class UserService {
  constructor(
    private repository: Repository,
    private logger: Logger
  ) {}

  async getUser(id: number): Promise<UserRequest | null> {
    this.logger.debug(\`Fetching user \${id}\`);
    const user = await this.repository.findById(id);
    if (!user) {
      this.logger.warn(\`User \${id} not found\`);
      return null;
    }
    return user;
  }

  async createUser(data: Partial<UserRequest>): Promise<UserRequest> {
    this.logger.info(\`Creating user: \${data.name}\`);
    const user = await this.repository.create(data);
    this.logger.info(\`User created with ID \${user.id}\`);
    return user;
  }

  async updateUser(id: number, data: Partial<UserRequest>): Promise<UserRequest> {
    this.logger.info(\`Updating user \${id}\`);
    const user = await this.repository.update(id, data);
    this.logger.info(\`User \${id} updated\`);
    return user;
  }

  async deleteUser(id: number): Promise<boolean> {
    this.logger.warn(\`Deleting user \${id}\`);
    const result = await this.repository.delete(id);
    this.logger.info(\`User \${id} deleted: \${result}\`);
    return result;
  }
}

export function createUserService(repo: Repository, logger: Logger): UserService {
  return new UserService(repo, logger);
}
`;
  fs.writeFileSync(filePath, content);
  return content;
}

describe('Summarization Integration', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `kaseki-integ-test-${Date.now()}`);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    clearSummaryCache();
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

    it('should return concrete metrics for the generated TypeScript service file', async () => {
      const filePath = path.join(testDir, 'example-service.ts');
      const content = writeGeneratedServiceFile(filePath);

      const contentOnly = await readFileWithSummary(filePath);
      expect(contentOnly).not.toBeNull();
      expect(contentOnly).toEqual(expect.any(String));
      expect(contentOnly).toContain('UserService');

      const result = await readFileWithSummaryAndMetrics(filePath);
      expectSuccessfulRead(result);
      expect(result.content).toContain('UserService');
      expect(result.metrics?.language).toBe('typescript');
      expect(result.metrics?.fullSizeBytes).toBe(Buffer.byteLength(content, 'utf-8'));
      expect(result.metrics?.returnedSizeBytes).toBe(Buffer.byteLength(result.content, 'utf-8'));
    });

    it('should force a full read for the generated TypeScript service file', async () => {
      const filePath = path.join(testDir, 'example-service-full.ts');
      const content = writeGeneratedServiceFile(filePath);

      const result = await readFileWithSummaryAndMetrics(filePath, { full: true });
      expectSuccessfulRead(result);
      expect(result.content).toBe(content);
      expect(result.metrics?.strategy).toBe('full');
      expect(result.metrics?.strategyReason).toBe('Pi explicit request (full=true)');
      expect(result.metrics?.decisionPath).toBe('full_read');
      expect(result.metrics?.language).toBe('typescript');
    });

    it('should return the documented null/error result for missing files', async () => {
      const missingFile = path.join(testDir, 'missing.ts');

      await expect(readFileWithSummary(missingFile)).resolves.toBeNull();
      await expect(readFileWithSummaryAndMetrics(missingFile)).resolves.toEqual({
        error: 'File not found',
        content: null,
      });
    });
  });

  describe('Performance Characteristics', () => {
    it('should return content and metrics for a small TypeScript file', async () => {
      const filePath = path.join(testDir, 'small.ts');
      const content = 'export const x: number = 1;\n';
      fs.writeFileSync(filePath, content);

      const result = await readFileWithSummaryAndMetrics(filePath);

      expectSuccessfulRead(result);
      expect((result as ReadErrorResult).error).toBeUndefined();
      expect(result.content).toBe(content);
      expect(result.metrics).toMatchObject({
        strategy: 'full',
        language: 'typescript',
        fullSizeBytes: Buffer.byteLength(content, 'utf-8'),
        returnedSizeBytes: Buffer.byteLength(content, 'utf-8'),
        compressionRatio: 1,
        cacheHit: false,
        decisionPath: 'full_read',
      });
      expect(result.metrics?.strategyReason).toMatch(/File too small/);
      expect(result.metrics?.parseTimeMs).toBe(0);
      expect(result.metrics?.estimatedTokensFull).toBeGreaterThan(0);
      expect(result.metrics?.estimatedTokensReturned).toBe(result.metrics?.estimatedTokensFull);
      expect(result.metrics?.estimatedTokensSaved).toBe(0);
    });

    it('should handle moderate file sizes', async () => {
      const filePath = path.join(testDir, 'moderate.ts');
      let content = 'export class A {}\n';
      for (let i = 0; i < 100; i++) {
        content += `export function func${i}() { return ${i}; }\n`;
      }
      fs.writeFileSync(filePath, content);

      const fullResult = await readFileWithSummaryAndMetrics(filePath, { full: true });
      expectSuccessfulRead(fullResult);
      expect(fullResult.content).toBe(content);
      expect(fullResult.metrics).toMatchObject({
        strategy: 'full',
        language: 'typescript',
        fullSizeBytes: Buffer.byteLength(content, 'utf-8'),
        returnedSizeBytes: Buffer.byteLength(content, 'utf-8'),
        compressionRatio: 1,
        decisionPath: 'full_read',
      });
      expect(fullResult.content).toContain('export class A {}');
      for (const symbol of ['func0', 'func1', 'func42', 'func99']) {
        expect(fullResult.content).toContain(`export function ${symbol}() {`);
      }

      const result = await readFileWithSummaryAndMetrics(filePath);

      expectSuccessfulRead(result);
      expect(result.metrics).toMatchObject({
        strategy: 'summary',
        language: 'typescript',
        fullSizeBytes: Buffer.byteLength(content, 'utf-8'),
        cacheHit: false,
        decisionPath: 'tree_sitter',
      });
      expect(result.metrics?.strategyReason).toMatch(/Large supported file in range/);
      expect(result.metrics?.returnedSizeBytes).toBe(Buffer.byteLength(result.content, 'utf-8'));
      expect(result.metrics?.compressionRatio).toBeCloseTo(
        Buffer.byteLength(result.content, 'utf-8') / Buffer.byteLength(content, 'utf-8')
      );
      expect(result.metrics?.compressionRatio).toBeGreaterThan(0);
      expect(result.metrics?.estimatedTokensFull).toBeGreaterThan(0);
      expect(result.metrics?.estimatedTokensReturned).toBeGreaterThan(0);
      expect(result.metrics?.estimatedTokensSaved).toBe(
        (result.metrics?.estimatedTokensFull ?? 0) - (result.metrics?.estimatedTokensReturned ?? 0)
      );

      expect(result.content).not.toBe(content);
      expect(result.content).toContain('<!-- SUMMARY: typescript');
      expect(result.content).toContain('## Exports');
      expect(result.content).toContain('- A (class)');
      expect(result.content).toContain('## Classes');
      expect(result.content).toContain('### A');
      expect(result.content).toContain('## Functions');

      for (const symbol of ['func0', 'func1', 'func42', 'func99']) {
        expect(result.content).toContain(`- ${symbol} (function)`);
        expect(result.content).toContain(`function ${symbol}()`);
      }
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
      const fixturePath = path.join(process.cwd(), 'tests/fixtures/summarization/data.xml');
      const filePath = path.join(testDir, 'data.xml');
      const content = fs.readFileSync(fixturePath, 'utf-8');
      fs.copyFileSync(fixturePath, filePath);

      const result = await readFileWithSummaryAndMetrics(filePath);

      expectSuccessfulRead(result);
      expect((result as ReadErrorResult).error).toBeUndefined();
      expect(result.content).toBe(content);
      expect(result.content).not.toContain('<!-- SUMMARY:');
      expect(result.metrics).toMatchObject({
        strategy: 'full',
        strategyReason: 'Unsupported language: unknown',
        language: 'unknown',
        fullSizeBytes: Buffer.byteLength(content, 'utf-8'),
        returnedSizeBytes: Buffer.byteLength(content, 'utf-8'),
        compressionRatio: 1,
        parseTimeMs: 0,
        cacheHit: false,
        decisionPath: 'full_read',
      });
      expect(result.metrics?.estimatedTokensFull).toBeGreaterThan(0);
      expect(result.metrics?.estimatedTokensReturned).toBe(result.metrics?.estimatedTokensFull);
      expect(result.metrics?.estimatedTokensSaved).toBe(0);
    });
  });
});
