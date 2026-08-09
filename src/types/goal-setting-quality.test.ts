import { describe, expect, it } from '@jest/globals';
import {
  calculateGoalQualityScore,
  getCriterionText,
  hasQualityWarnings,
} from './goal-setting-quality';
import type { GoalSettingOutput, QualityMetrics } from './goal-setting';

const baseGoal: GoalSettingOutput = {
  original_prompt: 'Improve the parser',
  upgraded_goal: 'Improve the parser with focused tests',
  key_requirements: [],
  success_criteria: ['tests pass'],
  reasoning: 'test fixture',
  confidence: 'high',
};

const metrics: QualityMetrics = {
  clarity: 'high',
  measurability: 'medium',
  specificity: 'low',
  scope_clarity: 'high',
  constraint_strength: 'medium',
};

describe('goal-setting quality helpers', () => {
  it('scores both a complete goal and metrics directly', () => {
    expect(calculateGoalQualityScore({ ...baseGoal, quality_metrics: metrics })).toBe(75);
    expect(calculateGoalQualityScore(metrics)).toBe(75);
  });

  it('returns the fallback score when metrics are absent', () => {
    expect(calculateGoalQualityScore(baseGoal)).toBe(50);
  });

  it('scores every quality level at its configured boundary', () => {
    expect(calculateGoalQualityScore({
      clarity: 'low', measurability: 'low', specificity: 'low',
      scope_clarity: 'low', constraint_strength: 'low',
    })).toBe(0);
    expect(calculateGoalQualityScore({
      clarity: 'high', measurability: 'high', specificity: 'high',
      scope_clarity: 'high', constraint_strength: 'high',
    })).toBe(125);
  });

  it('reports every missing quality safeguard', () => {
    const warnings = hasQualityWarnings({
      ...baseGoal,
      success_criteria: [{ criterion: 'unclear criterion', smart_score: 'low' }],
      quality_metrics: {
        clarity: 'low',
        measurability: 'low',
        specificity: 'low',
        scope_clarity: 'low',
        constraint_strength: 'low',
      },
    });

    expect(warnings).toEqual([
      'No explicit anti-patterns defined - recommended for safety',
      'No examples provided - recommended for clarity',
      'No constraints provided - recommended for architectural safety',
      'Success criteria not measurable (low smart_score)',
      'Goal clarity is low',
      'Success criteria not measurable',
      'Goal specificity is low',
      'Scope boundaries are unclear',
      'Constraint strength is low',
    ]);
  });

  it('does not warn when safeguards and metrics are present', () => {
    expect(hasQualityWarnings({
      ...baseGoal,
      anti_patterns: { do_not_modify: ['src/generated'] },
      examples: { before: 'old', after: 'new' },
      constraints: { technical: ['must pass tests'] },
      success_criteria: [{ criterion: 'tests pass', smart_score: 'high' }],
      quality_metrics: {
        clarity: 'high',
        measurability: 'high',
        specificity: 'high',
        scope_clarity: 'high',
        constraint_strength: 'high',
      },
    })).toEqual([]);
  });

  it('accepts partial safeguards and only reports the missing categories', () => {
    expect(hasQualityWarnings({
      ...baseGoal,
      anti_patterns: { must_preserve: ['public API'] },
      examples: { before: 'old' },
      constraints: { business: ['preserve behavior'] },
      success_criteria: ['tests pass'],
    })).toEqual([]);
  });

  it('extracts text from legacy and SMART criteria', () => {
    expect(getCriterionText('tests pass')).toBe('tests pass');
    expect(getCriterionText({ criterion: 'tests pass', smart_score: 'high' })).toBe('tests pass');
  });
});
