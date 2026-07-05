/**
 * Instance Failure Extraction
 *
 * Classifies failure reasons from metadata and instance artifacts.
 * Delegates reason extraction to failure-reason-extractors.ts
 */

import { Metadata } from './instance-metadata-reader';
import { normalizeExitCodeCandidate } from './instance-status-derivation';
import { classifyProviderFailure } from './provider-error-classifier';

// Re-export for backward compatibility with existing imports
export {
  extractValidationFailureReason,
  extractValidationAllowlistFailureReason,
  extractQualityFailureReason,
  extractGoalCheckFailureReason,
} from './utils/failure-reason-extractors';

/**
 * Classify failure type from metadata and exit code.
 */
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
