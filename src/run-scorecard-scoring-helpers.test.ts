import { determinePhaseOutcome, determineDimensionStatus, calculateEffectiveWeight, calculateWeightedPoints } from './run-scorecard-scoring-helpers';
import type { Evidence } from './run-scorecard-evidence';

describe('run-scorecard-scoring-helpers', () => {
  const mockEvidence: Partial<Evidence> = {
    status: 'completed',
    phaseReached: { goal_setting: true, scouting: true, coding: true, validation: true, goal_check: true, run_evaluation: true },
    phaseFailures: { goal_setting: false, scouting: false, coding: false, validation: false, goal_check: false, run_evaluation: false },
    validation: 'passed',
    goalCheckFailed: false,
    evaluatorAvailable: true,
  };

  describe('determinePhaseOutcome', () => {
    it('returns skipped for disabled phases', () => {
      expect(determinePhaseOutcome('coding', mockEvidence as Evidence, true)).toBe('skipped');
    });

    it('returns not_started for phases not reached', () => {
      const evidence = { ...mockEvidence, phaseReached: { ...mockEvidence.phaseReached, coding: false } };
      expect(determinePhaseOutcome('coding', evidence as Evidence, false)).toBe('not_started');
    });

    it('returns not_started for running/cancelled status', () => {
      const evidence = { ...mockEvidence, status: 'running' };
      expect(determinePhaseOutcome('coding', evidence as Evidence, false)).toBe('not_started');
    });

    it('returns failed when phaseFailures is true', () => {
      const evidence = { ...mockEvidence, phaseFailures: { ...mockEvidence.phaseFailures, coding: true } };
      expect(determinePhaseOutcome('coding', evidence as Evidence, false)).toBe('failed');
    });

    it('returns failed for validation phase when validation failed', () => {
      const evidence = { ...mockEvidence, validation: 'failed' };
      expect(determinePhaseOutcome('validation', evidence as Evidence, false)).toBe('failed');
    });

    it('returns failed for goal_check phase when goalCheckFailed is true', () => {
      const evidence = { ...mockEvidence, goalCheckFailed: true };
      expect(determinePhaseOutcome('goal_check', evidence as Evidence, false)).toBe('failed');
    });

    it('returns failed for run_evaluation when evaluatorAvailable is false', () => {
      const evidence = { ...mockEvidence, evaluatorAvailable: false };
      expect(determinePhaseOutcome('run_evaluation', evidence as Evidence, false)).toBe('failed');
    });

    it('returns succeeded for normal completed phases', () => {
      expect(determinePhaseOutcome('coding', mockEvidence as Evidence, false)).toBe('succeeded');
      expect(determinePhaseOutcome('scouting', mockEvidence as Evidence, false)).toBe('succeeded');
    });
  });

  describe('determineDimensionStatus', () => {
    it('returns not_applicable for disabled dimensions', () => {
      expect(determineDimensionStatus('goal_quality', false, true, 100, false)).toBe('not_applicable');
    });

    it('returns unavailable for unreached phases', () => {
      expect(determineDimensionStatus('goal_quality', true, false, 100, false)).toBe('unavailable');
    });

    it('returns unavailable for implementation_quality with no diff and not accepted', () => {
      expect(determineDimensionStatus('implementation_quality', true, true, 0, false)).toBe('unavailable');
    });

    it('returns complete for implementation_quality with diff', () => {
      expect(determineDimensionStatus('implementation_quality', true, true, 100, false)).toBe('complete');
    });

    it('returns complete for implementation_quality with zero diff but noChangeAccepted', () => {
      expect(determineDimensionStatus('implementation_quality', true, true, 0, true)).toBe('complete');
    });

    it('returns complete for other dimensions with reached phase', () => {
      expect(determineDimensionStatus('goal_quality', true, true, 100, false)).toBe('complete');
      expect(determineDimensionStatus('validation_quality', true, true, 100, false)).toBe('complete');
    });
  });

  describe('calculateEffectiveWeight', () => {
    it('returns 0 for non-applicable dimensions', () => {
      expect(calculateEffectiveWeight(20, false, 100)).toBe(0);
    });

    it('returns 0 when total eligible weight is 0', () => {
      expect(calculateEffectiveWeight(20, true, 0)).toBe(0);
    });

    it('calculates proportional weight', () => {
      // If weight is 20 and total eligible is 100, effective weight should be 0.2
      expect(calculateEffectiveWeight(20, true, 100)).toBe(0.2);
      expect(calculateEffectiveWeight(25, true, 100)).toBe(0.25);
    });

    it('handles redistributed weights correctly', () => {
      // If total eligible weight is 80 (after disabling some phases from 100)
      // and this dimension has weight 20, effective should be 20/80 = 0.25
      expect(calculateEffectiveWeight(20, true, 80)).toBe(0.25);
    });
  });

  describe('calculateWeightedPoints', () => {
    it('calculates weighted points correctly', () => {
      expect(calculateWeightedPoints(100, 0.2)).toBe(20);
      expect(calculateWeightedPoints(80, 0.25)).toBe(20);
      expect(calculateWeightedPoints(50, 0.1)).toBe(5);
    });

    it('rounds to 2 decimal places', () => {
      expect(calculateWeightedPoints(85.5, 0.333333)).toBe(28.5);
      expect(calculateWeightedPoints(90, 0.111111)).toBe(10);
    });

    it('handles zero effective weight', () => {
      expect(calculateWeightedPoints(100, 0)).toBe(0);
    });
  });
});
