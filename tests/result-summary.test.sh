#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

extract_function() {
  awk -v fn="$1" '
  $0 ~ ("^" fn "\\(\\) \\{") { capture=1; depth=0 }
  capture {
    print
    for (i = 1; i <= length($0); i++) {
      ch = substr($0, i, 1)
      if (ch == "{") depth++
      if (ch == "}") depth--
    }
    if (capture && depth == 0) exit
  }
' "$ROOT_DIR/kaseki-agent.sh"
}
eval "$(extract_function write_result_summary)"

KASEKI_RESULTS_DIR="$TMP_DIR/results"
mkdir -p "$KASEKI_RESULTS_DIR"
STATUS=8
FAILED_COMMAND='run evaluation'
INSTANCE_NAME='run-123'
DIAGNOSTIC_REASON='metadata_write_invalid'
extract_failure_diagnostic_reason() { printf '%s' "$DIAGNOSTIC_REASON"; }

cat > "$KASEKI_RESULTS_DIR/metadata.json" <<'JSON'
{"instance":"run-123","exit_code":8,"validation_commands_attempted":0,"validation_exit_code":0,"task_mode":"patch"}
JSON
cat > "$KASEKI_RESULTS_DIR/failure.json" <<'JSON'
{"validation_exit_code":0,"worker_error_type":"metadata_write_invalid","worker_error_phase":"finalize"}
JSON
printf 'src/a.ts\n' > "$KASEKI_RESULTS_DIR/changed-files.txt"
printf '+change\n' > "$KASEKI_RESULTS_DIR/git.diff"
cat > "$KASEKI_RESULTS_DIR/goal-check.json" <<'JSON'
{"met":true,"confidence":"high"}
JSON
cat > "$KASEKI_RESULTS_DIR/goal-setting.json" <<'JSON'
{"fallback":false,"confidence":"high","reasoning":"A fallback option was considered and rejected.","success_criteria":["Refactor the helper"]}
JSON
cat > "$KASEKI_RESULTS_DIR/run-evaluation.json" <<'JSON'
{"overall_assessment":"poor","reviewer_confidence":"low","task_completion_score":1,"summary":"Run assessed poor; validation was not run; 1 changed file; run failed with exit code 8."}
JSON
cat > "$KASEKI_RESULTS_DIR/run-scorecard.json" <<'JSON'
{"overall_score":49,"grade":"F","lifecycle_status":"failed"}
JSON

write_result_summary

summary="$KASEKI_RESULTS_DIR/result-summary.md"
grep -q -- '- Validation: Not run (0 commands attempted; exit code 0 is not a pass)' "$summary"
grep -q -- '- Goal Check: Met (confidence: high)' "$summary"
grep -q -- '- Run Evaluation: poor; confidence low; task completion 1/5' "$summary"
grep -q -- '- Scorecard: 49/100 (F); lifecycle failed' "$summary"
grep -q -- '- Worker Error: metadata_write_invalid (phase: finalize)' "$summary"
grep -q -- '- Goal Setting: Artifact available' "$summary"
if grep -q -- '- Goal Setting: Fallback used' "$summary"; then
  fail "goal-setting reasoning text was mistaken for a fallback flag"
fi

printf '%s\n' '{"instance":"run-123","exit_code":8,"validation_commands_attempted":0,"validation_exit_code":0,"phases":{"validation":{"commands_attempted":2,"results":[{"status":"passed"},{"status":"passed"}]}}}' > "$KASEKI_RESULTS_DIR/metadata.json"
write_result_summary
grep -q -- '- Validation: Passed (2 commands attempted)' "$summary"

printf 'result-summary.test.sh PASS\n'
