import { execFileSync } from 'node:child_process';

describe('evaluation routing prompt integration', () => {
  test('keeps admission hints nonbinding and preserves PR-stage review policy', () => {
    const output = execFileSync('bash', ['tests/jev-routing-prompt.test.sh'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(output).toContain('Evaluation routing hints stay advisory');
  });
});
