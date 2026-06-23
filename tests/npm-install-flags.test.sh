#!/usr/bin/env bash
# shellcheck disable=SC2034
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Source the pure npm install flag helpers directly.
# shellcheck source=/dev/null
. "$ROOT_DIR/scripts/npm-install-helpers.sh"

fail() { printf '✗ %s\n' "$1" >&2; exit 1; }
pass() { printf '✓ %s\n' "$1"; }

assert_flags() {
  local label="$1"
  local omit_dev="$2"
  local ignore_scripts="$3"
  local expected_display="$4"
  shift 4
  local -a expected_flags=("$@")
  local -a install_flags=()

  KASEKI_NPM_OMIT_DEV="$omit_dev"
  KASEKI_INSTALL_IGNORE_SCRIPTS="$ignore_scripts"
  append_npm_install_flags install_flags

  if [ "${#install_flags[@]}" -ne "${#expected_flags[@]}" ]; then
    fail "$label: expected ${#expected_flags[@]} flags, got ${#install_flags[@]}"
  fi

  local i
  for i in "${!expected_flags[@]}"; do
    if [ "${install_flags[$i]}" != "${expected_flags[$i]}" ]; then
      fail "$label: expected flag $i to be ${expected_flags[$i]}, got ${install_flags[$i]}"
    fi
  done

  local display
  display="$(render_npm_install_flags "${install_flags[@]}")"
  if [ "$display" != "$expected_display" ]; then
    fail "$label: expected display '$expected_display', got '$display'"
  fi

  local -a npm_args=(ci --prefer-offline "${install_flags[@]}")
  local expected_count=$((2 + ${#expected_flags[@]}))
  if [ "${#npm_args[@]}" -ne "$expected_count" ]; then
    fail "$label: npm argument count changed during expansion"
  fi

  pass "$label"
}

assert_flags "no optional install flags" 0 0 "none"
assert_flags "one optional install flag (omit dev)" 1 0 "--omit=dev" "--omit=dev"
assert_flags "one optional install flag (ignore scripts)" 0 1 "--ignore-scripts" "--ignore-scripts"
assert_flags "both optional install flags" 1 1 "--omit=dev --ignore-scripts" "--omit=dev" "--ignore-scripts"
