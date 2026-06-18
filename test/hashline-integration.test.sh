#!/bin/bash
# test/hashline-integration.test.sh
#
# Authoritative integration suite for hashline event handling.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
TEST_DIR=""

cleanup() {
  if [ -n "$TEST_DIR" ] && [ -d "$TEST_DIR" ]; then
    rm -rf "$TEST_DIR"
  fi
}
trap cleanup EXIT

setup_test() {
  local test_name="$1"
  cleanup
  TEST_DIR=$(mktemp -d)
  TESTS_RUN=$((TESTS_RUN + 1))
  echo -e "${YELLOW}Test $TESTS_RUN: $test_name${NC}"
}

pass_test() {
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo -e "${GREEN}✓ PASS${NC}\n"
}

fail_test() {
  local reason="$1"
  TESTS_FAILED=$((TESTS_FAILED + 1))
  echo -e "${RED}✗ FAIL: $reason${NC}\n"
}

assert_file_contains() {
  local file="$1"
  local pattern="$2"
  local message="${3:-}"

  if grep -q "$pattern" "$file" 2>/dev/null; then
    return 0
  fi

  fail_test "File $file does not contain '$pattern' ${message}"
  return 1
}

assert_file_not_contains() {
  local file="$1"
  local pattern="$2"
  local message="${3:-}"

  if ! grep -q "$pattern" "$file" 2>/dev/null; then
    return 0
  fi

  fail_test "File $file should not contain '$pattern' ${message}"
  return 1
}

assert_json_number() {
  local file="$1"
  local jq_expr="$2"
  local expected="$3"

  local actual
  actual=$(jq -r "$jq_expr" "$file" 2>/dev/null || echo "__jq_error__")
  if [ "$actual" = "$expected" ]; then
    return 0
  fi

  fail_test "Expected $jq_expr in $file to be '$expected' but got '$actual'"
  return 1
}

run_hashline_handler() {
  local events_file="$1"
  npx tsx src/hashline-event-handler-cli.ts \
    "$events_file" \
    "$TEST_DIR" \
    "$TEST_DIR/hashline-events.jsonl" \
    "$TEST_DIR/hashline-summary.json" \
    > "$TEST_DIR/hashline-cli.stdout" \
    2> "$TEST_DIR/hashline-cli.stderr"
}

# 1. Valid hashline event application.
test_valid_hashline_event_application() {
  setup_test "Apply valid hashline_edit event"

  local test_file="$TEST_DIR/test.ts"
  cat > "$test_file" <<'SRC'
function hello() {
  console.log('world');
  return 42;
}
SRC

  local target_line="  console.log('world');"
  local target_hash
  target_hash=$(echo -n "$target_line" | sha256sum | cut -c1-8)

  local events_file="$TEST_DIR/pi-events.jsonl"
  cat > "$events_file" <<EOF_EVENTS
{"type":"tool_call","tool_name":"hashline_edit","call":{"file":"test.ts","anchor":{"start_hash":"$target_hash","end_hash":"$target_hash","context_lines":3},"replacement":"  console.log('updated');"}}
EOF_EVENTS

  if ! run_hashline_handler "$events_file"; then
    fail_test "Event handler failed for valid hashline event"
    return 1
  fi

  assert_file_contains "$test_file" "updated" || return 1
  assert_file_not_contains "$test_file" "world" || return 1
  assert_json_number "$TEST_DIR/hashline-summary.json" '.applied' '1' || return 1
  assert_json_number "$TEST_DIR/hashline-summary.json" '.rejected' '0' || return 1
  pass_test
}

# 2. Empty/no-op event streams.
test_empty_noop_event_stream() {
  setup_test "Handle empty and no-op event stream"

  cat > "$TEST_DIR/test.ts" <<'SRC'
line 0
line 1
SRC

  local events_file="$TEST_DIR/pi-events.jsonl"
  cat > "$events_file" <<'EVENTS'
{"type":"message","content":"No edits needed"}
{"type":"tool_call","tool_name":"bash","command":"true"}
EVENTS

  if ! run_hashline_handler "$events_file"; then
    fail_test "Event handler failed for no-op event stream"
    return 1
  fi

  assert_json_number "$TEST_DIR/hashline-summary.json" '.applied' '0' || return 1
  assert_json_number "$TEST_DIR/hashline-summary.json" '.rejected' '0' || return 1
  [ -f "$TEST_DIR/hashline-events.jsonl" ] || { fail_test "hashline-events.jsonl was not created"; return 1; }
  pass_test
}

# 3. Stale anchor rejection.
test_stale_anchor_rejection() {
  setup_test "Reject stale hashline anchor"

  local test_file="$TEST_DIR/test.ts"
  cat > "$test_file" <<'SRC'
function test() {
  return 42;
}
SRC

  local events_file="$TEST_DIR/pi-events.jsonl"
  cat > "$events_file" <<'EVENTS'
{"type":"tool_call","tool_name":"hashline_edit","call":{"file":"test.ts","anchor":{"start_hash":"deadbeef","end_hash":"cafebabe","context_lines":1},"replacement":"replaced"}}
EVENTS

  run_hashline_handler "$events_file" || true

  assert_json_number "$TEST_DIR/hashline-summary.json" '.applied' '0' || return 1
  assert_json_number "$TEST_DIR/hashline-summary.json" '.rejected' '1' || return 1
  assert_file_not_contains "$test_file" "replaced" || return 1
  pass_test
}

# 4. Summary/event artifact creation.
test_summary_and_event_artifact_creation() {
  setup_test "Create valid hashline summary and event artifacts"

  local events_file="$TEST_DIR/pi-events.jsonl"
  : > "$events_file"

  if ! run_hashline_handler "$events_file"; then
    fail_test "Event handler failed for empty file"
    return 1
  fi

  [ -f "$TEST_DIR/hashline-summary.json" ] || { fail_test "hashline-summary.json was not created"; return 1; }
  [ -f "$TEST_DIR/hashline-events.jsonl" ] || { fail_test "hashline-events.jsonl was not created"; return 1; }
  jq empty "$TEST_DIR/hashline-summary.json" || { fail_test "hashline-summary.json is not valid JSON"; return 1; }
  while IFS= read -r line; do
    [ -z "$line" ] || echo "$line" | jq empty >/dev/null || { fail_test "hashline-events.jsonl contains invalid JSON"; return 1; }
  done < "$TEST_DIR/hashline-events.jsonl"
  pass_test
}

main() {
  echo "=== Hashline Integration Tests ==="
  echo ""

  test_valid_hashline_event_application || true
  test_empty_noop_event_stream || true
  test_stale_anchor_rejection || true
  test_summary_and_event_artifact_creation || true

  echo ""
  echo "=== Test Summary ==="
  echo "Tests run: $TESTS_RUN"
  echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
  echo -e "Failed: ${RED}$TESTS_FAILED${NC}"

  if [ "$TESTS_FAILED" -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    return 0
  fi

  echo -e "${RED}Some tests failed!${NC}"
  return 1
}

main "$@"
