import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '..');

describe('Docker runtime packaging', () => {
  test('worker allowlist helper resolution uses configured fallback and fails clearly when unavailable', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-helper-resolution-'));

    try {
      const workerDir = path.join(tempRoot, 'worker');
      const fallbackDir = path.join(tempRoot, 'fallback', 'scripts');
      const markerPath = path.join(tempRoot, 'fallback-helper-invoked.txt');
      fs.mkdirSync(workerDir, { recursive: true });
      fs.mkdirSync(fallbackDir, { recursive: true });

      const workerScript = path.join(workerDir, 'kaseki-agent.sh');
      fs.copyFileSync(path.join(repoRoot, 'kaseki-agent.sh'), workerScript);
      fs.chmodSync(workerScript, 0o755);

      const fallbackHelper = path.join(fallbackDir, 'allowlist-helper.sh');
      fs.writeFileSync(
        fallbackHelper,
        `#!/usr/bin/env bash
printf 'fallback helper invoked\n' > "$KASEKI_ALLOWLIST_HELPER_MARKER"
build_allowlist_regex() {
  printf 'fallback-regex:%s\n' "$*"
}
`,
      );
      fs.chmodSync(fallbackHelper, 0o755);

      const success = spawnSync('bash', [workerScript], {
        encoding: 'utf-8',
        env: {
          ...process.env,
          KASEKI_AGENT_HELPER_RESOLUTION_CHECK: '1',
          KASEKI_ALLOWLIST_HELPER_FALLBACK: fallbackHelper,
          KASEKI_ALLOWLIST_HELPER_MARKER: markerPath,
          KASEKI_CHANGED_FILES_ALLOWLIST: 'src/**',
        },
      });

      expect(success.status).toBe(0);
      expect(success.stderr).toBe('');
      expect(success.stdout).toContain(`allowlist_helper=${fallbackHelper}`);
      expect(fs.readFileSync(markerPath, 'utf-8')).toBe('fallback helper invoked\n');

      const missingFallback = path.join(tempRoot, 'missing', 'allowlist-helper.sh');
      const failure = spawnSync('bash', [workerScript], {
        encoding: 'utf-8',
        env: {
          ...process.env,
          KASEKI_AGENT_HELPER_RESOLUTION_CHECK: '1',
          KASEKI_ALLOWLIST_HELPER_FALLBACK: missingFallback,
        },
      });

      expect(failure.status).toBe(66);
      expect(failure.stderr).toBe(
        `ERROR: Allowlist helper is not readable. Expected packaged helper at ${workerDir}/scripts/allowlist-helper.sh or fallback helper at ${missingFallback}. This worker image or mounted template is incomplete; rebuild the image or restore scripts/allowlist-helper.sh.\n`,
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
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

  test('entrypoint startup-check configuration points at the packaged script path', () => {
    const entrypoint = fs.readFileSync(path.join(repoRoot, 'scripts/docker-entrypoint.sh'), 'utf-8');

    expect(entrypoint).toContain('KASEKI_SKIP_STARTUP_CHECKS:-0');
    expect(entrypoint).toContain('/scripts/startup-checks.sh "${KASEKI_STARTUP_CHECK_MODE:-all}"');
    expect(entrypoint).toContain('Startup checks failed: blocking startup issue detected');
  });

  test('entrypoint exports shared path defaults before command dispatch', () => {
    const entrypoint = fs.readFileSync(path.join(repoRoot, 'scripts/docker-entrypoint.sh'), 'utf-8');
    const resultsDefaultIndex = entrypoint.indexOf('export KASEKI_RESULTS_DIR="${KASEKI_RESULTS_DIR:-/results}"');
    const workspaceDefaultIndex = entrypoint.indexOf('export KASEKI_WORKSPACE_DIR="${KASEKI_WORKSPACE_DIR:-/workspace}"');
    const baselineDefaultIndex = entrypoint.indexOf('export KASEKI_WORKSPACE_BASELINE_DIR="${KASEKI_WORKSPACE_BASELINE_DIR:-${KASEKI_WORKSPACE_DIR}/baseline}"');
    const caseIndex = entrypoint.indexOf('case "${1:-agent}" in');
    const runModeIndex = entrypoint.indexOf('run-mode)');

    expect(resultsDefaultIndex).toBeGreaterThanOrEqual(0);
    expect(workspaceDefaultIndex).toBeGreaterThanOrEqual(0);
    expect(baselineDefaultIndex).toBeGreaterThanOrEqual(0);
    expect(resultsDefaultIndex).toBeLessThan(caseIndex);
    expect(workspaceDefaultIndex).toBeLessThan(caseIndex);
    expect(baselineDefaultIndex).toBeLessThan(caseIndex);
    expect(entrypoint.indexOf('export KASEKI_RESULTS_DIR="${KASEKI_RESULTS_DIR:-/results}"', runModeIndex)).toBe(-1);
  });

  test('default agent branch inherits path defaults when KASEKI_RESULTS_DIR is unset', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-entrypoint-agent-defaults-'));

    try {
      const startupChecks = path.join(tempRoot, 'startup-checks.sh');
      const agentStub = path.join(tempRoot, 'kaseki-agent');
      const entrypointScript = path.join(tempRoot, 'docker-entrypoint.sh');
      const agentEnvPath = path.join(tempRoot, 'agent-env.txt');

      fs.writeFileSync(
        startupChecks,
        `#!/usr/bin/env bash
set -euo pipefail
exit 0
`,
      );
      fs.chmodSync(startupChecks, 0o755);

      fs.writeFileSync(
        agentStub,
        `#!/usr/bin/env bash
set -euo pipefail
printf 'results=%s\nworkspace=%s\nbaseline=%s\n' "$KASEKI_RESULTS_DIR" "$KASEKI_WORKSPACE_DIR" "$KASEKI_WORKSPACE_BASELINE_DIR" > "$KASEKI_ENTRYPOINT_AGENT_ENV"
printf 'Missing OpenRouter API key: deliberate startup configuration error\n' >&2
exit 2
`,
      );
      fs.chmodSync(agentStub, 0o755);

      const entrypoint = fs
        .readFileSync(path.join(repoRoot, 'scripts/docker-entrypoint.sh'), 'utf-8')
        .replace('/scripts/startup-checks.sh', startupChecks)
        .replaceAll('/usr/local/bin/kaseki-agent', agentStub);
      fs.writeFileSync(entrypointScript, entrypoint);
      fs.chmodSync(entrypointScript, 0o755);

      const result = spawnSync('bash', [entrypointScript], {
        encoding: 'utf-8',
        env: {
          ...process.env,
          KASEKI_ENTRYPOINT_AGENT_ENV: agentEnvPath,
          KASEKI_RESULTS_DIR: undefined,
        },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('deliberate startup configuration error');
      expect(result.stderr).not.toContain('unbound variable');
      expect(fs.readFileSync(agentEnvPath, 'utf-8')).toBe(
        'results=/results\nworkspace=/workspace\nbaseline=/workspace/baseline\n',
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('startup-check script preserves container defaults and supported modes', () => {
    const startupChecks = fs.readFileSync(path.join(repoRoot, 'scripts/startup-checks.sh'), 'utf-8');

    expect(startupChecks).toContain('KASEKI_RESULTS_DIR="${KASEKI_RESULTS_DIR:-$KASEKI_ROOT/kaseki-results}"');
    expect(startupChecks).toContain('KASEKI_RUNS_DIR="${KASEKI_RUNS_DIR:-$KASEKI_ROOT/kaseki-runs}"');
    expect(startupChecks).toContain('quick|boot)');
    expect(startupChecks).toContain('baseline-validation)');
  });

  test('compose mounts the configured secret directory read-only', () => {
    const compose = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf-8');

    expect(compose).toContain('KASEKI_SECRETS_DIR: "${KASEKI_SECRETS_DIR:-/run/secrets/kaseki}"');
    expect(compose).toContain('${KASEKI_HOST_SECRETS_DIR:-/home/pi/secrets}:/run/secrets/kaseki:ro');
  });

  test('compose health check reaches the readiness endpoint', () => {
    const compose = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf-8');

    expect(compose).toContain("fetch('http://127.0.0.1:8080/ready')");
    expect(compose).toContain("process.exit(d.status==='ready'?0:1)");
  });

  test('template deployment preserves the configured image ref and records digest separately', () => {
    const deployScript = fs.readFileSync(path.join(repoRoot, 'scripts/deploy-pi-template.sh'), 'utf-8');

    expect(deployScript).toContain('REQUESTED_IMAGE="${KASEKI_IMAGE:-docker.io/cyanautomation/kaseki-agent:latest}"');
    expect(deployScript).toContain('printf \'%s\\n\' "$configured_image" > "$target/.kaseki-image"');
    expect(deployScript).toContain('docker image inspect "$deployed_image" --format');
    expect(deployScript).not.toContain('IMAGE="$resolved_digest"');
  });
});
