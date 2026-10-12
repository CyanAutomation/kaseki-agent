/**
 * Configuration for summarization behavior
 */

export type SupportedLanguage = 'typescript' | 'javascript';
export type DetectedLanguage = SupportedLanguage | 'go' | 'unknown';

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
   * Maximum file size (bytes) to parse for a structural summary
   * Larger files: parse time becomes prohibitive, fallback to full
   * Default: 1MB (1048576 bytes)
   */
  maxSizeBytes: number;

  /**
   * Timeout (ms) for structural parsing
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
  supportedLanguages: ['typescript', 'javascript'],
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
    minSizeBytes: integerOverride('KASEKI_SUMMARY_MIN_BYTES', 0),
    maxSizeBytes: integerOverride('KASEKI_SUMMARY_MAX_BYTES', 1),
    parseTimeoutMs: integerOverride('KASEKI_SUMMARY_PARSE_TIMEOUT', 1),
    llmFallbackTimeoutMs: integerOverride('KASEKI_SUMMARY_LLM_TIMEOUT', 1),
    enableLLMFallback: process.env.KASEKI_SUMMARY_LLM_FALLBACK !== 'false',
    enableCache: process.env.KASEKI_SUMMARY_CACHE !== 'false',
    cacheDir: process.env.KASEKI_SUMMARY_CACHE_DIR || undefined,
    cacheTTLMs: integerOverride('KASEKI_SUMMARY_CACHE_TTL_MS', 0),
    cacheMaxEntries: integerOverride('KASEKI_SUMMARY_CACHE_MAX_ENTRIES', 0),
    cacheMaxSizeBytes: integerOverride('KASEKI_SUMMARY_CACHE_MAX_SIZE_BYTES', 0),
  };
}

function integerOverride(name: string, minimum: number): number | undefined {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === '') return undefined;
  if (!/^\d+$/.test(raw)) {
    console.warn(`${name} must be a whole number >= ${minimum}; using the default.`);
    return undefined;
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    console.warn(`${name} must be a whole number >= ${minimum}; using the default.`);
    return undefined;
  }
  return value;
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
  const config = { ...DEFAULT_CONFIG, ...definedOverrides };
  if (config.minSizeBytes > config.maxSizeBytes) {
    console.warn('KASEKI_SUMMARY_MIN_BYTES must not exceed KASEKI_SUMMARY_MAX_BYTES; using the default size range.');
    config.minSizeBytes = DEFAULT_CONFIG.minSizeBytes;
    config.maxSizeBytes = DEFAULT_CONFIG.maxSizeBytes;
  }
  return config;
}
