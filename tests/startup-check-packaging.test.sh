#!/usr/bin/env bash
# shellcheck disable=SC2031
# Note: Variables modified across subshells and sourced scopes; this is intentional
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CONFIG="$ROOT_DIR/scripts/startup-check-packaging.sh"
ENTRYPOINT="$ROOT_DIR/scripts/docker-entrypoint.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

assert_file_contains() {
  local file="$1"
  local pattern="$2"
  local message="$3"

  if ! grep -Eq "$pattern" "$file"; then
    printf '%s\n' "$message" >&2
    exit 1
  fi
}

assert_file_match_count() {
  local file="$1"
  local pattern="$2"
  local expected_count="$3"
  local message="$4"
  local actual_count

  actual_count="$(grep -Ec "$pattern" "$file")"
  if [ "$actual_count" != "$expected_count" ]; then
    printf '%s (expected %s, found %s)\n' "$message" "$expected_count" "$actual_count" >&2
    exit 1
  fi
}

assert_json_array_contains() {
  local file="$1"
  local expression="$2"
  local message="$3"

  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const [file, expression] = process.argv.slice(1);
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(pkg.files) || !pkg.files.includes(expression)) {
      process.exit(1);
    }
  ' "$file" "$expression" || {
    printf '%s\n' "$message" >&2
    exit 1
  }
}

assert_dist_entry_point_smokes() {
  for entry_point in pi-event-filter.js job-scheduler.js kaseki-api-routes.js; do
    if [ ! -f "$ROOT_DIR/dist/$entry_point" ]; then
      printf 'FAIL: missing compiled entry point dist/%s; run npm run build before this post-build packaging contract\n' "$entry_point" >&2
      exit 1
    fi
  done

  node --input-type=module - \
    "$ROOT_DIR/dist/pi-event-filter.js" \
    "$ROOT_DIR/dist/job-scheduler.js" \
    "$ROOT_DIR/dist/kaseki-api-routes.js" \
    "$ROOT_DIR/dist/test-utils.js" \
    "$ROOT_DIR/dist/idempotency-store.js" \
    "$ROOT_DIR/dist/pre-flight-validator.js" <<'EOF_NODE'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { pathToFileURL } from 'node:url';

const [filterPath, schedulerPath, routesPath, testUtilsPath, idempotencyStorePath, preFlightValidatorPath] = process.argv.slice(2);

const filterModule = await import(pathToFileURL(filterPath));
const schedulerModule = await import(pathToFileURL(schedulerPath));
const routesModule = await import(pathToFileURL(routesPath));
const testUtilsModule = await import(pathToFileURL(testUtilsPath));
const idempotencyStoreModule = await import(pathToFileURL(idempotencyStorePath));
const preFlightValidatorModule = await import(pathToFileURL(preFlightValidatorPath));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-packaging-entrypoints-'));

try {
  const inputPath = path.join(tmpDir, 'events.raw.jsonl');
  const filteredPath = path.join(tmpDir, 'events.jsonl');
  const summaryPath = path.join(tmpDir, 'summary.json');
  fs.writeFileSync(inputPath, [
    JSON.stringify({
      type: 'tool_execution_start',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: { model: 'packaging-model', api: 'packaging-api' },
      assistantMessageEvent: { type: 'thinking_delta' },
    }),
    JSON.stringify({
      type: 'tool_execution_end',
      timestamp: '2026-01-01T00:00:01.000Z',
      message: {
        model: 'packaging-model',
        api: 'packaging-api',
        content: [
          { type: 'thinking', text: 'hidden' },
          { type: 'output_text', text: 'visible' },
        ],
      },
      assistantMessageEvent: {
        type: 'output_delta',
        partial: { content: [{ type: 'thinking', text: 'hidden' }, { type: 'output_text', text: 'kept' }] },
      },
    }),
  ].join('\n') + '\n');

  await filterModule.runPiEventFilter(inputPath, filteredPath, summaryPath);
  const kept = JSON.parse(fs.readFileSync(filteredPath, 'utf8').split('\n').filter(Boolean)[0]);
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  assert.deepEqual(kept.message.content, [{ type: 'output_text', text: 'visible' }]);
  assert.deepEqual(kept.assistantMessageEvent.partial.content, [{ type: 'output_text', text: 'kept' }]);
  assert.equal(summary.selected_model, 'packaging-model');
  assert.equal(summary.selected_api, 'packaging-api');

  const schedulerResultsDir = path.join(tmpDir, 'scheduler-results');
  const scheduler = new schedulerModule.JobScheduler(
    { ...testUtilsModule.createTestConfig(schedulerResultsDir), maxConcurrentRuns: 0 },
    { enqueueWebhook() {} },
  );
  try {
    const job = await scheduler.submitJob({ repoUrl: 'https://github.com/example/repo', ref: 'main', task: 'packaging smoke' });
    assert.equal(job.status, 'queued');
    assert.equal(scheduler.getJob(job.id)?.status, 'queued');
  } finally {
    await scheduler.shutdown();
  }

  const apiResultsDir = path.join(tmpDir, 'api-results');
  const config = { ...testUtilsModule.createTestConfig(apiResultsDir), apiKeys: ['secret'] };
  const router = routesModule.createApiRouter(
    {},
    config,
    new idempotencyStoreModule.IdempotencyStore(apiResultsDir, 24),
    new preFlightValidatorModule.PreFlightValidator(),
  );
  const app = express();
  app.use('/api', router);
  assert.ok(app._router ?? app.router);
  assert.deepEqual(
    routesModule.classifyDockerFailure('Cannot connect to the Docker daemon at unix:///var/run/docker.sock'),
    {
      detail: 'Docker daemon is unreachable from the API process.',
      remediation: 'Mount /var/run/docker.sock and verify the host Docker daemon is running.',
    },
  );
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
EOF_NODE
}


print_section() {
  printf '\n## %s\n' "$1"
}

assert_dockerfile_copies_to_build_context() {
  local source_path="$1"
  local destination_path="$2"
  local message="$3"

  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const [sourcePath, destinationPath] = process.argv.slice(1);
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const copyInstructions = dockerfile
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("COPY "));

    const matches = copyInstructions.some((line) => {
      const parts = line.split(/\s+/).slice(1);
      const destination = parts.at(-1);
      const sources = parts.slice(0, -1).filter((part) => !part.startsWith("--"));
      return destination === destinationPath && sources.includes(sourcePath);
    });

    if (!matches) {
      process.exit(1);
    }
  ' "$source_path" "$destination_path" || {
    printf '%s\n' "$message" >&2
    exit 1
  }
}

assert_dockerfile_copy_from_stage() {
  local stage="$1"
  local source_path="$2"
  local destination_path="$3"
  local message="$4"

  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const [stage, sourcePath, destinationPath] = process.argv.slice(1);
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const copyInstructions = dockerfile
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("COPY "));

    const matches = copyInstructions.some((line) => {
      const parts = line.split(/\s+/).slice(1);
      const fromIndex = parts.indexOf(`--from=${stage}`);
      const destination = parts.at(-1);
      const sources = parts.slice(0, -1).filter((part) => !part.startsWith("--"));
      return fromIndex !== -1 && destination === destinationPath && sources.includes(sourcePath);
    });

    if (!matches) {
      process.exit(1);
    }
  ' "$stage" "$source_path" "$destination_path" || {
    printf '%s\n' "$message" >&2
    exit 1
  }
}

assert_dockerfile_installs_executable() {
  local source_path="$1"
  local destination_path="$2"
  local expected_count="$3"
  local message="$4"

  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const [sourcePath, destinationPath, expectedCountText] = process.argv.slice(1);
    const expectedCount = Number(expectedCountText);
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const installPattern = new RegExp(`install\\s+-m\\s+0755\\s+${sourcePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+${destinationPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`, "g");
    const actualCount = [...dockerfile.matchAll(installPattern)].length;
    if (actualCount !== expectedCount) {
      console.error(`expected ${expectedCount}, found ${actualCount}`);
      process.exit(1);
    }
  ' "$source_path" "$destination_path" "$expected_count" || {
    printf '%s\n' "$message" >&2
    exit 1
  }
}

assert_dockerfile_preserves_runtime_file() {
  local source_path="$1"
  local app_lib_path="$2"
  local installed_path="$3"
  local message="$4"

  assert_file_contains Dockerfile "cp([[:space:]]+-r)?[[:space:]]+${source_path//./\.}[[:space:]]+${app_lib_path//./\.}" "$message"
  assert_dockerfile_installs_executable "$app_lib_path" "$installed_path" 2 "$message"
}

check_startup_check_symlink_contracts() {
  print_section 'Startup-check symlink behavior'

  APP_DIR="$TMP_DIR/app"
  SCRIPTS_DIR="$TMP_DIR/scripts"
  mkdir -p "$APP_DIR/scripts" "$SCRIPTS_DIR"

  (
    unset KASEKI_STARTUP_CHECK_SOURCE KASEKI_STARTUP_CHECK_PRIMARY_PATH KASEKI_INIT_CONTAINER_PATH KASEKI_STARTUP_CHECK_MODE_DEFAULT
    # shellcheck source=scripts/startup-check-packaging.sh
    . "$CONFIG"
    test "$KASEKI_STARTUP_CHECK_SOURCE" = "/app/scripts/startup-checks.sh"
    test "$KASEKI_STARTUP_CHECK_PRIMARY_PATH" = "/scripts/startup-checks.sh"
    test "$KASEKI_INIT_CONTAINER_PATH" = "/scripts/kaseki-init-container.sh"
    test "$KASEKI_STARTUP_CHECK_MODE_DEFAULT" = "all"
  )

  cat > "$APP_DIR/scripts/startup-checks.sh" <<'FAKE_STARTUP_CHECKS'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$1" > "${STARTUP_CHECK_MODE_CAPTURE:?}"
FAKE_STARTUP_CHECKS
  chmod +x "$APP_DIR/scripts/startup-checks.sh"

  export KASEKI_STARTUP_CHECK_SOURCE="$APP_DIR/scripts/startup-checks.sh"
  export KASEKI_STARTUP_CHECK_PRIMARY_PATH="$SCRIPTS_DIR/startup-checks.sh"
  export KASEKI_INIT_CONTAINER_PATH="$SCRIPTS_DIR/kaseki-init-container.sh"
  export KASEKI_STARTUP_CHECK_MODE_DEFAULT=all
  # shellcheck source=scripts/startup-check-packaging.sh
  . "$CONFIG"

  kaseki_install_startup_check_links

  test "$(readlink -f "$KASEKI_STARTUP_CHECK_PRIMARY_PATH")" = "$APP_DIR/scripts/startup-checks.sh"
  test "$(readlink -f "$KASEKI_INIT_CONTAINER_PATH")" = "$APP_DIR/scripts/startup-checks.sh"

  MODE_CAPTURE="$TMP_DIR/mode.txt"
  STARTUP_CHECK_MODE_CAPTURE="$MODE_CAPTURE" KASEKI_STARTUP_CHECK_MODE=quick kaseki_run_startup_checks
  test "$(cat "$MODE_CAPTURE")" = "quick"

  # Stable public container paths: users and init containers call these documented locations directly.
  assert_file_contains scripts/startup-check-packaging.sh '^: "\$\{KASEKI_STARTUP_CHECK_SOURCE:=/app/scripts/startup-checks\.sh\}"$' \
    'startup-check packaging source path default changed unexpectedly'
  assert_file_contains scripts/startup-check-packaging.sh '^: "\$\{KASEKI_STARTUP_CHECK_PRIMARY_PATH:=/scripts/startup-checks\.sh\}"$' \
    'startup-check primary symlink path default changed unexpectedly'
  assert_file_contains scripts/startup-check-packaging.sh '^: "\$\{KASEKI_INIT_CONTAINER_PATH:=/scripts/kaseki-init-container\.sh\}"$' \
    'init-container symlink path default changed unexpectedly'
  assert_file_contains scripts/startup-check-packaging.sh 'ln -sf "\$KASEKI_STARTUP_CHECK_SOURCE" "\$KASEKI_STARTUP_CHECK_PRIMARY_PATH"' \
    'startup-check packaging no longer links the primary startup-check path'
  assert_file_contains scripts/startup-check-packaging.sh 'ln -sf "\$KASEKI_STARTUP_CHECK_SOURCE" "\$KASEKI_INIT_CONTAINER_PATH"' \
    'startup-check packaging no longer links the init-container path'
  assert_file_contains scripts/docker-entrypoint.sh '^KASEKI_STARTUP_CHECK_PACKAGING_CONFIG="\$\{KASEKI_STARTUP_CHECK_PACKAGING_CONFIG:-/app/scripts/startup-check-packaging\.sh\}"$' \
    'docker entrypoint no longer sources the startup-check packaging config from /app/scripts'
  assert_file_contains scripts/docker-entrypoint.sh '/scripts/startup-checks\.sh "\$\{KASEKI_STARTUP_CHECK_MODE:-all\}"' \
    'docker entrypoint no longer invokes the packaged startup-check symlink with the selected mode'
}

check_dockerfile_packaging_contracts() {
  print_section 'Dockerfile packaging requirements'

  bash -n "$CONFIG" || { printf 'startup-check packaging config has invalid shell syntax\n' >&2; exit 1; }
  bash -n "$ENTRYPOINT" || { printf 'docker entrypoint has invalid shell syntax\n' >&2; exit 1; }

  assert_dockerfile_copies_to_build_context tsconfig.scripts.json ./ \
    'Dockerfile does not copy tsconfig.scripts.json before npm run build'
  assert_dockerfile_copies_to_build_context scripts ./scripts \
    'Dockerfile does not copy scripts into /app for startup-check packaging'
  assert_file_contains Dockerfile '^[[:space:]]+/app/scripts/startup-check-packaging\.sh \\$' \
    'Dockerfile does not mark startup-check-packaging.sh executable'
  assert_file_match_count Dockerfile '^[[:space:]]+&& /app/scripts/startup-check-packaging\.sh install \\$' 2 \
    'Dockerfile must install startup-check symlinks in both runtime and final stages'
  assert_dockerfile_copy_from_stage runtime /app/scripts ./scripts \
    'Dockerfile final stage does not copy packaged scripts from runtime stage'

  # Runtime CLI invoked by kaseki-agent.sh to remove hidden/thinking Pi events from user-visible logs.
  assert_dockerfile_preserves_runtime_file dist/pi-event-filter-helpers.js /app/lib/pi-event-filter-helpers.js /usr/local/bin/pi-event-filter-helpers.js \
    'Dockerfile does not preserve and install the pi-event-filter helper module'
  # Aggregation modules are dynamic runtime imports used by the packaged pi event filter executable.
  assert_file_contains Dockerfile 'cp -r[[:space:]]+dist/pi-event-aggregation[[:space:]]+/app/lib/pi-event-aggregation' \
    'Dockerfile does not preserve pi-event-filter runtime dependencies'
  assert_file_match_count Dockerfile 'cp -r /app/lib/pi-event-aggregation/\* /usr/local/bin/pi-event-aggregation/' 2 \
    'Dockerfile must install pi-event aggregation modules in runtime and final stages'
  assert_file_match_count Dockerfile '/usr/local/bin/kaseki-pi-event-filter "\$empty_events" "\$filtered_events" "\$event_summary"' 2 \
    'Dockerfile must execute the packaged pi-event filter in runtime and final stages'

  # Public container entrypoint: changing this breaks docker run and downstream deployments.
  assert_file_contains Dockerfile '^ENTRYPOINT \["/usr/bin/tini", "--", "/usr/local/bin/kaseki-entrypoint"\]$' \
    'Dockerfile entrypoint does not dispatch through kaseki-entrypoint'

  # Scouting validator is run before agent work and must be present in final stripped images.
  assert_dockerfile_installs_executable /app/dist/scouting-allowlist.js /usr/local/bin/scripts/scouting-allowlist.js 2 \
    'Dockerfile must install the scouting validator at its packaged runtime path in both image stages'
  assert_file_contains kaseki-agent.sh '/app/dist/scouting-allowlist\.js' \
    'runner does not fall back to the built scouting validator in the image'
  assert_file_contains kaseki-agent.sh '/usr/local/bin/scripts/scouting-allowlist\.js' \
    'runner does not recognize the installed scouting validator runtime path'
  assert_file_contains scripts/startup-checks.sh '"scouting-allowlist\.js"' \
    'worker preflight does not verify the packaged scouting validator'

  for helper in \
    instance-status-derivation.js \
    instance-stage-derivation.js \
    instance-failure-extraction.js
  do
    # These helpers are dynamic dependencies of the user-visible instance state report/status scripts.
    assert_dockerfile_preserves_runtime_file "dist/$helper" "/app/lib/$helper" "/usr/local/bin/$helper" \
      "Dockerfile does not preserve and install transitive instance-state helper: $helper"
  done

  assert_dist_entry_point_smokes
}

check_package_file_list_contracts() {
  print_section 'package.json file-list requirements'

  assert_file_contains .dockerignore '^!tsconfig\.scripts\.json$' \
    '.dockerignore does not allow tsconfig.scripts.json into the Docker build context'
  # npm consumers need scripts/ because startup-check-packaging.sh declares runtime paths and symlink behavior.
  assert_json_array_contains package.json scripts/ \
    'package.json files does not include scripts/ for npm package startup-check declarations'
}

check_startup_check_symlink_contracts
check_dockerfile_packaging_contracts
check_package_file_list_contracts

printf '\n✓ Startup-check packaging contract assertions passed.\n'
