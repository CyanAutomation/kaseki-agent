/**
 * Scoring calculation helpers extracted from run-scorecard-scoring.ts
 * Handles score computation, capping, and confidence calculation
 */

import type { RunScorecard } from './types/run-scorecard';

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

/**
 * Calculate raw score from dimension points without capping.
 * @param weightedPoints Array of weighted point values from dimensions
 * @returns Uncapped score (0-infinity range possible, but typically 0-100)
 */
export function calculateUncappedScore(weightedPoints: number[]): number {
  const total = weightedPoints.reduce((sum, points) => sum + points, 0);
  return Number(total.toFixed(2));
}

/**
 * Apply capping logic based on evaluator availability.
 * A successful patch can still be useful, but it must not look fully evaluated
 * when the evaluator artifact is a fallback or unavailable.
 * @param uncappedScore The raw score before capping
 * @param evaluatorReliabilityAvailable Whether both goal-check and evaluator are available
 * @returns Capped score with evaluator penalty if needed
 */
export function applyScoringCap(uncappedScore: number, evaluatorReliabilityAvailable: boolean): number {
  return evaluatorReliabilityAvailable ? uncappedScore : Math.min(uncappedScore, 89);
}

/**
 * Calculate confidence score based on evidence coverage and token reliability.
 * @param coverageRatio Evidence coverage ratio (0-1)
 * @param hasUnknownTokenRequests Whether unknown token requests were encountered
 * @param evaluatorReliabilityAvailable Whether evaluator phases are available
 * @returns Confidence score (0-100 clamped)
 */
export function calculateConfidenceScore(
  coverageRatio: number,
  hasUnknownTokenRequests: boolean,
  evaluatorReliabilityAvailable: boolean,
): number {
  const baseConfidence = coverageRatio * 100;
  const tokenPenalty = hasUnknownTokenRequests ? 0.9 : 1;
  const evaluatorPenalty = evaluatorReliabilityAvailable ? 1 : 0.7;
  return clamp(baseConfidence * tokenPenalty * evaluatorPenalty);
}

/**
 * Generate confidence rationale text.
 * @param available Number of evidence categories available
 * @param possible Total possible evidence categories
 * @param evaluatorReliabilityAvailable Whether evaluator phases are available
 * @returns Human-readable confidence explanation
 */
export function getConfidenceRationale(
  available: number,
  possible: number,
  evaluatorReliabilityAvailable: boolean,
): string {
  return `${available} of ${possible} evidence categories are available${evaluatorReliabilityAvailable ? '.' : '; one or more evaluator phases are unavailable.'}`;
}

/**
 * Determine scorecard completeness level.
 * @param coverageRatio Evidence coverage ratio (0-1)
 * @returns 'complete' if all evidence available, 'provisional' otherwise
 */
export function determineCompleteness(coverageRatio: number): RunScorecard['completeness'] {
  return coverageRatio === 1 ? 'complete' : 'provisional';
}

/**
 * Determine if evaluator reliability is available.
 * Both goal-check AND run-evaluation must be available.
 * @param goalCheckAvailable Whether goal check artifact is available
 * @param evaluatorAvailable Whether run evaluator is available
 * @returns true if both are available, false otherwise
 */
export function hasEvaluatorReliability(goalCheckAvailable: boolean, evaluatorAvailable: boolean): boolean {
  return goalCheckAvailable && evaluatorAvailable;
}

/**
 * Calculate missing critical evidence indicators.
 * @param diffBytes Number of bytes in git diff (0 if no changes)
 * @param validation Validation status
 * @param goalCheckAvailable Whether goal check is available
 * @param evaluatorAvailable Whether evaluator is available
 * @returns Array of missing critical evidence identifiers
 */
export function calculateMissingCritical(
  diffBytes: number,
  validation: string,
  goalCheckAvailable: boolean,
  evaluatorAvailable: boolean,
): string[] {
  const missing: string[] = [];
  if (diffBytes === 0) missing.push('diff');
  if (validation === 'unknown') missing.push('validation_result');
  if (!goalCheckAvailable) missing.push('goal_check');
  if (!evaluatorAvailable) missing.push('run_evaluation');
  return missing;
}
