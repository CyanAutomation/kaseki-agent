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
{"overall_score":49,"grade":"F","lifecycle_status":"failed","completeness":"provisional","confidence":{"score":61,"rationale":"Some evaluator evidence is unavailable."}}
JSON
summary="$KASEKI_RESULTS_DIR/result-summary.md"
printf '# Agent-authored review\n\nThe run made no changes because no safe improvement was found.\n' > "$summary"

write_result_summary

grep -q -- '- Validation: Not run (0 commands attempted; exit code 0 is not a pass)' "$summary"
grep -q -- '- Goal Check: Met (confidence: high)' "$summary"
grep -q -- '- Run Evaluation: poor; confidence low; task completion 1/5' "$summary"
grep -q -- '- Scorecard: 49/100 (F); lifecycle failed' "$summary"
grep -q -- 'completeness provisional; confidence 61/100' "$summary"
grep -q -- '- Worker Error: metadata_write_invalid (phase: finalize)' "$summary"
grep -q -- '- Goal Setting: Artifact available' "$summary"
if grep -q -- '- Goal Setting: Fallback used' "$summary"; then
  fail "goal-setting reasoning text was mistaken for a fallback flag"
fi
grep -q -- '- Agent review: agent-review.md' "$summary"
grep -q 'The run made no changes because no safe improvement was found\.' "$KASEKI_RESULTS_DIR/agent-review.md"

cat > "$KASEKI_RESULTS_DIR/goal-check.json" <<'JSON'
{"met":true,"confidence":"medium","evaluation_unavailable":true,"summary":"No diff was produced; empty diffs are allowed by this run. Semantic requirements require human review."}
JSON
cat > "$KASEKI_RESULTS_DIR/metadata.json" <<'JSON'
{"instance":"run-123","exit_code":0,"validation_commands_attempted":0,"validation_exit_code":0,"task_mode":"patch","no_change_accepted":true}
JSON
STATUS=0
write_result_summary
grep -q -- '- Goal Check: Contract met; semantic evaluation unavailable, human review required (confidence: medium)' "$summary"
grep -q -- '- No-Change Outcome: Accepted by run policy' "$summary"
grep -q 'The run made no changes because no safe improvement was found\.' "$KASEKI_RESULTS_DIR/agent-review.md"

printf '%s\n' '{"instance":"run-123","exit_code":8,"validation_commands_attempted":0,"validation_exit_code":0,"phases":{"validation":{"commands_attempted":2,"results":[{"status":"passed"},{"status":"passed"}]}}}' > "$KASEKI_RESULTS_DIR/metadata.json"
write_result_summary
grep -q -- '- Validation: Passed (2 commands attempted)' "$summary"

# Agent-writable artifact paths must not allow the summary writer to follow
# symlinks outside the results directory when preserving or replacing content.
external_summary="$TMP_DIR/external-summary.md"
external_review="$TMP_DIR/external-review.md"
printf 'external summary sentinel\n' > "$external_summary"
printf 'external review sentinel\n' > "$external_review"
rm -f "$summary" "$KASEKI_RESULTS_DIR/agent-review.md"
ln -s "$external_summary" "$summary"
ln -s "$external_review" "$KASEKI_RESULTS_DIR/agent-review.md"
write_result_summary
grep -q '^external summary sentinel$' "$external_summary"
grep -q '^external review sentinel$' "$external_review"
test ! -L "$summary"
test ! -L "$KASEKI_RESULTS_DIR/agent-review.md"
test ! -e "$KASEKI_RESULTS_DIR/agent-review.md"

printf '# Safe agent review\n' > "$summary"
ln -s "$external_review" "$KASEKI_RESULTS_DIR/agent-review.md"
write_result_summary
grep -q '^external review sentinel$' "$external_review"
grep -q '^# Safe agent review$' "$KASEKI_RESULTS_DIR/agent-review.md"
test ! -L "$KASEKI_RESULTS_DIR/agent-review.md"

printf 'result-summary.test.sh PASS\n'
