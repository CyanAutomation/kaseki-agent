/**
 * Failure Reason Extractors
 *
 * Extracts specific failure reasons from instance metadata.
 * Isolates the extraction logic for better modularity and testability.
 */

import type { Metadata } from '../instance-metadata-reader';

/**
 * Extract a typed reason from metadata field.
 * @param metadata - Instance metadata
 * @param field - Metadata field name
 * @returns Trimmed reason string or null if empty/missing
 */
function extractTypedReason(metadata: Metadata | undefined, field: string): string | null {
  if (!metadata) return null;
  const reason = typeof (metadata as Record<string, unknown>)[field] === 'string'
    ? ((metadata as Record<string, unknown>)[field] as string).trim()
    : '';
  return reason.length > 0 ? reason : null;
}

/**
 * Extract validation allowlist failure reason from metadata.
 * Returns the reason if validation allowlist check failed, otherwise null.
 */
export function extractValidationAllowlistFailureReason(metadata: Metadata = {}): string | null {
  return extractTypedReason(metadata, 'validation_allowlist_failure_reason');
}

/**
 * Extract validation failure reason from metadata.
 * Returns the reason if validation failed, otherwise null.
 * Falls back to allowlist reason if primary reason is empty.
 */
export function extractValidationFailureReason(metadata: Metadata = {}): string | null {
  const reason = extractTypedReason(metadata, 'validation_failure_reason');
  if (reason) return reason;
  return extractValidationAllowlistFailureReason(metadata);
}

/**
 * Extract quality gate failure reason from metadata.
 * Returns the reason if quality checks failed, otherwise null.
 */
export function extractQualityFailureReason(metadata: Metadata = {}): string | null {
  return extractTypedReason(metadata, 'quality_failure_reason');
}

/**
 * Extract goal check failure reason from metadata.
 * Returns the reason if goal check failed, otherwise null.
 */
export function extractGoalCheckFailureReason(metadata: Metadata = {}): string | null {
  return extractTypedReason(metadata, 'goal_check_failure_reason');
}
