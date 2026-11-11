import { execFileSync } from 'node:child_process';

describe('evaluation routing prompt integration', () => {
  test('keeps admission hints nonbinding and preserves PR-stage review policy', () => {
    const output = execFileSync('bash', ['tests/jev-routing-prompt.test.sh'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(output).toContain('Evaluation routing hints stay advisory');
    expect(output).toContain('Likely task type: documentation');
    expect(output).toContain('Suggested validation focus: docs_checks');
    expect(output).toContain('explicit validation commands, allowlists, and repository instructions take precedence');
    expect(output).toContain('Do not skip required validation or request human input');
    expect(output).toContain('agent-review.md');
    expect(output).toContain('reviewer-facing PR description');
  });
});
