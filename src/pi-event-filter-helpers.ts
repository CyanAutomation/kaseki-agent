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
  type: 'model_unavailable' | 'provider_error' | 'provider_empty_assistant_turn';
  provider?: string;
  api?: string;
  model?: string;
  stop_reason?: string;
  response_id?: string;
  status_code?: number;
  error_code?: string;
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
export function isProviderErrorRetryable(message: string): boolean {
  const lower = message.toLowerCase();

  // Non-retryable: permanent errors
  if (
    lower.includes('400') ||
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('404') ||
    lower.includes('invalid api key') ||
    lower.includes('authentication') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('deprecated')
  ) {
    return false;
  }

  // Retryable: transient errors
  return (
    lower.includes('503') ||
    lower.includes('429') ||
    lower.includes('timeout') ||
    lower.includes('econnreset') ||
    lower.includes('econnrefused') ||
    lower.includes('etimedout') ||
    lower.includes('ehostunreach') ||
    lower.includes('enetunreach') ||
    lower.includes('unavailable') ||
    lower.includes('offline') ||
    lower.includes('service is down') ||
    lower === 'provider finish_reason: error'
  );
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
  }

  return { type, retryable: isProviderErrorRetryable(message) };
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
