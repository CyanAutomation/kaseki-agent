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

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProviderErrorSummary {
  type: 'model_unavailable' | 'provider_error' | 'provider_empty_assistant_turn' | 'malformed_tool_call';
  provider?: string;
  api?: string;
  model?: string;
  stop_reason?: string;
  response_id?: string;
  status_code?: number;
  error_code?: string;
  cloudflare_log_id?: string;
  gateway_event_id?: string;
  upstream_error?: string;
  retry_after?: string;
  routed_provider?: string;
  routed_model?: string;
  recovery_suggestion?: string;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  message: string;
  retryable?: boolean;
}

// ─── Provider Error Detection ─────────────────────────────────────────────────

/**
 * Determine whether a provider error message suggests a transient failure
 * that is worth retrying (503, 429, connection errors) vs. a permanent failure
 * (404, deprecated model).
 */
/**
 * Category of provider error for better routing and observability
 */
type ErrorCategory =
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
interface ProviderErrorClassification {
  retryable: boolean;
  reason: string;
  category: ErrorCategory;
  matchedPattern: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Classify a provider error with rich context about why it's retryable/non-retryable
 */
export function classifyProviderErrorDetailed(message: string): ProviderErrorClassification {
  const patterns: Array<{
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

  // Find first matching pattern
  for (const pattern of patterns) {
    if (pattern.regex.test(message)) {
      return {
        retryable: pattern.retryable,
        reason: `Matched pattern: ${pattern.regex.source}`,
        category: pattern.category,
        matchedPattern: message.substring(0, 120),
        confidence: pattern.confidence,
      };
    }
  }

  // No pattern matched
  return {
    retryable: false,
    reason: 'No retry pattern matched (assuming permanent error)',
    category: 'unknown',
    matchedPattern: message.substring(0, 120),
    confidence: 'low',
  };
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
 */
export function extractProviderError(event: PiEvent): ProviderErrorSummary | null {
  const message = (event as any).message;
  if (!message || typeof message !== 'object') return null;

  let errorMessage = '';
  if (typeof message.errorMessage === 'string') {
    errorMessage = message.errorMessage.trim();
  } else if (message.errorMessage !== undefined && message.errorMessage !== null) {
    try {
      errorMessage = String(message.errorMessage).trim();
    } catch {
      return null;
    }
  }

  const stopReason = typeof message.stopReason === 'string' ? message.stopReason.trim() : '';
  if (!errorMessage || stopReason !== 'error') return null;

  const { type, retryable } = classifyProviderError(errorMessage);
  const nestedError = message.error && typeof message.error === 'object' ? message.error : undefined;
  const statusCandidate =
    message.statusCode ?? message.status_code ?? nestedError?.statusCode ?? nestedError?.status_code;
  const statusCode =
    typeof statusCandidate === 'number'
      ? statusCandidate
      : typeof statusCandidate === 'string' && /^\d{3}$/.test(statusCandidate)
        ? Number(statusCandidate)
        : undefined;
  const errorCodeCandidate = message.errorCode ?? message.error_code ?? nestedError?.code;
  const responseIdCandidate = message.responseId ?? message.response_id ?? (event as any).responseId;
  const cloudflareLogIdCandidate =
    message.cloudflareLogId ?? message.cloudflare_log_id ?? nestedError?.cloudflareLogId ?? nestedError?.cloudflare_log_id;
  const gatewayEventIdCandidate =
    message.gatewayEventId ?? message.gateway_event_id ?? nestedError?.eventId ?? nestedError?.event_id;
  const upstreamErrorCandidate =
    nestedError?.message ?? nestedError?.detail ?? message.errorDetail ?? message.error_detail;
  const retryAfterCandidate =
    message.retryAfter ?? message.retry_after ?? nestedError?.retryAfter ?? nestedError?.retry_after;
  const routedProviderCandidate =
    message.routedProvider ?? message.routed_provider ?? nestedError?.provider ?? nestedError?.routed_provider;
  const routedModelCandidate =
    message.routedModel ?? message.routed_model ?? nestedError?.model ?? nestedError?.routed_model;

  return {
    type,
    retryable,
    provider: typeof message.provider === 'string' ? message.provider : undefined,
    api: typeof message.api === 'string' ? message.api : undefined,
    model: typeof message.model === 'string' ? message.model : undefined,
    stop_reason: stopReason,
    response_id: typeof responseIdCandidate === 'string' ? responseIdCandidate : undefined,
    status_code: statusCode,
    error_code: typeof errorCodeCandidate === 'string' ? errorCodeCandidate : undefined,
    cloudflare_log_id: typeof cloudflareLogIdCandidate === 'string' ? cloudflareLogIdCandidate : undefined,
    gateway_event_id: typeof gatewayEventIdCandidate === 'string' ? gatewayEventIdCandidate : undefined,
    upstream_error: typeof upstreamErrorCandidate === 'string' ? upstreamErrorCandidate.slice(0, 1000) : undefined,
    retry_after: typeof retryAfterCandidate === 'string' || typeof retryAfterCandidate === 'number'
      ? String(retryAfterCandidate)
      : undefined,
    routed_provider: typeof routedProviderCandidate === 'string' ? routedProviderCandidate : undefined,
    routed_model: typeof routedModelCandidate === 'string' ? routedModelCandidate : undefined,
    recovery_suggestion: type === 'malformed_tool_call'
      ? 'Retry with a corrective instruction to emit one small, valid JSON tool call; use an alternate model if it repeats.'
      : undefined,
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
