#!/usr/bin/env bash
# Integration-style tests for --dry-run behavior in run-kaseki.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNNER="$REPO_ROOT/run-kaseki.sh"

pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }

require_file() {
  local file="$1"
  [ -f "$file" ] || fail "Expected file to exist: $file"
}

json_field_equals() {
  local file="$1" field="$2" expected="$3"
  local actual
  actual="$(node -e 'const fs=require("fs");const p=process.argv[1];const f=process.argv[2];const o=JSON.parse(fs.readFileSync(p,"utf8"));const v=o[f];process.stdout.write(v===undefined?"":String(v));' "$file" "$field")"
  [ "$actual" = "$expected" ] || fail "Expected $file field '$field' to be '$expected' (got '$actual')"
}

assert_stage_detail() {
  local stage_file="$1" stage_name="$2" detail_expected="$3"
  awk -F '\t' -v stage="$stage_name" -v expected="$detail_expected" '
    $1==stage { found=1; if ($4!=expected) { printf("detail mismatch for %s: expected %s got %s\n", stage, expected, $4) > "/dev/stderr"; exit 2 } }
    END { if (!found) exit 3 }
  ' "$stage_file" || fail "Expected stage '$stage_name' detail '$detail_expected' in $stage_file"
}

assert_file_empty() {
  local file="$1"
  [ -f "$file" ] || fail "Expected file to exist: $file"
  [ ! -s "$file" ] || fail "Expected empty file: $file"
}

run_once() {
  local root="$1" marker="$2"
  local start end elapsed_ms
  start="$(date +%s%3N)"
  (
    cd "$REPO_ROOT"
    export KASEKI_ROOT="$root"
    export KASEKI_LOG_DIR="$root/host-logs"
    export OPENROUTER_API_KEY="dry-run-test-key"
    export REPO_URL=""
    export GIT_REF="main"
    export KASEKI_VALIDATION_COMMANDS="printf SHOULD_NOT_RUN_${marker} > /tmp/kaseki-validation-$$-${marker}"
    export TASK_PROMPT="dry-run behavior test"
    export KASEKI_IMAGE="docker.io/cyanautomation/kaseki-agent:latest"

    set +e
    "$RUNNER" --dry-run >"$root/run-${marker}.stdout.log" 2>"$root/run-${marker}.stderr.log"
    code=$?
    set -e
  end="$(date +%s%3N)"
  elapsed_ms=$((end-start))
  echo "$code" > "$root/exit-${marker}.txt"
  echo "$elapsed_ms" > "$root/runtime-${marker}.ms"
}

echo "=== Testing --dry-run runtime behavior ==="

tmp_root="$(mktemp -d)"
validation_marker_first="/tmp/kaseki-validation-$$-first"
validation_marker_second="/tmp/kaseki-validation-$$-second"
trap 'rm -rf "$tmp_root" "$validation_marker_first" "$validation_marker_second"' EXIT

[ ! -e "$validation_marker_first" ] || fail "Pre-existing validation marker found: $validation_marker_first"
[ ! -e "$validation_marker_second" ] || fail "Pre-existing validation marker found: $validation_marker_second"

run_once "$tmp_root" first
run1_exit="$(cat "$tmp_root/exit-first.txt")"

if [ "$run1_exit" != "0" ] && grep -q "missing required host dependencies: docker" "$tmp_root/run-first.stderr.log"; then
  echo "⚠ Docker unavailable; running fallback dry-run smoke checks"
  awk '
    /KASEKI_DRY_RUN/ { seen_dry_run=1 }
    /record_stage_timing "validation" "0" .*"dry_run=true"/ { seen_validation=1 }
    /record_stage_timing "pi coding agent" "0" .*"dry_run=true"/ { seen_agent=1 }
    END { exit (seen_dry_run && seen_validation && seen_agent) ? 0 : 1 }
  ' "$REPO_ROOT/run-kaseki.sh" "$REPO_ROOT/kaseki-agent.sh" || fail "Fallback smoke check failed: dry-run behavior wiring incomplete"
  pass "fallback smoke checks passed under missing docker dependency"
  echo ""
  echo "✅ Dry-run fallback checks passed!"
  exit 0
fi

[ "$run1_exit" = "0" ] || fail "First dry-run invocation should exit 0 (got $run1_exit)"
pass "dry-run exits with expected code (0)"

command -v node >/dev/null 2>&1 || fail "Node.js is required for JSON assertions in dry-run integration checks"

result1="$tmp_root/kaseki-results/kaseki-1"
require_file "$result1/host-start.json"
require_file "$result1/metadata.json"
json_field_equals "$result1/host-start.json" "dry_run" "1"
json_field_equals "$result1/metadata.json" "dry_run" "1"
pass "host-start.json and metadata.json include dry_run=1"

require_file "$result1/stage-timings.tsv"
assert_stage_detail "$result1/stage-timings.tsv" "pi coding agent" "dry_run=true"
assert_stage_detail "$result1/stage-timings.tsv" "validation" "dry_run=true"
assert_stage_detail "$result1/stage-timings.tsv" "secret scan" "dry_run=true"
pass "stage timing details capture semantic dry-run skips"

assert_file_empty "$result1/pi-events.jsonl"
assert_file_empty "$result1/validation-timings.tsv"
[ ! -f "/tmp/kaseki-validation-$$-first" ] || fail "Validation command should not execute during dry-run"
pass "no external side effects (no real agent output / validation command execution)"

run_once "$tmp_root" second
run2_exit="$(cat "$tmp_root/exit-second.txt")"
[ "$run2_exit" = "0" ] || fail "Second dry-run invocation should exit 0 (got $run2_exit)"

result2="$tmp_root/kaseki-results/kaseki-2"
require_file "$result2/host-start.json"
require_file "$result2/metadata.json"
[ -d "$tmp_root/kaseki-results/kaseki-1" ] || fail "First result directory missing after second run"
[ -f "$tmp_root/kaseki-results/kaseki-1/host-start.json" ] || fail "First run outputs were overwritten"
[ ! -f "/tmp/kaseki-validation-$$-second" ] || fail "Validation command should not execute on second dry-run"
first_runtime_ms="$(cat "$tmp_root/runtime-first.ms")"
second_runtime_ms="$(cat "$tmp_root/runtime-second.ms")"
[ "$second_runtime_ms" -le $((first_runtime_ms + 1500)) ] || fail "Second run should stay within runtime guardrail (first=${first_runtime_ms}ms second=${second_runtime_ms}ms)"
pass "runtime tracked (first=${first_runtime_ms}ms second=${second_runtime_ms}ms)"
pass "second invocation creates kaseki-2 and preserves prior outputs"

echo ""
echo "✅ All --dry-run behavior tests passed!"
