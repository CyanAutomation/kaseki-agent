#!/usr/bin/env bash
set -euo pipefail

# Verifies durable user-facing prompt contracts produced by build_agent_prompt.
# These tests intentionally render the prompt and assert stable guidance markers
# rather than implementation details or long incidental wording.

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
  local harness
  local results_dir
  local status
  harness="$(mktemp)"
  results_dir="${KASEKI_RESULTS_DIR:-}"

  if [ -z "$results_dir" ]; then
    results_dir="$(mktemp -d)"
  fi

  cat > "$harness" <<'EOF_HARNESS'
#!/usr/bin/env bash
set -euo pipefail
read_repo_memory_section() { printf ''; }
get_caveman_instruction() { printf ''; }
: "${TASK_PROMPT:?TASK_PROMPT is required}"
: "${SCOUTING_ARTIFACT:?SCOUTING_ARTIFACT is required}"
: "${KASEKI_RESULTS_DIR:?KASEKI_RESULTS_DIR is required}"
: "${GOAL_CHECK_RETRY_PROMPT+x}"
: "${KASEKI_HASHLINE_EDITS:?KASEKI_HASHLINE_EDITS is required}"
: "${KASEKI_AGENT_GUARDRAILS:?KASEKI_AGENT_GUARDRAILS is required}"
# shellcheck source=/dev/null
. "$PROMPT_HELPER"
build_agent_prompt
EOF_HARNESS

  PROMPT_HELPER="$PROMPT_HELPER" \
  TASK_PROMPT="${TASK_PROMPT:-Implement the requested change.}" \
  SCOUTING_ARTIFACT="${SCOUTING_ARTIFACT:-/dev/null}" \
  KASEKI_RESULTS_DIR="$results_dir" \
  GOAL_CHECK_RETRY_PROMPT="${GOAL_CHECK_RETRY_PROMPT:-}" \
  KASEKI_HASHLINE_EDITS="${KASEKI_HASHLINE_EDITS:-0}" \
  KASEKI_AGENT_GUARDRAILS="${KASEKI_AGENT_GUARDRAILS:-1}" \
  bash "$harness" || status=$?
  status="${status:-0}"
  rm -f "$harness"
  if [ -z "${KASEKI_RESULTS_DIR:-}" ]; then
    rm -rf "$results_dir"
  fi
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

# Task prompt inclusion
test_task_contract_renders_task_prompt() {
  local result=0
  local prompt
  prompt="$(render_prompt)" || result=1

  if [ "$result" -eq 0 ]; then
    assert_contains "$prompt" "Task:" || result=1
    assert_contains "$prompt" "Implement the requested change." || result=1
  fi

  test_result "task contract renders the provided task prompt" "$result"
  return "$result"
}

# Guardrails enabled/disabled
test_guardrail_contract_enabled() {
  local result=0
  local prompt
  prompt="$(KASEKI_AGENT_GUARDRAILS=1 render_prompt)" || result=1

  if [ "$result" -eq 0 ]; then
    assert_contains "$prompt" "Operational guardrails:" || result=1
    assert_contains "$prompt" "Do not run git add" || result=1
    assert_contains "$prompt" "Do not run npm install" || result=1
    assert_contains "$prompt" "Critical change first" || result=1
    assert_contains "$prompt" "Do not print, inspect, or expose environment variables" || result=1
  fi

  test_result "guardrail contract appears when KASEKI_AGENT_GUARDRAILS=1" "$result"
  return "$result"
}

test_guardrail_contract_disabled() {
  local result=0
  local prompt
  prompt="$(KASEKI_AGENT_GUARDRAILS=0 render_prompt)" || result=1

  if [ "$result" -eq 0 ]; then
    assert_contains "$prompt" "Implement the requested change." || result=1
    assert_not_contains "$prompt" "Operational guardrails:" || result=1
    assert_not_contains "$prompt" "Do not run git add" || result=1
    assert_not_contains "$prompt" "Critical change first" || result=1
  fi

  test_result "guardrail contract is omitted when KASEKI_AGENT_GUARDRAILS=0" "$result"
  return "$result"
}

# Hashline edits guidance
test_hashline_edit_contract_enabled() {
  local result=0
  local prompt
  prompt="$(KASEKI_HASHLINE_EDITS=1 render_prompt)" || result=1

  if [ "$result" -eq 0 ]; then
    assert_contains "$prompt" "File editing with content-based anchors (hashline_edit):" || result=1
    assert_contains "$prompt" "hashline_edit" || result=1
    assert_contains "$prompt" "start_hash" || result=1
    assert_contains "$prompt" "end_hash" || result=1
    assert_contains "$prompt" "context_lines" || result=1
  fi

  test_result "hashline edit contract appears when KASEKI_HASHLINE_EDITS=1" "$result"
  return "$result"
}

test_hashline_edit_contract_disabled() {
  local result=0
  local prompt
  prompt="$(KASEKI_HASHLINE_EDITS=0 render_prompt)" || result=1

  if [ "$result" -eq 0 ]; then
    assert_contains "$prompt" "Implement the requested change." || result=1
    assert_not_contains "$prompt" "hashline_edit" || result=1
    assert_not_contains "$prompt" "start_hash" || result=1
    assert_not_contains "$prompt" "end_hash" || result=1
    assert_not_contains "$prompt" "context_lines" || result=1
  fi

  test_result "hashline edit contract is omitted when KASEKI_HASHLINE_EDITS=0" "$result"
  return "$result"
}

# Retry prompt inclusion
test_retry_prompt_contract_included_when_present() {
  local result=0
  local prompt
  prompt="$(GOAL_CHECK_RETRY_PROMPT='RETRY_CONTRACT_SENTINEL' render_prompt)" || result=1

  if [ "$result" -eq 0 ]; then
    assert_contains "$prompt" "Goal-check retry guidance:" || result=1
    assert_contains "$prompt" "RETRY_CONTRACT_SENTINEL" || result=1
  fi

  test_result "retry prompt contract renders goal-check retry guidance when present" "$result"
  return "$result"
}

test_retry_prompt_contract_omitted_when_empty() {
  local result=0
  local prompt
  prompt="$(GOAL_CHECK_RETRY_PROMPT='' render_prompt)" || result=1

  if [ "$result" -eq 0 ]; then
    assert_not_contains "$prompt" "Goal-check retry guidance:" || result=1
  fi

  test_result "retry prompt contract is omitted when no retry guidance is present" "$result"
  return "$result"
}

# Mode-specific instructions
test_mode_specific_contracts_render_supported_sections() {
  local result=0
  local prompt
  local results_dir scouting_artifact
  results_dir="$(mktemp -d)"
  scouting_artifact="$(mktemp)"

  printf '%s\n' '{"finding":"SCOUTING_ARTIFACT_CONTENT_IS_NOT_INLINED"}' > "$scouting_artifact"
  printf '%s\n' 'SUMMARIZATION_CONTRACT_SENTINEL' > "$results_dir/summarization-annotation.txt"

  prompt="$(
    SCOUTING_ARTIFACT="$scouting_artifact" \
    KASEKI_RESULTS_DIR="$results_dir" \
    KASEKI_HASHLINE_EDITS=0 \
    render_prompt
  )" || result=1
  rm -f "$scouting_artifact"
  rm -rf "$results_dir"

  if [ "$result" -eq 0 ]; then
    assert_contains "$prompt" "Scouting artifact:" || result=1
    assert_contains "$prompt" "$scouting_artifact" || result=1
    assert_contains "$prompt" "Summarization Analysis:" || result=1
    assert_contains "$prompt" "SUMMARIZATION_CONTRACT_SENTINEL" || result=1
    assert_not_contains "$prompt" "SCOUTING_ARTIFACT_CONTENT_IS_NOT_INLINED" || result=1
  fi

  test_result "mode-specific contracts render scouting and summarization sections" "$result"
  return "$result"
}

test_mode_specific_contract_ignores_legacy_prompt_files() {
  local result=0
  local prompt
  local legacy_prompt_file legacy_test_prompt_file
  legacy_prompt_file="$(mktemp)"
  legacy_test_prompt_file="$(mktemp)"

  printf '%s\n' 'LEGACY_PROMPT_FILE_CONTENT_SHOULD_NOT_RENDER' > "$legacy_prompt_file"
  printf '%s\n' 'LEGACY_TEST_PROMPT_FILE_CONTENT_SHOULD_NOT_RENDER' > "$legacy_test_prompt_file"

  prompt="$(
    PROMPT_FILE="$legacy_prompt_file" \
    TEST_PROMPT_FILE="$legacy_test_prompt_file" \
    KASEKI_HASHLINE_EDITS=0 \
    render_prompt
  )" || result=1
  rm -f "$legacy_prompt_file" "$legacy_test_prompt_file"

  if [ "$result" -eq 0 ]; then
    assert_contains "$prompt" "Task:" || result=1
    assert_not_contains "$prompt" 'LEGACY_PROMPT_FILE_CONTENT_SHOULD_NOT_RENDER' || result=1
    assert_not_contains "$prompt" 'LEGACY_TEST_PROMPT_FILE_CONTENT_SHOULD_NOT_RENDER' || result=1
  fi

  test_result "mode-specific contract ignores legacy prompt-file inputs" "$result"
  return "$result"
}

main() {
  printf '\n%s\n' "=== Phase 4: Task Prompt Enhancement Tests ==="
  printf 'Asserting generated build_agent_prompt output for stable prompt contracts\n\n'

  test_task_contract_renders_task_prompt
  test_guardrail_contract_enabled
  test_guardrail_contract_disabled
  test_hashline_edit_contract_enabled
  test_hashline_edit_contract_disabled
  test_retry_prompt_contract_included_when_present
  test_retry_prompt_contract_omitted_when_empty
  test_mode_specific_contracts_render_supported_sections
  test_mode_specific_contract_ignores_legacy_prompt_files

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
