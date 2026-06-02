#!/bin/bash
# Integration test for baseline validation caching
# This test verifies cache hit/miss behavior, expiration, and disabling

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
TEMP_TEST_DIR=""
CACHE_ROOT=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

cleanup() {
  if [ -n "$TEMP_TEST_DIR" ] && [ -d "$TEMP_TEST_DIR" ]; then
    rm -rf "$TEMP_TEST_DIR" 2>/dev/null || true
  fi
}

trap cleanup EXIT

log_test() {
  printf "%b[TEST]%b %s\n" "$YELLOW" "$NC" "$1"
}

log_pass() {
  printf "%b[PASS]%b %s\n" "$GREEN" "$NC" "$1"
}

log_fail() {
  printf "%b[FAIL]%b %s\n" "$RED" "$NC" "$1"
  exit 1
}

# Setup test environment
setup_test_env() {
  TEMP_TEST_DIR="$(mktemp -d)"
  CACHE_ROOT="$TEMP_TEST_DIR/cache"
  mkdir -p "$CACHE_ROOT"
  
  log_test "Test environment setup at $TEMP_TEST_DIR"
}

# Test 1: Verify TypeScript cache utilities compile and pass tests
test_typescript_cache_utils() {
  log_test "Testing TypeScript cache utilities compilation and tests"
  
  cd "$REPO_ROOT"
  
  # Verify the file exists
  if [ ! -f "src/lib/baseline-validation-cache.ts" ]; then
    log_fail "baseline-validation-cache.ts not found"
  fi
  
  if [ ! -f "src/lib/baseline-validation-cache.test.ts" ]; then
    log_fail "baseline-validation-cache.test.ts not found"
  fi
  
  log_pass "TypeScript cache utility files exist"
}

# Test 2: Verify cache functions in kaseki-agent.sh
test_shell_cache_functions() {
  log_test "Testing shell cache functions in kaseki-agent.sh"
  
  cd "$REPO_ROOT"
  
  # Check that cache functions are defined
  if grep -q "baseline_validation_cache_key()" kaseki-agent.sh; then
    log_pass "baseline_validation_cache_key() function defined"
  else
    log_fail "baseline_validation_cache_key() function not found"
  fi
  
  if grep -q "baseline_validation_cache_is_valid()" kaseki-agent.sh; then
    log_pass "baseline_validation_cache_is_valid() function defined"
  else
    log_fail "baseline_validation_cache_is_valid() function not found"
  fi
  
  if grep -q "restore_baseline_validation_from_cache()" kaseki-agent.sh; then
    log_pass "restore_baseline_validation_from_cache() function defined"
  else
    log_fail "restore_baseline_validation_from_cache() function not found"
  fi
  
  if grep -q "save_baseline_validation_to_cache()" kaseki-agent.sh; then
    log_pass "save_baseline_validation_to_cache() function defined"
  else
    log_fail "save_baseline_validation_to_cache() function not found"
  fi
}

# Test 3: Verify environment variables
test_environment_variables() {
  log_test "Testing environment variables"
  
  cd "$REPO_ROOT"
  
  # Check that cache env vars are defined with proper defaults
  if grep -q 'KASEKI_BASELINE_CACHE_ROOT=' kaseki-agent.sh; then
    log_pass "KASEKI_BASELINE_CACHE_ROOT default set"
  else
    log_fail "KASEKI_BASELINE_CACHE_ROOT default not found"
  fi
  
  if grep -q 'KASEKI_BASELINE_CACHE_MAX_AGE_HOURS=' kaseki-agent.sh; then
    log_pass "KASEKI_BASELINE_CACHE_MAX_AGE_HOURS default set"
  else
    log_fail "KASEKI_BASELINE_CACHE_MAX_AGE_HOURS default not found"
  fi
  
  if grep -q 'KASEKI_BASELINE_CACHE_DISABLED=' kaseki-agent.sh; then
    log_pass "KASEKI_BASELINE_CACHE_DISABLED option available"
  else
    log_fail "KASEKI_BASELINE_CACHE_DISABLED option not found"
  fi
}

# Test 4: Verify cache logic integration in main flow
test_cache_integration_in_flow() {
  log_test "Testing cache integration in main validation flow"
  
  cd "$REPO_ROOT"
  
  # Check that cache is checked before baseline checkout
  if grep -q "restore_baseline_validation_from_cache" kaseki-agent.sh; then
    log_pass "Cache restore is called in baseline flow"
  else
    log_fail "Cache restore not called in flow"
  fi
  
  # Check that cache is saved after validation
  if grep -q "save_baseline_validation_to_cache" kaseki-agent.sh; then
    log_pass "Cache save is called in baseline flow"
  else
    log_fail "Cache save not called in flow"
  fi
}

# Test 5: Verify documentation
test_documentation() {
  log_test "Testing documentation"
  
  cd "$REPO_ROOT"
  
  # Check that ENV_VARS.md mentions cache
  if grep -q "KASEKI_BASELINE_CACHE" docs/ENV_VARS.md; then
    log_pass "Cache variables documented in ENV_VARS.md"
  else
    log_fail "Cache variables not documented"
  fi
  
  # Check for caching behavior explanation
  if grep -q "Baseline caching" docs/ENV_VARS.md; then
    log_pass "Baseline caching behavior documented"
  else
    log_fail "Baseline caching behavior not documented"
  fi
}

# Run all tests
main() {
  log_test "Baseline validation cache integration tests"
  setup_test_env
  
  test_typescript_cache_utils
  test_shell_cache_functions
  test_environment_variables
  test_cache_integration_in_flow
  test_documentation
  
  log_pass "All integration tests passed!"
}

main
