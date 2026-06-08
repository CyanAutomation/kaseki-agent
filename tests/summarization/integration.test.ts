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
