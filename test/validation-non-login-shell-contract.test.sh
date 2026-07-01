#!/usr/bin/env bash
# Validate production helper command execution through a non-login bash shell.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=test/helpers/validation-contract-helpers.sh
source "$SCRIPT_DIR/helpers/validation-contract-helpers.sh"

test_non_login_validation_helper_execution() {
  local tmpdir fixture
  new_production_validation_context tmpdir
  fixture="$TEST_ROOT/fixture-success"
  create_validation_script_fixture_repo "$fixture"
  use_workspace_repo_fixture "$fixture"
  cd "$KASEKI_WORKSPACE_DIR/repo"
  reset_production_validation_state

  run_production_validation_helper "validation" "npm run check"

  [ "$helper_exit" -eq 0 ] || fail "validation helper should pass, got $helper_exit"
  assert_file_contains_literal "$TEST_RESULTS_DIR/validation.log" "==> npm run check" "validation.log should include the command boundary"
  assert_file_contains_literal "$TEST_RESULTS_DIR/validation.log" "fixture check passed" "validation.log should include real command output"
  assert_file_contains_literal "$TEST_RESULTS_DIR/validation.log" "[validation pipeline] statuses: command=0 tee=0 filter=0" "validation.log should include production pipeline statuses"
  assert_file_contains_literal "$TEST_RESULTS_DIR/validation-timings.tsv" $'npm run check\t0' "validation timings should record the real command exit"
  pass "Production validation helper runs fixture npm command through non-login shell"
}

printf '==> Validation non-login shell execution contract\n'
test_non_login_validation_helper_execution
