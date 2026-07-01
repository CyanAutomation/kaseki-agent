#!/usr/bin/env bash
# Validate user-facing diagnostics emitted by validation command failures.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=test/helpers/validation-contract-helpers.sh
source "$SCRIPT_DIR/helpers/validation-contract-helpers.sh"

test_validation_reports_deleted_working_directory() {
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
  assert_diagnostic_log_contains "$quality_log" '\[DIAGNOSTICS\] Validation command failed with directory access error:' '[DIAGNOSTICS] Validation command failed with directory access error:'
  assert_diagnostic_log_contains "$quality_log" 'Working directory status:' 'Working directory status:'
  assert_diagnostic_log_contains "$quality_log" '.*/repo exists: no' '/repo exists: no'
  assert_diagnostic_log_contains "$validation_log" 'Validation failed: first failing command was' 'Validation failed: first failing command was'

  pass "Deleted working-directory validation failure emitted diagnostics"
}

printf '==> Validation diagnostics contract\n'
test_validation_reports_deleted_working_directory
