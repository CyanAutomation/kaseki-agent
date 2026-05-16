#!/usr/bin/env bash
#
# Simple test suite for startup-checks.sh permission detection
#

set -euo pipefail

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

# Counters
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
log_pass() {
  echo -e "${GREEN}[PASS]${NC} $*" >&2
  ((TESTS_PASSED++))
}

log_fail() {
  echo -e "${RED}[FAIL]${NC} $*" >&2
  ((TESTS_FAILED++))
}

# Test: Verify startup-checks.sh contains the new functions
test_functions_exist() {
  local functions_to_check=(
    "is_path_on_readonly_mount"
    "get_current_permissions"
    "can_auto_fix_permissions"
    "auto_fix_directory_permissions"
    "auto_fix_file_permissions"
    "check_directory_traversable"
    "check_file_readable"
    "check_secret_paths"
  )
  
  echo ""
  echo "Testing function definitions..."
  
  for func in "${functions_to_check[@]}"; do
    if grep -q "^$func()" scripts/startup-checks.sh; then
      log_pass "$func defined"
    else
      log_fail "$func not found"
    fi
  done
}

# Test: Verify check_secret_paths is called in modes
test_integration_in_modes() {
  echo ""
  echo "Testing integration into modes..."
  
  if grep "check_secret_paths" scripts/startup-checks.sh | grep -q "all\|worker\|baseline-validation"; then
    log_pass "check_secret_paths found in startup-checks.sh"
  else
    log_fail "check_secret_paths integration not found"
  fi
}

# Test: Verify documentation updates
test_documentation() {
  echo ""
  echo "Testing documentation..."
  
  if grep -q "Permission Model\|permission.*model" docs/QUICK_START.md 2>/dev/null; then
    log_pass "Permission model documented in QUICK_START.md"
  else
    log_fail "Permission model not documented in QUICK_START.md"
  fi
  
  if grep -q "Permission Issues\|Secret Path Access" docs/TROUBLESHOOTING.md 2>/dev/null; then
    log_pass "Permission troubleshooting added to TROUBLESHOOTING.md"
  else
    log_fail "Permission troubleshooting not found in TROUBLESHOOTING.md"
  fi
}

# Test: Verify syntax is valid
test_syntax() {
  echo ""
  echo "Testing bash syntax..."
  
  if bash -n scripts/startup-checks.sh 2>/dev/null; then
    log_pass "startup-checks.sh has valid bash syntax"
  else
    log_fail "startup-checks.sh has syntax errors"
  fi
}

# Main test runner
main() {
  echo ""
  echo "========================================="
  echo "Startup Checks Permission Implementation Tests"
  echo "========================================="
  
  # Check if script exists
  if [ ! -f "scripts/startup-checks.sh" ]; then
    echo "Error: scripts/startup-checks.sh not found"
    exit 1
  fi
  
  # Run all tests
  test_functions_exist
  test_integration_in_modes
  test_documentation
  test_syntax
  
  # Summary
  echo ""
  echo "========================================="
  echo "Test Results"
  echo "========================================="
  echo -e "${GREEN}Passed:${NC} $TESTS_PASSED"
  echo -e "${RED}Failed:${NC} $TESTS_FAILED"
  echo ""
  
  if [ "$TESTS_FAILED" -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
    exit 0
  else
    echo -e "${RED}✗ Some tests failed (${TESTS_FAILED})${NC}"
    exit 1
  fi
}

main "$@"
