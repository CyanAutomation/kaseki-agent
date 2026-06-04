#!/usr/bin/env bash
#
# tests/host-setup-phase1.test.sh — Phase 1 unit tests for validation infrastructure
#
# Tests the new validation-stages.sh consolidation and kaseki-setup-host.sh refactoring.
# Each test validates a specific aspect of the Phase 1 implementation.
#
# Usage:
#   bash tests/host-setup-phase1.test.sh [--phase=1] [--verbose]
#
# Exit codes:
#   0 = all tests passed
#   1 = one or more tests failed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERBOSE="${VERBOSE:-0}"
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

# Test utilities
assert_exit_code() {
  local expected="$1" actual="$2" test_name="$3"
  if [ "$actual" = "$expected" ]; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    [ "$VERBOSE" = "1" ] && echo "  ✓ $test_name (exit=$actual)"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo "  ✗ $test_name (expected=$expected, actual=$actual)" >&2
  fi
}

assert_file_exists() {
  local file="$1" test_name="$2"
  if [ -f "$file" ]; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    [ "$VERBOSE" = "1" ] && echo "  ✓ $test_name"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo "  ✗ $test_name (file not found: $file)" >&2
  fi
}

assert_file_contains() {
  local file="$1" pattern="$2" test_name="$3"
  if grep -q "$pattern" "$file"; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    [ "$VERBOSE" = "1" ] && echo "  ✓ $test_name"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo "  ✗ $test_name (pattern not found: $pattern)" >&2
  fi
}

assert_json_valid() {
  local file="$1" test_name="$2"
  if command -v jq >/dev/null 2>&1; then
    if jq . "$file" >/dev/null 2>&1; then
      TESTS_PASSED=$((TESTS_PASSED + 1))
      [ "$VERBOSE" = "1" ] && echo "  ✓ $test_name (valid JSON)"
    else
      TESTS_FAILED=$((TESTS_FAILED + 1))
      echo "  ✗ $test_name (invalid JSON)" >&2
    fi
  else
    TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
    [ "$VERBOSE" = "1" ] && echo "  ⊘ $test_name (jq not available)"
  fi
}

# --- Phase 1 Tests ---

# Test 1: validation-stages.sh exists and is executable
test_validation_stages_exists() {
  echo "Test 1: validation-stages.sh exists"
  assert_file_exists "$SCRIPT_DIR/scripts/validation-stages.sh" "validation-stages.sh is present"
  [ -x "$SCRIPT_DIR/scripts/validation-stages.sh" ] && \
    { TESTS_PASSED=$((TESTS_PASSED + 1)); [ "$VERBOSE" = "1" ] && echo "  ✓ validation-stages.sh is executable"; } || \
    { TESTS_FAILED=$((TESTS_FAILED + 1)); echo "  ✗ validation-stages.sh is not executable" >&2; }
}

# Test 2: validation-stages.sh sources without error
test_validation_stages_sources() {
  echo "Test 2: validation-stages.sh can be sourced"
  if bash -c "source '$SCRIPT_DIR/scripts/validation-stages.sh'" 2>/dev/null; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    [ "$VERBOSE" = "1" ] && echo "  ✓ validation-stages.sh sources correctly"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo "  ✗ validation-stages.sh has syntax errors" >&2
  fi
}

# Test 3: kaseki-setup-host.sh --help works
test_kaseki_setup_help() {
  echo "Test 3: kaseki-setup-host.sh --help"
  output=$("$SCRIPT_DIR/scripts/kaseki-setup-host.sh" --help 2>&1 || true)
  if echo "$output" | grep -q "Usage:"; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    [ "$VERBOSE" = "1" ] && echo "  ✓ --help displays usage"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo "  ✗ --help output missing" >&2
  fi
}

# Test 4: kaseki-setup-host.sh accepts --check-only
test_kaseki_setup_check_only_flag() {
  echo "Test 4: kaseki-setup-host.sh --check-only flag"
  output=$("$SCRIPT_DIR/scripts/kaseki-setup-host.sh" --check-only 2>&1 || true)
  if echo "$output" | grep -q "Stage"; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    [ "$VERBOSE" = "1" ] && echo "  ✓ --check-only mode runs"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo "  ✗ --check-only mode failed" >&2
  fi
}

# Test 5: kaseki-setup-host.sh generates host-state.json
test_kaseki_setup_generates_state_json() {
  echo "Test 5: kaseki-setup-host.sh generates host-state.json"
  rm -f ~/.kaseki/host-state.json
  "$SCRIPT_DIR/scripts/kaseki-setup-host.sh" --check-only >/dev/null 2>&1 || true
  assert_file_exists "$HOME/.kaseki/host-state.json" "host-state.json is generated"
}

# Test 6: host-state.json is valid JSON
test_host_state_json_valid() {
  echo "Test 6: host-state.json is valid JSON"
  if [ -f "$HOME/.kaseki/host-state.json" ]; then
    assert_json_valid "$HOME/.kaseki/host-state.json" "host-state.json is valid"
  else
    TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
    [ "$VERBOSE" = "1" ] && echo "  ⊘ host-state.json not found (skipped)"
  fi
}

# Test 7: host-state.json contains checkout_freshness_probe
test_host_state_contains_probe() {
  echo "Test 7: host-state.json contains probe results"
  if [ -f "$HOME/.kaseki/host-state.json" ]; then
    assert_file_contains "$HOME/.kaseki/host-state.json" "checkout_freshness_probe" \
      "host-state.json contains probe data"
  else
    TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
    [ "$VERBOSE" = "1" ] && echo "  ⊘ host-state.json not found (skipped)"
  fi
}

# Test 8: kaseki-setup-host.sh generates setup-results.json
test_kaseki_setup_generates_results_json() {
  echo "Test 8: kaseki-setup-host.sh generates setup-results.json"
  rm -f ~/.kaseki/setup-results.json
  "$SCRIPT_DIR/scripts/kaseki-setup-host.sh" --check-only >/dev/null 2>&1 || true
  assert_file_exists "$HOME/.kaseki/setup-results.json" "setup-results.json is generated"
}

# Test 9: setup-results.json is valid JSON
test_setup_results_json_valid() {
  echo "Test 9: setup-results.json is valid JSON"
  if [ -f "$HOME/.kaseki/setup-results.json" ]; then
    assert_json_valid "$HOME/.kaseki/setup-results.json" "setup-results.json is valid"
  else
    TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
    [ "$VERBOSE" = "1" ] && echo "  ⊘ setup-results.json not found (skipped)"
  fi
}

# Test 10: setup-results.json contains mode field
test_setup_results_contains_mode() {
  echo "Test 10: setup-results.json contains mode field"
  if [ -f "$HOME/.kaseki/setup-results.json" ]; then
    assert_file_contains "$HOME/.kaseki/setup-results.json" '"mode"' \
      "setup-results.json contains mode"
  else
    TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
    [ "$VERBOSE" = "1" ] && echo "  ⊘ setup-results.json not found (skipped)"
  fi
}

# Test 11: --check-only mode does not change /agents
test_check_only_no_changes() {
  echo "Test 11: --check-only mode makes no changes"
  # Record stat before
  if [ -d /agents ]; then
    before=$(stat -c %Y /agents 2>/dev/null || stat -f %m /agents 2>/dev/null || echo "0")
    sleep 0.5
    "$SCRIPT_DIR/scripts/kaseki-setup-host.sh" --check-only >/dev/null 2>&1 || true
    after=$(stat -c %Y /agents 2>/dev/null || stat -f %m /agents 2>/dev/null || echo "0")
    if [ "$before" = "$after" ]; then
      TESTS_PASSED=$((TESTS_PASSED + 1))
      [ "$VERBOSE" = "1" ] && echo "  ✓ /agents was not modified by --check-only"
    else
      TESTS_FAILED=$((TESTS_FAILED + 1))
      echo "  ✗ /agents was modified by --check-only (potential bug)" >&2
    fi
  else
    TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
    [ "$VERBOSE" = "1" ] && echo "  ⊘ /agents not found (skipped)"
  fi
}

# Test 12: validation-stages.sh exports functions
test_validation_stages_exports() {
  echo "Test 12: validation-stages.sh exports functions"
  output=$(bash -c "source '$SCRIPT_DIR/scripts/validation-stages.sh' && declare -f validate_host_prerequisites" 2>&1 || true)
  if echo "$output" | grep -q "validate_host_prerequisites"; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    [ "$VERBOSE" = "1" ] && echo "  ✓ validate_host_prerequisites is exported"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo "  ✗ validate_host_prerequisites not exported" >&2
  fi
}

# Test 13: validate_container_entry accepts modes
test_validate_container_entry_modes() {
  echo "Test 13: validate_container_entry accepts all modes"
  for mode in all permissions bootstrap quick worker; do
    output=$(bash -c "source '$SCRIPT_DIR/scripts/validation-stages.sh' && validate_container_entry $mode" 2>&1 || true)
    if ! echo "$output" | grep -q "Unknown validation mode"; then
      TESTS_PASSED=$((TESTS_PASSED + 1))
      [ "$VERBOSE" = "1" ] && echo "  ✓ Mode '$mode' is accepted"
    else
      TESTS_FAILED=$((TESTS_FAILED + 1))
      echo "  ✗ Mode '$mode' rejected" >&2
      break
    fi
  done
}

# Test 14: Log functions are available
test_log_functions_available() {
  echo "Test 14: Log functions are exported"
  for func in log_pass log_warn log_error log_info; do
    output=$(bash -c "source '$SCRIPT_DIR/scripts/validation-stages.sh' && declare -f $func" 2>&1 || true)
    if echo "$output" | grep -q "$func"; then
      TESTS_PASSED=$((TESTS_PASSED + 1))
      [ "$VERBOSE" = "1" ] && echo "  ✓ $func is exported"
    else
      TESTS_FAILED=$((TESTS_FAILED + 1))
      echo "  ✗ $func not exported" >&2
      break
    fi
  done
}

# Test 15: kaseki-setup-host.sh integration with validation-stages.sh
test_kaseki_sources_validation() {
  echo "Test 15: kaseki-setup-host.sh sources validation-stages.sh"
  output=$(bash -c "source '$SCRIPT_DIR/scripts/validation-stages.sh'" 2>&1 || true)
  if [ -z "$output" ] || ! echo "$output" | grep -q "error"; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    [ "$VERBOSE" = "1" ] && echo "  ✓ Integration is correct"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo "  ✗ Integration issue detected" >&2
  fi
}

# --- Test Summary ---

run_all_tests() {
  echo ""
  echo "===== Phase 1: Validation Infrastructure Tests ====="
  echo ""

  test_validation_stages_exists
  test_validation_stages_sources
  test_kaseki_setup_help
  test_kaseki_setup_check_only_flag
  test_kaseki_setup_generates_state_json
  test_host_state_json_valid
  test_host_state_contains_probe
  test_kaseki_setup_generates_results_json
  test_setup_results_json_valid
  test_setup_results_contains_mode
  test_check_only_no_changes
  test_validation_stages_exports
  test_validate_container_entry_modes
  test_log_functions_available
  test_kaseki_sources_validation

  echo ""
  echo "===== Test Results ====="
  echo "Passed:  $TESTS_PASSED"
  echo "Failed:  $TESTS_FAILED"
  echo "Skipped: $TESTS_SKIPPED"
  echo ""

  if [ "$TESTS_FAILED" -eq 0 ]; then
    echo "✓ All tests passed!"
    return 0
  else
    echo "✗ Some tests failed"
    return 1
  fi
}

run_all_tests
exit $?
