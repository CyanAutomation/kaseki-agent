/**
 * Configuration for summarization behavior
 */

export type SupportedLanguage = 'typescript' | 'javascript' | 'go';

export interface SummarizerConfig {
  /**
   * Supported languages for summarization.
   * Unsupported languages fall back to full read.
   */
  supportedLanguages: SupportedLanguage[];

  /**
   * File size threshold (bytes) below which always return full read
   * Small files: summarization overhead not worth it
   * Default: 2KB (2048 bytes)
   */
  minSizeBytes: number;

  /**
   * Maximum file size (bytes) to parse with tree-sitter
   * Larger files: parse time becomes prohibitive, fallback to full
   * Default: 1MB (1048576 bytes)
   */
  maxSizeBytes: number;

  /**
   * Timeout (ms) for tree-sitter parsing
   * If parsing exceeds this, fallback to full read
   * Default: 500ms
   */
  parseTimeoutMs: number;

  /**
   * Timeout (ms) for LLM fallback summarization
   * If fallback takes too long, return full read
   * Default: 5000ms (5 seconds)
   */
  llmFallbackTimeoutMs: number;

  /**
   * Enable LLM fallback for unsupported languages or parse failures
   * When disabled, always use full read for fallback
   * Default: true
   */
  enableLLMFallback: boolean;

  /**
   * Cache directory path
   * Relative to workspace
   * Default: '.kaseki-summary-cache'
   */
  cacheDir: string;

  /**
   * Enable caching
   * Default: true
   */
  enableCache: boolean;

  /**
   * TTL for cache entries (ms)
   * Default: 24 hours
   */
  cacheTTLMs: number;

  /**
   * Maximum number of entries kept in the summary cache.
   * Default: 1000
   */
  cacheMaxEntries: number;

  /**
   * Maximum total summary cache content size in bytes.
   * Default: 50MB
   */
  cacheMaxSizeBytes: number;

  /**
   * Maximum lines to extract per section (classes, functions, etc.)
   * Prevents summaries from becoming too large
   * Default: 100
   */
  maxLinesPerSection: number;
}

/**
 * Default configuration
 * @internal
 */
const DEFAULT_CONFIG: SummarizerConfig = {
  supportedLanguages: ['typescript', 'javascript', 'go'],
  minSizeBytes: 2048, // 2KB
  maxSizeBytes: 1048576, // 1MB
  parseTimeoutMs: 2000,
  llmFallbackTimeoutMs: 5000,
  enableLLMFallback: true,
  cacheDir: '.kaseki-summary-cache',
  enableCache: true,
  cacheTTLMs: 24 * 60 * 60 * 1000, // 24 hours
  cacheMaxEntries: 1000,
  cacheMaxSizeBytes: 50 * 1024 * 1024, // 50MB
  maxLinesPerSection: 100,
};

/**
 * Get config from environment variables (overrides defaults)
 * @internal
 */
function getConfigFromEnv(): Partial<SummarizerConfig> {
  return {
    minSizeBytes: process.env.KASEKI_SUMMARY_MIN_BYTES ? parseInt(process.env.KASEKI_SUMMARY_MIN_BYTES, 10) : undefined,
    maxSizeBytes: process.env.KASEKI_SUMMARY_MAX_BYTES ? parseInt(process.env.KASEKI_SUMMARY_MAX_BYTES, 10) : undefined,
    parseTimeoutMs: process.env.KASEKI_SUMMARY_PARSE_TIMEOUT ? parseInt(process.env.KASEKI_SUMMARY_PARSE_TIMEOUT, 10) : undefined,
    llmFallbackTimeoutMs: process.env.KASEKI_SUMMARY_LLM_TIMEOUT ? parseInt(process.env.KASEKI_SUMMARY_LLM_TIMEOUT, 10) : undefined,
    enableLLMFallback: process.env.KASEKI_SUMMARY_LLM_FALLBACK !== 'false',
    enableCache: process.env.KASEKI_SUMMARY_CACHE !== 'false',
    cacheDir: process.env.KASEKI_SUMMARY_CACHE_DIR || undefined,
    cacheTTLMs: process.env.KASEKI_SUMMARY_CACHE_TTL_MS ? parseInt(process.env.KASEKI_SUMMARY_CACHE_TTL_MS, 10) : undefined,
    cacheMaxEntries: process.env.KASEKI_SUMMARY_CACHE_MAX_ENTRIES ? parseInt(process.env.KASEKI_SUMMARY_CACHE_MAX_ENTRIES, 10) : undefined,
    cacheMaxSizeBytes: process.env.KASEKI_SUMMARY_CACHE_MAX_SIZE_BYTES ? parseInt(process.env.KASEKI_SUMMARY_CACHE_MAX_SIZE_BYTES, 10) : undefined,
  };
}

/**
 * Merge environment overrides with defaults
 */
export function getConfig(): SummarizerConfig {
  const envOverrides = getConfigFromEnv();
  // Filter out undefined values so they don't override defaults
  const definedOverrides = Object.fromEntries(
    Object.entries(envOverrides).filter(([, v]) => v !== undefined)
  ) as Partial<SummarizerConfig>;
  return { ...DEFAULT_CONFIG, ...definedOverrides };
}
