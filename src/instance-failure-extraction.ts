/**
 * Instance Failure Extraction
 *
 * Extracts and classifies failure reasons from metadata and instance artifacts.
 */

import { Metadata } from './instance-metadata-reader';
import { normalizeExitCodeCandidate } from './instance-status-derivation';

/**
 * Extract validation failure reason from metadata.
 * Returns the reason if validation failed, otherwise null.
 */
export function extractValidationAllowlistFailureReason(metadata: Metadata = {}): string | null {
  const reason = typeof metadata.validation_allowlist_failure_reason === 'string'
    ? metadata.validation_allowlist_failure_reason.trim()
    : '';
  return reason.length > 0 ? reason : null;
}

export function extractValidationFailureReason(metadata: Metadata = {}): string | null {
  const reason = typeof metadata.validation_failure_reason === 'string'
    ? metadata.validation_failure_reason.trim()
    : '';
  if (reason.length > 0) return reason;
  return extractValidationAllowlistFailureReason(metadata);
}

/**
 * Extract quality gate failure reason from metadata.
 * Returns the reason if quality checks failed, otherwise null.
 */
export function extractQualityFailureReason(metadata: Metadata = {}): string | null {
  const reason = typeof metadata.quality_failure_reason === 'string'
    ? metadata.quality_failure_reason.trim()
    : '';
  return reason.length > 0 ? reason : null;
}

export function extractGoalCheckFailureReason(metadata: Metadata = {}): string | null {
  const reason = typeof metadata.goal_check_failure_reason === 'string'
    ? metadata.goal_check_failure_reason.trim()
    : '';
  return reason.length > 0 ? reason : null;
}

/**
 * Classify failure type from metadata and exit code.
 */
function classifyProviderFailure(metadata: Metadata, failedCommand: string): string | null {
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

  if (
    providerType === 'model_unavailable' ||
    haystack.includes('model_unavailable') ||
    haystack.includes('model is unavailable') ||
    haystack.includes('model unavailable') ||
    haystack.includes('no endpoints found') ||
    haystack.includes('not a valid model') ||
    haystack.includes('model_not_found')
  ) {
    return 'model-unavailable';
  }

  if (providerMessage || providerType === 'provider_error' || failedCommand.includes('provider error')) {
    return 'provider-error';
  }

  return null;
}

export function classifyFailure(
  metadata: Metadata = {},
  exitCode: number | string | null = null
): string {
  const normalizedExitCode = normalizeExitCodeCandidate(exitCode);
  const failedCommand =
    typeof metadata.failed_command === 'string' ? metadata.failed_command.trim() : '';
  const providerFailure = classifyProviderFailure(metadata, failedCommand);

  if (normalizedExitCode === 0) return 'none';
  if (providerFailure) return providerFailure;
  if (normalizedExitCode === 124) return 'timeout';
  if (normalizedExitCode === 8 || failedCommand === 'goal check') return 'goal-unmet';
  if (failedCommand === 'empty git diff' || normalizedExitCode === 3) return 'empty-diff';
  if (failedCommand === 'validation') return 'validation';
  if (failedCommand === 'quality checks') return 'quality';
  if (failedCommand === 'secret scan') return 'secret-scan';
  if (failedCommand.startsWith('github')) return 'github';
  const lowerFailedCommand = failedCommand.toLowerCase();
  if (
    lowerFailedCommand.includes('llm_gateway') ||
    lowerFailedCommand.includes('gateway') ||
    lowerFailedCommand.includes('openrouter') ||
    lowerFailedCommand.includes('api_key')
  ) {
    return 'credentials';
  }
  if (failedCommand) return failedCommand.replace(/\s+/g, '-');
  if (Number.isInteger(normalizedExitCode)) return 'nonzero-exit';
  return 'unknown';
}
