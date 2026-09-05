#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

KASEKI_RESULTS_DIR="$TMP_DIR/results"
mkdir -p "$KASEKI_RESULTS_DIR"
LOG_FILE="$TMP_DIR/errors.log"

log() {
  printf '%s: %s\n' "$1" "$2" >> "$LOG_FILE"
}

# Load only the helper so this unit test does not execute the agent entrypoint.
eval "$(sed -n '/^read_goal_check_json() {$/,/^}$/p' "$REPO_ROOT/kaseki-agent.sh")"

printf '%s\n' '{"met":true}' > "$KASEKI_RESULTS_DIR/goal-check.json"
[ "$(read_goal_check_json goal-1)" = '{"met":true}' ]

rm "$KASEKI_RESULTS_DIR/goal-check.json"
printf '%s\n' '{"met":false,"retry_prompt":"legacy fallback"}' > "$KASEKI_RESULTS_DIR/run-evaluation.json"
[ "$(read_goal_check_json goal-2)" = '{"met":false,"retry_prompt":"legacy fallback"}' ]

printf '%s\n' '{"overall_assessment":"good","task_completion_score":95}' > "$KASEKI_RESULTS_DIR/run-evaluation.json"
set +e
schema_mismatch_output="$(read_goal_check_json goal-3)"
schema_mismatch_status=$?
set -e
[ "$schema_mismatch_status" -ne 0 ]
[ "$schema_mismatch_output" = '{}' ]
grep -Fxq 'ERROR: Legacy run-evaluation JSON lacks a goal-check verdict for goal_id=goal-3' "$LOG_FILE"

rm "$KASEKI_RESULTS_DIR/run-evaluation.json"
set +e
missing_output="$(read_goal_check_json goal-4)"
missing_status=$?
set -e
[ "$missing_status" -ne 0 ]
[ "$missing_output" = '{}' ]
grep -Fxq 'ERROR: No goal-check JSON found for goal_id=goal-4' "$LOG_FILE"

echo "PASS: guarded goal-check JSON reader"
