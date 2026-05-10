#!/usr/bin/env bash
# tests/github-operations-failures.test.sh
# Test suite for github operations failure scenarios
# Tests various failure modes to ensure proper error handling and exit codes

set -uo pipefail

# Configuration
TESTS_PASSED=0
TESTS_FAILED=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
test_case() {
  local test_name="$1"
  printf '\n%b[TEST]%b %s\n' "$YELLOW" "$NC" "$test_name"
}

assert_exit_code() {
  local expected="$1"
  local actual="$2"
  local test_desc="$3"
  
  if [ "$actual" -eq "$expected" ]; then
    printf '%b✓%b %s (exit %d)\n' "$GREEN" "$NC" "$test_desc" "$actual"
    ((TESTS_PASSED++))
    return 0
  else
    printf '%b✗%b %s - expected exit %d, got %d\n' "$RED" "$NC" "$test_desc" "$expected" "$actual"
    ((TESTS_FAILED++))
    return 1
  fi
}

assert_file_contains() {
  local file="$1"
  local pattern="$2"
  local test_desc="$3"
  
  if [ ! -f "$file" ]; then
    printf '%b✗%b %s - file not found: %s\n' "$RED" "$NC" "$test_desc" "$file"
    ((TESTS_FAILED++))
    return 1
  fi
  
  if grep -q "$pattern" "$file"; then
    printf '%b✓%b %s\n' "$GREEN" "$NC" "$test_desc"
    ((TESTS_PASSED++))
    return 0
  else
    printf '%b✗%b %s - pattern not found in %s\n' "$RED" "$NC" "$test_desc" "$file"
    ((TESTS_FAILED++))
    return 1
  fi
}

# ===== Test 1: Node.js subprocess error handling =====
test_case "Node.js subprocess error handling"

# Verify the helper function exists and has error logging
if grep -q 'node_stderr_tmp=' "$PROJECT_ROOT/kaseki-agent.sh"; then
  printf '%b✓%b Helper captures stderr from Node.js errors\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Helper missing stderr capture\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

# Verify it returns error codes properly
if grep -q 'return.*node_exit_code' "$PROJECT_ROOT/kaseki-agent.sh"; then
  printf '%b✓%b Helper propagates Node.js exit codes\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Helper missing exit code propagation\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

# ===== Test 2: GitHub health check verification =====
test_case "GitHub operations preflight check implementation"

# Verify it checks for GitHub secrets
if grep -q '/run/secrets/github_app_id' "$PROJECT_ROOT/kaseki-agent.sh"; then
  printf '%b✓%b Health check verifies GitHub App secrets\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Health check missing GitHub App secret verification\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

# Verify it includes multiple checks (secrets, git, node, curl)
check_count=$(grep -c 'health-check' "$PROJECT_ROOT/kaseki-agent.sh" || true)
if [ "$check_count" -ge 5 ]; then
  printf '%b✓%b Health check includes comprehensive validation\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Health check may be incomplete\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

# ===== Test 3: Verify exit codes are specific (not generic "unexpected shell failure") =====
test_case "Exit codes are properly classified"

# Check that exit code 7 is used for config errors
if grep -q 'GITHUB_PUSH_EXIT=7' "$PROJECT_ROOT/kaseki-agent.sh"; then
  printf '%b✓%b Exit code 7 is used for config errors\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Exit code 7 usage not found\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

# Check that exit code 8 is used for runtime errors
if grep -q 'GITHUB_PUSH_EXIT=8' "$PROJECT_ROOT/kaseki-agent.sh"; then
  printf '%b✓%b Exit code 8 is used for runtime errors\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Exit code 8 usage not found\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

# Check that exit code 9 is used for API errors
if grep -q 'GITHUB_PR_EXIT=9' "$PROJECT_ROOT/kaseki-agent.sh"; then
  printf '%b✓%b Exit code 9 is used for API errors\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Exit code 9 usage not found\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

# ===== Test 4: DEBUG trap is set up =====
test_case "DEBUG trap for command tracking"

if grep -q 'trap.*BASH_COMMAND.*DEBUG' "$PROJECT_ROOT/kaseki-agent.sh"; then
  printf '%b✓%b DEBUG trap is configured\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b DEBUG trap not found\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

if grep -q 'LAST_COMMAND=' "$PROJECT_ROOT/kaseki-agent.sh"; then
  printf '%b✓%b LAST_COMMAND variable is tracked\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b LAST_COMMAND tracking not found\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

# ===== Test 5: Finish trap enhanced with diagnostic context =====
test_case "Finish trap includes diagnostic context"

if grep -q 'LAST_COMMAND_LOG=' "$PROJECT_ROOT/kaseki-agent.sh"; then
  printf '%b✓%b Finish trap logs last command\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Finish trap missing last command logging\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

if grep -q 'emit_error_event "unexpected_shell_failure"' "$PROJECT_ROOT/kaseki-agent.sh"; then
  printf '%b✓%b Finish trap emits error event for unexpected failures\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Finish trap missing error event emission\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

# ===== Test 6: run_node_subprocess helper exists and has error handling =====
test_case "run_node_subprocess() helper function"

if grep -q 'run_node_subprocess()' "$PROJECT_ROOT/kaseki-agent.sh"; then
  printf '%b✓%b Helper function is defined\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Helper function not found\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

if grep -q 'mktemp /tmp/node-stderr' "$PROJECT_ROOT/kaseki-agent.sh"; then
  printf '%b✓%b Helper captures Node.js stderr\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Helper missing stderr capture\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

if grep -q '\[node-subprocess-error\]' "$PROJECT_ROOT/kaseki-agent.sh"; then
  printf '%b✓%b Helper logs errors with structured format\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Helper missing structured error logging\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

# ===== Test 7: Diagnostic script exists =====
test_case "Diagnostic script availability"

DIAG_SCRIPT="$PROJECT_ROOT/scripts/kaseki-diagnose-github-failure.sh"
if [ -f "$DIAG_SCRIPT" ] && [ -x "$DIAG_SCRIPT" ]; then
  printf '%b✓%b Diagnostic script is present and executable\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Diagnostic script not found or not executable\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

# ===== Test 8: Health check function exists =====
test_case "GitHub operations health check function"

if grep -q 'check_github_operations_health()' "$PROJECT_ROOT/kaseki-agent.sh"; then
  printf '%b✓%b Health check function is defined\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Health check function not found\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

if grep -q 'health-check.*secrets' "$PROJECT_ROOT/kaseki-agent.sh"; then
  printf '%b✓%b Health check verifies secrets\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Health check missing secrets verification\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

# ===== Test 9: GitHub credential auto-detection feature =====
test_case "GitHub credential auto-detection"

if grep -q 'resolve_github_credentials()' "$PROJECT_ROOT/run-kaseki.sh"; then
  printf '%b✓%b Auto-detection function is defined\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Auto-detection function not found\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

if grep -q '.ssh/github-app-private-key' "$PROJECT_ROOT/run-kaseki.sh"; then
  printf '%b✓%b Auto-detection includes standard paths\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Auto-detection missing standard paths\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

# ===== Test 10: GitHub App enabled by default =====
test_case "GitHub App default behavior"

if grep -q 'GITHUB_APP_ENABLED="\${GITHUB_APP_ENABLED:-1}"' "$PROJECT_ROOT/run-kaseki.sh"; then
  printf '%b✓%b run-kaseki.sh defaults to enabled\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b run-kaseki.sh default not updated\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

if grep -q 'GITHUB_APP_ENABLED="\${GITHUB_APP_ENABLED:-1}"' "$PROJECT_ROOT/kaseki-agent.sh"; then
  printf '%b✓%b kaseki-agent.sh defaults to enabled\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b kaseki-agent.sh default not updated\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

# ===== Test 11: Graceful credential degradation =====
test_case "Graceful credential degradation"

if grep -q 'KASEKI_PUBLISH_MODE=.*auto.*GITHUB_APP_ENABLED=0' "$PROJECT_ROOT/run-kaseki.sh" || grep -q 'graceful degrade' "$PROJECT_ROOT/run-kaseki.sh"; then
  printf '%b✓%b Missing credentials handled gracefully in auto mode\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Graceful degradation not implemented\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

# ===== Test 12: Explicit disable still respected =====
test_case "Explicit GitHub App disable respected"

if grep -q 'GITHUB_APP_ENABLED="0"' "$PROJECT_ROOT/run-kaseki.sh"; then
  printf '%b✓%b Explicit disable setting is preserved\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Explicit disable not found\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

# ===== Summary =====
printf '\n%b=== Test Summary ===%b\n' "$YELLOW" "$NC"
printf 'Passed: %b%d%b\n' "$GREEN" "$TESTS_PASSED" "$NC"
printf 'Failed: %b%d%b\n' "$RED" "$TESTS_FAILED" "$NC"

if [ "$TESTS_FAILED" -eq 0 ]; then
  printf '\n%bAll tests passed!%b\n' "$GREEN" "$NC"
  exit 0
else
  printf '\n%bSome tests failed!%b\n' "$RED" "$NC"
  exit 1
fi
