/**
 * instance-state-derivation.ts
 *
 * Backward-compatible re-export barrel for instance state derivation modules.
 * Exports facade maintains all original public APIs without code duplication.
 *
 * Submodules:
 * - instance-status-derivation.ts — Lifecycle status and exit code resolution
 * - instance-stage-derivation.ts — Current stage resolution
 * - instance-failure-extraction.ts — Failure classification and extraction
 */

export type { InstanceLifecycleStatus } from './instance-status-derivation';
export {
  normalizeExitCodeCandidate,
  deriveInstanceLifecycleStatus,
  resolveInstanceExitCode,
} from './instance-status-derivation';

export { resolveInstanceStage } from './instance-stage-derivation';

export {
  extractValidationFailureReason,
  extractValidationAllowlistFailureReason,
  extractQualityFailureReason,
  extractGoalCheckFailureReason,
  classifyFailure,
} from './instance-failure-extraction';

