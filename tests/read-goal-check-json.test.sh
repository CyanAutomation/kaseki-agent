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
printf '%s\n' '{"overall_assessment":"fallback"}' > "$KASEKI_RESULTS_DIR/run-evaluation.json"
[ "$(read_goal_check_json goal-2)" = '{"overall_assessment":"fallback"}' ]

rm "$KASEKI_RESULTS_DIR/run-evaluation.json"
set +e
missing_output="$(read_goal_check_json goal-3)"
missing_status=$?
set -e
[ "$missing_status" -ne 0 ]
[ "$missing_output" = '{}' ]
grep -Fxq 'ERROR: No goal-check JSON found for goal_id=goal-3' "$LOG_FILE"

echo "PASS: guarded goal-check JSON reader"
