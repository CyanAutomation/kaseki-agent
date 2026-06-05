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

  test('image keeps the packaged entrypoint and default agent command', () => {
    const dockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf-8');

    expect(dockerfile).toContain('ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/kaseki-entrypoint"]');
    expect(dockerfile).toContain('CMD ["agent"]');
  });

  describe('docker-entrypoint command dispatch', () => {
    const entrypointScript = path.join(repoRoot, 'scripts/docker-entrypoint.sh');

    const withTempRoot = (name: string, callback: (tempRoot: string) => void): void => {
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), name));

      try {
        callback(tempRoot);
      } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    };

    const writeCaptureStub = (stubPath: string, capturePath: string): void => {
      fs.mkdirSync(path.dirname(stubPath), { recursive: true });
      fs.writeFileSync(
        stubPath,
        `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$0" "$@" > ${JSON.stringify(capturePath)}
exit "${'${KASEKI_ENTRYPOINT_STUB_EXIT:-0}'}"
`,
      );
      fs.chmodSync(stubPath, 0o755);
    };

    const readCapturedArgs = (capturePath: string): string[] =>
      fs.readFileSync(capturePath, 'utf-8').split('\n').filter(Boolean);

    const runEntrypoint = (args: string[], tempRoot: string) =>
      spawnSync('bash', [entrypointScript, ...args], {
        encoding: 'utf-8',
        env: {
          PATH: `${path.join(tempRoot, 'bin')}:${process.env.PATH ?? ''}`,
          KASEKI_SKIP_STARTUP_CHECKS: '1',
        },
      });

    const withAgentStub = (capturePath: string, callback: () => void): void => {
      const agentPath = '/usr/local/bin/kaseki-agent';
      const backupPath = `${agentPath}.kaseki-test-backup-${process.pid}`;
      const hadExistingAgent = fs.existsSync(agentPath);

      if (hadExistingAgent) {
        fs.renameSync(agentPath, backupPath);
      }

      try {
        writeCaptureStub(agentPath, capturePath);
        callback();
      } finally {
        fs.rmSync(agentPath, { force: true });
        if (hadExistingAgent) {
          fs.renameSync(backupPath, agentPath);
        }
      }
    };

    test.each(['api', 'kaseki-api'])('%s dispatches to the API service', (command) => {
      withTempRoot('kaseki-entrypoint-api-', (tempRoot) => {
        const capturePath = path.join(tempRoot, 'api-command.args');
        writeCaptureStub(path.join(tempRoot, 'bin', 'node'), capturePath);

        const result = runEntrypoint([command, '--port', '9000'], tempRoot);

        expect(result.status).toBe(0);
        expect(result.signal).toBeNull();
        expect(readCapturedArgs(capturePath)).toEqual([
          path.join(tempRoot, 'bin', 'node'),
          '/app/dist/kaseki-api-service.js',
          '--port',
          '9000',
        ]);
      });
    });

    test('agent dispatches to the default agent workflow', () => {
      withTempRoot('kaseki-entrypoint-agent-', (tempRoot) => {
        const capturePath = path.join(tempRoot, 'agent-command.args');

        withAgentStub(capturePath, () => {
          const result = runEntrypoint(['agent', 'https://example.test/repo.git', 'main'], tempRoot);

          expect(result.status).toBe(0);
          expect(result.signal).toBeNull();
          expect(readCapturedArgs(capturePath)).toEqual([
            '/usr/local/bin/kaseki-agent',
            'https://example.test/repo.git',
            'main',
          ]);
        });
      });
    });

    test('an explicit command is executed unchanged', () => {
      withTempRoot('kaseki-entrypoint-explicit-', (tempRoot) => {
        const capturePath = path.join(tempRoot, 'explicit-command.args');
        const explicitCommand = path.join(tempRoot, 'bin', 'explicit-command');
        writeCaptureStub(explicitCommand, capturePath);

        const result = runEntrypoint(['explicit-command', 'one', '--two', 'value with spaces'], tempRoot);

        expect(result.status).toBe(0);
        expect(result.signal).toBeNull();
        expect(readCapturedArgs(capturePath)).toEqual([explicitCommand, 'one', '--two', 'value with spaces']);
      });
    });

    test('exit codes from the dispatched command are propagated', () => {
      withTempRoot('kaseki-entrypoint-exit-', (tempRoot) => {
        const capturePath = path.join(tempRoot, 'exit-command.args');
        writeCaptureStub(path.join(tempRoot, 'bin', 'failing-command'), capturePath);

        const result = spawnSync('bash', [entrypointScript, 'failing-command'], {
          encoding: 'utf-8',
          env: {
            PATH: `${path.join(tempRoot, 'bin')}:${process.env.PATH ?? ''}`,
            KASEKI_SKIP_STARTUP_CHECKS: '1',
            KASEKI_ENTRYPOINT_STUB_EXIT: '42',
          },
        });

        expect(result.status).toBe(42);
        expect(result.signal).toBeNull();
        expect(readCapturedArgs(capturePath)).toEqual([path.join(tempRoot, 'bin', 'failing-command')]);
      });
    });

    test('signals from the dispatched command are propagated', () => {
      withTempRoot('kaseki-entrypoint-signal-', (tempRoot) => {
        const signalCommand = path.join(tempRoot, 'bin', 'signal-command');
        fs.mkdirSync(path.dirname(signalCommand), { recursive: true });
        fs.writeFileSync(
          signalCommand,
          `#!/usr/bin/env bash
set -euo pipefail
kill -TERM "$$"
`,
        );
        fs.chmodSync(signalCommand, 0o755);

        const result = runEntrypoint(['signal-command'], tempRoot);

        expect(result.status).toBeNull();
        expect(result.signal).toBe('SIGTERM');
      });
    });
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
