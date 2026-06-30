#!/usr/bin/env bash
# shellcheck disable=SC2034
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Source the pure npm install flag helpers directly.
# shellcheck source=/dev/null
. "$ROOT_DIR/scripts/npm-install-helpers.sh"

fail() { printf '✗ %s\n' "$1" >&2; exit 1; }
pass() { printf '✓ %s\n' "$1"; }

set_flag_env() {
  local name="$1"
  local value="$2"

  if [ "$value" = "__UNSET__" ]; then
    unset "$name"
  else
    printf -v "$name" '%s' "$value"
    export "$name"
  fi
}

assert_install_args() {
  local label="$1"
  local omit_dev="$2"
  local ignore_scripts="$3"
  shift 3
  local -a expected_args=("$@")
  local -a install_flags=()

  set_flag_env KASEKI_NPM_OMIT_DEV "$omit_dev"
  set_flag_env KASEKI_INSTALL_IGNORE_SCRIPTS "$ignore_scripts"
  append_npm_install_flags install_flags

  # User-facing contract: these helper flags are consumed by the worker install
  # command as: npm ci --prefer-offline "${install_flags[@]}".
  local -a npm_args=(npm ci --prefer-offline "${install_flags[@]}")

  if [ "${#npm_args[@]}" -ne "${#expected_args[@]}" ]; then
    fail "$label: expected ${#expected_args[@]} npm args, got ${#npm_args[@]} (${npm_args[*]})"
  fi

  local i
  for i in "${!expected_args[@]}"; do
    if [ "${npm_args[$i]}" != "${expected_args[$i]}" ]; then
      fail "$label: expected npm arg $i to be ${expected_args[$i]}, got ${npm_args[$i]}"
    fi
  done

  pass "$label"
}

assert_display_smoke() {
  local label="$1"
  local expected_display="$2"
  shift 2
  local display

  display="$(render_npm_install_flags "$@")"
  if [ "$display" != "$expected_display" ]; then
    fail "$label: expected display '$expected_display', got '$display'"
  fi

  pass "$label"
}

# Helper-level truth table for append_npm_install_flags:
# - KASEKI_NPM_OMIT_DEV=1 adds --omit=dev; unset, empty, or 0 omit it.
# - KASEKI_INSTALL_IGNORE_SCRIPTS=1 adds --ignore-scripts; unset or empty use
#   the documented helper default of 1, while 0 disables it.
# These assertions validate the final user-facing npm install argv, not only the
# formatting used in progress/cache log messages.
assert_install_args "explicit defaults: keep dev deps, ignore scripts" 0 1 \
  npm ci --prefer-offline --ignore-scripts
assert_install_args "explicit no optional install flags" 0 0 \
  npm ci --prefer-offline
assert_install_args "explicit omit dev only" 1 0 \
  npm ci --prefer-offline --omit=dev
assert_install_args "explicit omit dev and ignore scripts" 1 1 \
  npm ci --prefer-offline --omit=dev --ignore-scripts

# Negative/default cases for supported unset, empty, 0, and 1 values.
assert_install_args "unset env uses helper defaults" __UNSET__ __UNSET__ \
  npm ci --prefer-offline --ignore-scripts
assert_install_args "empty env uses helper defaults" "" "" \
  npm ci --prefer-offline --ignore-scripts
assert_install_args "omit dev unset remains disabled" __UNSET__ 0 \
  npm ci --prefer-offline
assert_install_args "omit dev empty remains disabled" "" 0 \
  npm ci --prefer-offline
assert_install_args "ignore scripts unset remains enabled" 0 __UNSET__ \
  npm ci --prefer-offline --ignore-scripts
assert_install_args "ignore scripts empty remains enabled" 0 "" \
  npm ci --prefer-offline --ignore-scripts

# Display output is not passed to npm; keep only a light smoke check for logs.
assert_display_smoke "display smoke: no flags" none
assert_display_smoke "display smoke: shell-style joined flags" "--omit=dev --ignore-scripts" \
  --omit=dev --ignore-scripts
