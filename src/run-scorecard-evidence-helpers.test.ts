import { stagePhase, computePhaseDurations } from './run-scorecard-evidence-helpers';

describe('run-scorecard-evidence-helpers', () => {
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
      expect(result.stageElapsed).toBe(10); // 2 + 5 + 3 = 10 (all elapsed_seconds added)
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
      expect(result.stageElapsed).toBe(8); // 5 (scouting) + 3 (unrecognized phase) = 8
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
