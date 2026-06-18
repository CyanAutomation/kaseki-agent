#!/usr/bin/env bash
set -euo pipefail

# Verifies the observable prompt content produced by build_agent_prompt for
# hashline_edit guidance. This intentionally tests generated prompt output
# instead of grepping for internal implementation variable names.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENT_SCRIPT="$REPO_ROOT/kaseki-agent.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

test_count=0
passed_count=0
failed_count=0

fail() {
  printf '%s\n' "ERROR: $*" >&2
  return 1
}

test_result() {
  local name="$1"
  local result="$2"

  test_count=$((test_count + 1))

  if [ "$result" -eq 0 ]; then
    printf "${GREEN}✓ PASS${NC} Test %d: %s\n" "$test_count" "$name"
    passed_count=$((passed_count + 1))
  else
    printf "${RED}✗ FAIL${NC} Test %d: %s\n" "$test_count" "$name"
    failed_count=$((failed_count + 1))
  fi
}

extract_build_agent_prompt() {
  awk '
    /^build_agent_prompt\(\) \{/ { in_func=1 }
    in_func { print }
    in_func && /^\}/ { exit }
  ' "$AGENT_SCRIPT"
}

render_prompt() {
  local hashline_edits="$1"
  local harness
  harness="$(mktemp)"
  trap 'rm -f "$harness"' RETURN

  cat > "$harness" <<EOF_HARNESS
#!/usr/bin/env bash
set -euo pipefail
read_repo_memory_section() { :; }
TASK_PROMPT='Implement the requested change.'
SCOUTING_ARTIFACT=''
KASEKI_RESULTS_DIR="\$(mktemp -d)"
GOAL_CHECK_RETRY_PROMPT=''
KASEKI_HASHLINE_EDITS='$hashline_edits'
KASEKI_AGENT_GUARDRAILS='1'
$(extract_build_agent_prompt)
build_agent_prompt
EOF_HARNESS

  bash "$harness"
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  printf '%s' "$haystack" | grep -Fq -- "$needle" || fail "Expected prompt to contain: $needle"
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  if printf '%s' "$haystack" | grep -Fq -- "$needle"; then
    fail "Expected prompt to omit: $needle"
  fi
}

test_hashline_edit_guidance_enabled() {
  local result=0
  local prompt
  prompt="$(render_prompt 1)" || result=1

  if [ "$result" -eq 0 ]; then
    assert_contains "$prompt" "File editing with content-based anchors (hashline_edit):" || result=1
    assert_contains "$prompt" "Use the hashline_edit tool to make precise file edits using content-based anchors instead of line numbers." || result=1
    assert_contains "$prompt" "Hashline_edit syntax:" || result=1
    assert_contains "$prompt" "start_hash: First 8 characters of SHA-256 hash of the first line to replace" || result=1
    assert_contains "$prompt" "end_hash: First 8 characters of SHA-256 hash of the last line to replace" || result=1
    assert_contains "$prompt" "context_lines: Number of surrounding lines to include for disambiguation" || result=1
    assert_contains "$prompt" "Use it to avoid stale line-number references between retries" || result=1
  fi

  test_result "KASEKI_HASHLINE_EDITS=1 includes hashline_edit contract and anchoring guidance" "$result"
  return "$result"
}

test_hashline_edit_guidance_disabled() {
  local result=0
  local prompt
  prompt="$(render_prompt 0)" || result=1

  if [ "$result" -eq 0 ]; then
    assert_contains "$prompt" "Task:" || result=1
    assert_contains "$prompt" "Implement the requested change." || result=1
    assert_not_contains "$prompt" "File editing with content-based anchors (hashline_edit):" || result=1
    assert_not_contains "$prompt" "Hashline_edit syntax:" || result=1
    assert_not_contains "$prompt" "Use the hashline_edit tool" || result=1
    assert_not_contains "$prompt" "start_hash: First 8 characters of SHA-256 hash" || result=1
    assert_not_contains "$prompt" "Use it to avoid stale line-number references between retries" || result=1
  fi

  test_result "KASEKI_HASHLINE_EDITS=0 omits hashline_edit guidance" "$result"
  return "$result"
}

main() {
  printf '\n%s\n' "=== Phase 4: Task Prompt Enhancement Tests ==="
  printf 'Asserting generated build_agent_prompt output for hashline_edit guidance\n\n'

  test_hashline_edit_guidance_enabled
  test_hashline_edit_guidance_disabled

  printf '\n%s\n' "=== Test Summary ==="
  printf 'Tests run: %d\n' "$test_count"
  printf "${GREEN}Passed: %d${NC}\n" "$passed_count"
  if [ "$failed_count" -gt 0 ]; then
    printf "${RED}Failed: %d${NC}\n" "$failed_count"
    exit 1
  fi

  printf 'Failed: 0\n\nAll tests passed!\n'
}

main "$@"
