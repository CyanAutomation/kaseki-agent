#!/usr/bin/env bash
# Validate that pre-agent validation commands execute in the cloned repository.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=test/helpers/validation-contract-helpers.sh
source "$SCRIPT_DIR/helpers/validation-contract-helpers.sh"

test_validation_command_cwd() {
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

printf '==> Validation command working-directory contract\n'
test_validation_command_cwd
