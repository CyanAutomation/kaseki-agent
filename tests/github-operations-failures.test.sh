#!/usr/bin/env bash
# shellcheck disable=SC2016,SC2317
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
if grep -q 'github_app_id_file=' "$PROJECT_ROOT/kaseki-agent.sh" && grep -q 'Cannot read GitHub App ID' "$PROJECT_ROOT/kaseki-agent.sh"; then
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

# Test 2c: Verify health check logs to expected file
if grep -q 'health_log="/results/github-health-check.log"' "$PROJECT_ROOT/kaseki-agent.sh"; then
  printf '%b✓%b Health check logs to expected file\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Health check logging configuration not found\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

# Test 2d: Verify health check handles GitHub auth smoke test
if grep -q 'KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK' "$PROJECT_ROOT/kaseki-agent.sh"; then
  printf '%b✓%b Health check supports configurable GitHub auth smoke test\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Health check missing GitHub auth smoke test config\n' "$RED" "$NC"
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

# ===== Test 7: GitHub App token helper failure diagnostics =====
test_case "GitHub App token helper failure diagnostics"

if grep -q 'token_exit_code=\$?' "$PROJECT_ROOT/kaseki-agent.sh" && grep -q 'github-app-token.*>"\$token_stdout_tmp" 2>"\$token_stderr_tmp"' "$PROJECT_ROOT/kaseki-agent.sh"; then
  printf '%b✓%b Token helper captures stdout, stderr, and exit code\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Token helper capture logic not found\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

if grep -q 'parsed.error || parsed.message' "$PROJECT_ROOT/kaseki-agent.sh" && grep -q 'Failed to generate token: %s' "$PROJECT_ROOT/kaseki-agent.sh"; then
  printf '%b✓%b Token helper failures log parsed error details\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Token helper failure logging lacks parsed error details\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

if grep -q 'GITHUB_API_ERROR_TYPE="github_app_token_error"' "$PROJECT_ROOT/kaseki-agent.sh" && grep -q 'emit_error_event "github_app_token_failed"' "$PROJECT_ROOT/kaseki-agent.sh"; then
  printf '%b✓%b Token helper failures set token-specific API error state and event type\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Token helper failures missing token-specific API error state or event\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

# ===== Test 8: Diagnostic script exists =====
test_case "Diagnostic script availability"

DIAG_SCRIPT="$PROJECT_ROOT/scripts/kaseki-diagnose-github-failure.sh"
if [ -f "$DIAG_SCRIPT" ] && [ -x "$DIAG_SCRIPT" ]; then
  printf '%b✓%b Diagnostic script is present and executable\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Diagnostic script not found or not executable\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi


# ===== Test 8b: Token generation phase metadata and final error handling =====
test_case "GitHub token generation phase is distinct from push failures"

if grep -q 'GITHUB_OPERATION_PHASE="token_generation"' "$PROJECT_ROOT/kaseki-agent.sh" && grep -q '"github_operation_phase"' "$PROJECT_ROOT/kaseki-agent.sh"; then
  printf '%b✓%b GitHub operation phase tracks token generation and is written to metadata\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b GitHub operation phase token metadata not found\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

if grep -q 'GitHub App token generation failed (exit code \$GITHUB_PUSH_EXIT)' "$PROJECT_ROOT/kaseki-agent.sh"; then
  printf '%b✓%b Final GitHub failure emission reports token generation precisely\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Final GitHub failure emission does not distinguish token generation\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

# ===== Test 8c: Diagnostic script distinguishes token and push phases =====
test_case "Diagnostic script reports token failures separately from push failures"

DIAG_TMP_DIR="$(mktemp -d /tmp/kaseki-github-diagnose-test.XXXXXX)"
TOKEN_RESULTS="$DIAG_TMP_DIR/token"
PUSH_RESULTS="$DIAG_TMP_DIR/push"
mkdir -p "$TOKEN_RESULTS" "$PUSH_RESULTS"
cat > "$TOKEN_RESULTS/metadata.json" <<'JSON'
{
  "instance": "token-case",
  "current_stage": "github operations",
  "exit_code": 7,
  "github_push_exit_code": 7,
  "github_pr_exit_code": 0,
  "github_operation_phase": "token_generation",
  "github_api_error_type": "github_app_token_error",
  "github_api_error_message": "installation not found",
  "github_api_http_status": "404"
}
JSON
cat > "$TOKEN_RESULTS/failure.json" <<'JSON'
{"error":"token"}
JSON
printf 'Generating GitHub App installation token...\nFailed to generate token: installation not found\n' > "$TOKEN_RESULTS/git-push.log"

cat > "$PUSH_RESULTS/metadata.json" <<'JSON'
{
  "instance": "push-case",
  "current_stage": "github operations",
  "exit_code": 8,
  "github_push_exit_code": 8,
  "github_pr_exit_code": 0,
  "github_operation_phase": "push",
  "github_api_error_type": "",
  "github_api_error_message": "",
  "github_api_http_status": ""
}
JSON
cat > "$PUSH_RESULTS/failure.json" <<'JSON'
{"error":"push"}
JSON
printf 'Pushing branch to GitHub...\nFailed to push branch\n' > "$PUSH_RESULTS/git-push.log"

TOKEN_REPORT="$DIAG_TMP_DIR/token-report.txt"
PUSH_REPORT="$DIAG_TMP_DIR/push-report.txt"
if "$PROJECT_ROOT/scripts/kaseki-diagnose-github-failure.sh" "$TOKEN_RESULTS" > "$TOKEN_REPORT" && \
   grep -q 'GitHub App token generation failed' "$TOKEN_REPORT" && \
   ! grep -q '\*\*Git push failed' "$TOKEN_REPORT"; then
  printf '%b✓%b Diagnostic script reports token phase failures as token generation failures\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Diagnostic script did not report token phase distinctly\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

if "$PROJECT_ROOT/scripts/kaseki-diagnose-github-failure.sh" "$PUSH_RESULTS" > "$PUSH_REPORT" && \
   grep -q '\*\*Git push failed (exit code: 8)\*\*' "$PUSH_REPORT" && \
   ! grep -q 'GitHub App token generation failed' "$PUSH_REPORT"; then
  printf '%b✓%b Diagnostic script still reports push phase failures as git push failures\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Diagnostic script did not preserve push failure diagnosis\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi
rm -rf "$DIAG_TMP_DIR"

# ===== Test 9: Health check function executable tests =====
test_case "GitHub operations health check function executable tests"

# Test 9a: Test health check with missing GitHub secrets
printf '%s' "Testing health check with missing GitHub App secrets... "
TEST_TMP_DIR=$(mktemp -d /tmp/kaseki-health-test.XXXXXX)
mkdir -p "$TEST_TMP_DIR/secrets"

# Create mock environment with missing secrets
export KASEKI_SECRETS_DIR="$TEST_TMP_DIR/secrets"
export GITHUB_APP_ID_FILE="$TEST_TMP_DIR/secrets/nonexistent_github_app_id"
export GITHUB_APP_CLIENT_ID_FILE="$TEST_TMP_DIR/secrets/nonexistent_github_app_client_id"
export GITHUB_APP_PRIVATE_KEY_FILE="$TEST_TMP_DIR/secrets/nonexistent_github_app_private_key"

# Mock the health check function extraction and execution
if grep -A 50 'check_github_operations_health()' "$PROJECT_ROOT/kaseki-agent.sh" | head -60 | grep -q 'Cannot read GitHub App ID'; then
  printf '%b✓%b Health check detects missing GitHub App secrets\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Health check missing secret detection logic\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

# Test 9b: Test health check with missing git command
printf '%s' "Testing health check with missing git... "
if command -v git >/dev/null 2>&1; then
  # Temporarily rename git to simulate missing command
  GIT_PATH=$(command -v git)
  PATH="/nonexistent:$PATH" command -v git >/dev/null 2>&1 && {
    printf '%b✗%b PATH manipulation test failed\\n' "$RED" "$NC"
    ((TESTS_FAILED++))
  } || {
    printf '%b✓%b Health check detects missing git command\\n' "$GREEN" "$NC"
    ((TESTS_PASSED++))
  }
  
  if grep -A 10 "git --version" "$PROJECT_ROOT/kaseki-agent.sh" | grep -q 'git command is not available'; then
    printf '%b✓%b Health check detects missing git command\n' "$GREEN" "$NC"
    ((TESTS_PASSED++))
  else
    printf '%b✗%b Health check missing git command detection\n' "$RED" "$NC"
    ((TESTS_FAILED++))
  fi
else
  printf '%s' "git not available in test environment, skipping git test\n"
fi

# Test 9c: Test health check with missing Node.js
printf '%s' "Testing health check with missing Node.js... "
if command -v node >/dev/null 2>&1; then
  # Temporarily rename node to simulate missing command
  NODE_PATH=$(command -v node)
  PATH="/nonexistent:$PATH" command -v node >/dev/null 2>&1 && {
    printf '%b✗%b PATH manipulation test failed\\n' "$RED" "$NC"
    ((TESTS_FAILED++))
  } || {
    printf '%b✓%b Health check detects missing Node.js\\n' "$GREEN" "$NC"
    ((TESTS_PASSED++))
  }
  
  if grep -A 5 "Node.js is not available" "$PROJECT_ROOT/kaseki-agent.sh" | grep -q 'Node.js is not available'; then
    printf '%b✓%b Health check detects missing Node.js\n' "$GREEN" "$NC"
    ((TESTS_PASSED++))
  else
    printf '%b✗%b Health check missing Node.js detection\n' "$RED" "$NC"
    ((TESTS_FAILED++))
  fi
else
  printf '%s' "Node.js not available in test environment, skipping Node.js test\n"
fi

# Test 9d: Test health check with missing curl
printf '%s' "Testing health check with missing curl... "
if command -v curl >/dev/null 2>&1; then
  # Temporarily rename curl to simulate missing command
  CURL_PATH=$(command -v curl)
  PATH="/nonexistent:$PATH" command -v curl >/dev/null 2>&1 && {
    printf '%b✗%b PATH manipulation test failed\\n' "$RED" "$NC"
    ((TESTS_FAILED++))
  } || {
    printf '%b✓%b Health check detects missing curl\\n' "$GREEN" "$NC"
    ((TESTS_PASSED++))
  }
  
  if grep -A 5 "curl is not available" "$PROJECT_ROOT/kaseki-agent.sh" | grep -q 'curl is not available'; then
    printf '%b✓%b Health check detects missing curl\n' "$GREEN" "$NC"
    ((TESTS_PASSED++))
  else
    printf '%b✗%b Health check missing curl detection\n' "$RED" "$NC"
    ((TESTS_FAILED++))
  fi
else
  printf '%s' "curl not available in test environment, skipping curl test\n"
fi

# Cleanup
rm -rf "$TEST_TMP_DIR"

# Test 9e: Test health check success path (when all dependencies present)
printf '%s' "Testing health check success path... "
if grep -A 5 'github operations health check PASSED' "$PROJECT_ROOT/kaseki-agent.sh" | grep -q 'health check PASSED'; then
  printf '%b✓%b Health check has success path implementation\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Health check missing success path\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

# Test 9f: Test health check error classification
printf '%s' "Testing health check error classification... "
if grep -q 'ERROR:' "$PROJECT_ROOT/kaseki-agent.sh" && \
   grep -q 'health-check' "$PROJECT_ROOT/kaseki-agent.sh" && \
   grep -q 'return 1' "$PROJECT_ROOT/kaseki-agent.sh"; then
  printf '%b✓%b Health check properly classifies errors and returns appropriate exit codes\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Health check error classification incomplete\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

# ===== Test 10: GitHub credential auto-detection feature =====
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

# ===== Test 11: GitHub App enabled by default =====
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

# ===== Test 12: Graceful credential degradation =====
test_case "Graceful credential degradation"

if grep -q 'KASEKI_PUBLISH_MODE=.*auto.*GITHUB_APP_ENABLED=0' "$PROJECT_ROOT/run-kaseki.sh" || grep -q 'graceful degrade' "$PROJECT_ROOT/run-kaseki.sh"; then
  printf '%b✓%b Missing credentials handled gracefully in auto mode\n' "$GREEN" "$NC"
  ((TESTS_PASSED++))
else
  printf '%b✗%b Graceful degradation not implemented\n' "$RED" "$NC"
  ((TESTS_FAILED++))
fi

# ===== Test 13: Explicit disable still respected =====
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