#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURES="$ROOT/tests/fixtures/goal-check-prompt"

snapshot="$(
  KASEKI_RESULTS_DIR="$FIXTURES" \
  TASK_PROMPT='Add stable handoff' \
  GOAL_SETTING_ARTIFACT="$FIXTURES/goal-setting.json" \
  SCOUTING_ARTIFACT="$FIXTURES/scouting.json" \
  TEST_IMPACT_WARNINGS_ARTIFACT="$FIXTURES/test-impact-warnings.json" \
  KASEKI_CAVEMAN_LEVEL=1 \
    bash "$ROOT/scripts/render-prompt.sh" goal-check
)"

[[ "$snapshot" != *'last 80 lines'* ]]
[[ "$(grep -o 'coding: started' <<<"$snapshot" | wc -l)" -eq 1 ]]
[[ "$snapshot" == *'context-handoff.json (read first)'* ]]
[[ "$snapshot" == *'Validation summary:'* ]]
[[ "$snapshot" == *'Exit codes: 0'* ]]
echo 'goal-check prompt contract passed'
