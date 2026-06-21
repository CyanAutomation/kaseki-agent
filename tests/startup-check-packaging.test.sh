#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CONFIG="$ROOT_DIR/scripts/startup-check-packaging.sh"
ENTRYPOINT="$ROOT_DIR/scripts/docker-entrypoint.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

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

printf '✓ Startup-check packaging contract assertions passed.\n'
