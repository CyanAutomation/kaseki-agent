import type { RunScorecard } from './types/run-scorecard';

/**
 * Map a numeric score to a letter grade
 * @param score - Score from 0-100
 * @returns Letter grade A-F
 */
export function assignGrade(score: number): RunScorecard['grade'] {
  return score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
}
