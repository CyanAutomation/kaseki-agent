import { object, number, bool, stagePhase } from './run-scorecard-guards';
import { computePhaseDurations } from './run-scorecard-evidence-utils';

describe('run-scorecard-evidence-utils', () => {
  describe('object', () => {
    it('returns object for valid objects', () => {
      expect(object({})).toEqual({});
      expect(object({ key: 'value' })).toEqual({ key: 'value' });
    });

    it('returns undefined for arrays', () => {
      expect(object([])).toBeUndefined();
      expect(object([1, 2, 3])).toBeUndefined();
    });

    it('returns undefined for null', () => {
      expect(object(null)).toBeUndefined();
    });

    it('returns undefined for primitives', () => {
      expect(object('string')).toBeUndefined();
      expect(object(123)).toBeUndefined();
      expect(object(true)).toBeUndefined();
    });

    it('returns undefined for undefined', () => {
      expect(object(undefined)).toBeUndefined();
    });
  });

  describe('number', () => {
    it('returns number for valid finite numbers', () => {
      expect(number(0)).toBe(0);
      expect(number(123)).toBe(123);
      expect(number(-456)).toBe(-456);
      expect(number(3.14)).toBe(3.14);
    });

    it('returns undefined for non-finite numbers', () => {
      expect(number(Infinity)).toBeUndefined();
      expect(number(-Infinity)).toBeUndefined();
      expect(number(NaN)).toBeUndefined();
    });

    it('returns undefined for non-numbers', () => {
      expect(number('123')).toBeUndefined();
      expect(number(true)).toBeUndefined();
      expect(number(null)).toBeUndefined();
      expect(number(undefined)).toBeUndefined();
    });
  });

  describe('bool', () => {
    it('returns boolean for true/false', () => {
      expect(bool(true)).toBe(true);
      expect(bool(false)).toBe(false);
    });

    it('returns undefined for non-booleans', () => {
      expect(bool(1)).toBeUndefined();
      expect(bool(0)).toBeUndefined();
      expect(bool('true')).toBeUndefined();
      expect(bool(null)).toBeUndefined();
      expect(bool(undefined)).toBeUndefined();
    });
  });

  describe('stagePhase', () => {
    it('detects goal_setting phase from stage name', () => {
      expect(stagePhase('goal.setting')).toBe('goal_setting');
      expect(stagePhase('Goal.Setting')).toBe('goal_setting');
      expect(stagePhase('GOAL_SETTING')).toBe('goal_setting');
    });

    it('detects scouting phase', () => {
      expect(stagePhase('scouting')).toBe('scouting');
      expect(stagePhase('Scouting')).toBe('scouting');
    });

    it('detects coding phase', () => {
      expect(stagePhase('coding')).toBe('coding');
      expect(stagePhase('CODING')).toBe('coding');
    });

    it('detects goal_check phase', () => {
      expect(stagePhase('goal.check')).toBe('goal_check');
      expect(stagePhase('goal-check')).toBe('goal_check');
    });

    it('detects run_evaluation phase', () => {
      expect(stagePhase('run.evaluation')).toBe('run_evaluation');
    });

    it('detects validation phase', () => {
      expect(stagePhase('validation')).toBe('validation');
    });

    it('does not classify pre-agent validation as post-change validation', () => {
      expect(stagePhase('pre-agent validation')).toBeUndefined();
    });

    it('returns undefined for unrecognized stage', () => {
      expect(stagePhase('unknown')).toBeUndefined();
      expect(stagePhase('unknown_stage')).toBeUndefined();
    });

    it('handles empty or falsy input gracefully', () => {
      expect(stagePhase('')).toBeUndefined();
      expect(stagePhase(null)).toBeUndefined();
      expect(stagePhase(undefined)).toBeUndefined();
      expect(stagePhase(0)).toBeUndefined();
    });
  });

  describe('computePhaseDurations', () => {
    it('accumulates durations for each phase', () => {
      const stageRows = [
        { stage: 'goal.setting', elapsed_seconds: 2 },
        { stage: 'scouting', elapsed_seconds: 5 },
        { stage: 'coding', elapsed_seconds: 10 },
      ];

      const result = computePhaseDurations(stageRows);

      expect(result.phaseDurationsMs).toEqual({
        goal_setting: 2000,
        scouting: 5000,
        coding: 10000,
      });
      expect(result.stageElapsed).toBe(17);
    });

    it('accumulates multiple entries for the same phase', () => {
      const stageRows = [
        { stage: 'coding', elapsed_seconds: 5 },
        { stage: 'coding', elapsed_seconds: 3 },
        { stage: 'validation', elapsed_seconds: 2 },
      ];

      const result = computePhaseDurations(stageRows);

      expect(result.phaseDurationsMs).toEqual({
        coding: 8000,
        validation: 2000,
      });
      expect(result.stageElapsed).toBe(10);
    });

    it('reports pre-agent validation separately from final validation', () => {
      const result = computePhaseDurations([
        { stage: 'pre-agent validation', elapsed_seconds: 150 },
        { stage: 'validation', elapsed_seconds: 20 },
        { stage: 'goal check', elapsed_seconds: 5 },
      ]);

      expect(result.phaseDurationsMs).toEqual({ validation: 20_000, goal_check: 5_000 });
      expect(result.preAgentValidationMs).toBe(150_000);
      expect(result.stageElapsed).toBe(175);
    });

    it('returns empty result for empty array', () => {
      const result = computePhaseDurations([]);

      expect(result.phaseDurationsMs).toEqual({});
      expect(result.stageElapsed).toBe(0);
    });

    it('skips entries with unrecognized phase names', () => {
      const stageRows = [
        { stage: 'goal.setting', elapsed_seconds: 2 },
        { stage: 'unknown', elapsed_seconds: 5 },
        { stage: 'scouting', elapsed_seconds: 3 },
      ];

      const result = computePhaseDurations(stageRows);

      expect(result.phaseDurationsMs).toEqual({
        goal_setting: 2000,
        scouting: 3000,
      });
      expect(result.stageElapsed).toBe(10);
    });

    it('skips entries with missing elapsed_seconds', () => {
      const stageRows = [
        { stage: 'goal.setting' },
        { stage: 'scouting', elapsed_seconds: 5 },
        { elapsed_seconds: 3 },
      ];

      const result = computePhaseDurations(stageRows);

      expect(result.phaseDurationsMs).toEqual({
        scouting: 5000,
      });
      expect(result.stageElapsed).toBe(8);
    });

    it('handles non-numeric elapsed_seconds gracefully', () => {
      const stageRows = [
        { stage: 'goal.setting', elapsed_seconds: 'not-a-number' },
        { stage: 'scouting', elapsed_seconds: 5 },
      ];

      const result = computePhaseDurations(stageRows);

      expect(result.phaseDurationsMs).toEqual({
        scouting: 5000,
      });
      expect(result.stageElapsed).toBe(5);
    });

    it('handles non-array input gracefully', () => {
      expect(computePhaseDurations(null as any).phaseDurationsMs).toEqual({});
      expect(computePhaseDurations(undefined as any).phaseDurationsMs).toEqual({});
      expect(computePhaseDurations({} as any).phaseDurationsMs).toEqual({});
      expect(computePhaseDurations('not-array' as any).phaseDurationsMs).toEqual({});
    });

    it('handles malformed objects in array', () => {
      const stageRows = [
        { stage: 'goal.setting', elapsed_seconds: 2 },
        null,
        { stage: 'scouting', elapsed_seconds: 3 },
        'malformed',
      ];

      const result = computePhaseDurations(stageRows as any);

      expect(result.phaseDurationsMs).toEqual({
        goal_setting: 2000,
        scouting: 3000,
      });
      expect(result.stageElapsed).toBe(5);
    });

    it('converts durations from seconds to milliseconds correctly', () => {
      const stageRows = [
        { stage: 'goal.setting', elapsed_seconds: 0.5 },
        { stage: 'scouting', elapsed_seconds: 1.25 },
      ];

      const result = computePhaseDurations(stageRows);

      expect(result.phaseDurationsMs).toEqual({
        goal_setting: 500,
        scouting: 1250,
      });
      expect(result.stageElapsed).toBe(1.75);
    });
  });
});
