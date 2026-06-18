#!/usr/bin/env bash
# shellcheck disable=SC1090
# Helper-focused tests for JSON encoding utilities sourced from scripts/lib/json.sh.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JSON_HELPER="${SCRIPT_DIR}/scripts/lib/json.sh"

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

source_json_encode() {
  # shellcheck source=../scripts/lib/json.sh
  source "$JSON_HELPER"
}

with_temp_json_helper_path_with_spaces() {
  local temp_dir helper_copy
  temp_dir=$(mktemp -d "${TMPDIR:-/tmp}/kaseki json helper.XXXXXX") || return 1
  helper_copy="${temp_dir}/json helper.sh"

  cp "$JSON_HELPER" "$helper_copy" || {
    if [ -n "$temp_dir" ] && [ "$temp_dir" != "/" ]; then
      rm -rf "$temp_dir"
    fi
    return 1
  }

  JSON_HELPER="$helper_copy" source_json_encode
  local source_status=$?
  if [ -n "$temp_dir" ] && [ "$temp_dir" != "/" ]; then
    rm -rf "$temp_dir"
  fi
  return "$source_status"
}

assert_valid_nonempty_json() {
  local output="$1"

  [ -n "$output" ] || return 1
  if ! command -v jq >/dev/null 2>&1; then
    printf 'ERROR: jq is required but not installed\n' >&2
    return 1
  fi
  printf '%s' "$output" | jq -e . >/dev/null
}

run_test() {
  local test_name="$1"
  local test_func="$2"

  TESTS_RUN=$((TESTS_RUN + 1))
  printf '[%3d] %-60s ' "$TESTS_RUN" "$test_name"

  if "$test_func"; then
    printf 'PASS\n'
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    printf 'FAIL\n'
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

test_json_encode_quotes() {
  source_json_encode

  local output
  output=$(printf 'hello "world"' | json_encode)

  assert_valid_nonempty_json "$output" && [ "$output" = '"hello \"world\""' ]
}

test_json_encode_control_characters() {
  source_json_encode

  local output
  output=$(printf 'line1\nline2\tctrl:\001' | json_encode)

  assert_valid_nonempty_json "$output" && [ "$output" = '"line1\nline2\tctrl:\u0001"' ]
}

test_json_helper_sources_from_path_with_spaces() {
  with_temp_json_helper_path_with_spaces || return 1

  local output
  output=$(printf 'space path' | json_encode)

  assert_valid_nonempty_json "$output" && [ "$output" = '"space path"' ]
}

main() {
  printf '\n%s\n' '=== Testing JSON helper functions ==='

  run_test 'json_encode escapes quotes exactly' test_json_encode_quotes
  run_test 'json_encode escapes newline/tab/control characters exactly' test_json_encode_control_characters
  run_test 'json helper sources from paths containing spaces' test_json_helper_sources_from_path_with_spaces

  printf '\nTest Results: %d/%d passed, %d failed\n' "$TESTS_PASSED" "$TESTS_RUN" "$TESTS_FAILED"

  if [ "$TESTS_FAILED" -eq 0 ]; then
    printf '✓ All JSON helper tests passed!\n'
    return 0
  fi

  printf '✗ Some JSON helper tests failed\n'
  return 1
}

main "$@"
