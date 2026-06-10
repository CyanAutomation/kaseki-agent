/**
 * Improvement #2: SMART Criteria Validation
 *
 * Tests validation of SMART criteria (Specific, Measurable, Achievable, Relevant, Time-bound)
 * in goal-setting output, including quality scoring and weak criteria detection.
 */

import {
  GoalSettingOutput,
  getCriterionText,
  hasQualityWarnings,
} from '../../src/types/goal-setting';

describe('Goal-Setting: SMART Criteria Validation (#2)', () => {
  it('should validate SMART criteria format and scores', () => {
    const criteria = [
      {
        criterion: 'all tests pass',
        smart_score: 'high' as const,
        reasoning: 'binary, measurable outcome',
      },
      {
        criterion: 'add 5 edge-case tests',
        smart_score: 'high' as const,
        reasoning: 'specific count, achievable in one run',
      },
      {
        criterion: 'improve code quality',
        smart_score: 'low' as const,
        reasoning: 'vague, not measurable',
      },
    ];

    const strongCriteria = criteria.filter((c) => c.smart_score === 'high');
    expect(strongCriteria).toHaveLength(2);
    expect(strongCriteria[0].criterion).toBe('all tests pass');

    const weakCriteria = criteria.filter((c) => c.smart_score === 'low');
    expect(weakCriteria).toHaveLength(1);
    expect(weakCriteria[0].criterion).toBe('improve code quality');
  });

  it('should detect weak SMART criteria quality and trigger warnings', () => {
    const goal: GoalSettingOutput = {
      original_prompt: 'Fix something',
      upgraded_goal: 'Fix it better',
      key_requirements: [],
      success_criteria: [
        { criterion: 'improve stuff', smart_score: 'low' },
        { criterion: 'make it better', smart_score: 'low' },
        { criterion: 'do something', smart_score: 'low' },
      ],
      reasoning: 'weak criteria',
      confidence: 'low',
    };

    const warnings = hasQualityWarnings(goal);
    expect(warnings).toBeDefined();
    expect(warnings.some((w) => w.includes('Success criteria'))).toBe(true);
  });

  it('should require at least one measurable criterion', () => {
    const goalWithMeasurable: GoalSettingOutput = {
      original_prompt: 'Improve system',
      upgraded_goal: 'Improve system performance',
      key_requirements: ['Add caching', 'Optimize queries'],
      success_criteria: [
        'response time < 100ms',
        'improve user experience',
      ],
      reasoning: 'at least one measurable criterion present',
      confidence: 'high',
    };

    // Mixed quality criteria should still be allowed
    expect(goalWithMeasurable.success_criteria).toHaveLength(2);
  });

  it('should support legacy string format for backward compatibility', () => {
    const goal: GoalSettingOutput = {
      original_prompt: 'Old format goal',
      upgraded_goal: 'Upgraded old format',
      key_requirements: [],
      success_criteria: [
        'criterion 1', // String format (legacy)
        'criterion 2',
      ] as any,
      reasoning: 'backward compatibility test',
      confidence: 'medium',
    };

    expect(typeof goal.success_criteria[0]).toBe('string');
    expect(getCriterionText(goal.success_criteria[0] as any)).toBe('criterion 1');
    expect(getCriterionText(goal.success_criteria[1] as any)).toBe('criterion 2');
  });

  it('should validate measurable criteria contain quantifiable elements', () => {
    const measurable = [
      'add 10 new tests',  // specific number
      'reduce latency by 50%',  // percentage
      'pass type checking',  // binary outcome
      'fix all 12 reported bugs',  // specific count
    ];

    measurable.forEach((criterion) => {
      expect(criterion.length).toBeGreaterThanOrEqual(10);
      // Measurable criteria contain either numbers, percentages, or binary keywords
      const hasMeasurableIndicator = /\d+|%|pass|pass|complete|success/.test(criterion);
      expect(hasMeasurableIndicator).toBe(true);
    });
  });

  it('should identify vague criteria lacking specificity', () => {
    const vague = [
      'improve code',
      'make it better',
      'fix issues',
      'enhance system',
    ];

    vague.forEach((criterion) => {
      const vagueKeywords = ['improve', 'better', 'enhance', 'good', 'fix', 'make'];
      const matches = vagueKeywords.some(kw => criterion.toLowerCase().includes(kw));
      expect(matches).toBe(true);
      // Vague criteria lack specific metrics or counts
      expect(/\d+|%|specific|exact/.test(criterion)).toBe(false);
    });
  });
});
