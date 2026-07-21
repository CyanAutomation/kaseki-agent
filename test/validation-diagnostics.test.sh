#!/usr/bin/env bash
# Validate user-facing diagnostics emitted by validation command failures.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=test/helpers/validation-contract-helpers.sh
source "$SCRIPT_DIR/helpers/validation-contract-helpers.sh"

test_deleted_working_directory_diagnostic_formatting() {
  local tmpdir validation_log quality_log
  new_production_validation_context tmpdir
  validation_log="$TEST_RESULTS_DIR/pre-validation.log"
  quality_log="$TEST_RESULTS_DIR/quality.log"
  printf 'Error: getcwd: cannot access parent directories\n' > "$validation_log"
  use_workspace_repo_missing

  append_validation_directory_diagnostics "$validation_log" "$quality_log" >/dev/null

  assert_validation_directory_diagnostics "$quality_log" no 'Error: getcwd: cannot access parent directories'
  assert_file_contains_literal "$validation_log" 'Error: getcwd: cannot access parent directories' 'pre-validation.log should retain the original failure'

  pass "Deleted working-directory diagnostics are formatted by the helper"
}

printf '==> Validation diagnostics contract\n'
test_deleted_working_directory_diagnostic_formatting
