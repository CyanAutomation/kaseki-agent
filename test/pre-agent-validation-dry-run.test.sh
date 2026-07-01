#!/usr/bin/env bash
# Validate pre-agent validation's dry-run exception without exercising later agent phases.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=test/helpers/validation-contract-helpers.sh
source "$SCRIPT_DIR/helpers/validation-contract-helpers.sh"

test_validation_command_runs_in_cloned_repository_cwd() {
  local tmpdir fake_repo marker run_log run_exit
  new_test_context tmpdir
  fake_repo="$tmpdir/fake-repo"
  marker="$tmpdir/validation-marker.txt"
  run_log="$tmpdir/kaseki-agent.log"
  create_controlled_repo "$fake_repo" 1

  if run_kaseki_agent_for_validation \
    "$tmpdir" \
    "$fake_repo" \
    "npm run validate" \
    "$run_log" \
    VALIDATION_MARKER="$marker"; then
    run_exit=0
  else
    run_exit=$?
  fi

  assert_agent_completed "$run_exit" "$run_log" "kaseki-agent.sh failed while running the fake validation command"
  [ -f "$marker" ] || fail "Validation marker was not written by the fake package script"
  assert_file_contains "$marker" "^cwd=${tmpdir}/workspace/repo$" "Validation command did not run in the cloned repository cwd"
  assert_file_contains "$tmpdir/results/pre-validation-timings.tsv" '^npm run validate[[:space:]]+0[[:space:]]' "pre-validation timings did not record successful npm run validate command"

  pass "Validation command ran in the cloned repository cwd"
}

test_pre_agent_validation_executes_in_baseline_dry_run() {
  local tmpdir fake_repo marker run_log run_exit
  new_test_context tmpdir
  fake_repo="$tmpdir/fake-repo"
  marker="$tmpdir/validation-marker.txt"
  run_log="$tmpdir/kaseki-agent.log"
  create_controlled_repo "$fake_repo" 1

  if run_kaseki_agent_for_validation \
    "$tmpdir" \
    "$fake_repo" \
    "npm run validate" \
    "$run_log" \
    VALIDATION_MARKER="$marker"; then
    run_exit=0
  else
    run_exit=$?
  fi

  assert_agent_completed "$run_exit" "$run_log" "kaseki-agent.sh failed in baseline dry-run pre-agent validation"
  [ -f "$marker" ] || fail "Pre-agent validation should execute during baseline-validation dry-run startup checks"
  assert_file_contains "$tmpdir/results/pre-validation-timings.tsv" '^npm run validate[[:space:]]+0[[:space:]]' "pre-agent dry-run exception did not record executed command timing"

  pass "Pre-agent validation executes during baseline-validation dry-run checks"
}

printf '==> Focused validation command execution contract\n'
test_validation_command_runs_in_cloned_repository_cwd
test_pre_agent_validation_executes_in_baseline_dry_run
