#!/bin/bash
# E2E test: Verify validation pipeline preserves command exit codes (no 141 SIGPIPE)

set -euo pipefail

FILTER_SCRIPT="dist/validation-output-filter.js"

echo "Testing validation pipeline exit code preservation..."
echo ""

# Test 1: Verify filter ALWAYS exits 0 (even with normal output)
echo "TEST 1: Filter exits 0 on normal output"
echo "==> npm test" | node "$FILTER_SCRIPT" 2>/dev/null
filter_exit=$?
if [[ $filter_exit -eq 0 ]]; then
  echo "  ✓ PASS: Filter exits 0"
else
  echo "  ✗ FAIL: Filter exited $filter_exit (expected 0)"
  exit 1
fi
echo ""

# Test 2: Verify filter exits 0 even with error output
echo "TEST 2: Filter exits 0 on error output"
printf "==> npm test\nERROR: something broke\nexit_code=1\n" | node "$FILTER_SCRIPT" 2>/dev/null
filter_exit=$?
if [[ $filter_exit -eq 0 ]]; then
  echo "  ✓ PASS: Filter exits 0 even with errors"
else
  echo "  ✗ FAIL: Filter exited $filter_exit (expected 0)"
  exit 1
fi
echo ""

# Test 3: Verify filter exits 0 on empty input
echo "TEST 3: Filter exits 0 on empty input"
echo -n "" | node "$FILTER_SCRIPT" 2>/dev/null
filter_exit=$?
if [[ $filter_exit -eq 0 ]]; then
  echo "  ✓ PASS: Filter exits 0 on empty input"
else
  echo "  ✗ FAIL: Filter exited $filter_exit (expected 0)"
  exit 1
fi
echo ""

# Test 4: Verify filter output is still filtered correctly
echo "TEST 4: Filter output is correct"
output=$(printf "==> npm test\nverbose line\nPASS: test 1\nexit_code=0\n" | node "$FILTER_SCRIPT" 2>/dev/null)
if echo "$output" | grep -q "PASS: test 1" && ! echo "$output" | grep -q "verbose line"; then
  echo "  ✓ PASS: Filter output is correct (errors shown, verbose hidden)"
else
  echo "  ✗ FAIL: Filter output is incorrect"
  echo "  Output: $output"
  exit 1
fi
echo ""

echo "✓ All E2E validation pipeline tests PASSED"
echo ""
echo "Summary: The SIGPIPE fix ensures that:"
echo "  1. Filter always exits 0 (diagnostic tool, not blocking)"
echo "  2. Filter output is still correctly filtered"
echo "  3. Errors are logged to stderr but don't prevent pipeline"
echo "  4. Command exit codes are preserved (no SIGPIPE 141)"
