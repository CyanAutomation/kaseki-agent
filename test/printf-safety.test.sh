#!/usr/bin/env bash
# shellcheck disable=SC1090,SC2034
# Test suite for printf safety fixes
# Tests edge cases that could cause the "printf: - : invalid option" error

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_RESULTS_DIR="${TMPDIR:-/tmp}/kaseki-agent-printf-safety-results.$$"
KASEKI_SCRIPT="${SCRIPT_DIR}/kaseki-agent.sh"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Setup and teardown
setup() {
  mkdir -p "$TEST_RESULTS_DIR/results"
  cd "$TEST_RESULTS_DIR" || exit
}

teardown() {
  rm -rf "$TEST_RESULTS_DIR"
}

# Test helpers
run_test() {
  local test_name="$1"
  local test_func="$2"
  
  TESTS_RUN=$((TESTS_RUN + 1))
  printf '[%3d] %-60s ' "$TESTS_RUN" "$test_name"
  
  if "$test_func" 2>/dev/null; then
    printf "%bPASS%b\n" "${GREEN}" "${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    printf "%bFAIL%b\n" "${RED}" "${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

source_validate_numeric() {
  source <(sed -n '/^validate_numeric()/,/^}/p' "$KASEKI_SCRIPT")
}

# Test: validate_numeric with valid input
test_validate_numeric_valid() {
  source_validate_numeric
  validate_numeric "test_var" "42"
}

# Test: validate_numeric with dash (the bug trigger)
test_validate_numeric_dash() {
  source_validate_numeric
  ! validate_numeric "test_var" "-"
}

# Test: validate_numeric with non-numeric input
test_validate_numeric_non_numeric() {
  source_validate_numeric
  ! validate_numeric "test_var" "not-a-number"
}

# Test: validate_numeric with empty input
test_validate_numeric_empty() {
  source_validate_numeric
  ! validate_numeric "test_var" ""
}

# Test: validate_numeric rejects values containing multiple lines
test_validate_numeric_multiline() {
  source_validate_numeric
  ! validate_numeric "restored_count" $'0\n0'
}


# Test: arithmetic succeeds after numeric validation
test_validated_numeric_arithmetic() {
  source_validate_numeric
  local restored_count=5
  local kept_count=3

  validate_numeric "restored_count" "$restored_count" && \
    validate_numeric "kept_count" "$kept_count" || return 1

  local total_count=$((restored_count + kept_count))
  [ "$total_count" = "8" ]
}

# Test: printf with leading-dash format and validated numeric value succeeds
test_printf_leading_dash_format_validated_numeric() {
  source_validate_numeric
  local total_count=8

  validate_numeric "total_count" "$total_count" && \
    printf -- '- **Test:** %%d = %d\n' "$total_count" > /dev/null 2>&1
}

# Test: printf with valid numeric argument (should not fail)
test_printf_valid_numeric() {
  local test_var=42
  printf 'test: %d\n' "$test_var" > /dev/null 2>&1
  # shellcheck disable=SC2181 # Explicit exit code check for clarity in test
  [ $? -eq 0 ]
}

# Test: printf with dash argument (should fail without quoting)
test_printf_dash_unquoted_fails() {
  local test_var="-"
  # This SHOULD fail with unquoted expansion
  ! printf '%d\n' $test_var > /dev/null 2>&1
}

# Test: printf with dash argument quoted (should fail with validation)
test_printf_dash_quoted_validation() {
  source_validate_numeric
  local test_var="-"
  ! validate_numeric "test_var" "$test_var"
}

# Test: grep count fallback works
test_grep_count_fallback() {
  # Empty file, grep should print one 0 and the fallback should not append another 0.
  : > results/test.jsonl
  local count
  count=$(grep -c 'pattern' results/test.jsonl 2>/dev/null || true)
  count=${count:-0}
  [ "$count" = "0" ]
}

# Test: grep count fallback on missing file
test_grep_count_fallback_missing() {
  # Missing file, fallback should normalize empty output to one 0.
  local count
  count=$(grep -c 'pattern' results/nonexistent.jsonl 2>/dev/null || true)
  count=${count:-0}
  [ "$count" = "0" ]
}

# Main test execution
main() {
  printf '\n%s\n' "$(printf '=%.0s' {1..70})"
  printf 'Testing Printf Safety Fixes\n'
  printf '%s\n' "$(printf '=%.0s' {1..70})"
  printf '\n'
  
  setup
  
  # validate_numeric tests
  printf '\n%s\n' '### validate_numeric() tests'
  run_test "validate_numeric with valid integer" test_validate_numeric_valid
  run_test "validate_numeric rejects dash (-)" test_validate_numeric_dash
  run_test "validate_numeric rejects non-numeric" test_validate_numeric_non_numeric
  run_test "validate_numeric rejects empty" test_validate_numeric_empty
  run_test "validate_numeric rejects multi-line value" test_validate_numeric_multiline
  
  # printf safety tests
  printf '\n%s\n' '### printf safety tests'
  run_test "validated numeric arithmetic succeeds" test_validated_numeric_arithmetic
  run_test "printf leading-dash format with validated numeric" test_printf_leading_dash_format_validated_numeric
  run_test "printf with valid numeric argument" test_printf_valid_numeric
  run_test "printf with dash (unquoted) should fail" test_printf_dash_unquoted_fails
  run_test "printf with dash (validation) should fail" test_printf_dash_quoted_validation
  
  # grep fallback tests
  printf '\n%s\n' '### grep fallback tests'
  run_test "grep count fallback on empty file" test_grep_count_fallback
  run_test "grep count fallback on missing file" test_grep_count_fallback_missing
  
  # Summary
  printf '\n%s\n' "$(printf '=%.0s' {1..70})"
  printf 'Test Results: %d/%d passed, %d failed\n' "$TESTS_PASSED" "$TESTS_RUN" "$TESTS_FAILED"
  
  if [ "$TESTS_FAILED" -eq 0 ]; then
    printf "%b✓ All tests passed!%b\n" "${GREEN}" "${NC}"
    teardown
    return 0
  else
    printf "%b✗ Some tests failed%b\n" "${RED}" "${NC}"
    printf 'Results directory: %s\n' "$TEST_RESULTS_DIR"
    return 1
  fi
}

main "$@"
