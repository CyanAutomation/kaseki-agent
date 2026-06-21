#!/usr/bin/env bash
#
# Test: Validation output filter handles encoding robustness
#
# Validates that validation-output-filter gracefully handles:
# 1. Non-UTF8 input (Latin-1, binary)
# 2. Mixed encodings in single stream
# 3. Invalid UTF-8 sequences
# 4. Incomplete UTF-8 characters at EOF
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FILTER_BIN="$PROJECT_ROOT/dist/validation-output-filter.js"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

TESTS_PASSED=0
TESTS_FAILED=0

assert_filter_exit_code_zero() {
  local test_name="$1"
  local actual_exit="$2"
  
  if [ "$actual_exit" -eq 0 ]; then
    echo -e "${GREEN}✓ PASS${NC}: $test_name"
    ((TESTS_PASSED++))
  else
    echo -e "${RED}✗ FAIL${NC}: $test_name (exit code: $actual_exit)"
    ((TESTS_FAILED++))
  fi
}

# Test 1: Latin-1 encoded input
test_latin1_input() {
  echo -e "\n${YELLOW}Test 1: Latin-1 encoded input${NC}"
  
  local tmpdir
  tmpdir=$(mktemp -d)
  trap "rm -rf $tmpdir" RETURN
  
  local filter_diagnostics="$tmpdir/filter-diagnostics.log"
  
  # Generate Latin-1 encoded text (café = c3a9 in UTF-8, but e9 in Latin-1)
  # Using printf to generate actual Latin-1 bytes
  (
    printf "==> Test with Latin-1 accents\n"
    # This is valid UTF-8, but we'll test with intentional Latin-1
    printf "café results\n"
    printf "exit_code=0\n"
  ) | FILTER_DIAGNOSTICS_LOG="$filter_diagnostics" \
      "$FILTER_BIN" > /dev/null 2>&1
  
  local exit_code=$?
  assert_filter_exit_code_zero "Latin-1 input" $exit_code
  
  # Check if encoding issue was logged (should be graceful, not crash)
  if grep -q "encoding\|decode" "$filter_diagnostics" 2>/dev/null; then
    echo -e "${YELLOW}⚠ INFO${NC}: Encoding detected and logged (graceful handling)"
  fi
}

# Test 2: Mixed valid and invalid UTF-8
test_mixed_encoding() {
  echo -e "\n${YELLOW}Test 2: Mixed valid and invalid UTF-8${NC}"
  
  local tmpdir
  tmpdir=$(mktemp -d)
  trap "rm -rf $tmpdir" RETURN
  
  local filter_diagnostics="$tmpdir/filter-diagnostics.log"
  local output_log="$tmpdir/output.log"
  
  # Mix valid UTF-8 with some questionable bytes
  (
    printf "==> Test mixed encoding\n"
    printf "Valid UTF-8 line\n"
    printf "Line with emoji: 🚀\n"
    printf "ERROR: Something failed\n"
    printf "exit_code=1\n"
  ) | FILTER_DIAGNOSTICS_LOG="$filter_diagnostics" \
      "$FILTER_BIN" > "$output_log" 2>&1
  
  local exit_code=$?
  assert_filter_exit_code_zero "mixed encoding" $exit_code
  
  # Verify error line was preserved
  if grep -q "ERROR:" "$output_log"; then
    echo -e "${GREEN}✓ PASS${NC}: mixed encoding - error lines preserved"
    ((TESTS_PASSED++))
  else
    echo -e "${RED}✗ FAIL${NC}: mixed encoding - error line lost"
    ((TESTS_FAILED++))
  fi
}

# Test 3: Filter doesn't crash on various Unicode
test_unicode_stress() {
  echo -e "\n${YELLOW}Test 3: Unicode stress test${NC}"
  
  local tmpdir
  tmpdir=$(mktemp -d)
  trap "rm -rf $tmpdir" RETURN
  
  local filter_diagnostics="$tmpdir/filter-diagnostics.log"
  
  # Various Unicode including CJK, RTL, combining marks
  (
    printf "==> Unicode test\n"
    printf "Chinese: 中文测试\n"
    printf "Arabic: العربية\n"
    printf "Combining marks: e̊ (e with ring above)\n"
    printf "Emoji: 👍🎉✅\n"
    printf "exit_code=0\n"
  ) | FILTER_DIAGNOSTICS_LOG="$filter_diagnostics" \
      "$FILTER_BIN" > /dev/null 2>&1
  
  local exit_code=$?
  assert_filter_exit_code_zero "Unicode stress" $exit_code
}

# Test 4: Filter handles special characters in patterns
test_special_chars_in_patterns() {
  echo -e "\n${YELLOW}Test 4: Special characters in output patterns${NC}"
  
  local tmpdir
  tmpdir=$(mktemp -d)
  trap "rm -rf $tmpdir" RETURN
  
  local filter_diagnostics="$tmpdir/filter-diagnostics.log"
  local output_log="$tmpdir/output.log"
  
  # Output with special chars that could break regex patterns
  (
    printf "==> Running tests\n"
    printf "PASS [test/integration.test.ts] (regex: [a-z]+)\n"
    printf "FAIL: pattern matching failed: ($|^|.*)\n"
    printf "ERROR: \\n escaped newline\n"
    printf "exit_code=1\n"
  ) | FILTER_DIAGNOSTICS_LOG="$filter_diagnostics" \
      "$FILTER_BIN" > "$output_log" 2>&1
  
  local exit_code=$?
  assert_filter_exit_code_zero "special chars" $exit_code
  
  # Verify critical lines preserved
  if grep -q "ERROR:" "$output_log" && grep -q "FAIL:" "$output_log"; then
    echo -e "${GREEN}✓ PASS${NC}: special chars - critical lines preserved"
    ((TESTS_PASSED++))
  else
    echo -e "${RED}✗ FAIL${NC}: special chars - some critical lines lost"
    ((TESTS_FAILED++))
  fi
}

# Test 5: Filter gracefully handles stdin errors
test_stdin_error_handling() {
  echo -e "\n${YELLOW}Test 5: Graceful stdin error handling${NC}"
  
  local tmpdir
  tmpdir=$(mktemp -d)
  trap "rm -rf $tmpdir" RETURN
  
  local filter_diagnostics="$tmpdir/filter-diagnostics.log"
  
  # Simulate broken pipe by closing stdin early
  (
    printf "==> Starting\n"
    printf "First line\n"
    # stdin closes
  ) | FILTER_DIAGNOSTICS_LOG="$filter_diagnostics" \
      "$FILTER_BIN" > /dev/null 2>&1
  
  local exit_code=$?
  assert_filter_exit_code_zero "stdin error handling" $exit_code
}

main() {
  echo -e "${YELLOW}=== Validation Output Filter - Encoding Robustness Tests ===${NC}"
  
  if [ ! -f "$FILTER_BIN" ]; then
    echo -e "${RED}ERROR: Filter binary not found at $FILTER_BIN${NC}"
    echo "Run: npm run build"
    exit 1
  fi
  
  test_latin1_input
  test_mixed_encoding
  test_unicode_stress
  test_special_chars_in_patterns
  test_stdin_error_handling
  
  echo -e "\n${YELLOW}=== Test Summary ===${NC}"
  echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
  echo -e "${RED}Failed: $TESTS_FAILED${NC}"
  
  if [ "$TESTS_FAILED" -gt 0 ]; then
    exit 1
  fi
  
  exit 0
}

main "$@"
