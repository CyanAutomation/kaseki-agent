/**
 * Scoring logic helpers for buildDimensions and buildPhases
 * Reduces cognitive complexity by extracting multi-level conditionals into named functions
 */

import type { Evidence } from './run-scorecard-evidence';

/**
 * Determines the outcome status for a phase based on evidence.
 * Extracts complex conditional chain from buildPhases.
 */
export function determinePhaseOutcome(
  phase: string,
  evidence: Evidence,
  isDisabled: boolean,
): 'skipped' | 'not_started' | 'failed' | 'succeeded' {
  // Disabled phases are explicitly skipped
  if (isDisabled) return 'skipped';

  // Phase not reached during execution
  if (!evidence.phaseReached[phase]) return 'not_started';

  // Run lifecycle prevents phase completion
  if (evidence.status === 'cancelled' || evidence.status === 'running') return 'not_started';

  // Terminal failures from metadata/failure artifacts
  if (evidence.phaseFailures[phase]) return 'failed';

  // Phase-specific failure signals
  if (phase === 'validation' && evidence.validation === 'failed') return 'failed';
  if (phase === 'goal_check' && evidence.goalCheckFailed) return 'failed';
  if (phase === 'run_evaluation' && !evidence.evaluatorAvailable) return 'failed';

  // All other completed phases are considered successful
  return 'succeeded';
}

/**
 * Determines the status (availability/completeness) of a dimension measurement.
 * Accounts for disabled phases and missing data.
 */
export function determineDimensionStatus(
  dimensionId: string,
  isApplicable: boolean,
  phaseReached: boolean,
  diffBytes: number,
  noChangeAccepted: boolean,
): 'not_applicable' | 'unavailable' | 'complete' {
  if (!isApplicable) return 'not_applicable';

  // Implementation quality score is unavailable if no changes were made and not explicitly accepted
  if (dimensionId === 'implementation_quality' && diffBytes === 0 && !noChangeAccepted) {
    return 'unavailable';
  }

  // Dimension is unavailable if its phase hasn't been reached
  if (!phaseReached) return 'unavailable';

  return 'complete';
}

/**
 * Calculates effective weight for a dimension after accounting for disabled phases.
 * Distributes disabled phase weights proportionally among remaining dimensions.
 */
export function calculateEffectiveWeight(
  weight: number,
  isApplicable: boolean,
  totalEligibleWeight: number,
): number {
  if (!isApplicable || totalEligibleWeight === 0) return 0;
  return weight / totalEligibleWeight;
}

/**
 * Calculates the weighted points contribution for a dimension.
 * Rounds to 2 decimal places for precision in reports.
 */
export function calculateWeightedPoints(
  normalizedScore: number,
  effectiveWeight: number,
): number {
  return Number((normalizedScore * effectiveWeight).toFixed(2));
}
