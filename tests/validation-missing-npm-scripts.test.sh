#!/usr/bin/env bash
# shellcheck disable=SC2034
# Test setup variables assigned for external use via sourced functions
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Load only the npm validation helpers from kaseki-agent.sh.
eval "$(awk '
  /^npm_run_script_name\(\)/ { emit=1 }
  /^missing_npm_script_for_validation_command\(\)/ { emit=1 }
  /^record_skipped_validation_command\(\)/ { emit=1 }
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

# Override record_skipped_validation_command to use temp directory instead of /results
record_skipped_validation_command() {
  local command="$1"
  local script_name="$2"
  local duration_seconds="$3"
  {
    printf '\n==> %s\n' "$command"
    printf 'skipped: package.json does not define npm script "%s"\n' "$script_name"
  } 2>&1 | tee -a "$tmp_dir/results/validation.log"
  printf '%s\tskipped\t%s\tmissing_npm_script=%s\n' "$command" "$duration_seconds" "$script_name" >> "$VALIDATION_TIMINGS_FILE"
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
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
: > "$tmp_dir/results/validation.log" || fail "Cannot write to validation.log"
: > "$VALIDATION_TIMINGS_FILE" || fail "Cannot write to validation timings file"

assert_equals "extracts npm run script names" "check" "$(npm_run_script_name 'npm run check')"
assert_equals "extracts npm run script with trailing args" "test" "$(npm_run_script_name 'npm run test -- --runInBand')"

# Missing npm scripts are now always skipped (non-fatal), regardless of KASEKI_SKIP_MISSING_NPM_SCRIPTS
assert_missing_script "always skips missing check script" "npm run check" "check"
assert_not_missing_script "does not skip defined test script" "npm run test"
assert_not_missing_script "does not skip defined build script" "npm run build"
assert_equals "default validation uses build when present" "npm run build;npm run test" "$(construct_default_validation_commands)"

cat > package.json <<'JSON'
{
  "scripts": {
    "type-check": "node -e 'process.exit(0)'",
    "test": "node -e 'process.exit(0)'"
  }
}
JSON
assert_equals "default validation falls back to type-check without build" "npm run type-check;npm run test" "$(construct_default_validation_commands)"
assert_not_missing_script "does not skip defined type-check script" "npm run type-check"

cat > package.json <<'JSON'
{
  "scripts": {
    "lint": "node -e 'process.exit(0)'"
  }
}
JSON
assert_equals "default validation stays non-empty when common scripts are missing" "npm run build;npm run type-check;npm run test" "$(construct_default_validation_commands)"

KASEKI_VALIDATION_COMMANDS_EXPLICIT=x
KASEKI_PRE_AGENT_VALIDATION_COMMANDS_EXPLICIT=""
KASEKI_VALIDATION_COMMANDS="npm run custom"
KASEKI_PRE_AGENT_VALIDATION_COMMANDS="npm run custom"
apply_default_validation_commands
assert_equals "explicit validation commands take precedence" "npm run custom" "$KASEKI_VALIDATION_COMMANDS"
assert_equals "pre-agent commands keep explicit validation default" "npm run custom" "$KASEKI_PRE_AGENT_VALIDATION_COMMANDS"
unset KASEKI_VALIDATION_COMMANDS_EXPLICIT KASEKI_VALIDATION_COMMANDS KASEKI_PRE_AGENT_VALIDATION_COMMANDS KASEKI_PRE_AGENT_VALIDATION_COMMANDS_EXPLICIT

record_skipped_validation_command "npm run build" "build" "0"

if ! grep -Fq 'skipped: package.json does not define npm script "build"' "$tmp_dir/results/validation.log"; then
  fail "validation.log should include a clear missing-script skip reason"
fi
pass "validation.log records missing-script skip reason"

assert_equals "validation timing records skipped row" $'npm run build	skipped	0	missing_npm_script=build' "$(cat "$VALIDATION_TIMINGS_FILE")"

echo ""
echo "✅ Missing npm script validation tests passed!"
