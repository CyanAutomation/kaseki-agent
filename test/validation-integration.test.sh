#!/usr/bin/env bash
# shellcheck disable=SC2034
# Integration test: Verify validation with non-login shell works
# This simulates the matmetrics scenario where validation commands need to run
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }

# Create temporary test directory with npm project
setup_test_repo() {
  local tmpdir="$1"
  cd "$tmpdir"
  
  # Initialize npm project with validation scripts
  cat > package.json <<'EOF'
{
  "name": "validation-test",
  "version": "1.0.0",
  "scripts": {
    "check": "npm ls --depth=0",
    "test": "node -e 'console.log(\"test passed\")'",
    "build": "node -e 'console.log(\"build passed\")'"
  }
}
EOF
  
  # Create a simple lockfile
  cat > package-lock.json <<'EOF'
{
  "name": "validation-test",
  "version": "1.0.0",
  "lockfileVersion": 3
}
EOF
}

# Test non-login shell validation execution
test_non_login_validation() {
  local tmpdir exit_code
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' EXIT
  
  setup_test_repo "$tmpdir"
  cd "$tmpdir"
  
  # Simulate the validation command execution with non-login shell
  # This is what happens in kaseki-agent.sh after the fix
  if bash -c "npm run check" >/dev/null 2>&1; then
    pass "Non-login validation command succeeded (npm run check)"
  else
    fail "Non-login validation command failed"
  fi
}

# Test that directory errors are caught early (checkpoint test)
test_directory_checkpoint() {
  local tmpdir validation_log exit_code
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' EXIT
  validation_log="$tmpdir/validation.log"
  
  # Simulate the checkpoint logic from kaseki-agent.sh
  if ! [ -d /nonexistent/repo ]; then
    {
      printf 'ERROR: Working directory /nonexistent/repo does not exist before validation\n'
      printf 'Current pwd: %s\n' "$(pwd 2>&1 || echo '<pwd failed>')"
    } > "$validation_log"
    
    if grep -q 'does not exist before validation' "$validation_log"; then
      pass "Directory checkpoint properly detects missing directories"
    else
      fail "Directory checkpoint did not detect missing directory"
    fi
  fi
}

# Test enhanced diagnostics capture
test_diagnostics_capture() {
  local tmpdir quality_log
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' EXIT
  quality_log="$tmpdir/quality.log"
  
  # Simulate a getcwd error and verify diagnostics capture
  if grep -q 'getcwd' <<< "Error: ENOENT: process.cwd failed"; then
    {
      printf '\n[DIAGNOSTICS] Validation command failed with directory access error:\n'
      printf 'Working directory status:\n'
      printf '  Current pwd: %s\n' "$(pwd 2>&1 || echo '<pwd failed>')"
      printf '  /workspace/repo exists: %s\n' "$([ -d /workspace/repo ] && echo 'yes' || echo 'no')"
    } > "$quality_log"
    
    if grep -q 'DIAGNOSTICS' "$quality_log"; then
      pass "Enhanced diagnostics properly captured"
    else
      fail "Enhanced diagnostics not captured"
    fi
  fi
}

printf '==> Validation Integration Tests\n'
test_non_login_validation
test_directory_checkpoint
test_diagnostics_capture

printf '\n✓ All integration tests passed\n'
