#!/usr/bin/env bash
# Validate startup validation command execution contracts without exercising later agent phases.
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


test_validation_commands_do_not_source_login_profiles() {
  local tmpdir fake_repo home_dir login_marker run_log run_exit
  new_test_context tmpdir
  fake_repo="$tmpdir/fake-repo"
  home_dir="$tmpdir/home"
  login_marker="$home_dir/login-shell-marker.txt"
  run_log="$tmpdir/kaseki-agent.log"
  mkdir -p "$home_dir"
  create_controlled_repo "$fake_repo" 1

  cat > "$home_dir/.bash_profile" <<'EOF_PROFILE'
printf 'login shell profile was sourced\n' > "$HOME/login-shell-marker.txt"
EOF_PROFILE

  if run_kaseki_agent_for_validation \
    "$tmpdir" \
    "$fake_repo" \
    "npm run validate" \
    "$run_log" \
    LOGIN_MARKER="$login_marker"; then
    run_exit=0
  else
    run_exit=$?
  fi

  assert_agent_completed "$run_exit" "$run_log" "kaseki-agent.sh failed while running the fake validation command"
  [ ! -e "$login_marker" ] || fail "Validation command used a login shell and sourced $home_dir/.bash_profile"

  pass "Validation command did not source login shell profiles"
}

test_pre_agent_validation_runs_during_baseline_dry_run() {
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

  pass "Pre-agent validation runs during baseline-validation dry-run checks"
}


test_validation_command_rejects_shell_metacharacters() {
  local tmpdir fake_repo marker run_log run_exit
  new_test_context tmpdir
  fake_repo="$tmpdir/fake-repo"
  marker="$tmpdir/injected-marker.txt"
  run_log="$tmpdir/kaseki-agent.log"
  create_controlled_repo "$fake_repo" 1

  if run_kaseki_agent_for_validation \
    "$tmpdir" \
    "$fake_repo" \
    "npm run validate;touch $marker" \
    "$run_log"; then
    run_exit=0
  else
    run_exit=$?
  fi

  [ "$run_exit" -ne 0 ] || fail "Unsafe validation command should reject the run"
  [ ! -e "$marker" ] || fail "Rejected validation command executed shell injection payload"
  assert_file_contains "$tmpdir/results/pre-validation.log" 'Validation command rejected by security allowlist: touch .*contains shell metacharacters|Validation command rejected by security allowlist: touch .*not on the validation command allowlist' "pre-validation log should record rejected command"
  pass "Validation command allowlist rejects shell metacharacter injection"
}

printf '==> Validation command execution contract\n'
test_validation_command_runs_in_cloned_repository_cwd
test_validation_commands_do_not_source_login_profiles
test_validation_command_rejects_shell_metacharacters
test_pre_agent_validation_runs_during_baseline_dry_run
