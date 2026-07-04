#!/usr/bin/env bash
# Validate the production helper checkpoints a missing workspace before commands run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PRODUCTION_VALIDATION_HELPER="$REPO_ROOT/scripts/validation-helpers.sh"
# shellcheck source=test/helpers/validation-contract-helpers.sh
source "$SCRIPT_DIR/helpers/validation-contract-helpers.sh"
# shellcheck source=scripts/validation-helpers.sh
source "$PRODUCTION_VALIDATION_HELPER"

set_current_stage() { printf '%s\n' "$1" > "$TEST_RESULTS_DIR/current-stage.txt"; }
emit_progress() { printf 'progress\t%s\t%s\n' "$1" "$2" >> "$TEST_RESULTS_DIR/progress.tsv"; }
emit_event() { printf 'event\t%s\t%s\n' "$1" "${*:2}" >> "$TEST_RESULTS_DIR/events.tsv"; }
record_stage_timing() { printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "${4:-}" >> "$TEST_RESULTS_DIR/stage-timings.tsv"; }

reset_validation_state() {
  VALIDATION_EXIT=0
  VALIDATION_FAILED_COMMAND_DETAIL=""
  VALIDATION_FAILURE_REASON=""
  VALIDATION_STOPPED_EARLY=false
  VALIDATION_COMMANDS_ATTEMPTED=0
  KASEKI_BASELINE_VALIDATION_DRY_RUN=0
  KASEKI_DRY_RUN=0
  KASEKI_VALIDATION_FAIL_FAST=1
  KASEKI_VALIDATION_RUN_ALL_COMMANDS=0
}

test_missing_workspace_checkpoint() {
  local tmpdir helper_exit
  new_test_context tmpdir

  TEST_ROOT="$tmpdir"
  TEST_RESULTS_DIR="$TEST_ROOT/results"
  TEST_WORKSPACE_DIR="$TEST_ROOT/workspace"
  KASEKI_RESULTS_DIR="$TEST_RESULTS_DIR"
  KASEKI_WORKSPACE_DIR="$TEST_WORKSPACE_DIR"
  FILTER_DIAGNOSTICS_LOG="$TEST_RESULTS_DIR/filter-diagnostics.log"
  FILTER_STDERR_FILE="$TEST_RESULTS_DIR/filter-stderr.log"
  export KASEKI_RESULTS_DIR KASEKI_WORKSPACE_DIR FILTER_DIAGNOSTICS_LOG FILTER_STDERR_FILE

  mkdir -p "$TEST_RESULTS_DIR" "$TEST_WORKSPACE_DIR"
  [ -n "$KASEKI_WORKSPACE_DIR" ] || fail "KASEKI_WORKSPACE_DIR is not set"
  rm -rf "$KASEKI_WORKSPACE_DIR/repo"
  : > "$FILTER_DIAGNOSTICS_LOG"
  : > "$FILTER_STDERR_FILE"

  cd "$TEST_ROOT"
  reset_validation_state

  set +e
  run_validation_commands \
    "validation" \
    "npm run check" \
    "$TEST_RESULTS_DIR/validation.log" \
    "$TEST_RESULTS_DIR/validation-raw.log" \
    "$TEST_RESULTS_DIR/validation-timings.tsv" \
    "$TEST_RESULTS_DIR/validation-environment.log" \
    "validation_command_failed"
  helper_exit=$?
  set -e

  [ "$helper_exit" -eq 1 ] || fail "validation helper should fail when the temp workspace repo is missing, got $helper_exit"
  assert_file_contains_literal "$TEST_RESULTS_DIR/validation.log" "ERROR: Working directory $KASEKI_WORKSPACE_DIR/repo does not exist before validation" "validation.log should contain the production checkpoint error for the temp workspace"
  assert_file_contains_literal "$TEST_RESULTS_DIR/stage-timings.tsv" "directory_missing" "stage timings should classify the missing workspace directory"
  [ "$VALIDATION_FAILURE_REASON" = "validation_command_failed: workspace_missing" ] || fail "unexpected failure reason: $VALIDATION_FAILURE_REASON"
  [ ! -e "$KASEKI_WORKSPACE_DIR/repo" ] || fail "test must not create unrelated workspace repo fixture state"
  pass "Production validation helper logs missing workspace checkpoint"
}

printf '==> Validation missing workspace checkpoint contract\n'
test_missing_workspace_checkpoint
