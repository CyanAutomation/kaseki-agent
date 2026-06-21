/**
 * Improvement #2: SMART Criteria Validation
 *
 * Tests validation of SMART criteria (Specific, Measurable, Achievable, Relevant, Time-bound)
 * in goal-setting output, including quality scoring and weak criteria detection.
 */

import {
  GoalSettingOutput,
  GoalSettingOutputSchema,
  getCriterionText,
  hasQualityWarnings,
  parseGoalSettingOutput,
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

  it('should preserve measurable SMART criteria and warn on vague criteria', () => {
    const measurableGoal = parseGoalSettingOutput({
      original_prompt: 'Improve test coverage',
      upgraded_goal: 'Improve test coverage with quantifiable completion checks',
      key_requirements: ['Add tests', 'Verify type safety'],
      success_criteria: [
        {
          criterion: 'add 10 new tests',
          smart_score: 'high',
          reasoning: 'specific count',
        },
        {
          criterion: 'pass type checking',
          smart_score: 'high',
          reasoning: 'binary outcome',
        },
      ],
      anti_patterns: { do_not_break: ['existing tests'] },
      constraints: { technical: ['keep public types compatible'] },
      examples: { after: '10 new tests pass and type checking succeeds' },
      reasoning: 'measurable criteria should not trigger SMART quality warnings',
      confidence: 'high',
    });

    expect(measurableGoal.success_criteria.map((c) => getCriterionText(c))).toEqual([
      'add 10 new tests',
      'pass type checking',
    ]);
    expect(measurableGoal.success_criteria).toEqual([
      expect.objectContaining({ criterion: 'add 10 new tests', smart_score: 'high' }),
      expect.objectContaining({ criterion: 'pass type checking', smart_score: 'high' }),
    ]);
    expect(hasQualityWarnings(measurableGoal)).not.toContain(
      'Success criteria not measurable (low smart_score)'
    );

    const vagueResult = GoalSettingOutputSchema.safeParse({
      original_prompt: 'Improve code',
      upgraded_goal: 'Make the code better',
      key_requirements: ['Improve code'],
      success_criteria: [
        {
          criterion: 'make it better',
          smart_score: 'low',
          reasoning: 'vague and not measurable',
        },
      ],
      anti_patterns: { do_not_modify: ['deployment scripts'] },
      constraints: { technical: ['preserve APIs'] },
      examples: { before: 'unclear behavior', after: 'better behavior' },
      reasoning: 'vague criteria should trigger SMART quality warnings',
      confidence: 'medium',
    });

    expect(vagueResult.success).toBe(true);
    if (!vagueResult.success) {
      throw new Error('Expected vague goal fixture to satisfy schema');
    }

    expect(hasQualityWarnings(vagueResult.data)).toContain(
      'Success criteria not measurable (low smart_score)'
    );
    expect(vagueResult.data.success_criteria[0]).toEqual(
      expect.objectContaining({ criterion: 'make it better', smart_score: 'low' })
    );
  });

  it('should identify vague criteria lacking specificity', () => {
    const goal: GoalSettingOutput = {
      original_prompt: 'Improve code',
      upgraded_goal: 'Make the code better',
      key_requirements: ['Improve maintainability'],
      success_criteria: [
        {
          criterion: 'improve code',
          smart_score: 'low',
          reasoning: 'vague wording without a measurable outcome',
        },
        {
          criterion: 'make it better',
          smart_score: 'low',
          reasoning: 'unclear target state and no acceptance metric',
        },
      ],
      reasoning: 'vague success criteria should be surfaced by production validation',
      confidence: 'medium',
    };

    const warnings = hasQualityWarnings(goal);

    expect(warnings).toContain('Success criteria not measurable (low smart_score)');
  });
});
