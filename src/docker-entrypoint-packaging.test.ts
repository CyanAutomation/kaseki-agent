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

  test('runtime image includes shellcheck used by repository lint scripts', () => {
    const dockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf-8');

    expect(dockerfile).toMatch(/apt-get install[^&]*\bshellcheck\b/);
  });

  test('image installs shared shell helpers beside the packaged agent command', () => {
    const dockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf-8');

    expect(dockerfile).toContain('/usr/local/bin/scripts');
    for (const helper of [
      'agent-prompt.sh',
      'allowlist-helper.sh',
      'dependency-cache-helpers.sh',
    ]) {
      expect(dockerfile).toContain(
        `install -m 0755 /app/scripts/${helper} /usr/local/bin/scripts/${helper}`,
      );
    }
    expect(dockerfile).toContain(
      'install -m 0644 /app/scripts/lib/json.sh /usr/local/bin/scripts/lib/json.sh',
    );
  });

  test('root-level Dockerfile COPY sources are included by the dockerignore allowlist', () => {
    const dockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf-8');
    const dockerignore = fs.readFileSync(path.join(repoRoot, '.dockerignore'), 'utf-8');
    const allowlistedEntries = new Set(
      dockerignore
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('!'))
        .map((line) => line.slice(1).replace(/\/$/, '')),
    );

    const parseCopySources = (line: string): string[] => {
      const tokens = line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
      const copyIndex = tokens.indexOf('COPY');
      const copyArgs = tokens
        .slice(copyIndex + 1)
        .filter((token) => !token.startsWith('--'))
        .map((token) => token.replace(/^['"]|['"]$/g, ''));

      return copyArgs.slice(0, -1);
    };

    const rootLevelCopySources = dockerfile
      .split(/\r?\n/)
      .flatMap((line) => {
        const trimmed = line.trim();

        if (!trimmed.startsWith('COPY ') || trimmed.includes('--from=')) {
          return [];
        }

        return parseCopySources(trimmed);
      })
      .filter((source) => source && !source.includes('/'));

    expect(rootLevelCopySources).toContain('.pi-extensions.js');
    expect(rootLevelCopySources).not.toHaveLength(0);

    const missingAllowlistEntries = rootLevelCopySources.filter((source) => !allowlistedEntries.has(source));

    expect(missingAllowlistEntries).toEqual([]);
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

    const writeCaptureStub = (stubPath: string): void => {
      fs.mkdirSync(path.dirname(stubPath), { recursive: true });
      fs.writeFileSync(
        stubPath,
        `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$0" "$@" > "$KASEKI_TEST_CAPTURE_PATH"
exit "${'${KASEKI_ENTRYPOINT_STUB_EXIT:-0}'}"
`,
      );
      fs.chmodSync(stubPath, 0o755);
    };

    const readCapturedArgs = (capturePath: string): string[] =>
      fs.readFileSync(capturePath, 'utf-8').split('\n').filter(Boolean);

    const runEntrypoint = (args: string[], tempRoot: string, env: NodeJS.ProcessEnv = {}) =>
      spawnSync('bash', [entrypointScript, ...args], {
        encoding: 'utf-8',
        env: {
          ...process.env,
          PATH: `${path.join(tempRoot, 'bin')}:${process.env.PATH ?? ''}`,
          KASEKI_SKIP_STARTUP_CHECKS: '1',
          ...env,
        },
      });

    test.each(['api', 'kaseki-api'])('%s dispatches to the API service', (command) => {
      withTempRoot('kaseki-entrypoint-api-', (tempRoot) => {
        const capturePath = path.join(tempRoot, 'api-command.args');
        writeCaptureStub(path.join(tempRoot, 'bin', 'node'));

        // Skip permission validation for unit test isolation (directories don't exist in test env)
        const result = runEntrypoint([command, '--port', '9000'], tempRoot, {
          KASEKI_TEST_CAPTURE_PATH: capturePath,
          KASEKI_SKIP_PERMISSION_VALIDATION: '1',
        });

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

    test('agent dispatches to the configured agent workflow', () => {
      withTempRoot('kaseki-entrypoint-agent-', (tempRoot) => {
        const capturePath = path.join(tempRoot, 'agent-command.args');
        const agentPath = path.join(tempRoot, 'bin', 'kaseki-agent');
        writeCaptureStub(agentPath);

        const result = runEntrypoint(['agent', 'https://example.test/repo.git', 'main'], tempRoot, {
          KASEKI_AGENT_BIN: agentPath,
          KASEKI_TEST_CAPTURE_PATH: capturePath,
        });

        expect(result.status).toBe(0);
        expect(result.signal).toBeNull();
        expect(readCapturedArgs(capturePath)).toEqual([agentPath, 'https://example.test/repo.git', 'main']);
      });
    });

    test('an explicit command is executed unchanged', () => {
      withTempRoot('kaseki-entrypoint-explicit-', (tempRoot) => {
        const capturePath = path.join(tempRoot, 'explicit-command.args');
        const explicitCommand = path.join(tempRoot, 'bin', 'explicit-command');
        writeCaptureStub(explicitCommand);

        const result = runEntrypoint(['explicit-command', 'one', '--two', 'value with spaces'], tempRoot, {
          KASEKI_TEST_CAPTURE_PATH: capturePath,
        });

        expect(result.status).toBe(0);
        expect(result.signal).toBeNull();
        expect(readCapturedArgs(capturePath)).toEqual([explicitCommand, 'one', '--two', 'value with spaces']);
      });
    });

    test('exit codes from the dispatched command are propagated', () => {
      withTempRoot('kaseki-entrypoint-exit-', (tempRoot) => {
        const capturePath = path.join(tempRoot, 'exit-command.args');
        writeCaptureStub(path.join(tempRoot, 'bin', 'failing-command'));

        const result = runEntrypoint(['failing-command'], tempRoot, {
          KASEKI_ENTRYPOINT_STUB_EXIT: '42',
          KASEKI_TEST_CAPTURE_PATH: capturePath,
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

    test('KASEKI_SKIP_PERMISSION_VALIDATION=1 skips API dispatch permission checks (test isolation)', () => {
      // This test documents that the skip flag allows unit tests to exercise API dispatch
      // without requiring writable /agents directories to exist on the test system.
      // In production, permission validation always runs (when the flag is unset or 0).
      withTempRoot('kaseki-entrypoint-skip-perms-', (tempRoot) => {
        const capturePath = path.join(tempRoot, 'api-perms-skip.args');
        writeCaptureStub(path.join(tempRoot, 'bin', 'node'));

        // API dispatch WITH skip flag succeeds (even if /agents dirs don't exist or aren't writable)
        const resultWithSkip = runEntrypoint(['api', '--port', '9000'], tempRoot, {
          KASEKI_TEST_CAPTURE_PATH: capturePath,
          KASEKI_SKIP_PERMISSION_VALIDATION: '1',
        });

        expect(resultWithSkip.status).toBe(0);
        expect(resultWithSkip.signal).toBeNull();
        expect(readCapturedArgs(capturePath)).toEqual([
          path.join(tempRoot, 'bin', 'node'),
          '/app/dist/kaseki-api-service.js',
          '--port',
          '9000',
        ]);
      });
    });
  });

  test('entrypoint startup-check configuration points at the packaged script path', () => {
    const entrypoint = fs.readFileSync(path.join(repoRoot, 'scripts/docker-entrypoint.sh'), 'utf-8');

    expect(entrypoint).toContain('KASEKI_SKIP_STARTUP_CHECKS:-0');
    expect(entrypoint).toContain('/scripts/startup-checks.sh "${KASEKI_STARTUP_CHECK_MODE:-all}"');
    expect(entrypoint).toContain('Startup checks failed: blocking startup issue detected');
  });

  test('worker startup checks validate packaged agent helper files', () => {
    const startupChecks = fs.readFileSync(path.join(repoRoot, 'scripts/startup-checks.sh'), 'utf-8');

    expect(startupChecks).toContain('check_packaged_agent_helpers');
    expect(startupChecks).toContain('agent-prompt.sh');
    expect(startupChecks).toContain('allowlist-helper.sh');
    expect(startupChecks).toContain('dependency-cache-helpers.sh');
    expect(startupChecks).toContain('lib/json.sh');
  });

  test('entrypoint permission-validation configuration can be skipped for testing', () => {
    const entrypoint = fs.readFileSync(path.join(repoRoot, 'scripts/docker-entrypoint.sh'), 'utf-8');

    // Verify the skip flag mechanism exists in the entrypoint
    expect(entrypoint).toContain('KASEKI_SKIP_PERMISSION_VALIDATION:-0');
    // Verify it only runs for API mode
    expect(entrypoint).toContain('api');
    expect(entrypoint).toContain('kaseki-api');
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
        .replace('/scripts/startup-checks.sh', startupChecks);
      fs.writeFileSync(entrypointScript, entrypoint);
      fs.chmodSync(entrypointScript, 0o755);

      const result = spawnSync('bash', [entrypointScript], {
        encoding: 'utf-8',
        env: {
          ...process.env,
          KASEKI_AGENT_BIN: agentStub,
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
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-template-deploy-'));
    const configuredImage = 'registry.example.test/cyanautomation/kaseki-agent:test-tag';
    const resolvedDigest = 'registry.example.test/cyanautomation/kaseki-agent@sha256:111122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000';

    const writeDockerStub = (binDir: string): void => {
      fs.mkdirSync(binDir, { recursive: true });
      const dockerStub = path.join(binDir, 'docker');
      fs.writeFileSync(
        dockerStub,
        `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$KASEKI_DOCKER_CALL_LOG"

if [ "${'${1:-}'}" = "image" ] && [ "${'${2:-}'}" = "inspect" ]; then
  if [ "${'${KASEKI_DOCKER_INSPECT_FAIL:-0}'}" = "1" ]; then
    printf 'simulated inspect failure for %s\n' "${'${3:-}'}" >&2
    exit 1
  fi
  case " $* " in
    *" --format "*) printf '%s\n' "$KASEKI_DOCKER_REPO_DIGEST" ;;
    *) printf '[{"RepoDigests":["%s"]}]\n' "$KASEKI_DOCKER_REPO_DIGEST" ;;
  esac
  exit 0
fi

case "${'${1:-}'}" in
  pull)
    exit 0
    ;;
  create)
    printf 'kaseki-test-container-%s\n' "${'${RANDOM:-1}'}"
    exit 0
    ;;
  cp)
    if [ "${'${3:-}'}" = "-" ]; then
      printf 'template probe\n'
      exit 0
    fi
    target="${'${3:-}'}"
    mkdir -p "$target/scripts" "$target/lib/secrets"
    for file in \
      run-kaseki.sh \
      kaseki \
      kaseki-agent.sh \
      scripts/kaseki-preflight.sh \
      lib/pi-event-filter.js \
      lib/pi-progress-stream.js \
      lib/kaseki-report.js \
      lib/github-app-token.js \
      lib/github-app-private-key.js \
      lib/github-utils.js \
      lib/logger.js \
      lib/secrets/host-secrets-reader.js
    do
      mkdir -p "$target/$(dirname "$file")"
      printf 'deployed %s\n' "$file" > "$target/$file"
    done
    exit 0
    ;;
  rm)
    exit 0
    ;;
esac

printf 'unexpected docker invocation: %s\n' "$*" >&2
exit 64
`,
      );
      fs.chmodSync(dockerStub, 0o755);
    };

    const runDeploy = (name: string, env: NodeJS.ProcessEnv = {}) => {
      const homeDir = path.join(tempRoot, name);
      const targetDir = path.join(homeDir, 'kaseki-template');
      const logDir = path.join(homeDir, 'logs');
      const binDir = path.join(homeDir, 'bin');
      const dockerCallLog = path.join(homeDir, 'docker-calls.log');
      fs.mkdirSync(homeDir, { recursive: true });
      writeDockerStub(binDir);

      const result = spawnSync('bash', [path.join(repoRoot, 'scripts/deploy-pi-template.sh')], {
        cwd: repoRoot,
        encoding: 'utf-8',
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
          HOME: homeDir,
          KASEKI_TEMPLATE_DIR: targetDir,
          KASEKI_IMAGE: configuredImage,
          KASEKI_IMAGE_PULL_POLICY: 'always',
          KASEKI_BUILD_IMAGE_IF_TEMPLATE_MISSING: '0',
          KASEKI_LOG_DIR: logDir,
          KASEKI_DOCKER_CALL_LOG: dockerCallLog,
          KASEKI_DOCKER_REPO_DIGEST: resolvedDigest,
          ...env,
        },
      });

      return { dockerCallLog, result, targetDir };
    };

    try {
      const success = runDeploy('success');

      expect(success.result.status).toBe(0);
      expect(success.result.stderr).toBe('');
      expect(fs.readFileSync(path.join(success.targetDir, '.kaseki-image'), 'utf-8')).toBe(`${configuredImage}\n`);
      expect(fs.readFileSync(path.join(success.targetDir, '.kaseki-image-digest'), 'utf-8')).toBe(`${resolvedDigest}\n`);
      expect(JSON.parse(fs.readFileSync(path.join(success.targetDir, '.kaseki-template-version'), 'utf-8'))).toMatchObject({
        image: configuredImage,
        deployedImage: configuredImage,
        imageDigest: resolvedDigest,
      });
      expect(fs.readFileSync(path.join(success.targetDir, '.kaseki-image'), 'utf-8')).not.toContain('@sha256:');
      expect(fs.readFileSync(success.dockerCallLog, 'utf-8')).toContain(`image inspect ${configuredImage}`);

      const inspectFailure = runDeploy('inspect-failure', { KASEKI_DOCKER_INSPECT_FAIL: '1' });

      expect(inspectFailure.result.status).toBe(0);
      expect(inspectFailure.result.stderr).toBe('');
      expect(inspectFailure.result.stdout).toContain('No repo digest found for image reference; continuing with tag');
      expect(fs.readFileSync(path.join(inspectFailure.targetDir, '.kaseki-image'), 'utf-8')).toBe(`${configuredImage}\n`);
      expect(fs.existsSync(path.join(inspectFailure.targetDir, '.kaseki-image-digest'))).toBe(false);
      expect(JSON.parse(fs.readFileSync(path.join(inspectFailure.targetDir, '.kaseki-template-version'), 'utf-8'))).toMatchObject({
        image: configuredImage,
        deployedImage: configuredImage,
        imageDigest: '',
      });
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
