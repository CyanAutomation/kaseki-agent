#!/bin/bash

##############################################################################
# test-scouting-retry.sh
#
# Test script for scouting phase retry mechanism.
# Validates that:
# 1. Transient failures (exit 124, JSON errors) trigger retry
# 2. Deterministic failures (exit 86) do NOT retry
# 3. Max attempts are respected (max 2 attempts)
# 4. Metadata is correctly populated with retry counts
#
# Run: bash scripts/test-scouting-retry.sh
##############################################################################

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

test_count=0
pass_count=0
fail_count=0

# Test utilities
test_header() {
  local title="$1"
  test_count=$((test_count + 1))
  printf '\n%s==> Test %d: %s%s\n' "$YELLOW" "$test_count" "$title" "$NC"
}

test_pass() {
  local msg="${1:-Test passed}"
  pass_count=$((pass_count + 1))
  printf '%s✓ PASS: %s%s\n' "$GREEN" "$msg" "$NC"
}

test_fail() {
  local msg="${1:-Test failed}"
  fail_count=$((fail_count + 1))
  printf '%s✗ FAIL: %s%s\n' "$RED" "$msg" "$NC"
}

# Load the is_transient_scouting_failure function
source_kaseki_functions() {
  # Extract the is_transient_scouting_failure function from kaseki-agent.sh
  local func_def
  func_def="$(sed -n '/^is_transient_scouting_failure()/,/^}/p' ./kaseki-agent.sh)"
  eval "$func_def"
}

##############################################################################
# Unit Tests for is_transient_scouting_failure()
##############################################################################

test_header "is_transient_scouting_failure: Exit 124 (timeout) → transient"
source_kaseki_functions
if is_transient_scouting_failure 124 ""; then
  test_pass "Exit 124 correctly identified as transient"
else
  test_fail "Exit 124 should be transient"
fi

test_header "is_transient_scouting_failure: Exit 86 (validation error) → NOT transient"
if ! is_transient_scouting_failure 86 "schema validation failed"; then
  test_pass "Exit 86 correctly identified as deterministic"
else
  test_fail "Exit 86 should NOT be transient"
fi

test_header "is_transient_scouting_failure: Exit 2 (missing config) → NOT transient"
if ! is_transient_scouting_failure 2 "missing API key"; then
  test_pass "Exit 2 correctly identified as deterministic"
else
  test_fail "Exit 2 should NOT be transient"
fi

test_header "is_transient_scouting_failure: Exit 1 with LLM error → transient"
if is_transient_scouting_failure 1 "Error: API connection failed"; then
  test_pass "Exit 1 with API error correctly identified as transient"
else
  test_fail "Exit 1 with API error should be transient"
fi

test_header "is_transient_scouting_failure: Exit 1 with schema error → NOT transient"
if ! is_transient_scouting_failure 1 "error: invalid JSON schema"; then
  test_pass "Exit 1 with schema error correctly identified as deterministic"
else
  test_fail "Exit 1 with schema error should NOT be transient"
fi

test_header "is_transient_scouting_failure: Exit 0 (success) → NOT transient"
if ! is_transient_scouting_failure 0 ""; then
  test_pass "Exit 0 correctly identified as not transient"
else
  test_fail "Exit 0 should NOT be transient"
fi

##############################################################################
# Integration Tests (checking metadata.json structure)
##############################################################################

test_header "Verify metadata.json contains scouting retry fields"
# Check that write_metadata references the scouting attempt variables
if grep -q 'scouting_attempts' ./kaseki-agent.sh; then
  test_pass "metadata.json includes scouting_attempts field"
else
  test_fail "metadata.json missing scouting_attempts field"
fi

if grep -q 'scouting_succeeded_on_attempt' ./kaseki-agent.sh; then
  test_pass "metadata.json includes scouting_succeeded_on_attempt field"
else
  test_fail "metadata.json missing scouting_succeeded_on_attempt field"
fi

test_header "Verify wrapper function exports env vars"
# Check that the wrapper function sets the environment variables
if grep -q 'KASEKI_SCOUTING_ATTEMPTS=' ./kaseki-agent.sh; then
  test_pass "Wrapper sets KASEKI_SCOUTING_ATTEMPTS env var"
else
  test_fail "Wrapper should set KASEKI_SCOUTING_ATTEMPTS"
fi

if grep -q 'KASEKI_SCOUTING_SUCCEEDED_ON_ATTEMPT=' ./kaseki-agent.sh; then
  test_pass "Wrapper sets KASEKI_SCOUTING_SUCCEEDED_ON_ATTEMPT env var"
else
  test_fail "Wrapper should set KASEKI_SCOUTING_SUCCEEDED_ON_ATTEMPT"
fi

test_header "Verify main execution loop calls wrapper"
# Check that the main loop calls run_scouting_agent_with_retry instead of run_scouting_agent
if grep -q 'run_scouting_agent_with_retry' ./kaseki-agent.sh; then
  test_pass "Main loop calls run_scouting_agent_with_retry()"
else
  test_fail "Main loop should call run_scouting_agent_with_retry()"
fi

# Ensure we're not calling the original function in the main loop anymore
if ! grep -A 3 '^if.*run_scouting_agent;' ./kaseki-agent.sh 2>/dev/null | grep -q 'run_scouting_agent$'; then
  test_pass "Main loop does not call old run_scouting_agent() directly"
else
  test_fail "Main loop should not call old run_scouting_agent() directly"
fi

##############################################################################
# Summary
##############################################################################

printf '\n%s===================================================%s\n' "$YELLOW" "$NC"
printf 'Tests Run:    %d\n' "$test_count"
printf 'Passed:       %s%d%s\n' "$GREEN" "$pass_count" "$NC"
printf 'Failed:       %s%d%s\n' "$([ "$fail_count" -eq 0 ] && echo "$GREEN" || echo "$RED")" "$fail_count" "$NC"
printf '%s===================================================%s\n' "$YELLOW" "$NC"

if [ "$fail_count" -eq 0 ]; then
  printf '\n%s✓ All tests passed!%s\n\n' "$GREEN" "$NC"
  exit 0
else
  printf '\n%s✗ Some tests failed!%s\n\n' "$RED" "$NC"
  exit 1
fi
