#!/usr/bin/env bash

# Generate the maturity-score artifact without copying its JSON to live logs.
record_maturity_score() {
  local workspace_dir="${1:-${KASEKI_WORKSPACE_DIR:?}}"
  local results_dir="${2:-${KASEKI_RESULTS_DIR:?}}"
  local executable="${KASEKI_MATURITY_SCORE_EXECUTABLE:-/app/scripts/kaseki-maturity-score.sh}"
  local maturity_score_log="${results_dir}/maturity-score.log"

  if [ ! -x "$executable" ]; then return 0; fi
  if [ ! -d "$workspace_dir/repo" ]; then
    printf 'maturity-score: skipped because repo checkout is missing: %s\n' "$workspace_dir/repo" >"$maturity_score_log"
    return 0
  fi
  if KASEKI_MATURITY_SCORE_STDOUT=0 "$executable" "$workspace_dir/repo" "$results_dir/maturity-score.json" >"$maturity_score_log" 2>&1; then
    printf 'maturity-score: wrote %s\n' "$results_dir/maturity-score.json" >"$maturity_score_log"
  else
    printf 'maturity-score: generation failed; see prior output if any\n' >>"$maturity_score_log"
  fi
}
