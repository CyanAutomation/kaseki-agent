/**
 * Improvement #1: Anti-Patterns Extraction
 *
 * Tests validation of anti-pattern categories (do_not_modify, do_not_break, must_preserve)
 * and quality warnings when anti-patterns are missing or malformed.
 */

import {
  GoalSettingOutput,
  GoalSettingOutputSchema,
  hasQualityWarnings,
  isGoalSettingOutput,
  parseGoalSettingOutput,
} from '../../src/types/goal-setting';

describe('Goal-Setting: Anti-Patterns Extraction (#1)', () => {
  it('should validate supported anti-pattern categories and report missing or malformed input', () => {
    const baseGoal = {
      original_prompt: 'Fix TypeScript errors',
      upgraded_goal: 'Fix TypeScript errors in src/api/',
      key_requirements: ['Handle compilation errors'],
      success_criteria: ['TypeScript passes'],
      reasoning: 'clear scope boundaries',
      confidence: 'high',
    } satisfies Omit<GoalSettingOutput, 'anti_patterns'>;

    // Test full anti-patterns object
    const goal = parseGoalSettingOutput({
      ...baseGoal,
      anti_patterns: {
        do_not_modify: ['src/generated/**'],
        do_not_break: ['API contracts'],
        must_preserve: ['error messages'],
      },
    });

    expect(goal.anti_patterns).toEqual({
      do_not_modify: ['src/generated/**'],
      do_not_break: ['API contracts'],
      must_preserve: ['error messages'],
    });
    expect(isGoalSettingOutput(goal)).toBe(true);

    // Test partial anti-patterns
    const partialAntiPatterns = parseGoalSettingOutput({
      ...baseGoal,
      anti_patterns: {
        do_not_break: ['API contracts'],
      },
    });

    expect(partialAntiPatterns.anti_patterns).toEqual({
      do_not_break: ['API contracts'],
    });
    expect(hasQualityWarnings(partialAntiPatterns)).not.toContain(
      'No explicit anti-patterns defined - recommended for safety',
    );

    // Test missing anti-patterns triggers quality warning
    const missingAntiPatterns = parseGoalSettingOutput(baseGoal);
    expect(hasQualityWarnings(missingAntiPatterns)).toContain(
      'No explicit anti-patterns defined - recommended for safety',
    );

    // Test malformed anti-patterns (non-array) fails schema validation
    expect(
      GoalSettingOutputSchema.safeParse({
        ...baseGoal,
        anti_patterns: {
          do_not_modify: 'src/generated/**',
        },
      }).success,
    ).toBe(false);
  });

  it('should support empty anti-pattern categories', () => {
    const goal: GoalSettingOutput = {
      original_prompt: 'Simple fix',
      upgraded_goal: 'Simple fix upgraded',
      key_requirements: [],
      success_criteria: [],
      anti_patterns: {
        do_not_modify: [],
        do_not_break: ['existing behavior'],
      },
      reasoning: 'minimal anti-patterns',
      confidence: 'medium',
    };

    expect(goal.anti_patterns?.do_not_modify).toEqual([]);
    expect(goal.anti_patterns?.do_not_break).toContain('existing behavior');
  });

  it('should validate that anti-patterns are semantically coherent', () => {
    const goal = parseGoalSettingOutput({
      original_prompt: 'Refactor database layer',
      upgraded_goal: 'Refactor database layer to use connection pooling',
      key_requirements: ['Use connection pooling', 'Minimize query count'],
      success_criteria: ['Pool size <= 20', 'Queries per request < 5'],
      anti_patterns: {
        do_not_modify: ['src/migrations/**', 'src/seeds/**'],
        do_not_break: ['database schema', 'ORM compatibility'],
        must_preserve: ['transaction semantics', 'data consistency'],
      },
      reasoning: 'Clear boundaries to avoid schema changes',
      confidence: 'high',
    });

    expect(goal.anti_patterns?.do_not_modify).toHaveLength(2);
    expect(goal.anti_patterns?.do_not_break).toHaveLength(2);
    expect(goal.anti_patterns?.must_preserve).toHaveLength(2);
  });
});
