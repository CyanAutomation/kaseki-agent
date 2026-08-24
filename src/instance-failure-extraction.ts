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
  const workerErrorType =
    typeof metadata.worker_error_type === 'string' ? metadata.worker_error_type.trim() : '';
  const providerFailure = classifyProviderFailure(metadata, failedCommand);

  if (normalizedExitCode === 0) return 'none';
  if (workerErrorType) return workerErrorType;
  if (providerFailure) return providerFailure;

  const exactRules: Array<[string, boolean]> = [
    ['timeout', normalizedExitCode === 124],
    ['critical_change_expectations', normalizedExitCode === 8 && failedCommand === 'critical change verification'],
    ['goal-unmet', normalizedExitCode === 8 || failedCommand === 'goal check'],
    ['empty-diff', normalizedExitCode === 3 || failedCommand === 'empty git diff'],
    ['validation', failedCommand === 'validation'],
    ['quality', failedCommand === 'quality checks'],
    ['secret-scan', failedCommand === 'secret scan'],
    ['github', failedCommand.startsWith('github')],
  ];
  const exactMatch = exactRules.find(([, matches]) => matches);
  if (exactMatch) return exactMatch[0];

  if (isCredentialFailure(failedCommand)) return 'credentials';
  if (failedCommand) return failedCommand.replace(/\s+/g, '-');
  if (Number.isInteger(normalizedExitCode)) return 'nonzero-exit';
  return 'unknown';
}

function isCredentialFailure(command: string): boolean {
  const normalized = command.toLowerCase();
  return ['llm_gateway', 'gateway', 'openrouter', 'api_key']
    .some((signal) => normalized.includes(signal));
}
