#!/usr/bin/env bash
# Validate explicit env-log argument handling for pre-agent validation state variables.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=test/helpers/validation-contract-helpers.sh
source "$SCRIPT_DIR/helpers/validation-contract-helpers.sh"

test_pre_agent_validation_env_log_argument() {
  local tmpdir fixture pre_raw_log pre_timings_file pre_env_log pre_helper_exit
  new_production_validation_context tmpdir
  fixture="$TEST_ROOT/fixture-pre-agent"
  pre_raw_log="$TEST_RESULTS_DIR/pre-validation-raw.log"
  pre_timings_file="$TEST_RESULTS_DIR/pre-validation-timings.tsv"
  pre_env_log="$TEST_RESULTS_DIR/pre-agent-validation-env.log"

  create_validation_script_fixture_repo "$fixture"
  use_workspace_repo_fixture "$fixture"
  cd "$KASEKI_WORKSPACE_DIR/repo"
  reset_production_validation_state

  : > "$pre_raw_log"
  : > "$pre_timings_file"
  rm -f "$pre_env_log"
  : > "$FILTER_DIAGNOSTICS_LOG"
  : > "$FILTER_STDERR_FILE"

  PRE_VALIDATION_EXIT="not-numeric-before-call"

  set +e
  run_validation_commands \
    "pre-agent validation" \
    "npm run check" \
    /dev/null \
    "$pre_raw_log" \
    "$pre_timings_file" \
    "$pre_env_log" \
    "pre_agent_validation_failed" \
    PRE_VALIDATION_EXIT \
    PRE_VALIDATION_FAILED_COMMAND_DETAIL \
    PRE_VALIDATION_FAILURE_REASON \
    PRE_VALIDATION_STOPPED_EARLY \
    PRE_VALIDATION_COMMANDS_ATTEMPTED
  pre_helper_exit=$?
  set -e

  [ "$pre_helper_exit" -eq 0 ] || fail "pre-agent validation helper should pass, got $pre_helper_exit"
  [[ "$PRE_VALIDATION_EXIT" =~ ^[0-9]+$ ]] || fail "PRE_VALIDATION_EXIT should remain numeric, got $PRE_VALIDATION_EXIT"
  [ "$PRE_VALIDATION_EXIT" -eq 0 ] || fail "PRE_VALIDATION_EXIT should be 0 for successful commands, got $PRE_VALIDATION_EXIT"
  assert_file_contains_literal "$pre_env_log" "[validation command] stage=pre-agent validation" "pre-agent env log should include stage metadata"
  assert_file_contains_literal "$pre_env_log" "[validation command] command=npm run check" "pre-agent env log should include command metadata"
  pass "Pre-agent validation helper writes env metadata to explicit env-log path"
}

printf '==> Validation env-log argument contract\n'
test_pre_agent_validation_env_log_argument
