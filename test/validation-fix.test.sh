#!/usr/bin/env bash
# Test for validation shell fix (non-login shell + directory checkpoint)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck disable=SC2034 # RUNNER is kept for potential test extensions
RUNNER="$REPO_ROOT/run-kaseki.sh"

pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }

# Test 1: Verify non-login shell syntax in kaseki-agent.sh
test_non_login_shell_syntax() {
  local line
  # shellcheck disable=SC2016 # The $ escape is intentional for grep pattern matching
  line=$(grep -n 'bash -c "\$trimmed"' "$REPO_ROOT/kaseki-agent.sh" | head -1 | cut -d: -f1)
  [ -n "$line" ] || fail "Non-login shell (bash -c) not found in kaseki-agent.sh"
  pass "Non-login shell syntax found at line $line"
  
  # Ensure old login shell is gone
  if grep -q 'bash -lc "\$trimmed"' "$REPO_ROOT/kaseki-agent.sh"; then
    fail "Old login shell syntax (bash -lc) still present in kaseki-agent.sh"
  fi
  pass "Old login shell syntax removed"
}

# Test 2: Verify directory checkpoint exists
test_directory_checkpoint() {
  if grep -q 'Working directory /workspace/repo does not exist before validation' "$REPO_ROOT/kaseki-agent.sh"; then
    pass "Directory checkpoint found in kaseki-agent.sh"
  else
    fail "Directory checkpoint not found"
  fi
}

# Test 3: Verify enhanced diagnostics exist
test_enhanced_diagnostics() {
  if grep -q 'getcwd.*No such file or directory.*cannot access parent directories' "$REPO_ROOT/kaseki-agent.sh"; then
    pass "Enhanced diagnostics for getcwd errors found"
  else
    fail "Enhanced diagnostics not found"
  fi
}

# Test 4: Verify script syntax is still valid
test_script_syntax() {
  if bash -n "$REPO_ROOT/kaseki-agent.sh" >/dev/null 2>&1; then
    pass "kaseki-agent.sh bash syntax is valid"
  else
    fail "kaseki-agent.sh has syntax errors"
  fi
}

# Test 5: Verify non-login shell works for npm commands (integration test)
test_non_login_npm_command() {
  local tmpdir exit_code
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' EXIT
  
  cd "$tmpdir"
  npm init -y >/dev/null 2>&1
  npm install eslint >/dev/null 2>&1
  
  # Test that non-login bash can run npm commands
  if bash -c "npm --version" >/dev/null 2>&1; then
    pass "Non-login shell can execute npm commands"
  else
    fail "Non-login shell cannot execute npm commands"
  fi
}

# Run all tests
printf '==> Validation Fix Tests\n'
test_non_login_shell_syntax
test_directory_checkpoint
test_enhanced_diagnostics
test_script_syntax
test_non_login_npm_command

printf '\n✓ All validation fix tests passed\n'
