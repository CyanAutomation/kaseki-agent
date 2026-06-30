import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..');

describe('worker storage layout', () => {
  const agentScript = readFileSync(join(repoRoot, 'kaseki-agent.sh'), 'utf8');
  const launcherScript = readFileSync(join(repoRoot, 'run-kaseki.sh'), 'utf8');

  it('keeps the coding raw event stream off the bounded /tmp tmpfs', () => {
    expect(agentScript).toContain(
      'RAW_EVENTS="${KASEKI_RESULTS_DIR}/pi-events.raw.jsonl"',
    );
    expect(agentScript).not.toContain('RAW_EVENTS="/tmp/pi-events.raw.jsonl"');
  });

  it('places high-volume npm and Pi state on the persistent cache mount', () => {
    expect(launcherScript).toContain('-e NPM_CONFIG_CACHE="/cache/npm-cache"');
    expect(launcherScript).toContain('-e PI_CODING_AGENT_DIR="/cache/pi-agent"');
    expect(launcherScript).toContain('-v "$CACHE:/cache:rw"');
  });
});
