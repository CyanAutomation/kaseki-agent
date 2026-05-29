#!/bin/bash
# Integration test: verify validation-output-filter always exits with 0
# This test ensures the SIGPIPE fix works correctly

set -euo pipefail

TEST_NAME="validation-output-filter exit code"
FILTER_SCRIPT="dist/validation-output-filter.js"
FILTER_TIMEOUT_SECONDS=10

fail() {
  echo "FAIL: $TEST_NAME - $*"
  exit 1
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local message="$3"

  if ! grep -Fq -- "$needle" <<<"$haystack"; then
    fail "$message"
  fi
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  local message="$3"

  if grep -Fq -- "$needle" <<<"$haystack"; then
    fail "$message"
  fi
}

run_filter() {
  local input="$1"
  local output exit_code

  set +e
  output=$(printf '%s' "$input" | timeout "${FILTER_TIMEOUT_SECONDS}s" node "$FILTER_SCRIPT" 2>/dev/null)
  exit_code=$?
  set -e

  if [[ $exit_code -eq 124 ]]; then
    fail "filter timed out after ${FILTER_TIMEOUT_SECONDS}s"
  fi

  if [[ $exit_code -ne 0 ]]; then
    fail "filter should exit 0, got $exit_code"
  fi

  printf '%s' "$output"
}

run_filter_from_fake_stream() {
  local output exit_code

  set +e
  output=$(fake_validation_stream | timeout "${FILTER_TIMEOUT_SECONDS}s" node "$FILTER_SCRIPT" 2>/dev/null)
  exit_code=$?
  set -e

  case "$exit_code" in
    0)
      ;;
    124)
      fail "fake stream was misclassified as a hang after ${FILTER_TIMEOUT_SECONDS}s"
      ;;
    *)
      fail "fake stream should propagate filter exit 0, got $exit_code"
      ;;
  esac

  printf '%s' "$output"
}

fake_validation_stream() {
  # Deterministic finite stream: no sleeps, races, or producer timeouts. The
  # stream intentionally omits exit_code=... to model truncated validation output
  # while still closing stdin normally.
  printf '%s\n' \
    '==> npm run test' \
    'Verbose output line that should be filtered' \
    'ERROR: deterministic failure before stream truncation'
}

# Check that the filter exists
if [[ ! -f "$FILTER_SCRIPT" ]]; then
  fail "filter script not found at $FILTER_SCRIPT"
fi

# Test 1: Normal output (should exit 0)
echo "TEST 1: Normal output..."
output=$(run_filter $'==> npm run test\nPASS: test 1\nexit_code=0\n')
assert_contains "$output" "PASS: test 1" "normal output should contain filtered results"
assert_contains "$output" "exit_code=0" "normal output should preserve final propagated exit code"
echo "PASS"

# Test 2: Output with errors (should still exit 0)
echo "TEST 2: Output with errors..."
output=$(run_filter $'==> npm run test\nERROR: test failed\nexit_code=1\n')
assert_contains "$output" "ERROR: test failed" "error output should be preserved"
assert_contains "$output" "exit_code=1" "failing validation exit code should be preserved for propagation"
echo "PASS"

# Test 3: Empty input (should exit 0)
echo "TEST 3: Empty input..."
output=$(run_filter '')
if [[ -n "$output" ]]; then
  fail "empty input should produce empty output"
fi
echo "PASS"

# Test 4: Deterministic truncated stream (should not be classified as timeout)
echo "TEST 4: Deterministic truncated stream..."
output=$(run_filter_from_fake_stream)
assert_contains "$output" "==> npm run test" "truncated stream should preserve command boundary"
assert_contains "$output" "ERROR: deterministic failure before stream truncation" "truncated stream should preserve error output"
assert_not_contains "$output" "Verbose output line that should be filtered" "truncated stream should still filter verbose output"
assert_not_contains "$output" "exit_code=" "truncated stream should not invent a propagated exit code"
echo "PASS"

# Test 5: Large output (stress test)
echo "TEST 5: Large output (10k lines)..."
large_input=$(
  printf '%s\n' '==> npm run test'
  for i in {1..10000}; do
    printf 'Verbose output line %s\n' "$i"
  done
  printf '%s\n' 'PASS: all tests' 'exit_code=42'
)
output=$(run_filter "$large_input")
assert_contains "$output" "PASS: all tests" "large output should preserve test milestone"
assert_contains "$output" "exit_code=42" "large output should preserve final propagated exit code"
assert_not_contains "$output" "Verbose output line 9999" "large output should filter verbose lines"
echo "PASS"

echo ""
echo "✓ All validation-output-filter exit code tests passed"
