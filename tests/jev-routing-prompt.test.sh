#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
mkdir -p "$TMP_DIR/results"

export KASEKI_RESULTS_DIR="$TMP_DIR/results"
export TASK_PROMPT='Update the documentation for installation.'
export KASEKI_AGENT_GUARDRAILS=1
export KASEKI_HASHLINE_EDITS=0
export KASEKI_TASK_TYPE_HINT=documentation
export KASEKI_VALIDATION_FOCUS_HINT=docs_checks
export GOAL_CHECK_RETRY_PROMPT=""
export SCOUTING_ARTIFACT="$TMP_DIR/missing-scouting.json"

get_caveman_instruction() { :; }
read_repo_memory_section() { :; }
. "$ROOT_DIR/scripts/agent-prompt.sh"

prompt="$(build_agent_prompt)"
grep -q 'Evaluation routing hints' <<< "$prompt"
grep -q 'Likely task type: documentation' <<< "$prompt"
grep -q 'Suggested validation focus: docs_checks' <<< "$prompt"
grep -q 'explicit validation commands, allowlists, and repository instructions take precedence' <<< "$prompt"
grep -q 'Do not skip required validation or request human input' <<< "$prompt"

printf '✓ Evaluation routing hints stay advisory and preserve automatic flow\n'
