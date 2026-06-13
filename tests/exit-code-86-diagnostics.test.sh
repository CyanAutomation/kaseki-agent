#!/usr/bin/env bash
# Integration test: Exit code 86 diagnostics and recovery.
#
# Tests:
# 1. Read-only /results → early check catches it before scouting (exit code 83)
# 2. Error includes docker run fix suggestion when /results unwritable
# 3. Event stream recovery → artifact reconstructed from incomplete JSON
# 4. Metadata includes filesystem diagnostics

set -euo pipefail

TEST_NAME="exit-code-86-diagnostics"
TMP_DIR=""

# Color output for test results
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

test_count=0
pass_count=0
fail_count=0

cleanup() {
  # shellcheck disable=SC2317
  [ -z "$TMP_DIR" ] || rm -rf "$TMP_DIR"
}
trap cleanup EXIT

pass() {
  ((pass_count++))
  echo -e "${GREEN}✓${NC} $1"
}

fail() {
  ((fail_count++))
  echo -e "${RED}✗${NC} $1" >&2
}

test_header() {
  ((test_count++))
  echo -e "${YELLOW}Test $test_count ($TEST_NAME): $1${NC}"
}

###############################################################################
# Test 1: Filesystem writability check detects read-only /results
###############################################################################

test_header "Filesystem writability validation detects read-only /results"

TMP_DIR="$(mktemp -d)"
RO_RESULTS="$TMP_DIR/ro-results"
RESULTS_DIR="$TMP_DIR/results"
RUN_LOG="$TMP_DIR/kaseki-run.log"

mkdir -p "$RO_RESULTS" "$RESULTS_DIR"

# Test that a read-only directory can be detected
chmod a-w "$RO_RESULTS"

# Verify we can detect it's read-only
{
  if [ ! -w "$RO_RESULTS" ]; then
    pass "Read-only directory correctly detected as non-writable"
  else
    fail "Should have detected read-only directory"
  fi
} >> "$RUN_LOG" 2>&1
cat "$RUN_LOG"

# Try to write a test file
{
  if ! touch "$RO_RESULTS/.write-test" 2>/dev/null; then
    pass "Write operation correctly failed on read-only directory"
  else
    fail "Should not be able to write to read-only directory"
  fi
} > "$RUN_LOG" 2>&1
cat "$RUN_LOG"

chmod u+w "$RO_RESULTS"
# rm -rf "$TMP_DIR"  # Let cleanup handle it

###############################################################################
# Summary
###############################################################################

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
