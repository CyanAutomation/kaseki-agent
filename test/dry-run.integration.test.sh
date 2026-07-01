#!/usr/bin/env bash
# shellcheck disable=SC2016,SC2015
# Optional smoke coverage for host-level run-kaseki.sh --dry-run wiring.
# Intentionally excluded from fast CI; run via npm run test:smoke:dry-run or set
# KASEKI_RUN_DRY_RUN_INTEGRATION=1 with Docker available to validate the host
# script wiring against the container dry-run artifact path.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNNER="$REPO_ROOT/run-kaseki.sh"
GATE_ENV="KASEKI_RUN_DRY_RUN_INTEGRATION"

pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }
skip() { printf '↷ %s\n' "$1"; exit 0; }

[ "${KASEKI_RUN_DRY_RUN_INTEGRATION:-0}" = "1" ] || skip "Set $GATE_ENV=1 to run Docker-backed dry-run integration test"
command -v docker >/dev/null 2>&1 || skip "Docker unavailable; skipping dry-run integration test"
docker info >/dev/null 2>&1 || skip "Docker daemon unavailable; skipping dry-run integration test"

assert_json_field_equals() {
  local file="$1" field="$2" expected="$3"
  node -e 'const fs=require("fs");const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const v=o[process.argv[2]];if(String(v)!==process.argv[3]){throw new Error(`${process.argv[1]} ${process.argv[2]} expected ${process.argv[3]} got ${String(v)}`)}' "$file" "$field" "$expected" \
    || fail "Expected $file field $field to equal $expected"
}

assert_file_empty() {
  local file="$1"
  [ -f "$file" ] || fail "Expected file to exist: $file"
  [ ! -s "$file" ] || fail "Expected empty file: $file"
}

tmp_root="$(mktemp -d)"
validation_marker="$tmp_root/validation-ran"
trap 'rm -rf "$tmp_root"' EXIT

(
  cd "$REPO_ROOT"
  export KASEKI_ROOT="$tmp_root"
  export KASEKI_LOG_DIR="$tmp_root/host-logs"
  export OPENROUTER_API_KEY="dry-run-test-key"
  export REPO_URL="https://github.com/CyanAutomation/kaseki-agent"
  export GIT_REF="main"
  export KASEKI_VALIDATION_COMMANDS="printf SHOULD_NOT_RUN > '$validation_marker'"
  export TASK_PROMPT="dry-run integration behavior test"
  "$RUNNER" --dry-run >"$tmp_root/run.stdout.log" 2>"$tmp_root/run.stderr.log"
) || fail "run-kaseki.sh --dry-run failed; see $tmp_root/run.stderr.log"

result_dir="$tmp_root/kaseki-results/kaseki-1"
assert_json_field_equals "$result_dir/host-start.json" dry_run 1
assert_json_field_equals "$result_dir/metadata.json" dry_run 1
assert_file_empty "$result_dir/pi-events.jsonl"
assert_file_empty "$result_dir/validation-timings.tsv"
[ ! -e "$validation_marker" ] || fail "Validation command should not execute during dry-run integration"
pass "run-kaseki.sh --dry-run records dry-run artifacts without validation side effects"

printf '\n✅ Optional dry-run integration test passed!\n'
