#!/bin/bash
# test/hashline-integration.test.sh
#
# Integration tests for hashline editing feature.
# Tests the full flow: Pi event generation → event filter → hashline validator → file edits
#
# Usage: bash test/hashline-integration.test.sh

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Temp directory for test fixtures
TEST_DIR=""

cleanup() {
  if [ -n "$TEST_DIR" ] && [ -d "$TEST_DIR" ]; then
    rm -rf "$TEST_DIR"
  fi
}

trap cleanup EXIT

setup_test() {
  local test_name="$1"
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

assert_equals() {
  local expected="$1"
  local actual="$2"
  local message="${3:-}"

  if [ "$expected" = "$actual" ]; then
    return 0
  else
    fail_test "Expected '$expected' but got '$actual' ${message}"
    return 1
  fi
}

assert_file_contains() {
  local file="$1"
  local pattern="$2"
  local message="${3:-}"

  if grep -q "$pattern" "$file" 2>/dev/null; then
    return 0
  else
    fail_test "File $file does not contain '$pattern' ${message}"
    return 1
  fi
}

assert_file_not_contains() {
  local file="$1"
  local pattern="$2"
  local message="${3:-}"

  if ! grep -q "$pattern" "$file" 2>/dev/null; then
    return 0
  else
    fail_test "File $file should not contain '$pattern' ${message}"
    return 1
  fi
}

# Test 1: Process valid hashline events
test_process_valid_hashline_events() {
  setup_test "Process valid hashline_edit events"

  # Create test file
  local test_file="$TEST_DIR/test.ts"
  cat > "$test_file" <<'EOF'
function hello() {
  console.log('world');
  return 42;
}
EOF

  # Create Pi JSONL events with hashline_edit
  local events_file="$TEST_DIR/events.jsonl"

  # Compute hash of line 2 ("  console.log('world');")
  local line2='  console.log('\''world'\'');'
  local hash_line2=$(echo -n "$line2" | sha256sum | cut -c1-8)

  # Create event
  cat > "$events_file" <<EOF
{"type":"tool_call","tool_name":"hashline_edit","call":{"file":"test.ts","anchor":{"start_hash":"$hash_line2","end_hash":"$hash_line2","context_lines":3},"replacement":"  console.log('updated');"},"event":"tool_execution_end"}
EOF

  # Process with event handler
  if ! npx tsx src/hashline-event-handler-cli.ts "$events_file" "$TEST_DIR" "$TEST_DIR/hashline-events.jsonl" "$TEST_DIR/hashline-summary.json" > /dev/null 2>&1; then
    fail_test "Event handler failed"
    return 1
  fi

  # Verify file was modified
  if assert_file_contains "$test_file" "updated"; then
    if assert_file_not_contains "$test_file" "world"; then
      pass_test
      return 0
    fi
  fi
  return 1
}

# Test 2: Reject stale anchors
test_reject_stale_anchors() {
  setup_test "Reject stale anchors"

  local test_file="$TEST_DIR/test.ts"
  cat > "$test_file" <<'EOF'
function test() {
  return 42;
}
EOF

  local events_file="$TEST_DIR/events.jsonl"
  cat > "$events_file" <<'EOF'
{"type":"tool_call","tool_name":"hashline_edit","call":{"file":"test.ts","anchor":{"start_hash":"deadbeef","end_hash":"cafebabe","context_lines":1},"replacement":"replaced"}}
EOF

  # Process events - should not fail but should reject
  npx tsx src/hashline-event-handler-cli.ts "$events_file" "$TEST_DIR" "$TEST_DIR/hashline-events.jsonl" "$TEST_DIR/hashline-summary.json" > /dev/null 2>&1 || true

  # Check summary
  local summary_file="$TEST_DIR/hashline-summary.json"
  if [ -f "$summary_file" ]; then
    local rejected=$(jq '.rejected' "$summary_file" 2>/dev/null || echo "0")
    if [ "$rejected" -eq 1 ]; then
      # Verify file was NOT modified
      if assert_file_not_contains "$test_file" "replaced"; then
        pass_test
        return 0
      fi
    fi
  fi
  fail_test "Stale anchor was not properly rejected"
  return 1
}

# Test 3: Process multiple events
test_process_multiple_events() {
  setup_test "Process multiple hashline_edit events"

  local test_file="$TEST_DIR/test.ts"
  cat > "$test_file" <<'EOF'
function test1() {
  return 1;
}
function test2() {
  return 2;
}
EOF

  local events_file="$TEST_DIR/events.jsonl"

  # Compute hashes
  local line2='  return 1;'
  local hash_line2=$(echo -n "$line2" | sha256sum | cut -c1-8)
  local line5='  return 2;'
  local hash_line5=$(echo -n "$line5" | sha256sum | cut -c1-8)

  cat > "$events_file" <<EOF
{"type":"tool_call","tool_name":"hashline_edit","call":{"file":"test.ts","anchor":{"start_hash":"$hash_line2","end_hash":"$hash_line2","context_lines":1},"replacement":"  return 100;"}}
{"type":"tool_call","tool_name":"hashline_edit","call":{"file":"test.ts","anchor":{"start_hash":"$hash_line5","end_hash":"$hash_line5","context_lines":1},"replacement":"  return 200;"}}
EOF

  npx tsx src/hashline-event-handler-cli.ts "$events_file" "$TEST_DIR" "$TEST_DIR/hashline-events.jsonl" "$TEST_DIR/hashline-summary.json" > /dev/null 2>&1 || true

  if assert_file_contains "$test_file" "return 100"; then
    if assert_file_contains "$test_file" "return 200"; then
      pass_test
      return 0
    fi
  fi
  return 1
}

# Test 4: Handle multi-line replacements
test_multiline_replacements() {
  setup_test "Handle multi-line replacements"

  local test_file="$TEST_DIR/test.ts"
  cat > "$test_file" <<'EOF'
function old() {
  const x = 1;
  const y = 2;
  return x + y;
}
EOF

  local events_file="$TEST_DIR/events.jsonl"

  local line2='  const x = 1;'
  local hash_line2=$(echo -n "$line2" | sha256sum | cut -c1-8)
  local line3='  const y = 2;'
  local hash_line3=$(echo -n "$line3" | sha256sum | cut -c1-8)

  cat > "$events_file" <<EOF
{"type":"tool_call","tool_name":"hashline_edit","call":{"file":"test.ts","anchor":{"start_hash":"$hash_line2","end_hash":"$hash_line3","context_lines":3},"replacement":"  const z = 3;"}}
EOF

  npx tsx src/hashline-event-handler-cli.ts "$events_file" "$TEST_DIR" "$TEST_DIR/hashline-events.jsonl" "$TEST_DIR/hashline-summary.json" > /dev/null 2>&1 || true

  if assert_file_contains "$test_file" "z = 3"; then
    if assert_file_not_contains "$test_file" "x = 1"; then
      if assert_file_not_contains "$test_file" "y = 2"; then
        pass_test
        return 0
      fi
    fi
  fi
  return 1
}

# Test 5: Skip non-hashline events
test_skip_non_hashline_events() {
  setup_test "Skip non-hashline events"

  local test_file="$TEST_DIR/test.ts"
  cat > "$test_file" <<'EOF'
line 0
line 1
EOF

  local events_file="$TEST_DIR/events.jsonl"
  cat > "$events_file" <<'EOF'
{"type":"message","content":"hello"}
{"type":"tool_call","tool_name":"bash","command":"ls"}
{"type":"tool_result","output":"done"}
EOF

  npx tsx src/hashline-event-handler-cli.ts "$events_file" "$TEST_DIR" "$TEST_DIR/hashline-events.jsonl" "$TEST_DIR/hashline-summary.json" > /dev/null 2>&1 || true

  # Check summary - should have 0 applied
  local summary_file="$TEST_DIR/hashline-summary.json"
  if [ -f "$summary_file" ]; then
    local applied=$(jq '.applied' "$summary_file" 2>/dev/null || echo "1")
    if [ "$applied" -eq 0 ]; then
      pass_test
      return 0
    fi
  fi
  fail_test "Non-hashline events were processed"
  return 1
}

# Run all tests
main() {
  echo "=== Hashline Integration Tests ==="
  echo ""

  test_process_valid_hashline_events || true
  test_reject_stale_anchors || true
  test_process_multiple_events || true
  test_multiline_replacements || true
  test_skip_non_hashline_events || true

  echo ""
  echo "=== Test Summary ==="
  echo "Tests run: $TESTS_RUN"
  echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
  echo -e "Failed: ${RED}$TESTS_FAILED${NC}"

  if [ "$TESTS_FAILED" -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    return 0
  else
    echo -e "${RED}Some tests failed!${NC}"
    return 1
  fi
}

main "$@"
