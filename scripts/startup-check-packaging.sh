#!/usr/bin/env bash
set -euo pipefail

# Structured packaging contract for startup-check entrypoints.
# Docker image assembly, entrypoint dispatch, and fast tests share these values
# instead of duplicating raw path strings in multiple places.
: "${KASEKI_STARTUP_CHECK_SOURCE:=/app/scripts/startup-checks.sh}"
: "${KASEKI_STARTUP_CHECK_PRIMARY_PATH:=/scripts/startup-checks.sh}"
: "${KASEKI_INIT_CONTAINER_PATH:=/scripts/kaseki-init-container.sh}"
: "${KASEKI_STARTUP_CHECK_MODE_DEFAULT:=all}"

kaseki_install_startup_check_links() {
  mkdir -p "$(dirname "$KASEKI_STARTUP_CHECK_PRIMARY_PATH")"
  ln -sf "$KASEKI_STARTUP_CHECK_SOURCE" "$KASEKI_STARTUP_CHECK_PRIMARY_PATH"
  ln -sf "$KASEKI_STARTUP_CHECK_SOURCE" "$KASEKI_INIT_CONTAINER_PATH"
}

kaseki_run_startup_checks() {
  "${KASEKI_STARTUP_CHECK_PRIMARY_PATH}" "${KASEKI_STARTUP_CHECK_MODE:-$KASEKI_STARTUP_CHECK_MODE_DEFAULT}"
}

if [ "${BASH_SOURCE[0]}" = "$0" ] && [ "${1:-}" = "install" ]; then
  kaseki_install_startup_check_links
fi
