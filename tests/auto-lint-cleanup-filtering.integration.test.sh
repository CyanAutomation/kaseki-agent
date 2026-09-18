#!/usr/bin/env bash
# shellcheck disable=SC1091,SC2034
# Integration tests for auto-lint-cleanup filtering.
# Tests that cleanup commands are filtered to only available scripts.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLEANUP_HELPER_PATH="$ROOT_DIR/scripts/auto-lint-cleanup-classification.sh"
DETECT_HELPER_PATH="$ROOT_DIR/scripts/detect-available-npm-scripts.sh"

if [[ ! -f "$CLEANUP_HELPER_PATH" ]]; then
  echo "Error: auto-lint-cleanup-classification helper not found at $CLEANUP_HELPER_PATH" >&2
  exit 1
fi

if [[ ! -f "$DETECT_HELPER_PATH" ]]; then
  echo "Error: detect-available-npm-scripts helper not found at $DETECT_HELPER_PATH" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

export KASEKI_WORKSPACE_DIR="$TMP_DIR"
export KASEKI_RESULTS_DIR="$TMP_DIR/results"
mkdir -p "$TMP_DIR/repo" "$KASEKI_RESULTS_DIR"

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

# Source detection helper first
# shellcheck source=/dev/null
. "$DETECT_HELPER_PATH"

# Source cleanup helper
# shellcheck source=/dev/null
. "$CLEANUP_HELPER_PATH"

# Mock functions needed by cleanup helper
emit_event() { printf '%s %s\n' "$1" "${*:2}" >> "$KASEKI_RESULTS_DIR/events.log"; }
record_stage_timing() { :; }
set_current_stage() { :; }
emit_progress() { :; }

# Test 1: filter_cleanup_commands_to_available filters out missing npm scripts
test_filter_removes_missing_npm_scripts() {
  # Create repo with only "test" script defined
  cat > "$TMP_DIR/repo/package.json" <<'JSON'
{
  "scripts": {
    "test": "jest"
  }
}
JSON
  
  local result
  result="$(filter_cleanup_commands_to_available "npm run lint:fix;npm run test;__kaseki_trailing_whitespace_cleanup__" "$TMP_DIR/repo")"
  
  # Should contain test and trailing whitespace cleanup, but NOT lint:fix
  assert_contains "filtered result includes test" "npm run test" "$result"
  assert_contains "filtered result includes trailing whitespace cleanup" "__kaseki_trailing_whitespace_cleanup__" "$result"
  
  # lint:fix should NOT be in the result
  if [[ "$result" == *"lint:fix"* ]]; then
    fail "filtered result should not include lint:fix"
  else
    pass "filter correctly removes unavailable lint:fix"
  fi
}

# Test 2: filter_cleanup_commands_to_available keeps available commands
test_filter_keeps_available_commands() {
  cat > "$TMP_DIR/repo/package.json" <<'JSON'
{
  "scripts": {
    "lint:fix": "eslint . --fix",
    "test": "jest",
    "build": "tsc"
  }
}
JSON
  
  local result
  result="$(filter_cleanup_commands_to_available "npm run lint:fix;npm run build" "$TMP_DIR/repo")"
  
  assert_contains "keeps lint:fix" "npm run lint:fix" "$result"
  assert_contains "keeps build" "npm run build" "$result"
  pass "filter keeps all available commands"
}

# Test 3: filter_cleanup_commands_to_available with non-npm commands
test_filter_always_keeps_non_npm_commands() {
  cat > "$TMP_DIR/repo/package.json" <<'JSON'
{
  "scripts": {}
}
JSON
  
  local result
  result="$(filter_cleanup_commands_to_available "__custom_cleanup__;npm run missing" "$TMP_DIR/repo")"
  
  # Custom command should always be kept, missing npm script should be removed
  assert_contains "keeps custom non-npm command" "__custom_cleanup__" "$result"
  
  if [[ "$result" == *"npm run missing"* ]]; then
    fail "should not keep missing npm scripts"
  else
    pass "correctly removes missing npm scripts while keeping custom commands"
  fi
}

# Test 4: filter_cleanup_commands_to_available with default kaseki cleanup commands
test_filter_default_cleanup_commands() {
  # Create a repo that's missing lint:fix (common case)
  cat > "$TMP_DIR/repo/package.json" <<'JSON'
{
  "name": "example-project",
  "scripts": {
    "test": "jest",
    "build": "tsc"
  }
}
JSON
  
  # Default kaseki cleanup commands
  local defaults="npm run lint:fix;__kaseki_trailing_whitespace_cleanup__"
  local result
  result="$(filter_cleanup_commands_to_available "$defaults" "$TMP_DIR/repo")"
  
  # Only trailing whitespace cleanup should remain
  assert_equals "default cleanup filtered for repo without lint:fix" "__kaseki_trailing_whitespace_cleanup__" "$result"
}

# Test 5: No filtering occurs when package.json missing
test_filter_no_package_json() {
  rm -f "$TMP_DIR/repo/package.json"
  
  local result
  result="$(filter_cleanup_commands_to_available "npm run lint:fix;__kaseki_trailing_whitespace_cleanup__" "$TMP_DIR/repo")"
  
  # Without package.json, commands should pass through unchanged (fallback: non-npm commands kept, npm commands skipped)
  # Actually, with no package.json, the filter returns the commands as-is since it can't detect availability
  assert_contains "includes non-npm cleanup" "__kaseki_trailing_whitespace_cleanup__" "$result"
  pass "filter handles missing package.json"
}

# Test 6: Integration with filter_cleanup_commands_to_available in context
test_integration_with_context() {
  : > "$KASEKI_RESULTS_DIR/events.log"
  
  cat > "$TMP_DIR/repo/package.json" <<'JSON'
{
  "scripts": {
    "lint": "eslint . --check-only"
  }
}
JSON
  
  # This tests that the filter_cleanup_commands function works when sourced
  local result
  result="$(filter_cleanup_commands_to_available "npm run lint:fix;npm run lint;npm run missing" "$TMP_DIR/repo")"
  
  assert_contains "includes available lint" "npm run lint" "$result"
  
  # lint:fix and missing should not be in result
  if [[ "$result" == *"lint:fix"* ]]; then
    fail "should not include lint:fix"
  fi
  if [[ "$result" == *"npm run missing"* ]]; then
    fail "should not include missing"
  fi
  pass "integration test passes"
}

# Run all tests
cd "$TMP_DIR/repo"
git init --initial-branch=main -q 2>/dev/null || git init -q 2>/dev/null
git config user.email "test@kaseki.local" 2>/dev/null || true
git config user.name "Test User" 2>/dev/null || true

test_filter_removes_missing_npm_scripts
test_filter_keeps_available_commands
test_filter_always_keeps_non_npm_commands
test_filter_default_cleanup_commands
test_filter_no_package_json
test_integration_with_context

echo ""
echo "All integration tests passed! ✓"
