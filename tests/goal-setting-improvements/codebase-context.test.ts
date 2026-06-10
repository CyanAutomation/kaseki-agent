/**
 * Improvement #3: Codebase Context Preservation
 *
 * Tests that goal-setting output includes and preserves knowledge of codebase conventions,
 * established patterns, technology stack, and architectural decisions.
 */

import {
  GoalSettingOutput,
} from '../../src/types/goal-setting';

describe('Goal-Setting: Codebase Context Preservation (#3)', () => {
  it('should include codebase signals in reasoning', () => {
    const goal: GoalSettingOutput = {
      original_prompt: 'Add error handling',
      upgraded_goal:
        'Add error handling to async functions in src/api/ using try-catch. Format errors per established pattern. No new dependencies.',
      key_requirements: ['Follow existing error pattern', 'Node.js + TypeScript environment'],
      success_criteria: [
        'All errors caught',
        'Consistent with codebase',
      ],
      reasoning:
        'Codebase uses Node.js + TypeScript with async/await patterns. Error messages follow "action failed: reason" format.',
      confidence: 'high',
    };

    expect(goal.reasoning).toContain('Node.js');
    expect(goal.reasoning).toContain('TypeScript');
    expect(goal.reasoning).toContain('async/await');
    expect(goal.key_requirements).toContain('Follow existing error pattern');
  });

  it('should identify technology stack from codebase signals', () => {
    const goal: GoalSettingOutput = {
      original_prompt: 'Optimize database queries',
      upgraded_goal: 'Optimize database queries using PgPool connection pooling in node-postgres',
      key_requirements: [
        'Use node-postgres (pg) library',
        'Implement PgPool pattern',
        'Preserve transaction semantics',
      ],
      success_criteria: [
        'Connection pool configured',
        'No leaked connections',
      ],
      reasoning: 'Codebase uses PostgreSQL + node-postgres (pg) v8. Connection pooling prevents resource exhaustion.',
      confidence: 'high',
    };

    expect(goal.reasoning).toContain('PostgreSQL');
    expect(goal.reasoning).toContain('node-postgres');
    expect(goal.upgraded_goal).toContain('PgPool');
  });

  it('should preserve established architectural patterns', () => {
    const goal: GoalSettingOutput = {
      original_prompt: 'Add new API endpoint',
      upgraded_goal: 'Add GET /api/users/:id endpoint following Express middleware chain pattern',
      key_requirements: [
        'Use Express.js middleware pattern',
        'Include authentication check',
        'Follow established error handling in routes/users.ts',
      ],
      success_criteria: [
        'Endpoint returns 200 with user data',
        'Returns 401 when unauthenticated',
        'Uses existing error middleware',
      ],
      reasoning:
        'Codebase follows Express middleware pattern with auth checks at route level. Errors are handled by central error middleware.',
      confidence: 'high',
    };

    // Verify key requirements include middleware pattern
    const hasMiddlewareReq = goal.key_requirements.some(req => req.includes('Express.js'));
    expect(hasMiddlewareReq).toBe(true);
    expect(goal.reasoning).toContain('middleware pattern');
    expect(goal.reasoning).toContain('central error middleware');
  });

  it('should reference specific files and locations in reasoning', () => {
    const goal: GoalSettingOutput = {
      original_prompt: 'Fix validation bug',
      upgraded_goal: 'Fix email validation in src/lib/validators.ts to reject +tagged addresses',
      key_requirements: [
        'Update regex in validateEmail()',
        'Add test case in tests/validators.test.ts',
      ],
      success_criteria: [
        'test@example+tag.com rejected',
      ],
      reasoning: 'Current regex in src/lib/validators.ts (line 42) does not reject +tagged email variations.',
      confidence: 'high',
    };

    expect(goal.reasoning).toContain('src/lib/validators.ts');
    expect(goal.reasoning).toContain('line 42');
    expect(goal.upgraded_goal).toContain('src/lib/validators.ts');
  });

  it('should include framework/library version constraints in context', () => {
    const goal: GoalSettingOutput = {
      original_prompt: 'Upgrade React',
      upgraded_goal: 'Upgrade to React 18 with concurrent features in src/components/',
      key_requirements: [
        'React 18 or higher',
        'TypeScript 4.6+',
        'No breaking changes to existing components',
      ],
      success_criteria: [
        'useTransition hook adopted',
        'All types still valid',
      ],
      reasoning:
        'Project requires React 18+ for Suspense/concurrent features. TypeScript 4.6+ for type safety. Node 16+ already in CI.',
      confidence: 'high',
    };

    expect(goal.reasoning).toContain('React 18+');
    expect(goal.reasoning).toContain('TypeScript 4.6+');
    expect(goal.reasoning).toContain('Node 16+');
  });

  it('should avoid prescribing solutions outside established tech stack', () => {
    const goal: GoalSettingOutput = {
      original_prompt: 'Improve caching',
      upgraded_goal: 'Add Redis caching layer for session management using node-redis',
      key_requirements: [
        'Use node-redis (existing dependency)',
        'Preserve Session interface contract',
      ],
      success_criteria: [
        'Session lookups cached',
      ],
      reasoning: 'Codebase already has node-redis as a dependency. Session pattern established in sessions.ts.',
      confidence: 'high',
    };

    // Should not recommend new frameworks
    expect(goal.reasoning).not.toContain('Install new package');
    expect(goal.reasoning).toContain('as a dependency');
  });
});
