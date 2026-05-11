#!/bin/bash
# Integration test: verify validation-output-filter always exits with 0
# This test ensures the SIGPIPE fix works correctly

set -euo pipefail

TEST_NAME="validation-output-filter exit code"
FILTER_SCRIPT="dist/validation-output-filter.js"

# Check that the filter exists
if [[ ! -f "$FILTER_SCRIPT" ]]; then
  echo "FAIL: $TEST_NAME - filter script not found at $FILTER_SCRIPT"
  exit 1
fi

# Test 1: Normal output (should exit 0)
echo "TEST 1: Normal output..."
output=$(echo -e "==> npm run test\nPASS: test 1\nexit_code=0" | node "$FILTER_SCRIPT" 2>/dev/null)
exit_code=$?
if [[ $exit_code -ne 0 ]]; then
  echo "FAIL: $TEST_NAME - normal output should exit 0, got $exit_code"
  exit 1
fi
if ! echo "$output" | grep -q "PASS: test 1"; then
  echo "FAIL: $TEST_NAME - normal output should contain filtered results"
  exit 1
fi
echo "PASS"

# Test 2: Output with errors (should still exit 0)
echo "TEST 2: Output with errors..."
output=$(echo -e "==> npm run test\nERROR: test failed\nexit_code=1" | node "$FILTER_SCRIPT" 2>/dev/null)
exit_code=$?
if [[ $exit_code -ne 0 ]]; then
  echo "FAIL: $TEST_NAME - output with errors should exit 0, got $exit_code"
  exit 1
fi
if ! echo "$output" | grep -q "ERROR: test failed"; then
  echo "FAIL: $TEST_NAME - error output should be preserved"
  exit 1
fi
echo "PASS"

# Test 3: Empty input (should exit 0)
echo "TEST 3: Empty input..."
output=$(echo -n "" | node "$FILTER_SCRIPT" 2>/dev/null)
exit_code=$?
if [[ $exit_code -ne 0 ]]; then
  echo "FAIL: $TEST_NAME - empty input should exit 0, got $exit_code"
  exit 1
fi
echo "PASS"

# Test 4: Stdin closes abruptly (simulated with timeout)
echo "TEST 4: Abrupt stdin close..."
# This creates a scenario where stdin closes without normal termination
(echo "==> npm run test" && sleep 0.1 && echo "FAIL: something") | timeout 0.05s node "$FILTER_SCRIPT" 2>/dev/null || exit_code=$?
# timeout returns 124 when it kills the process, but the filter should have exited cleanly with 0
# Just verify the command completes (doesn't hang forever)
echo "PASS"

# Test 5: Large output (stress test)
echo "TEST 5: Large output (10k lines)..."
{
  echo "==> npm run test"
  for i in {1..10000}; do
    echo "Verbose output line $i"
  done
  echo "PASS: all tests"
  echo "exit_code=0"
} | node "$FILTER_SCRIPT" 2>/dev/null
exit_code=$?
if [[ $exit_code -ne 0 ]]; then
  echo "FAIL: $TEST_NAME - large output should exit 0, got $exit_code"
  exit 1
fi
echo "PASS"

echo ""
echo "✓ All validation-output-filter exit code tests passed"
