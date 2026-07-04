/**
 * Provider Error Classification
 *
 * Extracts and classifies provider-related failures from metadata.
 * Separated for focused testing and maintainability.
 */

import { Metadata } from './instance-metadata-reader';

/**
 * Pattern registry for provider error classification.
 * Maps error types to array of patterns that indicate that error.
 */
const PROVIDER_ERROR_PATTERNS: Record<string, string[]> = {
  'model-unavailable': [
    'model_unavailable',
    'model is unavailable',
    'model unavailable',
    'no endpoints found',
    'not a valid model',
    'model_not_found',
  ],
};

/**
 * Classify provider failure type from metadata and command.
 * Returns the classification (e.g., 'model-unavailable', 'provider-error') or null if not a provider failure.
 */
export function classifyProviderFailure(metadata: Metadata, failedCommand: string): string | null {
  const providerType = typeof metadata.provider_error_type === 'string'
    ? metadata.provider_error_type.trim()
    : '';
  const providerMessage = typeof metadata.provider_error_message === 'string'
    ? metadata.provider_error_message.trim()
    : '';
  const diagnosticReason = typeof metadata.diagnostic_reason === 'string'
    ? metadata.diagnostic_reason.trim()
    : '';
  const haystack = [providerType, providerMessage, diagnosticReason, failedCommand].join(' ').toLowerCase();

  // Check pattern registry for matching error types
  for (const [errorType, patterns] of Object.entries(PROVIDER_ERROR_PATTERNS)) {
    // Direct type match takes precedence
    if (providerType === errorType) {
      return errorType;
    }
    // Check if any pattern matches in the haystack
    if (patterns.some((pattern) => haystack.includes(pattern))) {
      return errorType;
    }
  }

  // Generic provider error fallback
  if (providerMessage || providerType === 'provider_error' || failedCommand.includes('provider error')) {
    return 'provider-error';
  }

  return null;
}

/**
 * Get the pattern registry for testing and external analysis.
 */
export function getProviderErrorPatterns(): Record<string, string[]> {
  return PROVIDER_ERROR_PATTERNS;
}
