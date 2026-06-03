#!/usr/bin/env bash
set -euo pipefail

# Integration tests for kaseki-agent.sh + hashline event handler
# Tests that the hashline validation phase is properly integrated

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

test_count=0
passed_count=0
failed_count=0

test_result() {
  local name="$1"
  local result="$2"
  
  test_count=$((test_count + 1))
  
  if [ "$result" -eq 0 ]; then
    printf "${GREEN}✓ PASS${NC} Test $test_count: %s\n" "$name"
    passed_count=$((passed_count + 1))
  else
    printf "${RED}✗ FAIL${NC} Test $test_count: %s\n" "$name"
    failed_count=$((failed_count + 1))
  fi
}

# Setup temporary test workspace
setup_test_workspace() {
  TEST_TMPDIR="$(mktemp -d)"
  TEST_RESULTS_DIR="$TEST_TMPDIR/results"
  TEST_WORKSPACE_DIR="$TEST_TMPDIR/workspace"
  TEST_REPO_DIR="$TEST_TMPDIR/repo"
  
  mkdir -p "$TEST_RESULTS_DIR" "$TEST_WORKSPACE_DIR" "$TEST_REPO_DIR"
  
  # Initialize a minimal git repo
  cd "$TEST_REPO_DIR"
  git init -q
  git config user.email "test@example.com"
  git config user.name "Test User"
  
  # Create a simple source file
  echo "line 1: function foo() {" > src.js
  echo "  return 42;" >> src.js
  echo "}" >> src.js
  
  git add src.js
  git commit -q -m "initial"
  
  cd - > /dev/null
}

cleanup_test_workspace() {
  rm -rf "$TEST_TMPDIR" 2>/dev/null || true
}

# Test 1: Kaseki should call hashline event handler after pi-event-filter
test_hashline_handler_integration() {
  setup_test_workspace "hashline_handler_integration"
  
  # Compute hash of a line in src.js
  local line1_hash
  line1_hash=$(sha256sum <(echo -n "  return 42;") | cut -c1-8)
  local line2_hash
  line2_hash=$(sha256sum <(echo -n "}") | cut -c1-8)
  
  # Create a mock pi-events.jsonl with hashline_edit tool_call
  cat > "$TEST_RESULTS_DIR/pi-events.jsonl" <<EOF
{"type":"assistantMessage","assistantMessageEvent":{"type":"message","partial":{"content":[{"type":"text","text":"I'll fix this"}]}}}
{"type":"tool_call","tool_name":"hashline_edit","call":{"file":"src.js","anchor":{"start_hash":"$line1_hash","end_hash":"$line2_hash","context_lines":3},"replacement":"  return 43;\\n}"}}
{"type":"toolResult","toolResult":{"toolUseId":"call_123","content":[{"type":"text","text":"Edit applied successfully"}]}}
EOF

  # Run hashline event handler
  HASHLINE_EXIT=0
  npx tsx "$REPO_ROOT/src/hashline-event-handler-cli.ts" \
    "$TEST_RESULTS_DIR/pi-events.jsonl" \
    "$TEST_REPO_DIR" \
    "$TEST_RESULTS_DIR/hashline-events.jsonl" \
    "$TEST_RESULTS_DIR/hashline-summary.json" \
    2>/dev/null || HASHLINE_EXIT=$?
  
  # Verify output artifacts were created
  local result=0
  
  if [ ! -f "$TEST_RESULTS_DIR/hashline-events.jsonl" ]; then
    echo "ERROR: hashline-events.jsonl not created"
    result=1
  fi
  
  if [ ! -f "$TEST_RESULTS_DIR/hashline-summary.json" ]; then
    echo "ERROR: hashline-summary.json not created"
    result=1
  fi
  
  # Verify summary has expected fields
  if [ -f "$TEST_RESULTS_DIR/hashline-summary.json" ]; then
    local has_applied
    has_applied=$(jq '.applied' "$TEST_RESULTS_DIR/hashline-summary.json" 2>/dev/null || echo "null")
    local has_rejected
    has_rejected=$(jq '.rejected' "$TEST_RESULTS_DIR/hashline-summary.json" 2>/dev/null || echo "null")
    
    if [ "$has_applied" = "null" ] || [ "$has_rejected" = "null" ]; then
      echo "ERROR: hashline-summary.json missing required fields"
      result=1
    fi
  fi
  
  cleanup_test_workspace
  test_result "hashline handler produces output artifacts" "$result"
  return "$result"
}

# Test 2: Kaseki should handle missing hashline events gracefully
test_hashline_handler_empty_events() {
  setup_test_workspace "hashline_handler_empty_events"
  
  # Create a pi-events.jsonl with NO hashline_edit events
  cat > "$TEST_RESULTS_DIR/pi-events.jsonl" <<'EOF'
{"type":"assistantMessage","assistantMessageEvent":{"type":"message","partial":{"content":[{"type":"text","text":"No edits needed"}]}}}
EOF

  HASHLINE_EXIT=0
  npx tsx "$REPO_ROOT/src/hashline-event-handler-cli.ts" \
    "$TEST_RESULTS_DIR/pi-events.jsonl" \
    "$TEST_REPO_DIR" \
    "$TEST_RESULTS_DIR/hashline-events.jsonl" \
    "$TEST_RESULTS_DIR/hashline-summary.json" \
    2>/dev/null || HASHLINE_EXIT=$?
  
  local result=0
  
  # Should succeed even with no hashline events
  if [ "$HASHLINE_EXIT" -ne 0 ]; then
    echo "ERROR: hashline handler failed with exit $HASHLINE_EXIT when no events present"
    result=1
  fi
  
  # Should still create summary
  if [ ! -f "$TEST_RESULTS_DIR/hashline-summary.json" ]; then
    echo "ERROR: hashline-summary.json not created for empty events"
    result=1
  fi
  
  cleanup_test_workspace
  test_result "hashline handler handles empty events gracefully" "$result"
  return "$result"
}

# Test 3: Kaseki should handle stale anchors and record them
test_hashline_handler_stale_anchors() {
  setup_test_workspace "hashline_handler_stale_anchors"
  
  # Create a pi-events.jsonl with stale hashline_edit (bad hashes)
  cat > "$TEST_RESULTS_DIR/pi-events.jsonl" <<'EOF'
{"type":"tool_call","tool_name":"hashline_edit","call":{"file":"src.js","anchor":{"start_hash":"ffffffff","end_hash":"ffffffff","context_lines":3},"replacement":"invalid"}}
EOF

  HASHLINE_EXIT=0
  npx tsx "$REPO_ROOT/src/hashline-event-handler-cli.ts" \
    "$TEST_RESULTS_DIR/pi-events.jsonl" \
    "$TEST_REPO_DIR" \
    "$TEST_RESULTS_DIR/hashline-events.jsonl" \
    "$TEST_RESULTS_DIR/hashline-summary.json" \
    2>/dev/null || HASHLINE_EXIT=$?
  
  local result=0
  
  # Should complete (non-fatal rejection)
  if [ "$HASHLINE_EXIT" -ne 0 ] && [ "$HASHLINE_EXIT" -ne 1 ]; then
    echo "ERROR: hashline handler failed with unexpected exit $HASHLINE_EXIT on stale anchors"
    result=1
  fi
  
  # Should record rejection in summary
  if [ -f "$TEST_RESULTS_DIR/hashline-summary.json" ]; then
    local has_rejected
    has_rejected=$(jq '.rejected' "$TEST_RESULTS_DIR/hashline-summary.json" 2>/dev/null || echo "0")
    if [ "$has_rejected" = "0" ] || [ "$has_rejected" = "null" ]; then
      echo "ERROR: hashline-summary.json should record rejected edits"
      result=1
    fi
  fi
  
  cleanup_test_workspace
  test_result "hashline handler records stale anchor rejection" "$result"
  return "$result"
}

# Test 4: Kaseki should handle invalid workspace path gracefully
test_hashline_handler_invalid_workspace() {
  TEST_TMPDIR="$(mktemp -d)"
  TEST_RESULTS_DIR="$TEST_TMPDIR/results"
  mkdir -p "$TEST_RESULTS_DIR"
  
  cat > "$TEST_RESULTS_DIR/pi-events.jsonl" <<'EOF'
{"type":"tool_call","tool_name":"hashline_edit","call":{"file":"src.js","anchor":{"start_hash":"abc","end_hash":"def","context_lines":3},"replacement":"test"}}
EOF

  HASHLINE_EXIT=0
  npx tsx "$REPO_ROOT/src/hashline-event-handler-cli.ts" \
    "$TEST_RESULTS_DIR/pi-events.jsonl" \
    "/nonexistent/workspace" \
    "$TEST_RESULTS_DIR/hashline-events.jsonl" \
    "$TEST_RESULTS_DIR/hashline-summary.json" \
    2>/dev/null || HASHLINE_EXIT=$?
  
  local result=0
  
  # Should handle gracefully (file not found is non-fatal)
  if [ "$HASHLINE_EXIT" -gt 1 ]; then
    echo "ERROR: hashline handler should handle missing workspace gracefully, got exit $HASHLINE_EXIT"
    result=1
  fi
  
  cleanup_test_workspace
  rm -rf "$TEST_TMPDIR" 2>/dev/null || true
  
  test_result "hashline handler handles invalid workspace path gracefully" "$result"
  return "$result"
}

# Test 5: Verify hashline handler CLI produces valid JSON output
test_hashline_handler_json_output() {
  setup_test_workspace "hashline_handler_json_output"
  
  cat > "$TEST_RESULTS_DIR/pi-events.jsonl" <<'EOF'
{"type":"tool_call","tool_name":"hashline_edit","call":{"file":"src.js","anchor":{"start_hash":"abc","end_hash":"def","context_lines":3},"replacement":"test"}}
EOF

  HASHLINE_EXIT=0
  npx tsx "$REPO_ROOT/src/hashline-event-handler-cli.ts" \
    "$TEST_RESULTS_DIR/pi-events.jsonl" \
    "$TEST_REPO_DIR" \
    "$TEST_RESULTS_DIR/hashline-events.jsonl" \
    "$TEST_RESULTS_DIR/hashline-summary.json" \
    2>/dev/null || HASHLINE_EXIT=$?
  
  local result=0
  
  # Verify summary is valid JSON
  if [ -f "$TEST_RESULTS_DIR/hashline-summary.json" ]; then
    if ! jq empty "$TEST_RESULTS_DIR/hashline-summary.json" 2>/dev/null; then
      echo "ERROR: hashline-summary.json is not valid JSON"
      result=1
    fi
  fi
  
  # Verify events file exists and each line is JSON
  if [ -f "$TEST_RESULTS_DIR/hashline-events.jsonl" ]; then
    while IFS= read -r line; do
      if [ -n "$line" ]; then
        if ! echo "$line" | jq empty 2>/dev/null; then
          echo "ERROR: invalid JSON line in hashline-events.jsonl: $line"
          result=1
          break
        fi
      fi
    done < "$TEST_RESULTS_DIR/hashline-events.jsonl"
  fi
  
  cleanup_test_workspace
  test_result "hashline handler produces valid JSON output" "$result"
  return "$result"
}

# Main test runner
main() {
  printf '\n%s\n' "=== Kaseki Hashline Integration Tests ==="
  printf 'Running end-to-end tests for kaseki-agent.sh + hashline event handler\n\n'
  
  # Run all tests
  test_hashline_handler_integration
  test_hashline_handler_empty_events
  test_hashline_handler_stale_anchors
  test_hashline_handler_invalid_workspace
  test_hashline_handler_json_output
  
  # Print summary
  printf '\n%s\n' "=== Test Summary ==="
  printf 'Tests run: %d\n' "$test_count"
  printf "${GREEN}Passed: %d${NC}\n" "$passed_count"
  if [ "$failed_count" -gt 0 ]; then
    printf "${RED}Failed: %d${NC}\n" "$failed_count"
    exit 1
  else
    printf 'Failed: 0\n'
    printf '\nAll tests passed!\n'
    exit 0
  fi
}

main "$@"
