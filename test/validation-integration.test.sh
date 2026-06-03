#!/usr/bin/env bash
# Integration tests for the production validation command runner.
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
  # Load the real validation helpers while stubbing unrelated runtime plumbing.
  eval "$(awk '
    /^npm_run_script_name\(\)/ { emit=1 }
    /^classify_auto_lint_cleanup_command_exit\(\)/ { emit=0 }
    emit { print }
  ' "$REPO_ROOT/kaseki-agent.sh")"
  eval "$(awk '
    /^append_validation_failure_tail\(\)/ { emit=1 }
    /^auto_lint_cleanup_enabled_for_mode\(\)/ { emit=0 }
    emit { print }
  ' "$REPO_ROOT/kaseki-agent.sh")"
  eval "$(awk '
    /^run_validation_commands\(\)/ { emit=1 }
    /^compute_repo_memory_key\(\)/ { emit=0 }
    emit { print }
  ' "$REPO_ROOT/kaseki-agent.sh")"

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

setup_results_dir() {
  if [ -e /results ]; then
    RESULTS_PREEXISTED=1
  else
    RESULTS_PREEXISTED=0
    mkdir -p /results
  fi
  : > /results/quality.log
}

cleanup_workspace_repo() {
  if [ "$WORKSPACE_REPO_STATE" = "created" ]; then
    rm -rf /workspace/repo
  elif [ "$WORKSPACE_REPO_STATE" = "moved" ]; then
    rm -rf /workspace/repo
    mv "$WORKSPACE_REPO_BACKUP" /workspace/repo
  fi
}

cleanup_results_dir() {
  if [ "${RESULTS_PREEXISTED:-0}" = "0" ]; then
    rm -rf /results
  fi
}

with_workspace_repo_missing() {
  if [ -e /workspace/repo ] || [ -L /workspace/repo ]; then
    WORKSPACE_REPO_STATE="moved"
    WORKSPACE_REPO_BACKUP="$TEST_ROOT/workspace-repo.backup"
    mv /workspace/repo "$WORKSPACE_REPO_BACKUP" 2>/dev/null || fail "Failed to backup /workspace/repo"
  else
    WORKSPACE_REPO_STATE="absent"
  fi
}

with_workspace_repo_fixture() {
  local fixture="$1"
  if [ -e /workspace/repo ] || [ -L /workspace/repo ]; then
    WORKSPACE_REPO_STATE="moved"
    WORKSPACE_REPO_BACKUP="$TEST_ROOT/workspace-repo.backup"
    mv /workspace/repo "$WORKSPACE_REPO_BACKUP"
  else
    WORKSPACE_REPO_STATE="created"
  fi
  ln -s "$fixture" /workspace/repo
}

reset_validation_state() {
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

test_non_login_validation_via_production_helper() {
  local fixture="$TEST_ROOT/fixture-success"
  setup_fixture_repo "$fixture"
  with_workspace_repo_fixture "$fixture"
  cd "$fixture"
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
  with_workspace_repo_missing
  cd "$TEST_ROOT"
  reset_validation_state

  run_validation_helper "validation" "npm run check"

  [ "$helper_exit" -eq 1 ] || fail "validation helper should fail when /workspace/repo is missing, got $helper_exit"
  assert_file_contains "$TEST_RESULTS_DIR/validation.log" "ERROR: Working directory /workspace/repo does not exist before validation" "validation.log should contain the production checkpoint error"
  assert_file_contains "$TEST_RESULTS_DIR/stage-timings.tsv" "directory_missing" "stage timings should classify the missing workspace directory"
  [ "$VALIDATION_FAILURE_REASON" = "validation_command_failed: workspace_missing" ] || fail "unexpected failure reason: $VALIDATION_FAILURE_REASON"
  pass "Production validation helper logs missing workspace checkpoint"
}

test_directory_diagnostics_via_production_helper() {
  local fixture="$TEST_ROOT/fixture-diagnostics"
  setup_fixture_repo "$fixture"
  with_workspace_repo_fixture "$fixture"
  cd "$fixture"
  reset_validation_state

  run_validation_helper "validation" "npm run diagnose"

  [ "$helper_exit" -eq 9 ] || fail "validation helper should preserve failing command exit 9, got $helper_exit"
  assert_file_contains "$TEST_RESULTS_DIR/validation.log" "Error: getcwd: cannot access parent directories: No such file or directory" "validation.log should contain the real command stderr"
  assert_file_contains "$TEST_RESULTS_DIR/validation.log" "Validation failed: first failing command was \"npm run diagnose\" with exit 9" "validation.log should record the failed production command"
  assert_file_contains /results/quality.log "[DIAGNOSTICS] Validation command failed with directory access error:" "quality.log should include production directory diagnostics"
  assert_file_contains /results/quality.log "  /workspace/repo exists: yes" "quality.log should report workspace fixture status"
  pass "Production validation helper emits directory diagnostics from real failing command output"
}

printf '==> Validation Integration Tests\n'
TEST_ROOT="$(mktemp -d)"
TEST_RESULTS_DIR="$TEST_ROOT/results"
TEST_BIN_DIR="$TEST_ROOT/bin"
mkdir -p "$TEST_RESULTS_DIR"
WORKSPACE_REPO_STATE="absent"
WORKSPACE_REPO_BACKUP=""
trap 'cleanup_workspace_repo; cleanup_results_dir; rm -rf "$TEST_ROOT"' EXIT
setup_results_dir
setup_fake_filter
load_validation_helpers
FILTER_DIAGNOSTICS_LOG="$TEST_RESULTS_DIR/filter-diagnostics.log"
FILTER_STDERR_FILE="$TEST_RESULTS_DIR/filter-stderr.log"

# The checkpoint test must run before fixture tests because it intentionally
# observes the helper behavior when /workspace/repo is absent.
test_directory_checkpoint_via_production_helper
cleanup_workspace_repo
WORKSPACE_REPO_STATE="absent"
test_non_login_validation_via_production_helper
cleanup_workspace_repo
WORKSPACE_REPO_STATE="absent"
test_directory_diagnostics_via_production_helper

printf '\n✓ All integration tests passed\n'
