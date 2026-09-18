#!/usr/bin/env bash
# shellcheck disable=SC1091,SC2034
# Tests for detect-available-npm-scripts helper.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" || { echo "Error: Failed to determine repository root" >&2; exit 1; }
HELPER_PATH="$ROOT_DIR/scripts/detect-available-npm-scripts.sh"
if [[ ! -f "$HELPER_PATH" ]]; then
  echo "Error: detect-available-npm-scripts helper not found at $HELPER_PATH" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }

assert_equals() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    pass "$label"
  else
    fail "$label: expected '$expected', got '$actual'"
  fi
}

assert_contains() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" == *"$expected"* ]]; then
    pass "$label"
  else
    fail "$label: expected to find '$expected' in '$actual'"
  fi
}

# Source the helper
# shellcheck source=/dev/null
. "$HELPER_PATH"

# Test 1: get_available_npm_scripts with valid package.json
case_get_available_scripts_valid_json() {
  cd "$TMP_DIR"
  cat > package.json <<'JSON'
{
  "name": "test-project",
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix"
  }
}
JSON
  
  local result
  result="$(get_available_npm_scripts ./package.json)"
  assert_contains "available scripts includes build" "build" "$result"
  assert_contains "available scripts includes test" "test" "$result"
  assert_contains "available scripts includes lint" "lint" "$result"
  assert_contains "available scripts includes lint:fix" "lint:fix" "$result"
}

# Test 2: get_available_npm_scripts with missing package.json
case_get_available_scripts_missing_file() {
  cd "$TMP_DIR"
  if get_available_npm_scripts ./nonexistent.json >/dev/null 2>&1; then
    fail "should return error for missing package.json"
  else
    pass "missing package.json returns error"
  fi
}

# Test 3: get_available_npm_scripts with empty scripts section
case_empty_scripts_section() {
  cd "$TMP_DIR"
  cat > package.json <<'JSON'
{
  "name": "test-project"
}
JSON
  
  local result
  result="$(get_available_npm_scripts ./package.json)"
  assert_equals "empty scripts returns empty string" "" "$result"
}

# Test 4: script_is_available with existing script
case_script_is_available_exists() {
  cd "$TMP_DIR"
  cat > package.json <<'JSON'
{
  "scripts": {
    "lint:fix": "eslint . --fix",
    "test": "jest"
  }
}
JSON
  
  if script_is_available "lint:fix" ./package.json; then
    pass "script_is_available detects existing script"
  else
    fail "script_is_available should find lint:fix"
  fi
}

# Test 5: script_is_available with missing script
case_script_is_available_missing() {
  cd "$TMP_DIR"
  cat > package.json <<'JSON'
{
  "scripts": {
    "test": "jest"
  }
}
JSON
  
  if script_is_available "nonexistent" ./package.json 2>/dev/null; then
    fail "script_is_available should not find nonexistent script"
  else
    pass "script_is_available correctly reports missing script"
  fi
}

# Test 6: filter_npm_commands_to_available - keeps available npm commands
case_filter_keeps_available_commands() {
  cd "$TMP_DIR"
  cat > package.json <<'JSON'
{
  "scripts": {
    "lint:fix": "eslint . --fix",
    "test": "jest"
  }
}
JSON
  
  local result
  result="$(filter_npm_commands_to_available "npm run lint:fix;npm run test" ./package.json)"
  assert_equals "filter keeps available npm commands" "npm run lint:fix;npm run test" "$result"
}

# Test 7: filter_npm_commands_to_available - removes unavailable npm commands
case_filter_removes_unavailable_commands() {
  cd "$TMP_DIR"
  cat > package.json <<'JSON'
{
  "scripts": {
    "test": "jest"
  }
}
JSON
  
  local result
  result="$(filter_npm_commands_to_available "npm run lint:fix;npm run test" ./package.json)"
  assert_equals "filter removes unavailable npm commands" "npm run test" "$result"
}

# Test 8: filter_npm_commands_to_available - keeps non-npm commands
case_filter_keeps_non_npm_commands() {
  cd "$TMP_DIR"
  cat > package.json <<'JSON'
{
  "scripts": {
    "test": "jest"
  }
}
JSON
  
  local result
  result="$(filter_npm_commands_to_available "npm run test;__kaseki_trailing_whitespace_cleanup__" ./package.json)"
  assert_contains "filter keeps non-npm commands" "__kaseki_trailing_whitespace_cleanup__" "$result"
  assert_contains "filter keeps npm commands" "npm run test" "$result"
}

# Test 9: filter_npm_commands_to_available - handles mixed availability
case_filter_mixed_availability() {
  cd "$TMP_DIR"
  cat > package.json <<'JSON'
{
  "scripts": {
    "lint": "eslint .",
    "build": "tsc"
  }
}
JSON
  
  local result
  result="$(filter_npm_commands_to_available "npm run lint;npm run missing:fix;npm run build" ./package.json)"
  assert_contains "filter includes lint" "npm run lint" "$result"
  assert_contains "filter includes build" "npm run build" "$result"
  # Make sure missing:fix is NOT in the result
  if [[ "$result" == *"missing:fix"* ]]; then
    fail "filter should not include missing:fix"
  else
    pass "filter correctly excludes missing commands"
  fi
}

# Test 10: filter_npm_commands_to_available - empty package.json (no scripts)
case_filter_with_empty_scripts() {
  cd "$TMP_DIR"
  cat > package.json <<'JSON'
{
  "name": "test-project"
}
JSON
  
  local result
  result="$(filter_npm_commands_to_available "npm run lint:fix;__kaseki_trailing_whitespace_cleanup__" ./package.json)"
  # Only non-npm commands should remain
  assert_equals "filter with empty scripts keeps only non-npm" "__kaseki_trailing_whitespace_cleanup__" "$result"
}

# Test 11: filter_npm_commands_to_available - malformed JSON
case_filter_with_malformed_json() {
  cd "$TMP_DIR"
  printf 'invalid json' > package.json
  
  local result
  result="$(filter_npm_commands_to_available "npm run test;__kaseki_trailing_whitespace_cleanup__" ./package.json)"
  # Should still include non-npm commands
  assert_contains "filter handles malformed json gracefully" "__kaseki_trailing_whitespace_cleanup__" "$result"
}

# Test 12: npm_run_script_name - extracts script correctly
case_npm_run_script_name_basic() {
  local result
  result="$(npm_run_script_name 'npm run lint:fix')"
  assert_equals "extracts script name from basic command" "lint:fix" "$result"
}

# Test 13: npm_run_script_name - handles arguments
case_npm_run_script_name_with_args() {
  local result
  result="$(npm_run_script_name 'npm run test -- --watch')"
  assert_equals "extracts script name with trailing args" "test" "$result"
}

# Test 14: npm_run_script_name - handles whitespace
case_npm_run_script_name_whitespace() {
  local result
  result="$(npm_run_script_name 'npm   run   build')"
  assert_equals "extracts script name with extra whitespace" "build" "$result"
}

# Test 15: npm_run_script_name - rejects non-npm commands
case_npm_run_script_name_non_npm() {
  if npm_run_script_name 'npx tsc --noEmit' >/dev/null 2>&1; then
    fail "should not extract script from non-npm command"
  else
    pass "correctly rejects non-npm commands"
  fi
}

# Run all test cases
cd "$TMP_DIR"
case_get_available_scripts_valid_json
case_get_available_scripts_missing_file
case_empty_scripts_section
case_script_is_available_exists
case_script_is_available_missing
case_filter_keeps_available_commands
case_filter_removes_unavailable_commands
case_filter_keeps_non_npm_commands
case_filter_mixed_availability
case_filter_with_empty_scripts
case_filter_with_malformed_json
case_npm_run_script_name_basic
case_npm_run_script_name_with_args
case_npm_run_script_name_whitespace
case_npm_run_script_name_non_npm

echo ""
echo "All tests passed! ✓"
