#!/usr/bin/env bash
# shellcheck disable=SC2317,SC1091,SC2034
# Integration tests for the production validation command runner.
# SC2034: Test setup variables assigned for use via namerefs in validation helpers
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }

assert_file_contains() {
  local file="$1"
  local needle="$2"
  local message="$3"
  if ! grep -Fq -- "$needle" "$file"; then
    printf '%s\n' "--- $file ---" >&2
    cat "$file" >&2 || true
    fail "$message"
  fi
}

load_validation_helpers() {
  # Load the dedicated validation helper library instead of extracting functions
  # from the executable entrypoint. Tests stub the runtime callbacks below.
  # shellcheck source=../scripts/validation-helpers.sh
  source "$REPO_ROOT/scripts/validation-helpers.sh"

  set_current_stage() { printf '%s\n' "$1" > "$TEST_RESULTS_DIR/current-stage.txt"; }
  emit_progress() { printf 'progress\t%s\t%s\n' "$1" "$2" >> "$TEST_RESULTS_DIR/progress.tsv"; }
  emit_event() { printf 'event\t%s\t%s\n' "$1" "${*:2}" >> "$TEST_RESULTS_DIR/events.tsv"; }
  record_stage_timing() { printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "${4:-}" >> "$TEST_RESULTS_DIR/stage-timings.tsv"; }
}

setup_fake_filter() {
  mkdir -p "$TEST_BIN_DIR"
  cat > "$TEST_BIN_DIR/validation-output-filter" <<'EOF_FILTER'
#!/usr/bin/env bash
cat
EOF_FILTER
  chmod +x "$TEST_BIN_DIR/validation-output-filter"
  PATH="$TEST_BIN_DIR:$PATH"
  export PATH
}

use_workspace_repo_missing() {
  rm -rf "$KASEKI_WORKSPACE_DIR/repo"
  mkdir -p "$KASEKI_WORKSPACE_DIR"
}

use_workspace_repo_fixture() {
  local fixture="$1"
  rm -rf "$KASEKI_WORKSPACE_DIR/repo"
  mkdir -p "$KASEKI_WORKSPACE_DIR"
  cp -a "$fixture" "$KASEKI_WORKSPACE_DIR/repo"
}

reset_validation_state() {
  # Test setup variables assigned for use via namerefs in validation helpers
  VALIDATION_EXIT=0
  VALIDATION_FAILED_COMMAND_DETAIL=""
  VALIDATION_FAILURE_REASON=""
  VALIDATION_STOPPED_EARLY=false
  VALIDATION_COMMANDS_ATTEMPTED=0
  PRE_VALIDATION_EXIT=0
  PRE_VALIDATION_FAILED_COMMAND_DETAIL=""
  PRE_VALIDATION_FAILURE_REASON=""
  PRE_VALIDATION_STOPPED_EARLY=false
  PRE_VALIDATION_COMMANDS_ATTEMPTED=0
  KASEKI_BASELINE_VALIDATION_DRY_RUN=0
  KASEKI_DRY_RUN=0
  KASEKI_VALIDATION_FAIL_FAST=1
  KASEKI_VALIDATION_RUN_ALL_COMMANDS=0
}

setup_fixture_repo() {
  local fixture="$1"
  mkdir -p "$fixture"
  cat > "$fixture/package.json" <<'JSON'
{
  "name": "validation-integration-fixture",
  "version": "1.0.0",
  "scripts": {
    "check": "node -e 'console.log(\"fixture check passed\")'",
    "diagnose": "node -e 'console.error(\"Error: getcwd: cannot access parent directories: No such file or directory\"); process.exit(9)'"
  }
}
JSON
  cat > "$fixture/package-lock.json" <<'JSON'
{
  "name": "validation-integration-fixture",
  "version": "1.0.0",
  "lockfileVersion": 3
}
JSON
}

run_validation_helper() {
  local stage_label="$1"
  local commands="$2"
  local log_file="$TEST_RESULTS_DIR/validation.log"
  local raw_log="$TEST_RESULTS_DIR/validation-raw.log"
  local timings_file="$TEST_RESULTS_DIR/validation-timings.tsv"
  local env_log="$TEST_RESULTS_DIR/validation-environment.log"

  : > "$log_file"
  : > "$raw_log"
  : > "$timings_file"
  : > "$env_log"
  : > "$FILTER_DIAGNOSTICS_LOG"
  : > "$FILTER_STDERR_FILE"

  set +e
  run_validation_commands \
    "$stage_label" \
    "$commands" \
    "$log_file" \
    "$raw_log" \
    "$timings_file" \
    "$env_log" \
    "validation_command_failed"
  helper_exit=$?
  set -e
}


test_pre_agent_validation_env_log_argument_via_production_helper() {
  local fixture="$TEST_ROOT/fixture-pre-agent"
  local pre_raw_log="$TEST_RESULTS_DIR/pre-validation-raw.log"
  local pre_timings_file="$TEST_RESULTS_DIR/pre-validation-timings.tsv"
  local pre_env_log="$TEST_RESULTS_DIR/pre-agent-validation-env.log"
  local pre_helper_exit

  setup_fixture_repo "$fixture"
  use_workspace_repo_fixture "$fixture"
  cd "$KASEKI_WORKSPACE_DIR/repo"
  reset_validation_state

  : > "$pre_raw_log"
  : > "$pre_timings_file"
  rm -f "$pre_env_log"
  : > "$FILTER_DIAGNOSTICS_LOG"
  : > "$FILTER_STDERR_FILE"

  PRE_VALIDATION_EXIT="not-numeric-before-call"

  set +e
  run_validation_commands \
    "pre-agent validation" \
    "npm run check" \
    /dev/null \
    "$pre_raw_log" \
    "$pre_timings_file" \
    "$pre_env_log" \
    "pre_agent_validation_failed" \
    PRE_VALIDATION_EXIT \
    PRE_VALIDATION_FAILED_COMMAND_DETAIL \
    PRE_VALIDATION_FAILURE_REASON \
    PRE_VALIDATION_STOPPED_EARLY \
    PRE_VALIDATION_COMMANDS_ATTEMPTED
  pre_helper_exit=$?
  set -e

  [ "$pre_helper_exit" -eq 0 ] || fail "pre-agent validation helper should pass, got $pre_helper_exit"
  [[ "$PRE_VALIDATION_EXIT" =~ ^[0-9]+$ ]] || fail "PRE_VALIDATION_EXIT should remain numeric, got $PRE_VALIDATION_EXIT"
  [ "$PRE_VALIDATION_EXIT" -eq 0 ] || fail "PRE_VALIDATION_EXIT should be 0 for successful commands, got $PRE_VALIDATION_EXIT"
  assert_file_contains "$pre_env_log" "[validation command] stage=pre-agent validation" "pre-agent env log should include stage metadata"
  assert_file_contains "$pre_env_log" "[validation command] command=npm run check" "pre-agent env log should include command metadata"
  pass "Pre-agent validation helper writes env metadata to explicit env-log path"
}

test_non_login_validation_via_production_helper() {
  local fixture="$TEST_ROOT/fixture-success"
  setup_fixture_repo "$fixture"
  use_workspace_repo_fixture "$fixture"
  cd "$KASEKI_WORKSPACE_DIR/repo"
  reset_validation_state

  run_validation_helper "validation" "npm run check"

  [ "$helper_exit" -eq 0 ] || fail "validation helper should pass, got $helper_exit"
  assert_file_contains "$TEST_RESULTS_DIR/validation.log" "==> npm run check" "validation.log should include the command boundary"
  assert_file_contains "$TEST_RESULTS_DIR/validation.log" "fixture check passed" "validation.log should include real command output"
  assert_file_contains "$TEST_RESULTS_DIR/validation.log" "[validation pipeline] statuses: command=0 tee=0 filter=0" "validation.log should include production pipeline statuses"
  assert_file_contains "$TEST_RESULTS_DIR/validation-timings.tsv" $'npm run check\t0' "validation timings should record the real command exit"
  pass "Production validation helper runs fixture npm command through non-login shell"
}

test_directory_checkpoint_via_production_helper() {
  use_workspace_repo_missing
  cd "$TEST_ROOT"
  reset_validation_state

  run_validation_helper "validation" "npm run check"

  [ "$helper_exit" -eq 1 ] || fail "validation helper should fail when the temp workspace repo is missing, got $helper_exit"
  assert_file_contains "$TEST_RESULTS_DIR/validation.log" "ERROR: Working directory $KASEKI_WORKSPACE_DIR/repo does not exist before validation" "validation.log should contain the production checkpoint error for the temp workspace"
  assert_file_contains "$TEST_RESULTS_DIR/stage-timings.tsv" "directory_missing" "stage timings should classify the missing workspace directory"
  [ "$VALIDATION_FAILURE_REASON" = "validation_command_failed: workspace_missing" ] || fail "unexpected failure reason: $VALIDATION_FAILURE_REASON"
  pass "Production validation helper logs missing workspace checkpoint"
}

test_directory_diagnostics_via_production_helper() {
  local fixture="$TEST_ROOT/fixture-diagnostics"
  setup_fixture_repo "$fixture"
  use_workspace_repo_fixture "$fixture"
  cd "$KASEKI_WORKSPACE_DIR/repo"
  reset_validation_state

  run_validation_helper "validation" "npm run diagnose"

  [ "$helper_exit" -eq 9 ] || fail "validation helper should preserve failing command exit 9, got $helper_exit"
  assert_file_contains "$TEST_RESULTS_DIR/validation.log" "Error: getcwd: cannot access parent directories: No such file or directory" "validation.log should contain the real command stderr"
  assert_file_contains "$TEST_RESULTS_DIR/validation.log" "Validation failed: first failing command was \"npm run diagnose\" with exit 9" "validation.log should record the failed production command"
  assert_file_contains "$KASEKI_RESULTS_DIR/quality.log" "[DIAGNOSTICS] Validation command failed with directory access error:" "quality.log should include production directory diagnostics"
  assert_file_contains "$KASEKI_RESULTS_DIR/quality.log" "  $KASEKI_WORKSPACE_DIR/repo exists: yes" "quality.log should report workspace fixture status"
  pass "Production validation helper emits directory diagnostics from real failing command output"
}

printf '==> Validation Integration Tests\n'
TEST_ROOT="$(mktemp -d)"
TEST_RESULTS_DIR="$(mktemp -d "$TEST_ROOT/results.XXXXXX")"
TEST_WORKSPACE_DIR="$(mktemp -d "$TEST_ROOT/workspace.XXXXXX")"
TEST_BIN_DIR="$(mktemp -d "$TEST_ROOT/bin.XXXXXX")"
KASEKI_RESULTS_DIR="$TEST_RESULTS_DIR"
KASEKI_WORKSPACE_DIR="$TEST_WORKSPACE_DIR"
export KASEKI_RESULTS_DIR KASEKI_WORKSPACE_DIR
mkdir -p "$TEST_RESULTS_DIR" "$KASEKI_WORKSPACE_DIR"
trap 'rm -rf "$TEST_ROOT"' EXIT
setup_fake_filter
load_validation_helpers
FILTER_DIAGNOSTICS_LOG="$TEST_RESULTS_DIR/filter-diagnostics.log"
FILTER_STDERR_FILE="$TEST_RESULTS_DIR/filter-stderr.log"

# The checkpoint test must run before fixture tests because it intentionally
# observes the helper behavior when the temporary workspace repo is absent.
test_directory_checkpoint_via_production_helper
test_non_login_validation_via_production_helper
test_pre_agent_validation_env_log_argument_via_production_helper
test_directory_diagnostics_via_production_helper

printf '\n✓ All integration tests passed\n'
