import { normalizePhase, PHASES } from './run-scorecard-phases';

describe('normalizePhase', () => {
  test('maps common aliases to canonical phases', () => {
    expect(normalizePhase('Goal Setting')).toBe('goal_setting');
    expect(normalizePhase('goal-setting')).toBe('goal_setting');
    expect(normalizePhase('Scouting')).toBe('scouting');
    expect(normalizePhase('coding')).toBe('coding');
    expect(normalizePhase('Run Evaluation')).toBe('run_evaluation');
    expect(normalizePhase('evaluation')).toBe('run_evaluation');
  });

  test('returns fallback when unknown', () => {
    expect(normalizePhase('unexpected-phase-name')).toBe('coding');
    expect(normalizePhase(undefined)).toBe('coding');
  });

  test('PHASES exactly matches the canonical scorecard phase identifiers', () => {
    // Contract: RunScorecardSchema in ./types/run-scorecard.ts, exposed by
    // GET /api/runs/:id/scorecard. Rendering defines its own display order, so
    // PHASES order is not part of that API contract; assert membership and
    // uniqueness without making harmless reordering fail this test.
    const canonicalPhases = new Set([
      'goal_setting',
      'scouting',
      'coding',
      'validation',
      'goal_check',
      'run_evaluation',
    ]);

    expect(new Set(PHASES)).toEqual(canonicalPhases);
    expect(PHASES).toHaveLength(canonicalPhases.size);
  });
});
