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

// Requirement reference: docs/archive/GOAL_SETTING_IMPROVEMENTS.md, §2 "SMART Criteria Validation".
describe('Goal-Setting: SMART Criteria Validation (#2)', () => {
  it.each(['high', 'medium', 'low'] as const)('accepts the supported SMART score "%s"', (smartScore) => {
    const result = GoalSettingOutputSchema.safeParse({
      original_prompt: 'Improve parser validation',
      upgraded_goal: 'Improve parser validation with measurable criteria',
      key_requirements: ['Preserve parser behavior'],
      success_criteria: [
        { criterion: 'Add parser boundary coverage', smart_score: smartScore },
        { criterion: 'Focused parser tests pass', smart_score: 'high' },
      ],
      reasoning: 'The measurable criterion supports the goal.',
      confidence: 'high',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a SMART criterion with an unsupported score', () => {
    const result = GoalSettingOutputSchema.safeParse({
      original_prompt: 'Improve parser validation',
      upgraded_goal: 'Improve parser validation with measurable criteria',
      key_requirements: ['Preserve parser behavior'],
      success_criteria: [
        { criterion: 'Add parser boundary coverage', smart_score: 'excellent' },
      ],
      reasoning: 'The score value is outside the supported contract.',
      confidence: 'high',
    });

    expect(result.success).toBe(false);
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
    const measurableResult = GoalSettingOutputSchema.safeParse({
      original_prompt: 'Improve system',
      upgraded_goal: 'Improve system performance',
      key_requirements: ['Add caching', 'Optimize queries'],
      success_criteria: [
        {
          criterion: 'reduce p95 response time below 100ms',
          smart_score: 'high',
          reasoning: 'specific latency threshold',
        },
        {
          criterion: 'improve user experience',
          smart_score: 'medium',
          reasoning: 'directional outcome supported by the measurable latency criterion',
        },
      ],
      anti_patterns: { do_not_break: ['existing public API behavior'] },
      constraints: { technical: ['keep cache invalidation deterministic'] },
      examples: { after: 'p95 response time is below 100ms' },
      reasoning: 'at least one measurable criterion present',
      confidence: 'high',
    });

    expect(measurableResult.success).toBe(true);
    if (!measurableResult.success) {
      throw new Error('Expected measurable goal fixture to satisfy schema');
    }

    expect(hasQualityWarnings(measurableResult.data)).not.toContain(
      'Success criteria not measurable (low smart_score)'
    );

    const vagueResult = GoalSettingOutputSchema.safeParse({
      original_prompt: 'Improve system',
      upgraded_goal: 'Make the system better',
      key_requirements: ['Improve performance'],
      success_criteria: [
        {
          criterion: 'make it better',
          smart_score: 'low',
          reasoning: 'vague and not measurable',
        },
        {
          criterion: 'improve user experience',
          smart_score: 'low',
          reasoning: 'no observable acceptance threshold',
        },
      ],
      anti_patterns: { do_not_break: ['existing public API behavior'] },
      constraints: { technical: ['keep cache invalidation deterministic'] },
      examples: { after: 'better user experience' },
      reasoning: 'only vague criteria present',
      confidence: 'medium',
    });

    if (vagueResult.success) {
      expect(hasQualityWarnings(vagueResult.data)).toContain(
        'Success criteria not measurable (low smart_score)'
      );
    } else {
      expect(vagueResult.error.issues.length).toBeGreaterThan(0);
    }
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

    expect(vagueResult.success).toBe(false);
    if (vagueResult.success) {
      throw new Error('Expected vague goal fixture to fail measurable criteria validation');
    }

    expect(vagueResult.error.issues.map((issue) => issue.message)).toContain(
      'success_criteria must include at least one measurable SMART criterion'
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
