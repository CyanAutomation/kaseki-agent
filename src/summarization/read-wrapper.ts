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
    cache = new SummaryCache(cacheDir, {
      maxEntries: cfg.cacheMaxEntries,
      maxSizeBytes: cfg.cacheMaxSizeBytes,
      ttlMs: cfg.cacheTTLMs,
    });
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
 * Validates file exists and is a valid file
 * Returns file stats or null if invalid
 */
async function validateFileExists(
  filePath: string
): Promise<{ exists: boolean; isFile: boolean; isEmpty: boolean; sizeBytes: number } | null> {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    return null;
  }

  return {
    exists: true,
    isFile: true,
    isEmpty: stats.size === 0,
    sizeBytes: stats.size,
  };
}

/**
 * Handles empty file case
 */
async function handleEmptyFile(
  { returnMetrics }: ReadOptions & { returnMetrics?: boolean }
): Promise<string | null> {
  const content = '';
  if (returnMetrics) {
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
        decisionPath: 'full_read' as const,
        estimatedTokensFull: 0,
        estimatedTokensReturned: 0,
        estimatedTokensSaved: 0,
      },
    });
  }
  return content;
}

/**
 * Checks cache for summarization strategy
 * Returns cached content if hit, null otherwise
 */
async function checkCacheForSummary(
  filePath: string,
  cfg: SummarizerConfig,
  startTime: number,
  fullSizeBytes: number,
  strategy: ReadStrategy,
  strategyReason: string,
  language: string
): Promise<{ cacheHit: boolean; content?: string; metrics?: ReadMetrics } | null> {
  if (!cfg.enableCache || strategy !== 'summary') {
    return null;
  }

  const summaryCache = getCache();
  const cached = summaryCache.get(filePath);

  if (cached) {
    const returnedSize = Buffer.byteLength(cached.content, 'utf-8');
    return {
      cacheHit: true,
      content: cached.content,
      metrics: createMetrics(
        strategy,
        strategyReason,
        language,
        fullSizeBytes,
        returnedSize,
        performance.now() - startTime,
        true,
        'cache_hit'
      ),
    };
  }

  return null;
}

/**
 * Attempts summarization with error handling
 */
async function attemptSummarization(
  filePath: string,
  fullContent: string,
  language: string,
  cfg: SummarizerConfig,
  options: ReadOptions & { returnMetrics?: boolean },
  startTime: number,
  fullSizeBytes: number,
  strategy: ReadStrategy,
  strategyReason: string
): Promise<{ content: string; metrics?: ReadMetrics; decisionPath: ReadMetrics['decisionPath'] } | null> {
  if (language === 'unknown' || !cfg.supportedLanguages.includes(language as any)) {
    // Unsupported language - fallback to full
    return {
      content: fullContent,
      decisionPath: 'full_read',
      metrics: createMetrics('full', 'Unsupported language', language, fullSizeBytes, fullSizeBytes, 0, false, 'full_read'),
    };
  }

  try {
    const summarizationStart = performance.now();
    const sum = getSummarizer(language);

    if (!sum) {
      throw new Error('Summarizer not available');
    }

    const summary = sum.summarize(fullContent, options.timeoutMs || cfg.parseTimeoutMs);

    if (summary.parseError) {
      // Parse failed - return full
      return {
        content: fullContent,
        decisionPath: 'error',
        metrics: createMetrics(
          'full',
          `Parse error: ${summary.parseError}`,
          language,
          fullSizeBytes,
          fullSizeBytes,
          performance.now() - summarizationStart,
          false,
          'error'
        ),
      };
    }

    // Format summary as markdown
    const markdown = sum.formatAsMarkdown(summary);
    const returnedSize = Buffer.byteLength(markdown, 'utf-8');

    // Cache it
    if (cfg.enableCache) {
      getCache().set(filePath, markdown, language);
    }

    const parseTime = performance.now() - startTime;
    return {
      content: markdown,
      decisionPath: 'tree_sitter',
      metrics: createMetrics(strategy, strategyReason, language, fullSizeBytes, returnedSize, parseTime, false, 'tree_sitter'),
    };
  } catch (error) {
    // Summarization failed - fallback to full
    const elapsed = performance.now() - startTime;
    return {
      content: fullContent,
      decisionPath: 'error',
      metrics: createMetrics('full', `Summarization failed: ${error}`, language, fullSizeBytes, fullSizeBytes, elapsed, false, 'error'),
    };
  }
}

/**
 * Internal implementation
 * Refactored to use helper functions for clarity and reduced complexity
 */
async function readFileWithSummaryInternal(filePath: string, options: ReadOptions & { returnMetrics?: boolean }): Promise<string | null> {
  const startTime = performance.now();

  try {
    // Validate file exists
    const fileValidation = await validateFileExists(filePath);
    if (fileValidation === null) {
      if (options.returnMetrics) {
        return JSON.stringify({ error: 'File not found', content: null });
      }
      return null;
    }

    // Handle empty file
    if (fileValidation.isEmpty) {
      return await handleEmptyFile(options);
    }

    const fullSizeBytes = fileValidation.sizeBytes;
    const language = detectLanguage(filePath);
    const cfg = getConfigOrDefault();

    // Rule: explicit full=true override
    if (options.full === true) {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (options.returnMetrics) {
        return JSON.stringify({
          content,
          metrics: createMetrics('full', 'Pi explicit request (full=true)', language, fullSizeBytes, fullSizeBytes, 0, false, 'full_read'),
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
    const strategy = strategyResult.strategy;
    const strategyReason = strategyResult.reason;

    // If strategy says full read, return full file
    if (strategy === 'full') {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (options.returnMetrics) {
        return JSON.stringify({
          content,
          metrics: createMetrics(strategy, strategyReason, language, fullSizeBytes, fullSizeBytes, 0, false, 'full_read'),
        });
      }
      return content;
    }

    // Strategy says summary - check cache first
    const cacheResult = await checkCacheForSummary(filePath, cfg, startTime, fullSizeBytes, strategy, strategyReason, language);
    if (cacheResult) {
      if (options.returnMetrics) {
        return JSON.stringify({
          content: cacheResult.content,
          metrics: cacheResult.metrics,
        });
      }
      return cacheResult.content || null;
    }

    // Cache miss - attempt summarization
    const fullContent = fs.readFileSync(filePath, 'utf-8');
    const summarizationResult = await attemptSummarization(
      filePath,
      fullContent,
      language,
      cfg,
      options,
      startTime,
      fullSizeBytes,
      strategy,
      strategyReason
    );

    if (!summarizationResult) {
      return null;
    }

    if (options.returnMetrics) {
      return JSON.stringify({
        content: summarizationResult.content,
        metrics: summarizationResult.metrics,
      });
    }
    return summarizationResult.content;
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
