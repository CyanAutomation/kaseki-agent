#!/usr/bin/env bash
# Validate directory diagnostics emitted when validation output indicates cwd failures.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=test/helpers/validation-contract-helpers.sh
source "$SCRIPT_DIR/helpers/validation-contract-helpers.sh"

test_directory_diagnostics_from_command_output() {
  local tmpdir fixture
  new_production_validation_context tmpdir
  fixture="$TEST_ROOT/fixture-diagnostics"
  create_validation_script_fixture_repo "$fixture"
  use_workspace_repo_fixture "$fixture"
  cd "$KASEKI_WORKSPACE_DIR/repo"
  reset_production_validation_state

  run_production_validation_helper "validation" "npm run diagnose"

  [ "$helper_exit" -eq 9 ] || fail "validation helper should preserve failing command exit 9, got $helper_exit"
  assert_file_contains_literal "$TEST_RESULTS_DIR/validation.log" "Error: getcwd: cannot access parent directories: No such file or directory" "validation.log should contain the real command stderr"
  assert_file_contains_literal "$TEST_RESULTS_DIR/validation.log" "Validation failed: first failing command was \"npm run diagnose\" with exit 9" "validation.log should record the failed production command"
  assert_file_contains_literal "$KASEKI_RESULTS_DIR/quality.log" "[DIAGNOSTICS] Validation command failed with directory access error:" "quality.log should include production directory diagnostics"
  assert_file_contains_literal "$KASEKI_RESULTS_DIR/quality.log" "  $KASEKI_WORKSPACE_DIR/repo exists: yes" "quality.log should report workspace fixture status"
  pass "Production validation helper emits directory diagnostics from real failing command output"
}

printf '==> Validation directory diagnostics contract\n'
test_directory_diagnostics_from_command_output
