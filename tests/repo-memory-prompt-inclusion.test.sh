#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=helpers/repo-memory-test-helpers.sh
. "$(dirname "$0")/helpers/repo-memory-test-helpers.sh"
setup_repo_memory_fixture
trap 'rm -rf "$TMP_DIR"' EXIT
mkdir -p "$REPO_MEMORY_DIR"
printf '%s\n' '# Repository Memory Summary' '- Commit SHA: abc123' > "$REPO_MEMORY_FILE"
TASK_PROMPT='Fix the widget parser.' KASEKI_AGENT_GUARDRAILS=1 KASEKI_HASHLINE_EDITS=0
SCOUTING_ARTIFACT="$TMP_DIR/missing.json" GOAL_CHECK_RETRY_PROMPT="" REPO_MEMORY_NOW_EPOCH="$(stat -c %Y "$REPO_MEMORY_FILE")"
get_caveman_instruction() { :; }
# shellcheck source=../scripts/agent-prompt.sh
. "$ROOT_DIR/scripts/agent-prompt.sh"
prompt="$(build_agent_prompt)"
grep -q 'Prior repository context (opt-in cache' <<< "$prompt"
grep -q 'Commit SHA: abc123' <<< "$prompt"
grep -q 'Do not run git add, git commit, git push' <<< "$prompt"
printf '✅ Repository memory prompt inclusion test passed\n'
