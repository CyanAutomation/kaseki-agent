#!/usr/bin/env bash
# shellcheck disable=SC2034
# Test setup variables assigned for external use via sourced functions
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Load the dedicated validation helper library instead of extracting private
# functions from the executable entrypoint.
# shellcheck source=../scripts/validation-helpers.sh
source "$ROOT_DIR/scripts/validation-helpers.sh"

fail() { printf '✗ %s\n' "$1" >&2; exit 1; }
pass() { printf '✓ %s\n' "$1"; }

assert_equals() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  [ "$actual" = "$expected" ] || fail "$label: expected '$expected', got '$actual'"
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
}

write_package_json() {
  cat > package.json
}

run_case() {
  local name="$1"
  shift
  printf 'case: %s\n' "$name"
  "$@"
  pass "$name"
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
mkdir -p "$tmp_dir/results"
cd "$tmp_dir"

KASEKI_RESULTS_DIR="$tmp_dir/results"
VALIDATION_TIMINGS_FILE="$tmp_dir/results/validation-timings.tsv"
export KASEKI_RESULTS_DIR VALIDATION_TIMINGS_FILE
: > "$tmp_dir/results/validation.log" || fail "Cannot write to validation.log"
: > "$VALIDATION_TIMINGS_FILE" || fail "Cannot write to validation timings file"

case_npm_run_script_name_contract() {
  # Contract: validation commands only use missing-script skip handling for
  # parseable `npm run <script>` commands, preserving the script token exactly.
  assert_equals "bare npm run script" "check" "$(npm_run_script_name 'npm run check')"
  assert_equals "npm run script with trailing args" "test" "$(npm_run_script_name 'npm run test -- --runInBand')"
  assert_equals "npm run script with extra whitespace" "build" "$(npm_run_script_name 'npm   run   build')"

  if npm_run_script_name 'npx tsc --noEmit' >"$tmp_dir/npm-run-script-name.out"; then
    fail "non-npm-run validation command should not produce a script name"
  fi
}

case_missing_npm_script_for_validation_command_contract() {
  # Contract: a validation command that targets an undefined npm script is
  # reported as skippable instead of fatal, while defined scripts still run.
  write_package_json <<'JSON'
{
  "scripts": {
    "test": "node -e 'process.exit(0)'",
    "build": "node -e 'process.exit(0)'"
  }
}
JSON

  assert_missing_script "undefined npm run check is skippable" "npm run check" "check"
  assert_missing_script "undefined npm run lint with args is skippable" "npm run lint -- --max-warnings=0" "lint"
  assert_not_missing_script "defined npm run test is not skippable" "npm run test"
  assert_not_missing_script "defined npm run build is not skippable" "npm run build"
  assert_not_missing_script "non-npm validation command is not a missing npm script" "node --check index.js"
}

case_construct_default_validation_commands_contract() {
  # Contract: default validation favors existing npm scripts, then falls back to
  # common commands so validation remains explicit even for sparse package.jsons.
  write_package_json <<'JSON'
{
  "scripts": {
    "test": "node -e 'process.exit(0)'",
    "build": "node -e 'process.exit(0)'"
  }
}
JSON
  assert_equals "uses build before test when build exists" "npm run build;npm run test" "$(construct_default_validation_commands)"

  write_package_json <<'JSON'
{
  "scripts": {
    "type-check": "node -e 'process.exit(0)'",
    "test": "node -e 'process.exit(0)'"
  }
}
JSON
  assert_equals "uses type-check before test when build is absent" "npm run type-check;npm run test" "$(construct_default_validation_commands)"

  write_package_json <<'JSON'
{
  "scripts": {
    "lint": "node -e 'process.exit(0)'"
  }
}
JSON
  assert_equals "keeps non-empty validation fallback when common scripts are missing" "npm run build;npm run type-check;npm run test" "$(construct_default_validation_commands)"
}

case_apply_default_validation_commands_contract() {
  # Contract: explicit validation-command env vars are authoritative; otherwise
  # detected defaults are applied to agent and pre-agent validation together.
  write_package_json <<'JSON'
{
  "scripts": {
    "test": "node -e 'process.exit(0)'",
    "build": "node -e 'process.exit(0)'"
  }
}
JSON

  unset KASEKI_VALIDATION_COMMANDS_EXPLICIT KASEKI_VALIDATION_COMMANDS KASEKI_PRE_AGENT_VALIDATION_COMMANDS KASEKI_PRE_AGENT_VALIDATION_COMMANDS_EXPLICIT
  apply_default_validation_commands
  assert_equals "sets validation commands from defaults" "npm run build;npm run test" "$KASEKI_VALIDATION_COMMANDS"
  assert_equals "sets pre-agent commands from defaults" "npm run build;npm run test" "$KASEKI_PRE_AGENT_VALIDATION_COMMANDS"

  KASEKI_VALIDATION_COMMANDS_EXPLICIT=1
  KASEKI_PRE_AGENT_VALIDATION_COMMANDS_EXPLICIT=""
  KASEKI_VALIDATION_COMMANDS="npm run custom"
  KASEKI_PRE_AGENT_VALIDATION_COMMANDS="npm run custom"
  apply_default_validation_commands
  assert_equals "explicit validation commands take precedence" "npm run custom" "$KASEKI_VALIDATION_COMMANDS"
  assert_equals "pre-agent commands keep explicit validation default" "npm run custom" "$KASEKI_PRE_AGENT_VALIDATION_COMMANDS"
  KASEKI_VALIDATION_COMMANDS="npm run check;npm run test"
  KASEKI_PRE_AGENT_VALIDATION_COMMANDS="npm run check;npm run test"
  apply_default_validation_commands
  assert_equals "explicit test commands prepend the build artifact step" "npm run build;npm run check;npm run test" "$KASEKI_VALIDATION_COMMANDS"
  assert_equals "pre-agent test commands prepend the build artifact step" "npm run build;npm run check;npm run test" "$KASEKI_PRE_AGENT_VALIDATION_COMMANDS"
  unset KASEKI_VALIDATION_COMMANDS_EXPLICIT KASEKI_VALIDATION_COMMANDS KASEKI_PRE_AGENT_VALIDATION_COMMANDS KASEKI_PRE_AGENT_VALIDATION_COMMANDS_EXPLICIT
}

case_record_skipped_validation_command_contract() {
  # Contract: skipped validation commands emit exact log, timing, and JSONL
  # artifact fields that downstream validation-report readers consume.
  local log_file="$tmp_dir/results/validation.log"
  local timings_file="$VALIDATION_TIMINGS_FILE"
  local jsonl_file="$tmp_dir/results/.validation-results-temp.jsonl"
  : > "$log_file"
  : > "$timings_file"
  rm -f "$jsonl_file"

  record_skipped_validation_command "npm run build" "build" "0" "$log_file" "$timings_file"

  assert_equals "validation.log skipped text" \
    'Skipping validation command "npm run build" because package.json does not define script "build".' \
    "$(cat "$log_file")"
  assert_equals "validation timing skipped row fields" \
    $'npm run build\t127\t0\tskipped=missing_npm_script\tscript=build' \
    "$(cat "$timings_file")"
  assert_equals "validation JSONL skipped artifact fields" \
    '{"command": "npm run build", "exit_code": 127, "duration_seconds": 0, "status": "skipped"}' \
    "$(cat "$jsonl_file")"
}

case_validation_heartbeat_contract() {
  # Contract: a long-running validation command refreshes progress.jsonl while
  # it is still executing, so status consumers do not report it as stalled.
  local progress_file="$tmp_dir/results/progress.jsonl"
  : > "$progress_file"
  emit_progress() {
    printf '%s|%s\n' "$1" "$2" >> "$progress_file"
  }

  KASEKI_VALIDATION_HEARTBEAT_SECONDS=5
  local heartbeat_pid
  heartbeat_pid="$(start_validation_heartbeat 'pre-agent validation' 'npm run test')"
  sleep 6
  stop_validation_heartbeat "$heartbeat_pid"

  grep -Fq 'pre-agent validation|running validation command: npm run test' "$progress_file" \
    || fail 'validation heartbeat refreshes progress while a command is active'
}

run_case "npm_run_script_name follows validation-command parsing contract" case_npm_run_script_name_contract
run_case "missing_npm_script_for_validation_command follows skip contract" case_missing_npm_script_for_validation_command_contract
run_case "construct_default_validation_commands follows default-command contract" case_construct_default_validation_commands_contract
run_case "apply_default_validation_commands follows env precedence contract" case_apply_default_validation_commands_contract
run_case "record_skipped_validation_command writes validation artifacts contract" case_record_skipped_validation_command_contract
run_case "long validation commands emit progress heartbeats" case_validation_heartbeat_contract

echo ""
echo "✅ Missing npm script validation tests passed!"
