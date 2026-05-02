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
  (
    cd "$REPO_ROOT"
    export KASEKI_ROOT="$root"
    export KASEKI_LOG_DIR="$root/host-logs"
    export OPENROUTER_API_KEY="dry-run-test-key"
    export REPO_URL="https://github.com/CyanAutomation/crudmapper"
    export GIT_REF="main"
    export KASEKI_VALIDATION_COMMANDS="printf SHOULD_NOT_RUN_${marker} > /tmp/kaseki-validation-${marker}"
    export TASK_PROMPT="dry-run behavior test"
    export KASEKI_IMAGE="docker.io/cyanautomation/kaseki-agent:latest"

    set +e
    "$RUNNER" --dry-run >"$root/run-${marker}.stdout.log" 2>"$root/run-${marker}.stderr.log"
    code=$?
    set -e
    echo "$code" > "$root/exit-${marker}.txt"
  )
}

echo "=== Testing --dry-run runtime behavior ==="

tmp_root="$(mktemp -d)"
trap 'rm -rf "$tmp_root" /tmp/kaseki-validation-first /tmp/kaseki-validation-second' EXIT

run_once "$tmp_root" first
run1_exit="$(cat "$tmp_root/exit-first.txt")"

if [ "$run1_exit" != "0" ] && grep -q "missing required host dependencies: docker" "$tmp_root/run-first.stderr.log"; then
  echo "⚠ Docker unavailable; running fallback dry-run smoke checks"
  grep -q 'KASEKI_DRY_RUN' "$REPO_ROOT/run-kaseki.sh" || fail "Fallback smoke check failed: dry-run env wiring missing in run-kaseki.sh"
  grep -q 'record_stage_timing "validation" "0" .*"dry_run=true"' "$REPO_ROOT/kaseki-agent.sh" || fail "Fallback smoke check failed: dry-run validation semantic status missing"
  grep -q 'record_stage_timing "pi coding agent" "0" .*"dry_run=true"' "$REPO_ROOT/kaseki-agent.sh" || fail "Fallback smoke check failed: dry-run agent semantic status missing"
  pass "fallback smoke checks passed under missing docker dependency"
  echo ""
  echo "✅ Dry-run fallback checks passed!"
  exit 0
fi

[ "$run1_exit" = "0" ] || fail "First dry-run invocation should exit 0 (got $run1_exit)"
pass "dry-run exits with expected code (0)"

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
[ ! -f /tmp/kaseki-validation-first ] || fail "Validation command should not execute during dry-run"
pass "no external side effects (no real agent output / validation command execution)"

run_once "$tmp_root" second
run2_exit="$(cat "$tmp_root/exit-second.txt")"
[ "$run2_exit" = "0" ] || fail "Second dry-run invocation should exit 0 (got $run2_exit)"

result2="$tmp_root/kaseki-results/kaseki-2"
require_file "$result2/host-start.json"
require_file "$result2/metadata.json"
[ -d "$tmp_root/kaseki-results/kaseki-1" ] || fail "First result directory missing after second run"
[ -f "$tmp_root/kaseki-results/kaseki-1/host-start.json" ] || fail "First run outputs were overwritten"
[ ! -f /tmp/kaseki-validation-second ] || fail "Validation command should not execute on second dry-run"
pass "second invocation creates kaseki-2 and preserves prior outputs"

echo ""
echo "✅ All --dry-run behavior tests passed!"
