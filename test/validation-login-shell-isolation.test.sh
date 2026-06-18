#!/usr/bin/env bash
# Validate that pre-agent validation commands do not source login shell profiles.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=test/helpers/validation-contract-helpers.sh
source "$SCRIPT_DIR/helpers/validation-contract-helpers.sh"

test_login_shell_profile_isolation() {
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

printf '==> Validation login shell/profile isolation contract\n'
test_login_shell_profile_isolation
