import { execFileSync } from 'node:child_process';

describe('JEV advisory prompt integration', () => {
  test('keeps admission hints nonbinding and preserves PR-stage review policy', () => {
    const output = execFileSync('bash', ['tests/jev-routing-prompt.test.sh'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(output).toContain('JEV routing prompt stays advisory');
  });
});
