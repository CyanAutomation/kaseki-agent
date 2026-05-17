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

    expect(dockerfile).toContain('ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/kaseki-entrypoint"]');
    expect(dockerfile).toContain('CMD ["agent"]');
    expect(entrypoint).toContain('api|kaseki-api)');
    expect(entrypoint).toContain('exec node /app/dist/kaseki-api-service.js');
    expect(entrypoint).toContain('exec "$@"');
  });

  test('final image exposes startup checks at the path used by the entrypoint', () => {
    const dockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf-8');
    const entrypoint = fs.readFileSync(path.join(repoRoot, 'scripts/docker-entrypoint.sh'), 'utf-8');
    const startupChecks = fs.readFileSync(path.join(repoRoot, 'scripts/startup-checks.sh'), 'utf-8');
    const compose = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf-8');

    expect(entrypoint).toContain('/scripts/startup-checks.sh');
    expect(dockerfile).toContain('ln -sf /app/scripts/startup-checks.sh /scripts/startup-checks.sh');
    expect(dockerfile).toContain('ln -sf /app/scripts/startup-checks.sh /scripts/kaseki-init-container.sh');
    expect(startupChecks).toContain('KASEKI_RESULTS_DIR="${KASEKI_RESULTS_DIR:-$KASEKI_ROOT/kaseki-results}"');
    expect(startupChecks).toContain('KASEKI_RUNS_DIR="${KASEKI_RUNS_DIR:-$KASEKI_ROOT/kaseki-runs}"');
    expect(startupChecks).toContain('quick|boot)');
    expect(startupChecks).toContain('baseline-validation)');
    expect(compose).toContain('KASEKI_SECRETS_DIR: "${KASEKI_SECRETS_DIR:-/agents/secrets}"');
    expect(compose).toContain(':/agents/secrets:ro'); // Supports both hardcoded and variable-substituted paths
    expect(compose).toContain("fetch('http://127.0.0.1:8080/ready')");
  });

  test('template deployment preserves the configured image ref and records digest separately', () => {
    const deployScript = fs.readFileSync(path.join(repoRoot, 'scripts/deploy-pi-template.sh'), 'utf-8');

    expect(deployScript).toContain('REQUESTED_IMAGE="${KASEKI_IMAGE:-docker.io/cyanautomation/kaseki-agent:latest}"');
    expect(deployScript).toContain('printf \'%s\\n\' "$configured_image" > "$target/.kaseki-image"');
    expect(deployScript).toContain('docker image inspect "$deployed_image" --format');
    expect(deployScript).not.toContain('IMAGE="$resolved_digest"');
  });
});
