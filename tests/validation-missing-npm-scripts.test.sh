#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Load only the npm validation helpers from kaseki-agent.sh.
eval "$(awk '
  /^npm_run_script_name\(\)/ { emit=1 }
  /^compute_repo_memory_key\(\)/ { emit=0 }
  emit { print }
' "$ROOT_DIR/kaseki-agent.sh")"

fail() { printf '✗ %s\n' "$1" >&2; exit 1; }
pass() { printf '✓ %s\n' "$1"; }

assert_equals() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  [ "$actual" = "$expected" ] || fail "$label: expected '$expected', got '$actual'"
  pass "$label"
}

assert_missing_script() {
  local label="$1"
  local command="$2"
  local expected_script="$3"
  local actual_script
  if ! actual_script="$(missing_npm_script_for_validation_command "$command")"; then
    fail "$label: expected missing npm script '$expected_script'"
  fi
  assert_equals "$label" "$expected_script" "$actual_script"
}

assert_not_missing_script() {
  local label="$1"
  local command="$2"
  if missing_npm_script_for_validation_command "$command" >"$tmp_dir/missing-script-test.out" 2>/dev/null; then
    fail "$label: command should not be treated as a missing npm script ($(cat "$tmp_dir/missing-script-test.out"))"
  fi
  pass "$label"
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir" /tmp/kaseki-missing-script-test.out' EXIT
mkdir -p "$tmp_dir/results"
cd "$tmp_dir"
cat > package.json <<'JSON'
{
  "scripts": {
    "test": "node -e 'process.exit(0)'",
    "build": "node -e 'process.exit(0)'"
  }
}
JSON

VALIDATION_TIMINGS_FILE="$tmp_dir/results/validation-timings.tsv"
mkdir -p /results
: > /results/validation.log
: > "$VALIDATION_TIMINGS_FILE"

assert_equals "extracts npm run script names" "check" "$(npm_run_script_name 'npm run check')"
assert_equals "extracts npm run script with trailing args" "test" "$(npm_run_script_name 'npm run test -- --runInBand')"

KASEKI_SKIP_MISSING_NPM_SCRIPTS=1
assert_missing_script "skips missing check script" "npm run check" "check"
assert_not_missing_script "does not skip defined test script" "npm run test"
assert_not_missing_script "does not skip defined build script" "npm run build"

KASEKI_SKIP_MISSING_NPM_SCRIPTS=0
assert_not_missing_script "preserves explicit commands unless opt-in is enabled" "npm run check"

KASEKI_SKIP_MISSING_NPM_SCRIPTS=1
record_skipped_validation_command "npm run check" "check" "0"

if ! grep -Fq 'skipped: package.json does not define npm script "check"' /results/validation.log; then
  fail "validation.log should include a clear missing-script skip reason"
fi
pass "validation.log records missing-script skip reason"

assert_equals "validation timing records skipped row" $'npm run check\tskipped\t0\tmissing_npm_script=check' "$(cat "$VALIDATION_TIMINGS_FILE")"

echo ""
echo "✅ Missing npm script validation tests passed!"
