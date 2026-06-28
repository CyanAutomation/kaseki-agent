/**
 * Integration tests for summarization pipeline cross-component behavior.
 *
 * These scenarios intentionally avoid symbol-by-symbol extraction checks, which
 * belong in the individual summarizer unit tests. Instead they verify the
 * read wrapper, strategy selection, summarizer, metrics, and cache work together
 * the way an end user observes them.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  clearSummaryCache,
  readFileWithSummary,
  readFileWithSummaryAndMetrics,
} from '../../src/summarization/read-wrapper';
import type { ReadResult } from '../../src/summarization/read-wrapper';
import { getConfig } from '../../src/summarization/summarizer-config';

type ReadErrorResult = {
  error?: string;
  content: string | null;
  metrics?: ReadResult['metrics'];
};

function expectReadResult(result: ReadResult | null): asserts result is ReadResult {
  expect(result).not.toBeNull();
  expect((result as ReadErrorResult | null)?.error).toBeUndefined();
}

function fixturePath(name: string): string {
  return path.join(process.cwd(), 'tests/fixtures/summarization', name);
}

function copyFixture(testDir: string, fixtureName: string): { filePath: string; content: string } {
  const filePath = path.join(testDir, fixtureName);
  fs.copyFileSync(fixturePath(fixtureName), filePath);
  return {
    filePath,
    content: fs.readFileSync(filePath, 'utf-8'),
  };
}

function expectSizeMetrics(result: ReadResult, originalContent: string): void {
  const fullSizeBytes = Buffer.byteLength(originalContent, 'utf-8');
  const returnedSizeBytes = Buffer.byteLength(result.content, 'utf-8');

  expect(result.metrics).toMatchObject({
    fullSizeBytes,
    returnedSizeBytes,
    compressionRatio: returnedSizeBytes / fullSizeBytes,
    estimatedTokensFull: Math.ceil(fullSizeBytes / 3.5),
    estimatedTokensReturned: Math.ceil(returnedSizeBytes / 3.5),
    estimatedTokensSaved: Math.ceil(fullSizeBytes / 3.5) - Math.ceil(returnedSizeBytes / 3.5),
  });
}

describe('Summarization Integration', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-integ-test-'));
    clearSummaryCache();
  });

  afterEach(() => {
    clearSummaryCache();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('small TypeScript file returns full source because summarization would not save tokens', async () => {
    const { filePath, content } = copyFixture(testDir, 'small-file.ts');

    const result = await readFileWithSummaryAndMetrics(filePath);

    expectReadResult(result);
    expect(result.content).toBe(content);
    expect(result.metrics).toMatchObject({
      strategy: 'full',
      strategyReason: `File too small (${Buffer.byteLength(content, 'utf-8')} < ${getConfig().minSizeBytes} bytes)`,
      language: 'typescript',
      cacheHit: false,
      decisionPath: 'full_read',
      parseTimeMs: 0,
      compressionRatio: 1,
      estimatedTokensSaved: 0,
    });
    expectSizeMetrics(result, content);
  });

  it('large TypeScript file uses structural summary before raw fallback', async () => {
    const { filePath, content } = copyFixture(testDir, 'large-file.ts');

    const result = await readFileWithSummaryAndMetrics(filePath);

    expectReadResult(result);
    expect(result.content).not.toBe(content);
    expect(result.content).toContain('<!-- SUMMARY: typescript');
    expect(result.content).toContain('use full=true to read implementation details');
    expect(result.content).toContain('UserManager');
    expect(result.content).not.toContain('sessions.delete(token);');
    expect(result.metrics).toMatchObject({
      strategy: 'summary',
      strategyReason: `Large supported file in range (typescript, ${Buffer.byteLength(content, 'utf-8')} bytes)`,
      language: 'typescript',
      cacheHit: false,
      decisionPath: 'tree_sitter',
    });
    expect(result.metrics?.returnedSizeBytes).toBeLessThan(result.metrics?.fullSizeBytes ?? 0);
    expect(result.metrics?.estimatedTokensSaved).toBeGreaterThan(0);
    expectSizeMetrics(result, content);
  });

  it('second read of large TypeScript file serves cached structural summary', async () => {
    const { filePath, content } = copyFixture(testDir, 'large-file.ts');

    const firstRead = await readFileWithSummaryAndMetrics(filePath);
    const secondRead = await readFileWithSummaryAndMetrics(filePath);

    expectReadResult(firstRead);
    expectReadResult(secondRead);
    expect(firstRead.metrics).toMatchObject({
      strategy: 'summary',
      cacheHit: false,
      decisionPath: 'tree_sitter',
    });
    expect(secondRead.content).toBe(firstRead.content);
    expect(secondRead.metrics).toMatchObject({
      strategy: 'summary',
      cacheHit: true,
      decisionPath: 'cache_hit',
      language: 'typescript',
    });
    expectSizeMetrics(secondRead, content);
  });

  it('explicit full read bypasses structural summary for implementation details', async () => {
    const { filePath, content } = copyFixture(testDir, 'large-file.ts');

    const result = await readFileWithSummaryAndMetrics(filePath, { full: true });

    expectReadResult(result);
    expect(result.content).toBe(content);
    expect(result.content).toContain('sessions.delete(token);');
    expect(result.metrics).toMatchObject({
      strategy: 'full',
      strategyReason: 'Pi explicit request (full=true)',
      language: 'typescript',
      cacheHit: false,
      decisionPath: 'full_read',
      parseTimeMs: 0,
      compressionRatio: 1,
      estimatedTokensSaved: 0,
    });
    expectSizeMetrics(result, content);
  });

  it('unsupported XML file falls back to full content with unsupported-language reason', async () => {
    const { filePath, content } = copyFixture(testDir, 'data.xml');

    const result = await readFileWithSummaryAndMetrics(filePath);

    expectReadResult(result);
    expect(result.content).toBe(content);
    expect(result.content).not.toContain('<!-- SUMMARY:');
    expect(result.metrics).toMatchObject({
      strategy: 'full',
      strategyReason: 'Unsupported language: unknown',
      language: 'unknown',
      cacheHit: false,
      decisionPath: 'full_read',
      parseTimeMs: 0,
      compressionRatio: 1,
      estimatedTokensSaved: 0,
    });
    expectSizeMetrics(result, content);
  });

  it('files over the parse limit keep raw content instead of attempting a summary', async () => {
    const filePath = path.join(testDir, 'oversized.ts');
    const content = 'x'.repeat(getConfig().maxSizeBytes + 1);
    fs.writeFileSync(filePath, content);

    const result = await readFileWithSummaryAndMetrics(filePath);

    expectReadResult(result);
    expect(result.content).toBe(content);
    expect(result.metrics).toMatchObject({
      strategy: 'full',
      strategyReason: `File too large (${Buffer.byteLength(content, 'utf-8')} > ${getConfig().maxSizeBytes} bytes)`,
      language: 'typescript',
      cacheHit: false,
      decisionPath: 'full_read',
      parseTimeMs: 0,
      compressionRatio: 1,
      estimatedTokensSaved: 0,
    });
    expectSizeMetrics(result, content);
  });

  it('missing file reports the documented null/error fallback', async () => {
    const missingFile = path.join(testDir, 'missing.ts');

    await expect(readFileWithSummary(missingFile)).resolves.toBeNull();
    await expect(readFileWithSummaryAndMetrics(missingFile)).resolves.toEqual({
      error: 'File not found',
      content: null,
    });
  });
});
