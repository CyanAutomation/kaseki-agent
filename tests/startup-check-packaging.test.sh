#!/usr/bin/env bash
# shellcheck disable=SC2031
# Note: Variables modified across subshells and sourced scopes; this is intentional.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CONFIG="$ROOT_DIR/scripts/startup-check-packaging.sh"
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

print_section() {
  printf '\n## %s\n' "$1"
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

check_startup_check_symlink_contracts

printf '\n✓ Startup-check packaging smoke assertions passed.\n'
