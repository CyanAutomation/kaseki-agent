#!/usr/bin/env bash
set -euo pipefail

# Verifies the observable prompt content produced by build_agent_prompt for
# hashline_edit guidance. This intentionally tests generated prompt output
# instead of grepping for internal implementation variable names.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROMPT_HELPER="$REPO_ROOT/scripts/agent-prompt.sh"

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

render_prompt() {
  local hashline_edits="$1"
  local harness
  local status
  harness="$(mktemp)"

  cat > "$harness" <<EOF_HARNESS
#!/usr/bin/env bash
set -euo pipefail
read_repo_memory_section() { :; }
get_caveman_instruction() { :; }
TASK_PROMPT='Implement the requested change.'
SCOUTING_ARTIFACT=''
KASEKI_RESULTS_DIR="\$(mktemp -d)"
GOAL_CHECK_RETRY_PROMPT=''
KASEKI_HASHLINE_EDITS='$hashline_edits'
KASEKI_AGENT_GUARDRAILS='1'
# shellcheck source=/dev/null
. "$PROMPT_HELPER"
build_agent_prompt
EOF_HARNESS

  PROMPT_HELPER="$PROMPT_HELPER" bash "$harness"
  status=$?
  rm -f "$harness"
  return "$status"
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
    assert_contains "$prompt" "hashline_edit" || result=1
    assert_contains "$prompt" "start_hash" || result=1
    assert_contains "$prompt" "end_hash" || result=1
    assert_contains "$prompt" "context_lines" || result=1
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
    assert_not_contains "$prompt" "hashline_edit" || result=1
    assert_not_contains "$prompt" "start_hash" || result=1
    assert_not_contains "$prompt" "end_hash" || result=1
    assert_not_contains "$prompt" "context_lines" || result=1
  fi

  test_result "KASEKI_HASHLINE_EDITS=0 omits hashline_edit guidance" "$result"
  return "$result"
}

test_rendered_prompt_includes_task_prompt() {
  local result=0
  local prompt
  prompt="$(render_prompt 1)" || result=1

  if [ "$result" -eq 0 ]; then
    assert_contains "$prompt" "Task:" || result=1
    assert_contains "$prompt" "Implement the requested change." || result=1
  fi

  test_result "rendered prompt includes the task prompt" "$result"
  return "$result"
}

test_rendered_prompt_ignores_legacy_prompt_file_inputs() {
  local result=0
  local prompt
  local harness legacy_prompt_file legacy_test_prompt_file results_dir scouting_artifact
  harness="$(mktemp)"
  legacy_prompt_file="$(mktemp)"
  legacy_test_prompt_file="$(mktemp)"
  results_dir="$(mktemp -d)"
  scouting_artifact="$(mktemp)"

  printf '%s\n' 'LEGACY_PROMPT_FILE_CONTENT_SHOULD_NOT_RENDER' > "$legacy_prompt_file"
  printf '%s\n' 'LEGACY_TEST_PROMPT_FILE_CONTENT_SHOULD_NOT_RENDER' > "$legacy_test_prompt_file"
  printf '%s\n' '{"finding":"SCOUTING_ARTIFACT_CONTENT_IS_NOT_INLINED"}' > "$scouting_artifact"
  printf '%s\n' 'SUPPORTED_SUMMARIZATION_ANNOTATION_SHOULD_RENDER' > "$results_dir/summarization-annotation.txt"

  cat > "$harness" <<EOF_HARNESS
#!/usr/bin/env bash
set -euo pipefail
read_repo_memory_section() { printf '%s' 'SUPPORTED_REPO_MEMORY_SHOULD_RENDER'; }
get_caveman_instruction() { :; }
TASK_PROMPT='SUPPORTED_TASK_PROMPT_SHOULD_RENDER'
PROMPT_FILE='$legacy_prompt_file'
TEST_PROMPT_FILE='$legacy_test_prompt_file'
SCOUTING_ARTIFACT='$scouting_artifact'
KASEKI_RESULTS_DIR='$results_dir'
GOAL_CHECK_RETRY_PROMPT='SUPPORTED_GOAL_CHECK_RETRY_SHOULD_RENDER'
KASEKI_HASHLINE_EDITS='0'
KASEKI_AGENT_GUARDRAILS='1'
# shellcheck source=/dev/null
. "$PROMPT_HELPER"
build_agent_prompt
EOF_HARNESS

  prompt="$(PROMPT_HELPER="$PROMPT_HELPER" bash "$harness")" || result=1
  rm -f "$harness" "$legacy_prompt_file" "$legacy_test_prompt_file" "$scouting_artifact"
  rm -rf "$results_dir"

  if [ "$result" -eq 0 ]; then
    assert_contains "$prompt" 'SUPPORTED_TASK_PROMPT_SHOULD_RENDER' || result=1
    assert_contains "$prompt" 'SUPPORTED_REPO_MEMORY_SHOULD_RENDER' || result=1
    assert_contains "$prompt" "$scouting_artifact" || result=1
    assert_contains "$prompt" 'SUPPORTED_GOAL_CHECK_RETRY_SHOULD_RENDER' || result=1
    assert_contains "$prompt" 'SUPPORTED_SUMMARIZATION_ANNOTATION_SHOULD_RENDER' || result=1
    assert_not_contains "$prompt" 'SCOUTING_ARTIFACT_CONTENT_IS_NOT_INLINED' || result=1
    assert_not_contains "$prompt" 'LEGACY_PROMPT_FILE_CONTENT_SHOULD_NOT_RENDER' || result=1
    assert_not_contains "$prompt" 'LEGACY_TEST_PROMPT_FILE_CONTENT_SHOULD_NOT_RENDER' || result=1
  fi

  test_result "legacy prompt-file inputs do not affect rendered prompt output" "$result"
  return "$result"
}

main() {
  printf '\n%s\n' "=== Phase 4: Task Prompt Enhancement Tests ==="
  printf 'Asserting generated build_agent_prompt output for stable prompt-contract markers\n\n'

  test_hashline_edit_guidance_enabled
  test_hashline_edit_guidance_disabled
  test_rendered_prompt_includes_task_prompt
  test_rendered_prompt_ignores_legacy_prompt_file_inputs

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
