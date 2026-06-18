#!/usr/bin/env bash
# Validate diagnostics when the validation command loses access to its working directory.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=test/helpers/validation-contract-helpers.sh
source "$SCRIPT_DIR/helpers/validation-contract-helpers.sh"

test_deleted_working_directory_diagnostics() {
  local tmpdir fake_repo run_log run_exit quality_log validation_log
  new_test_context tmpdir
  fake_repo="$tmpdir/fake-repo"
  run_log="$tmpdir/kaseki-agent.log"
  quality_log="$tmpdir/results/quality.log"
  validation_log="$tmpdir/results/pre-validation.log"
  create_controlled_repo "$fake_repo" 1

  if run_kaseki_agent_for_validation \
    "$tmpdir" \
    "$fake_repo" \
    "npm run validate" \
    "$run_log" \
    SIMULATE_GETCWD_FAILURE=1; then
    run_exit=0
  else
    run_exit=$?
  fi

  [ "$run_exit" -eq 1 ] || fail "kaseki-agent.sh should return exit 1 when validation hits the simulated getcwd failure (exit $run_exit)"
  assert_file_contains "$quality_log" '\[DIAGNOSTICS\] Validation command failed with directory access error:' "Directory-access failure did not emit user-facing diagnostics"
  assert_file_contains "$quality_log" 'Working directory status:' "Directory-access diagnostics did not summarize working directory status"
  assert_file_contains "$quality_log" '.*/repo exists: no' "Directory-access diagnostics did not report the missing repo directory"
  assert_file_contains "$validation_log" 'Validation failed: first failing command was' "Validation log did not summarize the failing validation command"

  pass "Deleted working-directory validation failure emitted diagnostics"
}

printf '==> Deleted working-directory diagnostics contract\n'
test_deleted_working_directory_diagnostics
