import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..');

describe('shell entrypoint parseability', () => {
  it('parses kaseki-agent.sh without executing it', () => {
    execFileSync('bash', ['-n', join(repoRoot, 'kaseki-agent.sh')]);
  });
});
