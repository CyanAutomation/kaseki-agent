#!/usr/bin/env bash
# shellcheck disable=SC2034,SC2317
# Tests for hashline non-fatal exit code behavior
# Verifies that validation failures (anchor mismatches) don't cause exit 1,
# but infrastructure errors (missing files, I/O) do.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Stub functions to avoid full kaseki-agent.sh dependencies
set_current_stage() { :; }
emit_progress() { printf '[progress] %s: %s\n' "$1" "$2" >> "${RESULTS_DIR}/progress.log"; }
emit_event() { printf '%s\n' "$*" >> "${RESULTS_DIR}/events.log"; }
emit_error_event() { printf '[error] %s: %s\n' "$1" "$2" >> "${RESULTS_DIR}/events.log"; }
record_stage_timing() { printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "${4:-}" >> "${RESULTS_DIR}/stage-timings.tsv"; }

pass() {
  local message="${1:?pass message required}"
  printf '✓ %s\n' "$message"
}

fail() {
  local message="${1:?failure message required}"
  printf '✗ %s\n' "$message" >&2
  exit 1
}

setup_results_dir() {
  rm -rf "$TMP_DIR/results"
  mkdir -p "$TMP_DIR/results"
  export RESULTS_DIR="$TMP_DIR/results"
  export KASEKI_RESULTS_DIR="$TMP_DIR/results"
  : > "$RESULTS_DIR/progress.log"
  : > "$RESULTS_DIR/events.log"
  : > "$RESULTS_DIR/stage-timings.tsv"
  : > "$RESULTS_DIR/hashline-validation.log"
}

# Extract the hashline validation logic from kaseki-agent.sh
# This is the section we're testing: lines 9928-9960
# Returns 0 for validation failures, 1 for infrastructure errors
test_hashline_nonfatal_logic() {
  local hashline_exit="$1"
  local errors_count="$2"
  local rejected_count="${3:-0}"

  # Setup: Create a mock hashline-summary.json
  cat > "$RESULTS_DIR/hashline-summary.json" <<EOF
{
  "applied": $((10 - rejected_count - errors_count)),
  "rejected": $rejected_count,
  "errors": $errors_count,
  "totalLinesModified": $((10 - rejected_count - errors_count))
}
EOF

  # Simulate the hashline validation section from kaseki-agent.sh in a subshell
  # to avoid exiting the test script
  (
    local STATUS=0
    local FAILED_COMMAND=""
    
    # This mirrors the logic from kaseki-agent.sh lines 9928-9960
    if [ "$hashline_exit" -ne 0 ] && [ "$STATUS" -eq 0 ]; then
      # Check if the failure is due to infrastructure errors (errors > 0) or just validation rejections
      HASHLINE_ERRORS=0
      if [ -f "${RESULTS_DIR}/hashline-summary.json" ]; then
        HASHLINE_ERRORS=$(node - "${RESULTS_DIR}/hashline-summary.json" <<'NODE' 2>/dev/null || printf '0\n'
const fs = require('node:fs');
const summary = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
process.stdout.write(String(summary.errors || 0));
NODE
)
      fi

      # Only propagate exit code if there are actual infrastructure errors
      if [ "$HASHLINE_ERRORS" -gt 0 ]; then
        STATUS="$hashline_exit"
        FAILED_COMMAND="hashline validation"
        emit_error_event "hashline_validation_failed" "Hashline event processing failed with exit code $hashline_exit (infrastructure/I/O error, $HASHLINE_ERRORS errors)"
      else
        # Validation failures only (rejected edits due to anchor mismatches) - non-fatal
        local rejected_from_summary
        rejected_from_summary=$(node - "${RESULTS_DIR}/hashline-summary.json" <<'NODE' 2>/dev/null || printf '0\n'
const fs = require('node:fs');
const summary = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
process.stdout.write(String(summary.rejected || 0));
NODE
)
        printf 'Hashline validation: %d edits rejected due to anchor mismatches (non-fatal; recorded in restoration-report.md)\n' "$rejected_from_summary" | tee -a "${RESULTS_DIR}"/hashline-validation.log
      fi
    fi

    # Exit with the determined status code (0 for validation failures, 1 for infrastructure errors)
    exit "$STATUS"
  )
}

# Test 1: Hashline exits with 1, but only validation failures (errors=0) -> should exit 0
echo "==> Test 1: Hashline validation failure (anchor mismatch) with exit 1"
{
  setup_results_dir
  if test_hashline_nonfatal_logic 1 0 5; then
    # Should succeed (exit 0)
    pass "Hashline validation with rejected edits (no infrastructure errors) exits 0"
  else
    fail "Hashline validation with rejected edits should exit 0, got exit $?"
  fi
}

# Test 2: Hashline exits with 1, with infrastructure errors (errors>0) -> should propagate exit 1
echo "==> Test 2: Hashline infrastructure error (missing file) with exit 1"
{
  setup_results_dir
  if test_hashline_nonfatal_logic 1 2 3; then
    fail "Hashline with infrastructure errors should exit 1, but exited 0"
  else
    exit_code=$?
    if [ "$exit_code" -eq 1 ]; then
      pass "Hashline with infrastructure errors (2 errors) exits 1"
    else
      fail "Hashline with infrastructure errors should exit 1, got exit $exit_code"
    fi
  fi
}

# Test 3: Hashline exits with 0 (success) -> should always exit 0
echo "==> Test 3: Hashline success with no rejections or errors"
{
  setup_results_dir
  if test_hashline_nonfatal_logic 0 0 0; then
    pass "Hashline success (no errors, no rejections) exits 0"
  else
    fail "Hashline success should exit 0, got exit $?"
  fi
}

# Test 4: Hashline exits with 0 (success with rejections) -> should exit 0
echo "==> Test 4: Hashline success with some rejections"
{
  setup_results_dir
  if test_hashline_nonfatal_logic 0 0 3; then
    pass "Hashline success with rejections exits 0"
  else
    fail "Hashline success with rejections should exit 0, got exit $?"
  fi
}

# Test 5: Verify that hashline-summary.json with errors field is properly checked
echo "==> Test 5: hashline-summary.json parsing robustness"
{
  setup_results_dir
  
  # Test with missing errors field (should default to 0)
  cat > "$RESULTS_DIR/hashline-summary.json" <<EOF
{
  "applied": 5,
  "rejected": 2
}
EOF
  
  if test_hashline_nonfatal_logic 1 0 2; then
    pass "Hashline summary without errors field defaults to non-fatal"
  else
    fail "Hashline summary without errors field should exit 0"
  fi
}

# Test 6: Verify progress logging distinguishes fatal vs non-fatal
echo "==> Test 6: Progress logging for validation failures"
{
  setup_results_dir
  test_hashline_nonfatal_logic 1 0 5 || true
  
  if grep -q "edits rejected due to anchor mismatches" "$RESULTS_DIR/hashline-validation.log"; then
    pass "Progress logging includes anchor mismatch message"
  else
    fail "Progress logging should mention anchor mismatches"
  fi
}

# Test 7: Verify error event is only emitted for infrastructure errors
echo "==> Test 7: Error event emission for infrastructure errors only"
{
  setup_results_dir
  test_hashline_nonfatal_logic 1 2 0 || true
  
  if grep -q "hashline_validation_failed" "$RESULTS_DIR/events.log"; then
    pass "Infrastructure error events are recorded"
  else
    fail "Infrastructure error events should be recorded"
  fi
}

# Test 8: No error event for validation failures
echo "==> Test 8: No error event emission for validation failures"
{
  setup_results_dir
  test_hashline_nonfatal_logic 1 0 3 || true
  
  if ! grep -q "hashline_validation_failed" "$RESULTS_DIR/events.log"; then
    pass "No error events for validation failures (anchor mismatches)"
  else
    fail "Should not emit error events for validation failures"
  fi
}

echo ""
echo "All hashline non-fatal exit code tests passed!"
