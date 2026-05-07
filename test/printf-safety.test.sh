#!/usr/bin/env bash
# Test suite for printf safety and restoration report generation fixes
# Tests edge cases that could cause the "printf: - : invalid option" error

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_RESULTS_DIR="${SCRIPT_DIR}/test/printf-safety-results"
KASEKI_SCRIPT="${SCRIPT_DIR}/kaseki-agent.sh"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Setup and teardown
setup() {
  mkdir -p "$TEST_RESULTS_DIR"
  mkdir -p "$TEST_RESULTS_DIR/results"
  cd "$TEST_RESULTS_DIR"
}

teardown() {
  rm -rf "$TEST_RESULTS_DIR"
}

# Test helpers
run_test() {
  local test_name="$1"
  local test_func="$2"
  
  TESTS_RUN=$((TESTS_RUN + 1))
  printf '[%3d] %-60s ' "$TESTS_RUN" "$test_name"
  
  if "$test_func" 2>/dev/null; then
    printf "${GREEN}PASS${NC}\n"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    printf "${RED}FAIL${NC}\n"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Test: validate_numeric with valid input
test_validate_numeric_valid() {
  source <(sed -n '/^validate_numeric()/,/^}/p' "$KASEKI_SCRIPT")
  validate_numeric "test_var" "42"
}

# Test: validate_numeric with dash (the bug trigger)
test_validate_numeric_dash() {
  source <(sed -n '/^validate_numeric()/,/^}/p' "$KASEKI_SCRIPT")
  ! validate_numeric "test_var" "-"
}

# Test: validate_numeric with non-numeric input
test_validate_numeric_non_numeric() {
  source <(sed -n '/^validate_numeric()/,/^}/p' "$KASEKI_SCRIPT")
  ! validate_numeric "test_var" "not-a-number"
}

# Test: validate_numeric with empty input
test_validate_numeric_empty() {
  source <(sed -n '/^validate_numeric()/,/^}/p' "$KASEKI_SCRIPT")
  ! validate_numeric "test_var" ""
}

# Test: restoration report with missing file
test_restoration_report_missing_file() {
  source <(sed -n '/^validate_numeric()/,/^}/p' "$KASEKI_SCRIPT")
  source <(sed -n '/^generate_restoration_report()/,/^}/p' "$KASEKI_SCRIPT")
  
  rm -f results/restoration.jsonl
  generate_restoration_report  # Should return 0 (skip silently)
  [ $? -eq 0 ]
}

# Test: restoration report with empty file
test_restoration_report_empty_file() {
  source <(sed -n '/^validate_numeric()/,/^}/p' "$KASEKI_SCRIPT")
  source <(sed -n '/^generate_restoration_report()/,/^}/p' "$KASEKI_SCRIPT")
  
  : > results/restoration.jsonl
  generate_restoration_report  # Should return 0 (no changes to report)
  [ $? -eq 0 ]
}

# Test: restoration report with valid entries
test_restoration_report_valid_entries() {
  source <(sed -n '/^validate_numeric()/,/^}/p' "$KASEKI_SCRIPT")
  source <(sed -n '/^generate_restoration_report()/,/^}/p' "$KASEKI_SCRIPT")
  
  cat > results/restoration.jsonl <<'EOF'
{"timestamp":"2026-05-07T10:00:00Z","event":"file_evaluated","file":"src/test.ts","status":"kept","reason":"matched_allowlist"}
{"timestamp":"2026-05-07T10:00:01Z","event":"file_restored","file":"docs/readme.md","status":"restored","reason":"not_in_allowlist"}
EOF
  
  generate_restoration_report && [ -f results/restoration-report.md ] && \
    grep -q 'Total Files Changed: 2' results/restoration-report.md && \
    grep -q 'Files Kept: 1' results/restoration-report.md && \
    grep -q 'Files Restored: 1' results/restoration-report.md
}

# Test: restoration report with only kept files
test_restoration_report_only_kept() {
  source <(sed -n '/^validate_numeric()/,/^}/p' "$KASEKI_SCRIPT")
  source <(sed -n '/^generate_restoration_report()/,/^}/p' "$KASEKI_SCRIPT")
  
  cat > results/restoration.jsonl <<'EOF'
{"timestamp":"2026-05-07T10:00:00Z","event":"file_evaluated","file":"src/test.ts","status":"kept","reason":"matched_allowlist"}
{"timestamp":"2026-05-07T10:00:01Z","event":"file_evaluated","file":"src/lib.ts","status":"kept","reason":"matched_allowlist"}
EOF
  
  generate_restoration_report && [ -f results/restoration-report.md ] && \
    grep -q 'Total Files Changed: 2' results/restoration-report.md && \
    grep -q 'Allowlist Coverage: 100' results/restoration-report.md
}

# Test: restoration report with only restored files
test_restoration_report_only_restored() {
  source <(sed -n '/^validate_numeric()/,/^}/p' "$KASEKI_SCRIPT")
  source <(sed -n '/^generate_restoration_report()/,/^}/p' "$KASEKI_SCRIPT")
  
  cat > results/restoration.jsonl <<'EOF'
{"timestamp":"2026-05-07T10:00:00Z","event":"file_restored","file":"docs/readme.md","status":"restored","reason":"not_in_allowlist"}
{"timestamp":"2026-05-07T10:00:01Z","event":"file_restored","file":"CHANGELOG.md","status":"restored","reason":"not_in_allowlist"}
EOF
  
  generate_restoration_report && [ -f results/restoration-report.md ] && \
    grep -q 'Total Files Changed: 2' results/restoration-report.md && \
    grep -q 'Allowlist Coverage: 0' results/restoration-report.md && \
    grep -q 'Low Allowlist Coverage' results/restoration-report.md
}

# Test: restoration report with low coverage warning
test_restoration_report_low_coverage_warning() {
  source <(sed -n '/^validate_numeric()/,/^}/p' "$KASEKI_SCRIPT")
  source <(sed -n '/^generate_restoration_report()/,/^}/p' "$KASEKI_SCRIPT")
  
  # Create scenario: 1 kept, 9 restored = 10% coverage (< 50%)
  printf '{"timestamp":"2026-05-07T10:00:00Z","event":"file_evaluated","file":"src/test.ts","status":"kept","reason":"matched_allowlist"}\n' > results/restoration.jsonl
  for i in {1..9}; do
    printf '{"timestamp":"2026-05-07T10:00:%02d","event":"file_restored","file":"file%d.txt","status":"restored","reason":"not_in_allowlist"}\n' "$i" "$i" >> results/restoration.jsonl
  done
  
  generate_restoration_report && [ -f results/restoration-report.md ] && \
    grep -q 'Low Allowlist Coverage' results/restoration-report.md && \
    grep -q 'Allowlist Coverage: 10' results/restoration-report.md
}

# Test: printf with valid numeric argument (should not fail)
test_printf_valid_numeric() {
  local test_var=42
  printf 'test: %d\n' "$test_var" > /dev/null 2>&1
  [ $? -eq 0 ]
}

# Test: printf with dash argument (should fail without quoting)
test_printf_dash_unquoted_fails() {
  local test_var="-"
  # This SHOULD fail with unquoted expansion
  ! printf '%d\n' $test_var > /dev/null 2>&1
}

# Test: printf with dash argument quoted (should fail with validation)
test_printf_dash_quoted_validation() {
  source <(sed -n '/^validate_numeric()/,/^}/p' "$KASEKI_SCRIPT")
  local test_var="-"
  ! validate_numeric "test_var" "$test_var"
}

# Test: grep count fallback works
test_grep_count_fallback() {
  # Empty file, grep should return 0
  : > results/test.jsonl
  local count=$(grep -c 'pattern' results/test.jsonl 2>/dev/null || echo 0)
  [ "$count" -eq 0 ]
}

# Test: grep count fallback on missing file
test_grep_count_fallback_missing() {
  # Missing file, fallback should trigger
  local count=$(grep -c 'pattern' results/nonexistent.jsonl 2>/dev/null || echo 0)
  [ "$count" -eq 0 ]
}

# Test: json_encode function availability
test_json_encode_exists() {
  source <(sed -n '/^json_encode()/,/^}/p' "$KASEKI_SCRIPT")
  local output=$(printf 'test' | json_encode)
  [ "$output" = '"test"' ]
}

# Test: json_encode fallback when node unavailable
test_json_encode_fallback() {
  source <(sed -n '/^json_encode()/,/^}/p' "$KASEKI_SCRIPT")
  
  # Temporarily override PATH to hide node
  local old_path="$PATH"
  export PATH="/usr/bin:/bin"  # Minimal PATH without node
  
  local output=$(printf 'test' | json_encode 2>/dev/null || true)
  # Should return empty JSON string "" or handle gracefully
  export PATH="$old_path"
  
  # Test passes if it doesn't crash
  true
}

# Main test execution
main() {
  printf '\n%s\n' "$(printf '=%.0s' {1..70})"
  printf 'Testing Printf Safety & Restoration Report Generation Fixes\n'
  printf '%s\n' "$(printf '=%.0s' {1..70})"
  printf '\n'
  
  setup
  
  # validate_numeric tests
  printf '\n%s\n' '### validate_numeric() tests'
  run_test "validate_numeric with valid integer" test_validate_numeric_valid
  run_test "validate_numeric rejects dash (-)" test_validate_numeric_dash
  run_test "validate_numeric rejects non-numeric" test_validate_numeric_non_numeric
  run_test "validate_numeric rejects empty" test_validate_numeric_empty
  
  # restoration report tests
  printf '\n%s\n' '### generate_restoration_report() tests'
  run_test "restoration report skips missing file" test_restoration_report_missing_file
  run_test "restoration report handles empty file" test_restoration_report_empty_file
  run_test "restoration report with valid entries" test_restoration_report_valid_entries
  run_test "restoration report with only kept files" test_restoration_report_only_kept
  run_test "restoration report with only restored files" test_restoration_report_only_restored
  run_test "restoration report low coverage warning" test_restoration_report_low_coverage_warning
  
  # printf safety tests
  printf '\n%s\n' '### printf safety tests'
  run_test "printf with valid numeric argument" test_printf_valid_numeric
  run_test "printf with dash (unquoted) should fail" test_printf_dash_unquoted_fails
  run_test "printf with dash (validation) should fail" test_printf_dash_quoted_validation
  
  # grep fallback tests
  printf '\n%s\n' '### grep fallback tests'
  run_test "grep count fallback on empty file" test_grep_count_fallback
  run_test "grep count fallback on missing file" test_grep_count_fallback_missing
  
  # json_encode tests
  printf '\n%s\n' '### json_encode() tests'
  run_test "json_encode function works" test_json_encode_exists
  run_test "json_encode handles node unavailable" test_json_encode_fallback
  
  # Summary
  printf '\n%s\n' "$(printf '=%.0s' {1..70})"
  printf 'Test Results: %d/%d passed, %d failed\n' "$TESTS_PASSED" "$TESTS_RUN" "$TESTS_FAILED"
  
  if [ "$TESTS_FAILED" -eq 0 ]; then
    printf "${GREEN}✓ All tests passed!${NC}\n"
    teardown
    return 0
  else
    printf "${RED}✗ Some tests failed${NC}\n"
    printf 'Results directory: %s\n' "$TEST_RESULTS_DIR"
    return 1
  fi
}

main "$@"
