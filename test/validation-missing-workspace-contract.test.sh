#!/usr/bin/env bash
# Validate the production helper checkpoints a missing workspace before commands run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=test/helpers/validation-contract-helpers.sh
source "$SCRIPT_DIR/helpers/validation-contract-helpers.sh"

test_missing_workspace_checkpoint() {
  local tmpdir
  new_production_validation_context tmpdir
  use_workspace_repo_missing
  cd "$TEST_ROOT"
  reset_production_validation_state

  run_production_validation_helper "validation" "npm run check"

  [ "$helper_exit" -eq 1 ] || fail "validation helper should fail when the temp workspace repo is missing, got $helper_exit"
  assert_file_contains_literal "$TEST_RESULTS_DIR/validation.log" "ERROR: Working directory $KASEKI_WORKSPACE_DIR/repo does not exist before validation" "validation.log should contain the production checkpoint error for the temp workspace"
  assert_file_contains_literal "$TEST_RESULTS_DIR/stage-timings.tsv" "directory_missing" "stage timings should classify the missing workspace directory"
  [ "$VALIDATION_FAILURE_REASON" = "validation_command_failed: workspace_missing" ] || fail "unexpected failure reason: $VALIDATION_FAILURE_REASON"
  pass "Production validation helper logs missing workspace checkpoint"
}

printf '==> Validation missing workspace checkpoint contract\n'
test_missing_workspace_checkpoint
