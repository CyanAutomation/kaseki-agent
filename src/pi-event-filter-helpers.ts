/**
 * Extracted helpers for pi-event-filter.ts
 *
 * These functions handle the two most complex concerns in the event filter:
 * 1. Provider error detection and classification
 * 2. Message text length extraction with multi-path fallbacks
 *
 * Exported here to allow independent unit testing.
 */

import { PiEvent } from './lib/event-timestamp-helpers.js';
import type { ProviderErrorSummary } from './pi-event-filter-helpers/types.js';

export type { ProviderErrorSummary } from './pi-event-filter-helpers/types.js';

// Re-export provider error field extraction helpers for testability
export {
  extractErrorMessage,
  extractStopReason,
  extractNestedError,
  extractStatusCode,
  extractErrorCode,
  extractResponseId,
  extractCloudflareLogId,
  extractGatewayEventId,
  extractUpstreamError,
  extractRetryAfter,
  extractRoutedProvider,
  extractRoutedModel,
  extractRecoverySuggestion,
} from './pi-event-filter-helpers/provider-error-extraction.js';

// Import helpers for use in extractProviderError
import {
  extractErrorMessage,
  extractStopReason,
  extractNestedError,
  extractStatusCode,
  extractErrorCode,
  extractResponseId,
  extractCloudflareLogId,
  extractGatewayEventId,
  extractUpstreamError,
  extractRetryAfter,
  extractRoutedProvider,
  extractRoutedModel,
  extractRecoverySuggestion,
} from './pi-event-filter-helpers/provider-error-extraction.js';

// ─── Types ────────────────────────────────────────────────────────────────────

// ─── Provider Error Detection ─────────────────────────────────────────────────

/**
 * Category of provider error for better routing and observability
 */
export type ErrorCategory =
  | 'gateway_timeout'
  | 'rate_limited'
  | 'service_unavailable'
  | 'transient_network'
  | 'malformed_request'
  | 'auth_error'
  | 'model_not_found'
  | 'unknown';

/**
 * Rich classification result for provider errors
 */
export interface ProviderErrorClassification {
  retryable: boolean;
  reason: string;
  category: ErrorCategory;
  matchedPattern: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Error pattern registry for provider error classification.
 * Patterns are ordered by priority (permanent errors first, then transient).
 */
const ERROR_PATTERN_REGISTRY: Array<{
  regex: RegExp;
  retryable: boolean;
  category: ErrorCategory;
  confidence: 'high' | 'medium' | 'low';
}> = [
  // Auth errors (permanent - check FIRST because 401 is explicit)
  { regex: /\b401\b|unauthorized|invalid\s+api\s+key|authentication\s+failed|forbidden/i,
    retryable: false, category: 'auth_error', confidence: 'high' },

  // Not found (permanent - check FIRST because 404 is explicit)
  { regex: /\b404\b|not\s+found|not\s+a\s+valid\s+model|no\s+endpoints?\s+found|model_not_found|model\s+not\s+found/i,
    retryable: false, category: 'model_not_found', confidence: 'high' },

  // Bad request / deprecated (permanent - check FIRST because 400 is explicit)
  { regex: /\b400\b|bad\s+request|deprecated|no\s+longer\s+supported|discontinued/i,
    retryable: false, category: 'auth_error', confidence: 'high' },

  // Service unavailable (very likely transient - check after explicit 4xx codes)
  { regex: /\b503\b|service.{0,30}unavailable|service.{0,20}down|temporarily.{0,10}unavailable|model.{0,10}unavailable|model.{0,20}temporarily/i, retryable: true, category: 'service_unavailable', confidence: 'high' },

  // Rate limiting (transient with backoff needed)
  { regex: /\b429\b|rate\s+limit|throttl/i, retryable: true, category: 'rate_limited', confidence: 'high' },

  // Gateway/network timeouts
  { regex: /timeout|econnreset|econnrefused|etimedout|ehostunreach|enetunreach|socket\s+hang\s+up/i,
    retryable: true, category: 'gateway_timeout', confidence: 'high' },

  // Generic provider finish_reason error (we don't know why, but could be transient)
  { regex: /provider\s+finish_reason\s*:\s*error|finish_reason\s*:\s*error/i,
    retryable: true, category: 'unknown', confidence: 'medium' },

  // Malformed tool call (transient, can be corrected)
  { regex: /tool\s+call.*?(json|parse|malformed|unterminated)|malformed.*?tool\s+call/i,
    retryable: true, category: 'malformed_request', confidence: 'high' },

  // Generic network transience
  { regex: /offline|connection\s+refused|try\s+again/i,
    retryable: true, category: 'transient_network', confidence: 'medium' },
];

/**
 * Find matching error pattern in registry
 */
function matchErrorPattern(message: string): typeof ERROR_PATTERN_REGISTRY[0] | undefined {
  return ERROR_PATTERN_REGISTRY.find((pattern) => pattern.regex.test(message));
}

/**
 * Build classification result from matched pattern or default
 */
function buildClassificationResult(
  message: string,
  pattern: typeof ERROR_PATTERN_REGISTRY[0] | undefined
): ProviderErrorClassification {
  if (pattern) {
    return {
      retryable: pattern.retryable,
      reason: `Matched pattern: ${pattern.regex.source}`,
      category: pattern.category,
      matchedPattern: message.substring(0, 120),
      confidence: pattern.confidence,
    };
  }

  // No pattern matched (assume permanent error)
  return {
    retryable: false,
    reason: 'No retry pattern matched (assuming permanent error)',
    category: 'unknown',
    matchedPattern: message.substring(0, 120),
    confidence: 'low',
  };
}

/**
 * Classify a provider error with rich context about why it's retryable/non-retryable
 */
export function classifyProviderErrorDetailed(message: string): ProviderErrorClassification {
  const pattern = matchErrorPattern(message);
  return buildClassificationResult(message, pattern);
}

export function isProviderErrorRetryable(message: string): boolean {
  return classifyProviderErrorDetailed(message).retryable;
}

/**
 * Classify a provider error message into a type and retryability verdict.
 */
export function classifyProviderError(message: string): {
  type: ProviderErrorSummary['type'];
  retryable: boolean;
} {
  const lower = message.toLowerCase();
  let type: ProviderErrorSummary['type'] = 'provider_error';

  if (
    lower.includes('model is unavailable') ||
    lower.includes('model unavailable') ||
    lower.includes('no endpoints found') ||
    lower.includes('not a valid model') ||
    lower.includes('model_not_found')
  ) {
    type = 'model_unavailable';
  } else if (
    lower.includes('tool call') &&
    (lower.includes('json') || lower.includes('parse') || lower.includes('malformed') || lower.includes('unterminated'))
  ) {
    type = 'malformed_tool_call';
  }

  const classification = classifyProviderErrorDetailed(message);
  return { type, retryable: classification.retryable };
}

/**
 * Classify a provider error and return detailed classification info
 */
export function classifyProviderErrorWithContext(message: string): {
  type: ProviderErrorSummary['type'];
  retryable: boolean;
  classification: ProviderErrorClassification;
} {
  return {
    type: classifyProviderError(message).type,
    retryable: classifyProviderErrorDetailed(message).retryable,
    classification: classifyProviderErrorDetailed(message),
  };
}

/**
 * Extract a ProviderErrorSummary from a Pi event whose message has stopReason 'error'.
 * Returns null if the event does not represent a provider error.
 *
 * Delegates field extraction to focused helper functions to reduce cognitive complexity.
 */
export function extractProviderError(event: PiEvent): ProviderErrorSummary | null {
  const message = (event as any).message;
  if (!message || typeof message !== 'object') return null;

  const errorMessage = extractErrorMessage(message);
  const stopReason = extractStopReason(message);

  if (!errorMessage || stopReason !== 'error') return null;

  const { type, retryable } = classifyProviderError(errorMessage);
  const nestedError = extractNestedError(message);

  return {
    type,
    retryable,
    provider: typeof message.provider === 'string' ? message.provider : undefined,
    api: typeof message.api === 'string' ? message.api : undefined,
    model: typeof message.model === 'string' ? message.model : undefined,
    stop_reason: stopReason,
    response_id: extractResponseId(message, event),
    status_code: extractStatusCode(message, nestedError),
    error_code: extractErrorCode(message, nestedError),
    cloudflare_log_id: extractCloudflareLogId(message, nestedError),
    gateway_event_id: extractGatewayEventId(message, nestedError),
    upstream_error: extractUpstreamError(message, nestedError),
    retry_after: extractRetryAfter(message, nestedError),
    routed_provider: extractRoutedProvider(message, nestedError),
    routed_model: extractRoutedModel(message, nestedError),
    recovery_suggestion: extractRecoverySuggestion(type),
    message: errorMessage,
  };
}

// ─── Message Text Extraction ──────────────────────────────────────────────────

/**
 * Extract the total length of assistant text from a message object, following
 * multiple fallback paths to handle varying streaming/gateway response formats.
 *
 * Returns 0 when no non-empty text is found in any path.
 */
export function extractMessageTextLength(message: any): number {
  if (!message || typeof message !== 'object') return 0;

  // Primary path: message.content (string or array)
  const content = message?.content;
  if (typeof content === 'string') return content.trim().length;
  if (Array.isArray(content)) {
    const len = content.reduce((sum: number, part: any) => {
      if (typeof part === 'string') return sum + part.trim().length;
      if (!part || typeof part !== 'object') return sum;
      const text =
        typeof part.text === 'string'
          ? part.text
          : typeof part.output_text === 'string'
            ? part.output_text
            : '';
      return sum + text.trim().length;
    }, 0);
    if (len > 0) return len;
  }

  // Fallback 1: message.text (some streaming implementations)
  if (typeof message?.text === 'string') {
    const len = message.text.trim().length;
    if (len > 0) return len;
  }

  // Fallback 2: message.output_text (gateway/OpenRouter alternative)
  if (typeof message?.output_text === 'string') {
    const len = message.output_text.trim().length;
    if (len > 0) return len;
  }

  // Fallback 3: nested body.output[].content[].text (OpenRouter-specific format)
  if (Array.isArray(message?.body?.output)) {
    try {
      const len = message.body.output.reduce((sum: number, item: any) => {
        if (!item || typeof item !== 'object') return sum;
        if (Array.isArray(item.content)) {
          return (
            sum +
            item.content.reduce((itemSum: number, part: any) => {
              return itemSum + (typeof part?.text === 'string' ? part.text.trim().length : 0);
            }, 0)
          );
        }
        return sum;
      }, 0);
      if (len > 0) return len;
    } catch {
      // Continue to return 0
    }
  }

  return 0;
}
