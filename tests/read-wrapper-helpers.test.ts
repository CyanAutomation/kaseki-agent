import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  clearSummaryCache,
  readFileWithSummary,
  readFileWithSummaryAndMetrics,
} from '../src/summarization/read-wrapper';
import { detectLanguage, getReadStrategy } from '../src/summarization/read-strategy';
import { getConfig } from '../src/summarization/summarizer-config';

describe('read-wrapper behavior', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-wrapper-test-'));
    clearSummaryCache();
  });

  afterEach(() => {
    clearSummaryCache();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  function writeLargeTypeScriptFile(fileName = 'large.ts'): { filePath: string; content: string } {
    const filePath = path.join(testDir, fileName);
    const repeatedMethods = Array.from({ length: 180 }, (_, index) => {
      return `  method${index}(value: number): number {\n    return value + ${index};\n  }`;
    }).join('\n');
    const content = [
      'export interface LargeFixture {',
      '  id: string;',
      '  count: number;',
      '}',
      '',
      'export class LargeReaderFixture {',
      repeatedMethods,
      '}',
      '',
      'export function makeLargeFixture(id: string): LargeFixture {',
      '  return { id, count: id.length };',
      '}',
      '',
    ].join('\n');

    fs.writeFileSync(filePath, content);
    return { filePath, content };
  }

  it('returns null when the file is missing', async () => {
    await expect(readFileWithSummary(path.join(testDir, 'missing.ts'))).resolves.toBeNull();
  });

  it('returns full content with full_read metrics for a small supported file', async () => {
    const filePath = path.join(testDir, 'small.ts');
    const content = 'export const answer = 42;\n';
    fs.writeFileSync(filePath, content);

    const result = await readFileWithSummaryAndMetrics(filePath);

    expect(result).not.toBeNull();
    expect(result?.content).toBe(content);
    expect(result?.metrics?.language).toBe('typescript');
    expect(result?.metrics?.strategy).toBe('full');
    expect(result?.metrics?.decisionPath).toBe('full_read');
    expect(result?.metrics?.cacheHit).toBe(false);
    expect(result?.metrics?.returnedSizeBytes).toBe(result?.metrics?.fullSizeBytes);
  });

  it('reports a cache hit when a cache-enabled summary read is repeated', async () => {
    const { filePath } = writeLargeTypeScriptFile();

    const firstRead = await readFileWithSummaryAndMetrics(filePath);
    const secondRead = await readFileWithSummaryAndMetrics(filePath);

    expect(firstRead).not.toBeNull();
    expect(firstRead?.metrics?.strategy).toBe('summary');
    expect(firstRead?.metrics?.decisionPath).toBe('tree_sitter');
    expect(firstRead?.metrics?.cacheHit).toBe(false);
    expect(firstRead?.content).toContain('<!-- SUMMARY: typescript');

    expect(secondRead).not.toBeNull();
    expect(secondRead?.content).toBe(firstRead?.content);
    expect(secondRead?.metrics?.strategy).toBe('summary');
    expect(secondRead?.metrics?.decisionPath).toBe('cache_hit');
    expect(secondRead?.metrics?.cacheHit).toBe(true);
  });

  it('falls back to a full read for files above the maximum summarization size', async () => {
    const filePath = path.join(testDir, 'oversized.ts');
    const minimalContent = 'export const oversized = "x";\n';
    fs.writeFileSync(filePath, minimalContent);
    fs.truncateSync(filePath, getConfig().maxSizeBytes + 1);
    const content = fs.readFileSync(filePath, 'utf-8');
    fs.writeFileSync(filePath, content);

    const result = await readFileWithSummaryAndMetrics(filePath);

    expect(result).not.toBeNull();
    expect(result?.content).toBe(content);
    expect(result?.metrics?.strategy).toBe('full');
    expect(result?.metrics?.decisionPath).toBe('full_read');
    expect(result?.metrics?.strategyReason).toContain('File too large');
    expect(result?.metrics?.returnedSizeBytes).toBe(result?.metrics?.fullSizeBytes);
  });

  it('uses the production read strategy for draft reads instead of summarizing', () => {
    const { filePath, content } = writeLargeTypeScriptFile('draft.ts');
    const strategy = getReadStrategy({
      filePath,
      sizeBytes: Buffer.byteLength(content, 'utf-8'),
      language: detectLanguage(filePath),
      config: getConfig(),
      isDraft: true,
    });

    expect(strategy.strategy).toBe('full');
    expect(strategy.reason).toContain('Editing phase');
  });
});
