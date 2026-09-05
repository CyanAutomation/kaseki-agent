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

  test('PHASES includes expected keys', () => {
    expect(Array.isArray(PHASES)).toBe(true);
    expect(PHASES.length).toBeGreaterThanOrEqual(6);
  });
});
