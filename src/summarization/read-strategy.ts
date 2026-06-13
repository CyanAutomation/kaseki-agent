/**
 * Smart thresholding logic for determining when to summarize vs full read
 * Strategy: Small files → full, Large supported files → summary, Unsupported/parse-fail → full
 */
import { SupportedLanguage, SummarizerConfig } from './summarizer-config';

export type ReadStrategy = 'full' | 'summary';

export interface StrategyContext {
  filePath: string;
  sizeBytes: number;
  language: SupportedLanguage | 'unknown';
  config: SummarizerConfig;
  parseError?: string;
  isDraft?: boolean; // True if Pi is about to edit (should read full for correctness)
}

export interface StrategyResult {
  strategy: ReadStrategy;
  reason: string;
  estimatedTokens?: number;
}

/**
 * Determine read strategy based on heuristics
 */
export function getReadStrategy(context: StrategyContext): StrategyResult {
  // Rule 1: If Pi is about to edit, use full read
  // This ensures correctness - implementations are in function bodies, not signatures
  if (context.isDraft) {
    return {
      strategy: 'full',
      reason: 'Editing phase - full read for correctness',
    };
  }

  // Rule 2: If parse error occurred, fallback to full
  if (context.parseError) {
    return {
      strategy: 'full',
      reason: `Parse failed: ${context.parseError}`,
    };
  }

  // Rule 3: If file too small, full read is cheaper (no summarization overhead)
  if (context.sizeBytes < context.config.minSizeBytes) {
    return {
      strategy: 'full',
      reason: `File too small (${context.sizeBytes} < ${context.config.minSizeBytes} bytes)`,
      estimatedTokens: Math.ceil(context.sizeBytes / 3.5), // rough token estimate
    };
  }

  // Rule 4: If language unsupported, fallback to full
  if (!context.config.supportedLanguages.includes(context.language as SupportedLanguage)) {
    return {
      strategy: 'full',
      reason: `Unsupported language: ${context.language}`,
    };
  }

  // Rule 5: If file too large, might exceed parse timeout - use full for safety
  if (context.sizeBytes > context.config.maxSizeBytes) {
    return {
      strategy: 'full',
      reason: `File too large (${context.sizeBytes} > ${context.config.maxSizeBytes} bytes)`,
    };
  }

  // Rule 6: Default - use summary for supported languages within size range
  // This is the happy path where summarization provides token savings
  const estimatedFullTokens = Math.ceil(context.sizeBytes / 3.5);
  const estimatedSummaryTokens = Math.ceil((estimatedFullTokens * 0.3) / 1); // Assume ~30% of full size

  return {
    strategy: 'summary',
    reason: `Large supported file in range (${context.language}, ${context.sizeBytes} bytes)`,
    estimatedTokens: estimatedSummaryTokens,
  };
}

/**
 * Detect language from file extension
 */
export function detectLanguage(filePath: string): SupportedLanguage | 'unknown' {
  const ext = filePath.toLowerCase().split('.').pop() || '';

  const languageMap: Record<string, SupportedLanguage> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    go: 'go',
  };

  return languageMap[ext] || 'unknown';
}

