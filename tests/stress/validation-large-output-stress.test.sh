#!/usr/bin/env bash
# shellcheck disable=SC2317
#
# Nightly/stress test: Validation output filter handles large output without crashing.
#
# This test is intentionally excluded from routine CI. Run it explicitly with:
#   RUN_VALIDATION_OUTPUT_STRESS_TESTS=1 bash tests/stress/validation-large-output-stress.test.sh
#
# Expected runtime: typically 10-30 seconds on a developer workstation, and up to
# 2 minutes on constrained Raspberry Pi-class hardware.
#
# Validates that validation-output-filter can process large bounded output (50k+ lines)
# on memory-constrained systems (RPi 4 with 4GB) without OOM or SIGPIPE.
#
# Scenarios tested:
# 1. Large output (50k lines)
# 2. Very large single line (1MB in one line)
# 3. Rapid bounded burst of output (10k lines)
# 4. Deterministic stdin closure
# 5. Memory-bounds smoke coverage
#

set -euo pipefail

# Test environment setup
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FILTER_BIN="$PROJECT_ROOT/dist/validation-output-filter.js"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test results tracking
TESTS_PASSED=0
TESTS_FAILED=0

# Utility functions
assert_filter_exit_code_zero() {
  local test_name="$1"
  local actual_exit="$2"
  
  if [ "$actual_exit" -eq 0 ]; then
    echo -e "${GREEN}✓ PASS${NC}: $test_name (filter exited 0)"
    ((TESTS_PASSED += 1))
  else
    echo -e "${RED}✗ FAIL${NC}: $test_name (filter exited $actual_exit, expected 0)"
    ((TESTS_FAILED += 1))
  fi
}

assert_diagnostics_logged() {
  local test_name="$1"
  local diagnostics_file="$2"
  local expected_pattern="$3"
  
  if [ ! -f "$diagnostics_file" ]; then
    echo -e "${RED}✗ FAIL${NC}: $test_name - diagnostics file not created: $diagnostics_file"
    ((TESTS_FAILED += 1))
    return 1
  fi
  
  if grep -q "$expected_pattern" "$diagnostics_file"; then
    echo -e "${GREEN}✓ PASS${NC}: $test_name - diagnostics contain: $expected_pattern"
    ((TESTS_PASSED += 1))
    return 0
  else
    echo -e "${RED}✗ FAIL${NC}: $test_name - expected pattern not found: $expected_pattern"
    echo "  Diagnostics file contents:"
    head -20 "$diagnostics_file" | sed 's/^/    /'
    ((TESTS_FAILED += 1))
    return 1
  fi
}

# Test 1: Large output (50k lines)
test_large_output() {
  echo -e "\n${YELLOW}Test 1: Large output scenario (50k lines)${NC}"
  
  local tmpdir
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' RETURN
  
  local filter_diagnostics="$tmpdir/filter-diagnostics.log"
  local output_log="$tmpdir/output.log"
  
  # Generate 50k lines of simulated test output (more efficient than bash loop)
  (
    echo "==> Running large test suite"
    seq 1 50000 | awk '{if (NR % 1000 == 0) print "Test batch " NR/1000 ": running tests"; else print "  test case " NR ": verbose debug output"}'
    echo "exit_code=0"
  ) | FILTER_DIAGNOSTICS_LOG="$filter_diagnostics" \
      "$FILTER_BIN" > "$output_log" 2>&1
  
  local exit_code=$?
  
  # Verify filter exited cleanly
  assert_filter_exit_code_zero "large output" $exit_code
  
  # Verify diagnostics captured (optional for current impl)
  if [ -f "$filter_diagnostics" ]; then
    if grep -q "filter-startup:" "$filter_diagnostics"; then
      echo -e "${GREEN}✓ PASS${NC}: large output - diagnostics captured"
      ((TESTS_PASSED += 1))
    fi
  fi
  
  # Verify output was processed
  local output_lines
  output_lines=$(wc -l < "$output_log")
  if [ "$output_lines" -gt 0 ]; then
    echo -e "${GREEN}✓ PASS${NC}: large output - processed $output_lines output lines"
    ((TESTS_PASSED += 1))
  else
    echo -e "${RED}✗ FAIL${NC}: large output - no output lines generated"
    ((TESTS_FAILED += 1))
  fi
  
  # Check memory pressure warnings if they appear
  if grep -q "memory_pressure\|excessive_output" "$filter_diagnostics"; then
    echo -e "${YELLOW}⚠ WARNING${NC}: large output - memory pressure detected in diagnostics"
  fi
}

# Test 2: Very large single line (1MB)
test_large_single_line() {
  echo -e "\n${YELLOW}Test 2: Large single line scenario (1MB in one line)${NC}"
  
  local tmpdir
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' RETURN
  
  local filter_diagnostics="$tmpdir/filter-diagnostics.log"
  local output_log="$tmpdir/output.log"
  
  # Generate 1MB of text in a single line (efficient generation)
  local large_line
  large_line=$(head -c 1000000 /dev/zero | tr '\0' 'x')
  
  (
    echo "==> Running error reproduction"
    echo "ERROR: $large_line"
    echo "exit_code=1"
  ) | FILTER_DIAGNOSTICS_LOG="$filter_diagnostics" \
      "$FILTER_BIN" > "$output_log" 2>&1
  
  local exit_code=$?
  
  # Verify filter exited cleanly
  assert_filter_exit_code_zero "large single line" $exit_code
  
  # Verify error was captured (not filtered out)
  if grep -q "^ERROR:" "$output_log"; then
    echo -e "${GREEN}✓ PASS${NC}: large single line - error line preserved in output"
    ((TESTS_PASSED += 1))
  else
    echo -e "${RED}✗ FAIL${NC}: large single line - error line was filtered out"
    ((TESTS_FAILED += 1))
  fi
}

# Test 3: Rapid bounded burst of output
test_rapid_burst() {
  echo -e "\n${YELLOW}Test 3: Rapid burst scenario (10k lines in rapid succession)${NC}"
  
  local tmpdir
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' RETURN
  
  local filter_diagnostics="$tmpdir/filter-diagnostics.log"
  local output_log="$tmpdir/output.log"
  
  # Generate rapid burst of output (10k lines)
  (
    echo "==> Starting test execution"
    seq 1 10000 | awk '{print "Test " NR ": some output"}'
    echo "exit_code=0"
  ) | FILTER_DIAGNOSTICS_LOG="$filter_diagnostics" \
      "$FILTER_BIN" > "$output_log" 2>&1
  
  local exit_code=$?
  
  # Verify filter exited cleanly
  assert_filter_exit_code_zero "rapid burst" $exit_code
  
  # Verify diagnostics show processing completed (optional)
  if [ -f "$filter_diagnostics" ] && grep -q "filter-close:" "$filter_diagnostics"; then
    echo -e "${GREEN}✓ PASS${NC}: rapid burst - diagnostics show completion"
    ((TESTS_PASSED += 1))
  fi
}

# Test 4: Filter handles deterministic finite stdin closure gracefully
test_stdin_closure() {
  echo -e "\n${YELLOW}Test 4: Graceful stdin closure${NC}"
  
  local tmpdir
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' RETURN
  
  local filter_diagnostics="$tmpdir/filter-diagnostics.log"
  local output_log="$tmpdir/output.log"
  
  # Deterministic bounded producer: stdin closes immediately after the fixture is
  # emitted, avoiding sleeps or timing races while still exercising EOF handling.
  (
    printf '%s\n' "==> Starting test"
    printf '%s\n' "ERROR: deterministic producer finished before exit marker"
  ) | FILTER_DIAGNOSTICS_LOG="$filter_diagnostics" \
      "$FILTER_BIN" > "$output_log" 2>&1
  
  local exit_code=$?
  
  # Verify filter exited cleanly (not SIGPIPE)
  assert_filter_exit_code_zero "stdin closure" $exit_code
  
  # Verify diagnostics captured the closure (optional)
  if [ -f "$filter_diagnostics" ] && grep -q "filter-close:" "$filter_diagnostics"; then
    echo -e "${GREEN}✓ PASS${NC}: stdin closure - diagnostics captured closure"
    ((TESTS_PASSED += 1))
  fi
}

# Test 5: Filter memory usage stays within bounds (RPi 4 constraint)
test_memory_bounds() {
  echo -e "\n${YELLOW}Test 5: Memory bounds on RPi 4 (4GB total)${NC}"
  
  local tmpdir
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' RETURN
  
  local filter_diagnostics="$tmpdir/filter-diagnostics.log"
  local output_log="$tmpdir/output.log"
  
  # Generate 50k lines (moderate-to-large test)
  (
    echo "==> Running test suite"
    seq 1 50000 | awk '{print "Test case " NR}'
    echo "exit_code=0"
  ) | FILTER_DIAGNOSTICS_LOG="$filter_diagnostics" \
      "$FILTER_BIN" > "$output_log" 2>&1
  
  local exit_code=$?
  
  # Verify filter exited cleanly
  assert_filter_exit_code_zero "memory bounds" $exit_code
  
  # On a real system, we'd measure actual memory usage
  # For now, verify the process completed without OOM errors
  if ! grep -q "out of memory\|ENOMEM\|OOM" "$filter_diagnostics"; then
    echo -e "${GREEN}✓ PASS${NC}: memory bounds - no OOM errors detected"
    ((TESTS_PASSED += 1))
  else
    echo -e "${RED}✗ FAIL${NC}: memory bounds - OOM errors detected in diagnostics"
    ((TESTS_FAILED += 1))
  fi
}

# Main test execution
main() {
  echo -e "${YELLOW}=== Validation Output Filter - Large Output Stress Tests ===${NC}"
  echo "Platform: Raspberry Pi 4 with 4GB memory"
  echo "Filter binary: $FILTER_BIN"
  echo "Expected runtime: 10-30 seconds on workstations; up to 2 minutes on constrained hosts."
  
  if [ "${RUN_VALIDATION_OUTPUT_STRESS_TESTS:-}" != "1" ]; then
    echo -e "${YELLOW}SKIP: validation output stress tests are gated.${NC}"
    echo "Set RUN_VALIDATION_OUTPUT_STRESS_TESTS=1 to run this nightly/stress suite."
    echo "Expected runtime: 10-30 seconds on workstations; up to 2 minutes on constrained hosts."
    exit 0
  fi

  if [ ! -f "$FILTER_BIN" ]; then
    echo -e "${RED}ERROR: Filter binary not found at $FILTER_BIN${NC}"
    echo "Run: npm run build"
    exit 1
  fi
  
  # Run all tests
  test_large_output
  test_large_single_line
  test_rapid_burst
  test_stdin_closure
  test_memory_bounds
  
  # Summary
  echo -e "\n${YELLOW}=== Test Summary ===${NC}"
  echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
  echo -e "${RED}Failed: $TESTS_FAILED${NC}"
  
  if [ "$TESTS_FAILED" -gt 0 ]; then
    exit 1
  fi
  
  exit 0
}

main "$@"
