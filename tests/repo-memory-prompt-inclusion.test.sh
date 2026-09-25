#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=helpers/repo-memory-test-helpers.sh
. "$(dirname "$0")/helpers/repo-memory-test-helpers.sh"

setup_repo_memory_fixture
trap 'rm -rf "$TMP_DIR"' EXIT

CACHED_CONTENT_MARKER='REPOSITORY_MEMORY_CONTENT_MARKER'
CURRENT_TASK_MARKER='CURRENT_TASK_INSTRUCTIONS_MARKER'

mkdir -p "$REPO_MEMORY_DIR"
printf '%s\n' '# Repository Memory Summary' "$CACHED_CONTENT_MARKER" > "$REPO_MEMORY_FILE"

export TASK_PROMPT="$CURRENT_TASK_MARKER"
export KASEKI_AGENT_GUARDRAILS=1
export KASEKI_HASHLINE_EDITS=0
export SCOUTING_ARTIFACT="$TMP_DIR/missing.json"
export GOAL_CHECK_RETRY_PROMPT=""
get_caveman_instruction() { :; }

# shellcheck source=../scripts/agent-prompt.sh
. "$ROOT_DIR/scripts/agent-prompt.sh"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_memory_omitted() {
  local case_name="$1"
  local prompt
  prompt="$(build_agent_prompt)"

  if grep -Fq "$CACHED_CONTENT_MARKER" <<< "$prompt"; then
    fail "$case_name repository memory was included"
  fi
  grep -Fq "$CURRENT_TASK_MARKER" <<< "$prompt" \
    || fail "$case_name prompt omitted the current task"
}

# Fresh, explicitly enabled memory is enclosed by prompt section boundaries.
REPO_MEMORY_NOW_EPOCH="$(stat -c %Y "$REPO_MEMORY_FILE")"
prompt="$(build_agent_prompt)"

[ "$(grep -Foc "$CACHED_CONTENT_MARKER" <<< "$prompt")" -eq 1 ] \
  || fail 'fresh repository memory was not included exactly once'

memory_block="$(awk -v marker="$CACHED_CONTENT_MARKER" '
  $0 == "---" {
    if (found) {
      closed = 1
      exit
    }
    capture = 1
    next
  }
  capture {
    block = block $0 ORS
    if ($0 == marker) found = 1
  }
  END {
    if (!found || !closed) exit 1
    printf "%s", block
  }
' <<< "$prompt")" || fail 'repository memory was not enclosed by section markers'

grep -Fxq '# Repository Memory Summary' <<< "$memory_block" \
  || fail 'repository memory heading was omitted from its section'
if grep -Fq "$CURRENT_TASK_MARKER" <<< "$memory_block"; then
  fail 'repository memory was not separated from the current task instructions'
fi
case "${prompt%%"$CACHED_CONTENT_MARKER"*}" in
  *"$CURRENT_TASK_MARKER"*) ;;
  *) fail 'repository memory did not follow the current task instructions' ;;
esac

# The same cached fixture must be omitted when repository memory is disabled.
KASEKI_REPO_MEMORY_MODE=off
assert_memory_omitted 'disabled'

# The same cached fixture must be omitted when it is stale.
KASEKI_REPO_MEMORY_MODE=summary
REPO_MEMORY_NOW_EPOCH="$(( $(stat -c %Y "$REPO_MEMORY_FILE") + KASEKI_REPO_MEMORY_TTL_DAYS * 86400 + 1 ))"
assert_memory_omitted 'stale'

# The same fixture path must be omitted when its cached content is unavailable.
REPO_MEMORY_NOW_EPOCH="$(date +%s)"
rm -f "$REPO_MEMORY_FILE"
assert_memory_omitted 'unavailable'

printf '✅ Repository memory prompt inclusion test passed\n'
