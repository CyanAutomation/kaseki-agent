/**
 * File reading wrapper with smart summarization
 * Integrates tree-sitter summarization, caching, and smart thresholding
 */
import * as fs from 'fs';
import * as path from 'path';
import { TreeSitterSummarizer } from '../summarization/tree-sitter-summarizer';
import { SummaryCache } from '../summarization/summary-cache';
import { SummarizerConfig, getConfig } from '../summarization/summarizer-config';
import { getReadStrategy, detectLanguage, StrategyContext, ReadStrategy } from '../summarization/read-strategy';

export interface ReadOptions {
  /**
   * Force full read regardless of size/strategy
   * Used when Pi explicitly requests full=true
   */
  full?: boolean;

  /**
   * Whether to return metrics with the content
   */
  returnMetrics?: boolean;

  /**
   * Timeout for parsing (ms)
   */
  timeoutMs?: number;

  /**
   * Context for editing phase
   * If true, will always return full read
   */
  isDraft?: boolean;
}

export interface ReadMetrics {
  strategy: ReadStrategy;
  strategyReason: string;
  language: string;
  fullSizeBytes: number;
  returnedSizeBytes: number;
  compressionRatio: number;
  parseTimeMs: number;
  cacheHit: boolean;
  decisionPath: 'cache_hit' | 'full_read' | 'tree_sitter' | 'error';
  estimatedTokensFull: number;
  estimatedTokensReturned: number;
  estimatedTokensSaved: number;
}

export interface ReadResult {
  content: string;
  metrics?: ReadMetrics;
}

let cache: SummaryCache | null = null;
let summarizer: TreeSitterSummarizer | null = null;
let config: SummarizerConfig | null = null;

function getCache(): SummaryCache {
  if (!cache) {
    const cfg = getConfig();
    const cacheDir = path.join(process.cwd(), cfg.cacheDir);
    cache = new SummaryCache(cacheDir);
  }
  return cache;
}

function getSummarizer(language: string): TreeSitterSummarizer | null {
  try {
    if (!summarizer) {
      const cfg = getConfig();
      if (!cfg.supportedLanguages.includes(language as any)) {
        return null;
      }
      summarizer = new TreeSitterSummarizer(language as any);
    }
    return summarizer;
  } catch {
    return null;
  }
}

function getConfigOrDefault(): SummarizerConfig {
  if (!config) {
    config = getConfig();
  }
  return config;
}

/**
 * Read file content with smart summarization
 * Default behavior: uses heuristics to choose summary vs full read
 * Can be overridden with full=true for explicit full read
 */
export async function readFileWithSummary(filePath: string, options: ReadOptions = {}): Promise<string | null> {
  return readFileWithSummaryInternal(filePath, options) as Promise<string | null>;
}

export async function readFileWithSummaryAndMetrics(filePath: string, options: ReadOptions = {}): Promise<ReadResult | null> {
  const content = await readFileWithSummaryInternal(filePath, { ...options, returnMetrics: true });
  return content ? JSON.parse(content as string) : null;
}

/**
 * Internal implementation
 */
async function readFileWithSummaryInternal(filePath: string, options: ReadOptions & { returnMetrics?: boolean }): Promise<string | null> {
  const startTime = performance.now();
  let strategy: ReadStrategy = 'full';
  let strategyReason = '';
  let cacheHit = false;
  let decisionPath: ReadMetrics['decisionPath'] = 'error';

  try {
    // Check file exists
    if (!fs.existsSync(filePath)) {
      return options.returnMetrics ? JSON.stringify({ error: 'File not found', content: null }) : null;
    }

    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size === 0) {
      const content = '';
      if (options.returnMetrics) {
        return JSON.stringify({
          content,
          metrics: {
            strategy: 'full',
            strategyReason: 'Empty file',
            language: 'unknown',
            fullSizeBytes: 0,
            returnedSizeBytes: 0,
            compressionRatio: 1,
            parseTimeMs: 0,
            cacheHit: false,
            decisionPath: 'full_read',
            estimatedTokensFull: 0,
            estimatedTokensReturned: 0,
            estimatedTokensSaved: 0,
          },
        });
      }
      return content;
    }

    const fullSizeBytes = stats.size;
    const language = detectLanguage(filePath);
    const cfg = getConfigOrDefault();

    // Rule: explicit full=true override
    if (options.full === true) {
      const content = fs.readFileSync(filePath, 'utf-8');
      decisionPath = 'full_read';
      strategy = 'full';
      strategyReason = 'Pi explicit request (full=true)';

      if (options.returnMetrics) {
        return JSON.stringify({
          content,
          metrics: createMetrics(strategy, strategyReason, language, fullSizeBytes, fullSizeBytes, 0, cacheHit, decisionPath),
        });
      }
      return content;
    }

    // Get strategy
    const strategyCtx: StrategyContext = {
      filePath,
      sizeBytes: fullSizeBytes,
      language: language as any,
      config: cfg,
      isDraft: options.isDraft,
    };

    const strategyResult = getReadStrategy(strategyCtx);
    strategy = strategyResult.strategy;
    strategyReason = strategyResult.reason;

    // If strategy says full read, just return full file
    if (strategy === 'full') {
      const content = fs.readFileSync(filePath, 'utf-8');
      decisionPath = 'full_read';

      if (options.returnMetrics) {
        return JSON.stringify({
          content,
          metrics: createMetrics(strategy, strategyReason, language, fullSizeBytes, fullSizeBytes, 0, cacheHit, decisionPath),
        });
      }
      return content;
    }

    // Strategy says summary - check cache first
    if (cfg.enableCache) {
      const summaryCache = getCache();
      const cached = summaryCache.get(filePath);

      if (cached) {
        cacheHit = true;
        decisionPath = 'cache_hit';
        const returnedSize = Buffer.byteLength(cached.content, 'utf-8');

        if (options.returnMetrics) {
          return JSON.stringify({
            content: cached.content,
            metrics: createMetrics(strategy, strategyReason, language, fullSizeBytes, returnedSize, performance.now() - startTime, cacheHit, decisionPath),
          });
        }
        return cached.content;
      }
    }

    // Cache miss - generate summary
    if (language === 'unknown' || !cfg.supportedLanguages.includes(language as any)) {
      // Unsupported language - fallback to full
      const content = fs.readFileSync(filePath, 'utf-8');
      decisionPath = 'full_read';
      strategy = 'full';

      if (options.returnMetrics) {
        return JSON.stringify({
          content,
          metrics: createMetrics(strategy, 'Unsupported language', language, fullSizeBytes, fullSizeBytes, 0, cacheHit, decisionPath),
        });
      }
      return content;
    }

    // Try to summarize
    const fullContent = fs.readFileSync(filePath, 'utf-8');
    const summarizationStart = performance.now();

    try {
      const sum = getSummarizer(language);
      if (!sum) {
        throw new Error('Summarizer not available');
      }

      const summary = sum.summarize(fullContent, options.timeoutMs || cfg.parseTimeoutMs);

      if (summary.parseError) {
        // Parse failed - return full
        decisionPath = 'error';
        strategy = 'full';

        if (options.returnMetrics) {
          return JSON.stringify({
            content: fullContent,
            metrics: createMetrics(strategy, `Parse error: ${summary.parseError}`, language, fullSizeBytes, fullSizeBytes, performance.now() - summarizationStart, cacheHit, decisionPath),
          });
        }
        return fullContent;
      }

      // Format summary as markdown
      const markdown = sum.formatAsMarkdown(summary);
      const returnedSize = Buffer.byteLength(markdown, 'utf-8');

      // Cache it
      if (cfg.enableCache) {
        getCache().set(filePath, markdown, language);
      }

      decisionPath = 'tree_sitter';
      const parseTime = performance.now() - startTime;

      if (options.returnMetrics) {
        return JSON.stringify({
          content: markdown,
          metrics: createMetrics(strategy, strategyReason, language, fullSizeBytes, returnedSize, parseTime, cacheHit, decisionPath),
        });
      }
      return markdown;
    } catch (error) {
      // Summarization failed - fallback to full
      const elapsed = performance.now() - startTime;
      decisionPath = 'error';
      strategy = 'full';

      if (options.returnMetrics) {
        return JSON.stringify({
          content: fullContent,
          metrics: createMetrics(strategy, `Summarization failed: ${error}`, language, fullSizeBytes, fullSizeBytes, elapsed, cacheHit, decisionPath),
        });
      }
      return fullContent;
    }
  } catch (error) {
    // Top-level error - return error response
    const errorMsg = error instanceof Error ? error.message : String(error);

    if (options.returnMetrics) {
      return JSON.stringify({
        error: errorMsg,
        content: null,
      });
    }
    return null;
  }
}

function createMetrics(
  strategy: ReadStrategy,
  strategyReason: string,
  language: string,
  fullSizeBytes: number,
  returnedSizeBytes: number,
  parseTimeMs: number,
  cacheHit: boolean,
  decisionPath: ReadMetrics['decisionPath']
): ReadMetrics {
  const compressionRatio = fullSizeBytes > 0 ? returnedSizeBytes / fullSizeBytes : 1;
  const estimatedTokensFull = Math.ceil(fullSizeBytes / 3.5);
  const estimatedTokensReturned = Math.ceil(returnedSizeBytes / 3.5);
  const estimatedTokensSaved = estimatedTokensFull - estimatedTokensReturned;

  return {
    strategy,
    strategyReason,
    language,
    fullSizeBytes,
    returnedSizeBytes,
    compressionRatio,
    parseTimeMs,
    cacheHit,
    decisionPath,
    estimatedTokensFull,
    estimatedTokensReturned,
    estimatedTokensSaved,
  };
}

/**
 * Cleanup and flush cache
 * Call this when Pi is done with read phase
 */
export function flushSummaryCache(): void {
  if (cache) {
    cache.flush();
  }
}

/**
 * Get cache statistics
 */
export function getSummaryCacheStats() {
  if (!cache) return null;
  return cache.getStats();
}

/**
 * Clear cache (useful for testing or between runs in containers)
 */
export function clearSummaryCache(): void {
  if (cache) {
    cache.clear();
  }
}
