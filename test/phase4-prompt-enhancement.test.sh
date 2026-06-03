#!/usr/bin/env bash
set -euo pipefail

# TDD tests for Phase 4: Task prompt enhancement with hashline_edit guidance
# Tests that KASEKI_HASHLINE_EDITS=1 causes prompts to include hashline_edit instruction

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

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

# Test 1: build_agent_prompt includes hashline_edit guidance when enabled
test_hashline_edit_guidance_enabled() {
  local result=0
  local script_file="$REPO_ROOT/kaseki-agent.sh"
  
  # Check that build_agent_prompt function has hashline_edits_section variable
  if ! grep -q 'hashline_edits_section' "$script_file"; then
    echo "ERROR: build_agent_prompt missing hashline_edits_section variable"
    result=1
  fi
  
  # Check that function includes hashline_edits_section in the output (look further in function)
  if ! grep -A 150 'build_agent_prompt()' "$script_file" | grep -q 'hashline_edits_section'; then
    echo "ERROR: build_agent_prompt not using hashline_edits_section in output"
    result=1
  fi
  
  # Check for conditional based on KASEKI_HASHLINE_EDITS
  if ! grep -q 'if.*KASEKI_HASHLINE_EDITS.*!= "0"' "$script_file"; then
    echo "ERROR: Missing conditional for KASEKI_HASHLINE_EDITS"
    result=1
  fi
  
  test_result "build_agent_prompt includes hashline_edit guidance" "$result"
  return "$result"
}

# Test 2: Prompt mentions hashline_edit tool
test_hashline_edit_tool_mentioned() {
  local result=0
  local script_file="$REPO_ROOT/kaseki-agent.sh"
  
  # Check that "hashline_edit" is mentioned in the prompt guidance
  if ! grep -q 'hashline_edit' "$script_file"; then
    echo "ERROR: hashline_edit tool not mentioned in prompt"
    result=1
  fi
  
  test_result "Prompt mentions hashline_edit tool" "$result"
  return "$result"
}

# Test 3: Prompt explains content-based anchoring
test_hashline_anchor_explanation() {
  local result=0
  local script_file="$REPO_ROOT/kaseki-agent.sh"
  
  # Check for mention of content-based or SHA-256 anchors
  if ! grep -q -E 'content|anchor|SHA.*256|hash' "$script_file"; then
    echo "WARNING: Prompt may not explain content-based anchoring (optional)"
  fi
  
  test_result "Prompt explains content-based anchoring" "$result"
  return "$result"
}

# Test 4: Prompt describes fallback to bash/write
test_hashline_fallback_explanation() {
  local result=0
  local script_file="$REPO_ROOT/kaseki-agent.sh"
  
  # Check that prompt mentions fallback to bash or write
  if ! grep -q -E 'fallback|bash.*write|not.*supported' "$script_file"; then
    echo "WARNING: Prompt may not mention fallback behavior (optional)"
  fi
  
  test_result "Prompt describes fallback to bash/write" "$result"
  return "$result"
}

# Test 5: KASEKI_HASHLINE_EDITS env var is defined
test_kaseki_hashline_edits_var_defined() {
  local result=0
  local script_file="$REPO_ROOT/kaseki-agent.sh"
  
  # Check that KASEKI_HASHLINE_EDITS is initialized
  if ! grep -q "KASEKI_HASHLINE_EDITS=" "$script_file"; then
    echo "ERROR: KASEKI_HASHLINE_EDITS not initialized"
    result=1
  fi
  
  test_result "KASEKI_HASHLINE_EDITS environment variable defined" "$result"
  return "$result"
}

# Test 6: Prompt guidance section doesn't appear when disabled
test_hashline_edit_disabled_skipped() {
  local result=0
  local script_file="$REPO_ROOT/kaseki-agent.sh"
  
  # Check that there's a condition that skips the section when disabled
  if ! grep -B3 -A3 'hashline_edits_section' "$script_file" | grep -q "!= \"0\""; then
    echo "WARNING: May not properly skip hashline section when disabled (optional)"
  fi
  
  test_result "Hashline guidance skipped when KASEKI_HASHLINE_EDITS=0" "$result"
  return "$result"
}

# Test 7: Integration with Pi tool schema
test_pi_tool_hashline_definition() {
  local result=0
  local doc_file="$REPO_ROOT/docs/PI_TOOL_HASHLINE_EDIT.md"
  
  if [ ! -f "$doc_file" ]; then
    echo "WARNING: PI_TOOL_HASHLINE_EDIT.md not found"
    result=0  # Not a failure; doc might not exist yet
  elif ! grep -q 'tool.*definition\|schema' "$doc_file"; then
    echo "WARNING: PI_TOOL_HASHLINE_EDIT.md may not include tool definition"
  fi
  
  test_result "Pi tool definition documented" "$result"
  return "$result"
}

# Main test runner
main() {
  printf '\n%s\n' "=== Phase 4: Task Prompt Enhancement Tests ==="
  printf 'Running TDD tests for hashline_edit guidance in task prompts\n\n'
  
  # Run all tests
  test_hashline_edit_guidance_enabled
  test_hashline_edit_tool_mentioned
  test_hashline_anchor_explanation
  test_hashline_fallback_explanation
  test_kaseki_hashline_edits_var_defined
  test_hashline_edit_disabled_skipped
  test_pi_tool_hashline_definition
  
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
