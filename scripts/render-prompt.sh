#!/usr/bin/env bash
# Render production prompts with caller-supplied environment and artifact files.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
prompt_name="${1:-}"

: "${KASEKI_RESULTS_DIR:=$(mktemp -d)}"
: "${TASK_PROMPT:=}"
: "${GOAL_SETTING_ARTIFACT:=$KASEKI_RESULTS_DIR/goal-setting.json}"
: "${SCOUTING_ARTIFACT:=$KASEKI_RESULTS_DIR/scouting.json}"
: "${TEST_IMPACT_WARNINGS_ARTIFACT:=$KASEKI_RESULTS_DIR/test-impact-warnings.json}"
: "${RUN_EVALUATION_CANDIDATE_ARTIFACT:=$KASEKI_RESULTS_DIR/run-evaluation-candidate.json}"
: "${GOAL_CHECK_RETRY_PROMPT:=}"
: "${KASEKI_AGENT_GUARDRAILS:=1}"
: "${KASEKI_HASHLINE_EDITS:=0}"

get_caveman_instruction() { printf '%s' "${CAVEMAN_INSTRUCTION:-}"; }
read_repo_memory_section() { printf '%s' "${REPO_MEMORY_SECTION:-}"; }
build_pr_body() { printf '%s' "${DRAFT_PR_BODY:-}"; }

# shellcheck source=/dev/null
. "$SCRIPT_DIR/evaluation-prompts.sh"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/agent-prompt.sh"

case "$prompt_name" in
  goal-check) build_goal_check_prompt ;;
  run-evaluation) build_run_evaluation_prompt ;;
  agent) build_agent_prompt ;;
  *)
    printf 'Usage: %s {goal-check|run-evaluation|agent}\n' "$0" >&2
    exit 64
    ;;
esac
