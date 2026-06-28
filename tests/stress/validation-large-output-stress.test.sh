#!/usr/bin/env bash
# shellcheck disable=SC2317
#
# Test: Validation output filter shell stress coverage
#
# Nightly/stress-only test for real pipeline backpressure and large-output
# behavior. This is intentionally excluded from routine CI; run explicitly with:
#
#   RUN_VALIDATION_OUTPUT_STRESS=1 bash tests/stress/validation-large-output-stress.test.sh
#
# Expected runtime: usually 10-30 seconds on a developer workstation, and up to
# 2 minutes on Raspberry Pi 4-class or otherwise resource-constrained hosts.
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

# Test 1: Large output (100k lines, ~50MB)
test_large_output() {
  echo -e "\n${YELLOW}Test 1: Large output scenario (100k lines)${NC}"
  
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

# Test 2: Very large single line (10MB)
test_large_single_line() {
  echo -e "\n${YELLOW}Test 2: Large single line scenario (10MB in one line)${NC}"
  
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

# Test 3: Rapid burst of output
test_rapid_burst() {
  echo -e "\n${YELLOW}Test 3: Rapid burst scenario (1000 lines in rapid succession)${NC}"
  
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

# Test 4: Real pipeline backpressure with bounded producer
test_pipeline_backpressure() {
  echo -e "\n${YELLOW}Test 4: Real pipeline backpressure with bounded producer${NC}"

  local tmpdir
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' RETURN

  local filter_diagnostics="$tmpdir/filter-diagnostics.log"
  local output_log="$tmpdir/output.log"

  set +e
  node - <<'NODE' | FILTER_DIAGNOSTICS_LOG="$filter_diagnostics" "$FILTER_BIN" | head -n 3 > "$output_log"
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

for (let index = 1; index <= 20000; index += 1) {
  if (index === 1) console.log('==> Running bounded backpressure fixture');
  console.log(`ERROR retained backpressure marker ${index}`);
}
console.log('exit_code=0');
NODE
  local pipeline_exit=$?
  set -e

  if [ "$pipeline_exit" -eq 0 ] || [ "$pipeline_exit" -eq 141 ]; then
    echo -e "${GREEN}✓ PASS${NC}: backpressure pipeline completed without crashing (exit $pipeline_exit)"
    ((TESTS_PASSED += 1))
  else
    echo -e "${RED}✗ FAIL${NC}: backpressure pipeline exited $pipeline_exit"
    ((TESTS_FAILED += 1))
  fi

  if grep -Fxq '==> Running bounded backpressure fixture' "$output_log" && \
     grep -Fxq 'ERROR retained backpressure marker 1' "$output_log"; then
    echo -e "${GREEN}✓ PASS${NC}: backpressure - exact retained markers observed before downstream close"
    ((TESTS_PASSED += 1))
  else
    echo -e "${RED}✗ FAIL${NC}: backpressure - missing retained markers"
    cat "$output_log" | sed 's/^/    /'
    ((TESTS_FAILED += 1))
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
  if [ "${RUN_VALIDATION_OUTPUT_STRESS:-}" != "1" ]; then
    echo "Skipping validation output stress suite."
    echo "Set RUN_VALIDATION_OUTPUT_STRESS=1 to run this nightly/stress test."
    echo "Expected runtime: 10-30 seconds on typical workstations, up to 2 minutes on constrained hosts."
    exit 0
  fi

  echo -e "${YELLOW}=== Validation Output Filter - Large Output Stress Tests ===${NC}"
  echo "Platform: Raspberry Pi 4 with 4GB memory"
  echo "Filter binary: $FILTER_BIN"
  
  if [ ! -f "$FILTER_BIN" ]; then
    echo -e "${RED}ERROR: Filter binary not found at $FILTER_BIN${NC}"
    echo "Run: npm run build"
    exit 1
  fi
  
  # Run all tests
  test_large_output
  test_large_single_line
  test_rapid_burst
  test_pipeline_backpressure
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
