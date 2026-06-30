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

if ! bash -n "$CONFIG"; then
  printf 'startup-check packaging config has invalid shell syntax\n' >&2
  exit 1
fi

if ! bash -n "$ENTRYPOINT"; then
  printf 'docker entrypoint has invalid shell syntax\n' >&2
  exit 1
fi

assert_file_contains Dockerfile '^COPY package\.json package-lock\.json tsconfig\.json tsconfig\.scripts\.json \.\/$' \
  'Dockerfile does not copy tsconfig.scripts.json before npm run build'
assert_file_contains Dockerfile '^COPY scripts \.\/scripts$' \
  'Dockerfile does not copy scripts into /app for startup-check packaging'
assert_file_contains Dockerfile '^[[:space:]]+/app/scripts/startup-check-packaging\.sh \\$' \
  'Dockerfile does not mark startup-check-packaging.sh executable'
assert_file_match_count Dockerfile '^[[:space:]]+&& /app/scripts/startup-check-packaging\.sh install \\$' 2 \
  'Dockerfile must install startup-check symlinks in both runtime and final stages'
assert_file_contains Dockerfile 'cp dist/pi-event-filter-helpers.js /app/lib/pi-event-filter-helpers.js' \
  'Dockerfile does not preserve pi-event-filter helper module'
assert_file_contains Dockerfile 'cp -r dist/pi-event-aggregation /app/lib/pi-event-aggregation' \
  'Dockerfile does not preserve pi-event-filter runtime dependencies'
assert_file_match_count Dockerfile 'install -m 0755 /app/lib/pi-event-filter-helpers.js /usr/local/bin/pi-event-filter-helpers.js' 2 \
  'Dockerfile must install pi-event-filter helper in runtime and final stages'
assert_file_match_count Dockerfile 'cp -r /app/lib/pi-event-aggregation/\* /usr/local/bin/pi-event-aggregation/' 2 \
  'Dockerfile must install pi-event aggregation modules in runtime and final stages'
assert_file_match_count Dockerfile '/usr/local/bin/kaseki-pi-event-filter "\$empty_events" "\$filtered_events" "\$event_summary"' 2 \
  'Dockerfile must execute the packaged pi-event filter in runtime and final stages'
assert_file_contains Dockerfile '^COPY --from=runtime /app/scripts \.\/scripts$' \
  'Dockerfile final stage does not copy packaged scripts from runtime stage'
assert_file_contains Dockerfile '^ENTRYPOINT \["/usr/bin/tini", "--", "/usr/local/bin/kaseki-entrypoint"\]$' \
  'Dockerfile entrypoint does not dispatch through kaseki-entrypoint'
assert_file_match_count Dockerfile 'install -m 0755 /app/dist/scouting-allowlist\.js /usr/local/bin/scripts/scouting-allowlist\.js' 2 \
  'Dockerfile must install the scouting validator at its packaged runtime path in both image stages'
assert_file_contains kaseki-agent.sh '/app/dist/scouting-allowlist\.js' \
  'runner does not fall back to the built scouting validator in the image'
assert_file_contains kaseki-agent.sh '/usr/local/bin/scripts/scouting-allowlist\.js' \
  'runner does not recognize the installed scouting validator runtime path'
assert_file_contains scripts/startup-checks.sh '"scouting-allowlist\.js"' \
  'worker preflight does not verify the packaged scouting validator'

assert_file_contains .dockerignore '^!tsconfig\.scripts\.json$' \
  '.dockerignore does not allow tsconfig.scripts.json into the Docker build context'
assert_json_array_contains package.json scripts/ \
  'package.json files does not include scripts/ for npm package startup-check declarations'

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

for helper in \
  instance-status-derivation.js \
  instance-stage-derivation.js \
  instance-failure-extraction.js
do
  if ! grep -q "cp dist/$helper /app/lib/$helper" Dockerfile; then
    printf 'Dockerfile does not copy transitive instance-state helper: %s\n' "$helper" >&2
    exit 1
  fi

  if ! grep -q "install -m 0755 /app/lib/$helper /usr/local/bin/$helper" Dockerfile; then
    printf 'Dockerfile does not install transitive instance-state helper: %s\n' "$helper" >&2
    exit 1
  fi
done

printf '✓ Startup-check packaging contract assertions passed.\n'
