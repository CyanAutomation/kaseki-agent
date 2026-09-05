#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=../scripts/validation-helpers.sh
source "$ROOT_DIR/scripts/validation-helpers.sh"

fail() { printf '✗ %s\n' "$1" >&2; exit 1; }

tmp_dir="$(mktemp -d)"
heartbeat_pid=""
cleanup() {
  stop_validation_heartbeat "$heartbeat_pid"
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

progress_file="$tmp_dir/progress.jsonl"
: > "$progress_file"

emit_progress() {
  printf '{"stage":"%s","message":"%s"}\n' "$1" "$2" >> "$progress_file"
}

line_count() {
  awk 'END { print NR + 0 }' "$progress_file"
}

wait_for_line_count() {
  local expected="$1"
  local attempts="${2:-100}"
  local attempt

  for ((attempt = 0; attempt < attempts; attempt++)); do
    [ "$(line_count)" -ge "$expected" ] && return 0
    sleep 0.01
  done
  return 1
}

assert_line_count_stays() {
  local expected="$1"
  local attempts="${2:-20}"
  local attempt

  for ((attempt = 0; attempt < attempts; attempt++)); do
    [ "$(line_count)" -eq "$expected" ] \
      || fail "heartbeat count changed after scheduler stopped"
    sleep 0.01
  done
}

# No scheduler has been activated yet, so progress must remain untouched.
[ "$(line_count)" -eq 0 ] || fail "heartbeat emitted before activation"

# Inject a short interval at the scheduler boundary instead of weakening the
# production minimum or making this contract wait for a wall-clock interval.
heartbeat_pid="$(start_validation_heartbeat 'pre-agent validation' 'npm run test' '0.05')"
wait_for_line_count 1 \
  || fail "active heartbeat scheduler did not emit within the polling bound"

grep -Fxq \
  '{"stage":"pre-agent validation","message":"running validation command: npm run test"}' \
  "$progress_file" \
  || fail "active scheduler emitted an incorrectly structured heartbeat"

stop_validation_heartbeat "$heartbeat_pid"
heartbeat_pid=""
count_after_stop="$(line_count)"
assert_line_count_stays "$count_after_stop"

printf '✓ validation heartbeat activation, event, and stop contract\n'
