#!/usr/bin/env bash
# shellcheck disable=SC1090
# Helper-focused tests for JSON encoding utilities sourced from kaseki-agent.sh.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KASEKI_SCRIPT="${SCRIPT_DIR}/kaseki-agent.sh"

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

source_json_encode() {
  source <(sed -n '/^json_encode()/,/^}/p' "$KASEKI_SCRIPT")
}

assert_valid_nonempty_json() {
  local output="$1"

  [ -n "$output" ] || return 1
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

main() {
  printf '\n%s\n' '=== Testing JSON helper functions ==='

  run_test 'json_encode escapes quotes exactly' test_json_encode_quotes
  run_test 'json_encode escapes newline/tab/control characters exactly' test_json_encode_control_characters

  printf '\nTest Results: %d/%d passed, %d failed\n' "$TESTS_PASSED" "$TESTS_RUN" "$TESTS_FAILED"

  if [ "$TESTS_FAILED" -eq 0 ]; then
    printf '✓ All JSON helper tests passed!\n'
    return 0
  fi

  printf '✗ Some JSON helper tests failed\n'
  return 1
}

main "$@"
