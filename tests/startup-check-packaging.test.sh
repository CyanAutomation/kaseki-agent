#!/usr/bin/env bash
# shellcheck disable=SC2031
# Note: Variables modified across subshells and sourced scopes; this is intentional.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CONFIG="$ROOT_DIR/scripts/startup-check-packaging.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

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

  unset KASEKI_STARTUP_CHECK_MODE
  STARTUP_CHECK_MODE_CAPTURE="$MODE_CAPTURE" kaseki_run_startup_checks
  test "$(cat "$MODE_CAPTURE")" = "all"
}

check_entrypoint_mode_forwarding() {
  print_section 'Docker entrypoint startup-check mode forwarding'

  ENTRYPOINT_MODE_CAPTURE="$TMP_DIR/entrypoint-mode.txt"
  export ENTRYPOINT_MODE_CAPTURE
  cat > "$TMP_DIR/entrypoint-startup-checks.sh" <<'FAKE_ENTRYPOINT_CHECKS'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$1" > "${ENTRYPOINT_MODE_CAPTURE:?}"
FAKE_ENTRYPOINT_CHECKS
  chmod +x "$TMP_DIR/entrypoint-startup-checks.sh"

  KASEKI_STARTUP_CHECK_PACKAGING_CONFIG="$CONFIG" \
    KASEKI_STARTUP_CHECK_PRIMARY_PATH="$TMP_DIR/entrypoint-startup-checks.sh" \
    KASEKI_SKIP_PERMISSION_VALIDATION=1 \
    env -u KASEKI_STARTUP_CHECK_MODE bash scripts/docker-entrypoint.sh true
  test "$(cat "$ENTRYPOINT_MODE_CAPTURE")" = "all"

  KASEKI_STARTUP_CHECK_PACKAGING_CONFIG="$CONFIG" \
    KASEKI_STARTUP_CHECK_PRIMARY_PATH="$TMP_DIR/entrypoint-startup-checks.sh" \
    KASEKI_STARTUP_CHECK_MODE=quick \
    KASEKI_SKIP_PERMISSION_VALIDATION=1 \
    bash scripts/docker-entrypoint.sh true
  test "$(cat "$ENTRYPOINT_MODE_CAPTURE")" = "quick"
}

check_entrypoint_packaged_config_dispatch() {
  print_section 'Docker entrypoint packaged-config dispatch'

  local packaged_config_path='/app/scripts/startup-check-packaging.sh'
  local fixture_config="$TMP_DIR/packaged-startup-check-packaging.sh"
  local test_entrypoint="$TMP_DIR/docker-entrypoint.sh"
  local source_capture="$TMP_DIR/packaged-config-source.txt"
  local mode_capture="$TMP_DIR/packaged-config-mode.txt"

  cat > "$fixture_config" <<'FAKE_PACKAGED_CONFIG'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "${BASH_SOURCE[0]}" > "${PACKAGED_CONFIG_SOURCE_CAPTURE:?}"
kaseki_run_startup_checks() {
  printf '%s\n' "${KASEKI_STARTUP_CHECK_MODE:-all}" > "${PACKAGED_CONFIG_MODE_CAPTURE:?}"
}
FAKE_PACKAGED_CONFIG

  # Packaging spec: tests/packaging-layout.test.sh::contract_published_package_contents
  # installs this config at /app/scripts; exercise the entrypoint's default dispatch
  # against a relocated fixture so this test verifies sourcing and invocation, not text.
  sed "s|$packaged_config_path|$fixture_config|" scripts/docker-entrypoint.sh > "$test_entrypoint"
  chmod +x "$test_entrypoint"

  PACKAGED_CONFIG_SOURCE_CAPTURE="$source_capture" \
    PACKAGED_CONFIG_MODE_CAPTURE="$mode_capture" \
    KASEKI_STARTUP_CHECK_MODE=quick \
    KASEKI_SKIP_PERMISSION_VALIDATION=1 \
    env -u KASEKI_STARTUP_CHECK_PACKAGING_CONFIG bash "$test_entrypoint" true

  test "$(cat "$source_capture")" = "$fixture_config"
  test "$(cat "$mode_capture")" = "quick"
}

check_startup_check_symlink_contracts
check_entrypoint_mode_forwarding
check_entrypoint_packaged_config_dispatch

printf '\n✓ Startup-check packaging smoke assertions passed.\n'
