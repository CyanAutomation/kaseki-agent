/**
 * Provider Error Field Extraction Helpers
 *
 * Isolates the complex field extraction logic from extractProviderError()
 * to improve maintainability and testability.
 */

import { PiEvent } from '../lib/event-timestamp-helpers.js';
import type { ProviderErrorSummary } from './types.js';

/**
 * Extract and normalize the error message from a Pi event message object.
 * Handles multiple fallback paths and type coercion.
 */
export function extractErrorMessage(message: any): string {
  if (typeof message?.errorMessage === 'string') {
    return message.errorMessage.trim();
  }

  if (message?.errorMessage !== undefined && message?.errorMessage !== null) {
    try {
      return String(message.errorMessage).trim();
    } catch {
      return '';
    }
  }

  return '';
}

/**
 * Extract and normalize the stop reason from a message object.
 */
export function extractStopReason(message: any): string {
  return typeof message?.stopReason === 'string' ? message.stopReason.trim() : '';
}

/**
 * Extract nested error object fields with multiple fallback paths.
 * Handles both snake_case and camelCase variants.
 *
 * @param message - Pi event message object
 * @returns Extracted nested error object or undefined
 */
export function extractNestedError(message: any): any {
  return message?.error && typeof message.error === 'object' ? message.error : undefined;
}

/**
 * Extract HTTP status code with multiple fallback paths and type coercion.
 */
export function extractStatusCode(message: any, nestedError: any): number | undefined {
  const statusCandidate =
    message?.statusCode ?? message?.status_code ?? nestedError?.statusCode ?? nestedError?.status_code;

  if (typeof statusCandidate === 'number') {
    // HTTP status codes must be integers (3-digit codes: 100-599)
    if (Number.isInteger(statusCandidate) && statusCandidate >= 100 && statusCandidate <= 599) {
      return statusCandidate;
    }
    return undefined;
  }

  if (typeof statusCandidate === 'string' && /^\d{3}$/.test(statusCandidate)) {
    return Number(statusCandidate);
  }

  return undefined;
}

/**
 * Extract error code from multiple field locations.
 */
export function extractErrorCode(message: any, nestedError: any): string | undefined {
  const errorCodeCandidate =
    message?.errorCode ?? message?.error_code ?? nestedError?.code ?? nestedError?.error_code;
  return typeof errorCodeCandidate === 'string' ? errorCodeCandidate : undefined;
}

/**
 * Extract response ID from message or event level.
 */
export function extractResponseId(message: any, event: PiEvent): string | undefined {
  const responseIdCandidate = message?.responseId ?? message?.response_id ?? (event as any).responseId;
  return typeof responseIdCandidate === 'string' ? responseIdCandidate : undefined;
}

/**
 * Extract Cloudflare log ID from multiple locations.
 */
export function extractCloudflareLogId(message: any, nestedError: any): string | undefined {
  const cloudflareLogIdCandidate =
    message?.cloudflareLogId ??
    message?.cloudflare_log_id ??
    nestedError?.cloudflareLogId ??
    nestedError?.cloudflare_log_id;
  return typeof cloudflareLogIdCandidate === 'string' ? cloudflareLogIdCandidate : undefined;
}

/**
 * Extract gateway event ID from multiple locations.
 */
export function extractGatewayEventId(message: any, nestedError: any): string | undefined {
  const gatewayEventIdCandidate =
    message?.gatewayEventId ?? message?.gateway_event_id ?? nestedError?.eventId ?? nestedError?.event_id;
  return typeof gatewayEventIdCandidate === 'string' ? gatewayEventIdCandidate : undefined;
}

/**
 * Extract upstream error detail from nested error with length limit.
 */
export function extractUpstreamError(message: any, nestedError: any): string | undefined {
  const upstreamErrorCandidate =
    nestedError?.message ??
    nestedError?.detail ??
    nestedError?.errorDetail ??
    nestedError?.error_detail ??
    message?.errorDetail ??
    message?.error_detail;
  return typeof upstreamErrorCandidate === 'string' ? upstreamErrorCandidate.slice(0, 1000) : undefined;
}

/**
 * Extract retry-after header or field value.
 */
export function extractRetryAfter(message: any, nestedError: any): string | undefined {
  const retryAfterCandidate =
    message?.retryAfter ?? message?.retry_after ?? nestedError?.retryAfter ?? nestedError?.retry_after;
  return typeof retryAfterCandidate === 'string' || typeof retryAfterCandidate === 'number'
    ? String(retryAfterCandidate)
    : undefined;
}

/**
 * Extract routed provider from multiple locations.
 */
export function extractRoutedProvider(message: any, nestedError: any): string | undefined {
  const routedProviderCandidate =
    message?.routedProvider ??
    message?.routed_provider ??
    nestedError?.provider ??
    nestedError?.routed_provider;
  return typeof routedProviderCandidate === 'string' ? routedProviderCandidate : undefined;
}

/**
 * Extract routed model from multiple locations.
 */
export function extractRoutedModel(message: any, nestedError: any): string | undefined {
  const routedModelCandidate =
    message?.routedModel ?? message?.routed_model ?? nestedError?.model ?? nestedError?.routed_model;
  return typeof routedModelCandidate === 'string' ? routedModelCandidate : undefined;
}

/**
 * Extract recovery suggestion based on error type.
 */
export function extractRecoverySuggestion(type: ProviderErrorSummary['type']): string | undefined {
  return type === 'malformed_tool_call'
    ? 'Retry with a corrective instruction to emit one small, valid JSON tool call; use an alternate model if it repeats.'
    : undefined;
}
