#!/usr/bin/env bash
# Behavior test for Caveman prompt injection.
# Renders the public agent prompt path and asserts the KASEKI_CAVEMAN
# environment switch controls whether terse communication guidance appears.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROMPT_HELPER="$REPO_ROOT/scripts/agent-prompt.sh"
ENVIRONMENT_CONFIGURATION_DOC="$REPO_ROOT/.agents/skills/environment-configuration/SKILL.md"

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

assert_prompt_contains() {
  local prompt="$1"
  local expected_text="$2"
  local behavior="$3"

  printf '%s' "$prompt" | grep -Fq -- "$expected_text" \
    || fail "$behavior: expected generated prompt to contain '$expected_text'"
}

assert_prompt_omits() {
  local prompt="$1"
  local forbidden_text="$2"
  local behavior="$3"

  if printf '%s' "$prompt" | grep -Fq -- "$forbidden_text"; then
    fail "$behavior: expected generated prompt to omit '$forbidden_text'"
  fi
}

assert_file_mentions_public_env_var() {
  local file_path="$1"
  local env_var="$2"
  local behavior="$3"

  grep -Fq -- "$env_var" "$file_path" \
    || fail "$behavior: expected $file_path to document public environment variable $env_var"
}

render_agent_prompt() {
  local caveman_enabled="$1"
  local harness results_dir status
  harness="$(mktemp)" || fail "Failed to create temporary harness file"
  results_dir="$(mktemp -d)" || { rm -f "$harness"; fail "Failed to create temporary results directory"; }

  cat > "$harness" <<'EOF_HARNESS'
#!/usr/bin/env bash
set -euo pipefail
read_repo_memory_section() { printf ''; }
get_caveman_instruction() {
  if [ "${KASEKI_CAVEMAN:-1}" != "1" ]; then
    return 0
  fi
  cat <<'CAVEMAN'
Terse, professional communication. Drop articles, filler, pleasantries. Keep full sentences. Short synonyms (big not extensive, fix not implement). No tool narration, tables, emoji. Standard acronyms only (DB/API/HTTP). Technical terms exact, code blocks unchanged. Pattern: [thing] [action] [reason]. [next step]. Example: "Bug in auth middleware. Expiry check uses < not <=. Fix:" Substance stays. Fluff dies.
CAVEMAN
}
: "${PROMPT_HELPER:?PROMPT_HELPER is required}"
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

  if PROMPT_HELPER="$PROMPT_HELPER" \
    TASK_PROMPT="Implement caveman prompt behavior test." \
    SCOUTING_ARTIFACT="/dev/null" \
    KASEKI_RESULTS_DIR="$results_dir" \
    GOAL_CHECK_RETRY_PROMPT="" \
    KASEKI_HASHLINE_EDITS="0" \
    KASEKI_AGENT_GUARDRAILS="0" \
    KASEKI_CAVEMAN="$caveman_enabled" \
    bash "$harness"; then
    status=0
  else
    status=$?
  fi

  rm -f "$harness"
  rm -rf "$results_dir"
  return "$status"
}

test_caveman_prompt_contract_enabled() {
  local result=0 prompt
  prompt="$(render_agent_prompt 1)" || result=1

  if [ "$result" -eq 0 ]; then
    assert_prompt_contains "$prompt" "Terse, professional communication." \
      "KASEKI_CAVEMAN=1 protects terse communication guidance" || result=1
    assert_prompt_contains "$prompt" "Substance stays. Fluff dies." \
      "KASEKI_CAVEMAN=1 protects caveman instruction footer" || result=1
    assert_prompt_contains "$prompt" "Implement caveman prompt behavior test." \
      "KASEKI_CAVEMAN=1 preserves user task prompt" || result=1
  fi

  test_result "KASEKI_CAVEMAN=1 includes Caveman instruction in generated agent prompt" "$result"
  return "$result"
}

test_caveman_prompt_contract_disabled() {
  local result=0 prompt
  prompt="$(render_agent_prompt 0)" || result=1

  if [ "$result" -eq 0 ]; then
    assert_prompt_omits "$prompt" "Terse, professional communication." \
      "KASEKI_CAVEMAN=0 protects opt-out from terse communication guidance" || result=1
    assert_prompt_omits "$prompt" "Substance stays. Fluff dies." \
      "KASEKI_CAVEMAN=0 protects opt-out from caveman instruction footer" || result=1
    assert_prompt_contains "$prompt" "Implement caveman prompt behavior test." \
      "KASEKI_CAVEMAN=0 preserves user task prompt" || result=1
  fi

  test_result "KASEKI_CAVEMAN=0 omits Caveman instruction from generated agent prompt" "$result"
  return "$result"
}

test_caveman_public_configuration_documented() {
  local result=0

  assert_file_mentions_public_env_var "$ENVIRONMENT_CONFIGURATION_DOC" "KASEKI_CAVEMAN" \
    "Environment configuration skill documents supported public prompt switches" || result=1

  test_result "KASEKI_CAVEMAN remains documented as public environment configuration" "$result"
  return "$result"
}

main() {
  printf 'Asserting Caveman prompt behavior through rendered agent prompt\n\n'

  test_caveman_prompt_contract_enabled || true
  test_caveman_prompt_contract_disabled || true
  test_caveman_public_configuration_documented || true

  printf '\nTests: %d passed, %d failed, %d total\n' "$passed_count" "$failed_count" "$test_count"

  if [ "$failed_count" -ne 0 ]; then
    exit 1
  fi
}

main "$@"
