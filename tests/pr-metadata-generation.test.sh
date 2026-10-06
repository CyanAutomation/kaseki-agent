#!/usr/bin/env bash
# Tests for deterministic, sanitized GitHub PR metadata generation.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }

extract_function() {
  local name="$1"
  awk -v fn="$name" '
    $0 ~ "^" fn "\\(\\) \\{" { capture=1; depth=0 }
    capture {
      print
      for (i = 1; i <= length($0); i++) {
        ch = substr($0, i, 1)
        if (ch == "{") depth++
        if (ch == "}") depth--
      }
      if (capture && depth == 0) exit
    }
  ' "$ROOT_DIR/kaseki-agent.sh" | sed "s#/results#$RESULTS_DIR#g"
}

RESULTS_DIR="$TMP_DIR/results"
mkdir -p "$RESULTS_DIR"
KASEKI_RESULTS_DIR="$RESULTS_DIR"

# Load only helpers exercised here; avoid sourcing the worker's startup path.
eval "$(extract_function sanitize_pr_metadata_text)"
eval "$(extract_function sanitize_pr_body_text)"
eval "$(extract_function truncate_pr_metadata_text)"
eval "$(extract_function derive_pr_title)"
eval "$(extract_function format_pr_command_results)"
eval "$(extract_function format_pr_command_results_bounded)"
eval "$(extract_function format_pr_json_list)"
eval "$(extract_function build_pr_agent_review)"
eval "$(extract_function build_pr_summary)"
eval "$(extract_function build_pr_changes)"
eval "$(extract_function build_pr_human_review_focus)"
eval "$(extract_function build_pr_improvements_summary)"
eval "$(extract_function build_pr_body)"
eval "$(extract_function build_pr_fallback_body)"
eval "$(extract_function run_node_subprocess)"
eval "$(extract_function validate_run_evaluation_candidate)"

if grep -Eq 'refresh_finalized_pr_scorecard|GITHUB_PR_UPDATE_TOKEN|update_github_pull_request_body' "$ROOT_DIR/kaseki-agent.sh"; then
  fail "PR publication must not retain an installation token for scorecard enrichment"
fi
pass "PR publication does not retain a token for scorecard enrichment"

grep -Fq '\"draft\": false' "$ROOT_DIR/kaseki-agent.sh" || fail "PR creation must explicitly request a normal PR"
if grep -Fq 'is_pr_draft_mode' "$ROOT_DIR/kaseki-agent.sh"; then
  fail "Conditional PR publishing code remains in the worker"
fi
pass "Worker PR creation has one normal, non-draft path"

grep -Fq 'Do not repeat the task prompt, including as a fallback.' "$ROOT_DIR/scripts/evaluation-prompts.sh" \
  || fail "Run-evaluation prompt does not prohibit task-prompt echoes"
grep -Fq 'Keep validation results in the generated Verification section.' "$ROOT_DIR/scripts/evaluation-prompts.sh" \
  || fail "Run-evaluation prompt does not separate change prose from validation results"
pass "Run-evaluation prompt keeps PR prose focused on changes and reserves validation for its section"

INSTANCE_NAME="kaseki-test-instance"
TASK_PROMPT='Fix OAuth flow for quoted "input" using secret=task-secret and ghp_1234567890abcdef. Preserve redirect state.'
KASEKI_MODEL='openrouter/private-test-model'
ACTUAL_MODEL='openrouter/private-actual-model'
START_EPOCH=$(($(date +%s) - 125))
PRE_VALIDATION_EXIT=1
VALIDATION_EXIT=0
QUALITY_EXIT=0
SECRET_SCAN_EXIT=0
GIT_REF='main'
KASEKI_PUBLISH_MODE='pr'
feature_branch='kaseki/kaseki-test-instance'
PRE_VALIDATION_TIMINGS_FILE="$RESULTS_DIR/pre-validation-timings.tsv"
VALIDATION_TIMINGS_FILE="$RESULTS_DIR/validation-timings.tsv"
cat > "$PRE_VALIDATION_TIMINGS_FILE" <<'TSV'
npm run check	0	3	tee_exit=0 filter_exit=0
TSV
cat > "$VALIDATION_TIMINGS_FILE" <<'TSV'
npm run test -- --token=abc123	0	12	tee_exit=0 filter_exit=0
npm run build	0	5	tee_exit=0 filter_exit=0
TSV
cat > "$RESULTS_DIR/changed-files.txt" <<'FILES'
src/oauth/callback.ts
tests/oauth-callback.test.ts
FILES
cat > "$RESULTS_DIR/git.diff" <<'DIFF'
diff --git a/src/oauth/callback.ts b/src/oauth/callback.ts
--- a/src/oauth/callback.ts
+++ b/src/oauth/callback.ts
@@ -1,2 +1,3 @@
-drop redirect state
+preserve redirect state
+handle callback retry
DIFF
cat > "$RESULTS_DIR/result-summary.md" <<'SUMMARY'
# Kaseki result

## Summary
- Preserves OAuth redirect state through callback retries.
- Adds a regression test for callback retries.

## Validation
- This internal validation prose must not appear in the PR summary.
SUMMARY
cat > "$RESULTS_DIR/goal-check.json" <<'JSON'
{"met":false,"missing":["The expired-state callback behavior was not verified."]}
JSON
cat > "$RESULTS_DIR/run-evaluation.json" <<'JSON'
{
  "overall_assessment": "good",
  "reviewer_confidence": "high",
  "task_completion_score": 5,
  "pr_summary": "Preserves OAuth redirect state when callbacks are retried, preventing valid authorization flows from losing their original destination.",
  "pr_changes": [
    "Carries redirect state through callback retries.",
    "Adds regression coverage for callback retry behavior."
  ],
  "human_review_focus": [
    "The callback retry limit could also mean retries happen before state validation.",
    "Review task criteria because goal-setting used a fallback artifact.",
    "Expired-state callbacks may return an unhelpful error; confirm callers receive the expected response."
  ],
  "model": "openrouter/private-actual-model",
  "started_at": "2026-10-05T12:00:00Z",
  "ended_at": "2026-10-05T12:02:05Z",
  "duration_ms": 125000,
  "phase_scorecard": {"coding": {"score": 100}}
}
JSON
cat > "$RESULTS_DIR/run-scorecard.json" <<'JSON'
{"overall_score":100,"grade":"A","model":"private-model","details":"internal evaluator telemetry"}
JSON

pr_title="$(derive_pr_title)"
pr_body="$(build_pr_body)"
grep -Fq '## Summary' <<<"$pr_body" || fail "PR body is missing a summary"
grep -Fq 'Preserves OAuth redirect state when callbacks are retried' <<<"$pr_body" || fail "PR body omitted the reviewer-facing change summary"
grep -Fq 'Carries redirect state through callback retries.' <<<"$pr_body" || fail "PR body omitted an implementation bullet"
grep -Fq $'destination.\n\n## Changes' <<<"$pr_body" || fail "PR body did not separate the summary and changes sections"
grep -Fq $'callback retry behavior.\n\n## Review notes' <<<"$pr_body" || fail "PR body did not separate the changes and review sections"
grep -Fq '## Verification' <<<"$pr_body" || fail "PR body is missing verification results"
grep -Fq 'npm run test' <<<"$pr_body" || fail "PR body omitted post-agent validation"
grep -Fq 'passed' <<<"$pr_body" || fail "PR body omitted validation status"
grep -Fq 'Expired-state callbacks may return an unhelpful error; confirm callers receive the expected response.' <<<"$pr_body" || fail "PR body omitted a specific reviewer action"
if grep -Eiq 'task prompt|task-secret|ghp_1234567890abcdef|private-(test|actual)-model|reviewer.confidence|overall.assessment|duration_ms|125000|started_at|ended_at|phase_scorecard|overall_score|file(s)? changed|pre-agent validation|tee_exit|filter_exit|exit 0, [0-9]+s|internal validation prose' <<<"$pr_body"; then
  fail "PR body exposed task, evaluator, file-count, baseline, or process telemetry"
fi
if grep -Eiq 'could also mean|goal-setting|fallback artifact|callback retry limit' <<<"$pr_body"; then
  fail "PR body included speculative or internal review focus"
fi
pass "PR body describes implemented changes and excludes task and run telemetry"
pass "PR body includes only actionable review focus and post-agent validation status"

mv "$VALIDATION_TIMINGS_FILE" "$RESULTS_DIR/validation-timings.saved.tsv"
no_validation_body="$(build_pr_body)"
mv "$RESULTS_DIR/validation-timings.saved.tsv" "$VALIDATION_TIMINGS_FILE"
grep -Fq 'No post-agent validation commands were recorded.' <<<"$no_validation_body" || fail "Missing validation evidence was not described accurately"
if grep -Fq -- '- Not recorded' <<<"$no_validation_body"; then
  fail "Missing validation evidence used an ambiguous status"
fi
pass "Missing validation evidence is stated explicitly without implying a pass"

pr_title_json=""
pr_body_json=""
run_node_subprocess pr_title_json "console.log(JSON.stringify(require('fs').readFileSync(0, 'utf8')))" "$pr_title" "$TMP_DIR/node.log"
run_node_subprocess pr_body_json "console.log(JSON.stringify(require('fs').readFileSync(0, 'utf8')))" "$pr_body" "$TMP_DIR/node.log"
payload="{\"title\": $pr_title_json, \"body\": $pr_body_json, \"head\": \"$feature_branch\", \"base\": \"$GIT_REF\", \"draft\": false}"
PAYLOAD="$payload" node <<'NODE'
const payload = JSON.parse(process.env.PAYLOAD);
if (!payload.title.startsWith('fix:')) process.exit(1);
if (!payload.body.includes('## Summary')) process.exit(2);
if (payload.draft !== false) process.exit(3);
NODE
pass "GitHub PR API payload preserves the reviewer-facing body and requests a normal PR"

# The published body may use the agent result summary when evaluator prose is
# absent, but it must not echo the prompt or fold validation text into summary.
cat > "$RESULTS_DIR/run-evaluation.json" <<'JSON'
{"overall_assessment":"unknown","reviewer_confidence":"low","pr_summary":"Run evaluation was unavailable; please rely on the summary, validation results, and changed files."}
JSON
fallback_body="$(build_pr_body)"
grep -Fq 'Preserves OAuth redirect state through callback retries.' <<<"$fallback_body" || fail "Result-summary fallback did not describe the implemented change"
if grep -Eiq 'This internal validation prose|Fix OAuth flow|Requested outcome|secret=task-secret|Duration:|Run metadata' <<<"$fallback_body"; then
  fail "Fallback summary included validation details, task prompt, or run metadata"
fi
pass "Evaluator fallback uses concise change evidence without repeating the task"

mv "$RESULTS_DIR/result-summary.md" "$RESULTS_DIR/result-summary.saved.md"
cat > "$RESULTS_DIR/changed-files.txt" <<'FILES'
src/alpha.ts
src/beta.ts
src/gamma.ts
src/delta.ts
src/epsilon.ts
FILES
file_only_body="$(build_pr_body 2>"$TMP_DIR/file-fallback.stderr")"
mv "$RESULTS_DIR/result-summary.saved.md" "$RESULTS_DIR/result-summary.md"
grep -Fq 'Updated several files, including' <<<"$file_only_body" || fail "File-based fallback did not identify the changed files"
grep -Fq '`src/alpha.ts`' <<<"$file_only_body" || fail "File-based fallback omitted a changed path"
if [ -s "$TMP_DIR/file-fallback.stderr" ]; then
  fail "File-based fallback wrote an error while formatting paths"
fi
if grep -Eiq '[0-9]+ files? changed|across [0-9]+ changed files?' <<<"$file_only_body" || grep -Fq '## Changes' <<<"$file_only_body"; then
  fail "File-based fallback repeated file counts or a duplicate file inventory"
fi
if grep -Fq 'Fix OAuth flow' <<<"$file_only_body"; then
  fail "File-based fallback repeated the task prompt"
fi
pass "File-based fallback avoids task echoes, counts, and duplicate file lists"

# A final safety fallback remains nonempty and excludes publication/run metadata.
fallback_body="$(build_pr_fallback_body)"
grep -Fq '## Summary' <<<"$fallback_body" || fail "Empty-body fallback omitted the summary"
grep -Fq '## Verification' <<<"$fallback_body" || fail "Empty-body fallback omitted verification"
if grep -Eiq 'Run metadata|Generated at|Publish mode|Duration:|pre-agent validation|file(s)? changed' <<<"$fallback_body"; then
  fail "Empty-body fallback included run metadata or baseline validation"
fi
pass "Empty-body fallback stays concise and reviewer-focused"

for publish_mode in pr auto; do
  KASEKI_PUBLISH_MODE="$publish_mode"
  fallback_body_json=""
  run_node_subprocess fallback_body_json "console.log(JSON.stringify(require('fs').readFileSync(0, 'utf8')))" "$fallback_body" "$TMP_DIR/node.log"
  payload="{\"body\": $fallback_body_json, \"draft\": false}"
  PAYLOAD="$payload" node <<'NODE'
const payload = JSON.parse(process.env.PAYLOAD);
if (typeof payload.body !== 'string' || !payload.body.trim().includes('## Summary')) process.exit(1);
if (payload.draft !== false) process.exit(2);
NODE
done
pass "Fallback PR body remains valid JSON for PR and auto publish modes"

# Keep the evaluation schema contract aligned with the fields consumed by the
# reviewer-facing body, and reject older candidates without pr_changes.
RUN_EVALUATION_CANDIDATE_ARTIFACT="$RESULTS_DIR/run-evaluation-candidate.json"
RUN_EVALUATION_ARTIFACT="$RESULTS_DIR/validated-run-evaluation.json"
KASEKI_RUN_EVALUATION_MODEL="test-model"
RUN_EVALUATION_ACTUAL_MODEL="test-model"
export RUN_EVALUATION_CANDIDATE_ARTIFACT RUN_EVALUATION_ARTIFACT KASEKI_RUN_EVALUATION_MODEL RUN_EVALUATION_ACTUAL_MODEL
cat > "$RUN_EVALUATION_CANDIDATE_ARTIFACT" <<'JSON'
{
  "overall_assessment":"good","reviewer_confidence":"medium","task_completion_score":4,
  "summary":"Evaluation summary.","pr_summary":"Implemented behavior.","pr_changes":["Specific implementation change."],
  "human_review_focus":[],"stage_value":[],"evidence_sources_inspected":[],"contradictions":[],
  "confidence_calibration":{"objective_outcome":"met","calibrated":true,"reason":"Evidence supports the result."},
  "phase_scorecard":{},"efficiency_findings":[],"kaseki_improvement_opportunities":[],"warnings":[]
}
JSON
if validate_run_evaluation_candidate >/dev/null 2>&1 \
  && node -e 'const value=require(process.argv[1]); if (!Array.isArray(value.pr_changes) || value.pr_changes.length !== 1) process.exit(1);' "$RUN_EVALUATION_ARTIFACT"; then
  pass "Run-evaluation validation preserves PR summary and implementation bullets"
else
  fail "Run-evaluation validation did not preserve pr_changes"
fi
node -e 'const fs=require("fs"); const file=process.argv[1]; const value=JSON.parse(fs.readFileSync(file,"utf8")); delete value.pr_changes; fs.writeFileSync(file, JSON.stringify(value));' "$RUN_EVALUATION_CANDIDATE_ARTIFACT"
rm -f "$RUN_EVALUATION_ARTIFACT"
if validate_run_evaluation_candidate >/dev/null 2>&1; then
  fail "Run-evaluation validator accepted a response without pr_changes"
fi
pass "Run-evaluation validator rejects candidates missing implementation bullets"
