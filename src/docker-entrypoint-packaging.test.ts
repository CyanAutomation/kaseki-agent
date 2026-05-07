import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '..');

describe('Docker runtime packaging', () => {
  test('worker can resolve allowlist helper from the /app fallback path', () => {
    const script = fs.readFileSync(path.join(repoRoot, 'kaseki-agent.sh'), 'utf-8');
    expect(script).toContain('ALLOWLIST_HELPER="$SCRIPT_DIR/scripts/allowlist-helper.sh"');
    expect(script).toContain('[ -r /app/scripts/allowlist-helper.sh ]');
    expect(script).toContain('ALLOWLIST_HELPER="/app/scripts/allowlist-helper.sh"');
  });

  test('image entrypoint dispatches api and explicit commands without replacing entrypoint', () => {
    const dockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf-8');
    const entrypoint = fs.readFileSync(path.join(repoRoot, 'scripts/docker-entrypoint.sh'), 'utf-8');

    expect(dockerfile).toContain('ENTRYPOINT ["/usr/local/bin/kaseki-entrypoint"]');
    expect(dockerfile).toContain('CMD ["agent"]');
    expect(entrypoint).toContain('api|kaseki-api)');
    expect(entrypoint).toContain('exec node /app/dist/kaseki-api-service.js');
    expect(entrypoint).toContain('exec "$@"');
  });

  test('template deployment preserves the configured image ref and records digest separately', () => {
    const deployScript = fs.readFileSync(path.join(repoRoot, 'scripts/deploy-pi-template.sh'), 'utf-8');

    expect(deployScript).toContain('REQUESTED_IMAGE="${KASEKI_IMAGE:-docker.io/cyanautomation/kaseki-agent:latest}"');
    expect(deployScript).toContain('printf \'%s\\n\' "$configured_image" > "$target/.kaseki-image"');
    expect(deployScript).toContain('docker image inspect "$deployed_image" --format');
    expect(deployScript).not.toContain('IMAGE="$resolved_digest"');
  });
});
