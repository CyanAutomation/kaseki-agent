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
  ' "$ROOT_DIR/kaseki-agent.sh"
}

# Load only the helpers needed for PR metadata and the existing JSON encoding path.
eval "$(extract_function sanitize_pr_metadata_text)"
eval "$(extract_function sanitize_pr_body_text)"
eval "$(extract_function truncate_pr_metadata_text)"
eval "$(extract_function derive_pr_title)"
eval "$(extract_function is_pr_draft_mode)"
eval "$(extract_function format_pr_command_results)"
eval "$(extract_function format_pr_changed_files)"
eval "$(extract_function build_pr_improvements_summary)"
eval "$(extract_function build_pr_body)"
eval "$(extract_function run_node_subprocess)"

mkdir -p /results "$TMP_DIR/results"
rm -f /results/result-summary.md /results/changed-files.txt /results/git.diff
PRE_VALIDATION_TIMINGS_FILE="$TMP_DIR/results/pre-validation-timings.tsv"
VALIDATION_TIMINGS_FILE="$TMP_DIR/results/validation-timings.tsv"
cat > "$PRE_VALIDATION_TIMINGS_FILE" <<'TSV'
npm run check	0	3	tee_exit=0 filter_exit=0
TSV
cat > "$VALIDATION_TIMINGS_FILE" <<'TSV'
npm run test -- --token=abc123	0	12	tee_exit=0 filter_exit=0
npm run build	0	5	tee_exit=0 filter_exit=0
TSV

INSTANCE_NAME="kaseki-test-instance"
TASK_PROMPT=$(cat <<'PROMPT'
Fix OAuth flow for quoted "input" using secret=abc123 and ghp_1234567890abcdef.

1. Preserve the redirect-state handoff.
2. Add regression tests.



- Keep reviewer notes readable.
PROMPT
)
KASEKI_MODEL='openrouter/test-model'
ACTUAL_MODEL='openrouter/actual-model'
START_EPOCH=$(($(date +%s) - 125))
PRE_VALIDATION_EXIT=0
VALIDATION_EXIT=0
QUALITY_EXIT=0
SECRET_SCAN_EXIT=0
GIT_REF='main'
KASEKI_PUBLISH_MODE='pr'
feature_branch='kaseki/kaseki-test-instance'

pr_title="$(derive_pr_title)"
cat > /results/changed-files.txt <<'FILES'
kaseki-agent.sh
tests/pr-metadata-generation.test.sh
docs/usage-token=abc123.md
FILES
cat > /results/git.diff <<'DIFF'
diff --git a/kaseki-agent.sh b/kaseki-agent.sh
--- a/kaseki-agent.sh
+++ b/kaseki-agent.sh
@@ -1,2 +1,3 @@
-old
+new
+another
DIFF
cat > /results/result-summary.md <<'SUMMARY'
# Kaseki result

## Summary
- Updated publish mode documentation to describe normal PR creation as the default.
- Regenerated API metadata so publishMode includes pr and token=abc123.

## Validation
- Do not include this validation detail in the reviewer summary.
SUMMARY
pr_body="$(build_pr_body)"

case "$pr_title" in
  "fix: OAuth flow"*) pass "PR title is derived from the task prompt with conventional prefix" ;;
  *) fail "PR title was not derived from prompt: $pr_title" ;;
esac

case "$pr_title" in
  *" ($INSTANCE_NAME)") pass "PR title includes sanitized instance suffix" ;;
  *) fail "PR title missing instance suffix: $pr_title" ;;
esac

if printf '%s\n%s' "$pr_title" "$pr_body" | grep -Eq 'secret=abc123|ghp_1234567890abcdef|--token=abc123'; then
  fail "PR metadata leaked secret-like values"
else
  pass "PR metadata redacts secret-like values"
fi

INSTANCE_NAME="kaseki-42"
TASK_PROMPT="Update $(printf 'verylong %.0s' {1..20})"
long_pr_title="$(derive_pr_title)"
if [ "${#long_pr_title}" -le 72 ] && [[ "$long_pr_title" == *" ($INSTANCE_NAME)" ]]; then
  pass "Long PR titles truncate before preserving the instance suffix"
else
  fail "Long PR title did not preserve suffix within length: $long_pr_title (${#long_pr_title})"
fi

TASK_PROMPT=''
rm -f /results/result-summary.md
fallback_pr_title="$(derive_pr_title)"
if [ "$fallback_pr_title" = "chore: Kaseki agent changes ($INSTANCE_NAME)" ]; then
  pass "Empty prompts produce conventional fallback title with instance suffix"
else
  fail "Empty prompt fallback title had unexpected format: $fallback_pr_title"
fi

for expected in \
  '## Original task prompt' \
  'Fix OAuth flow for quoted "input" using [redacted] and [redacted].' \
  '1. Preserve the redirect-state handoff.' \
  '2. Add regression tests.' \
  '- Keep reviewer notes readable.' \
  '## Files changed' \
  'kaseki-agent.sh' \
  'tests/pr-metadata-generation.test.sh' \
  'docs/usage-[redacted]' \
  '## Summary' \
  'Updated publish mode documentation to describe normal PR creation as the default.' \
  'Regenerated API metadata so publishMode includes pr and [redacted]' \
  '### Change metadata' \
  'Changed files: 3 total.' \
  'Source files updated: 1.' \
  'Tests updated: 1.' \
  'Documentation updated: 1.' \
  'Diff stats: +2/-1 lines' \
  '## Validation' \
  'Pre-agent validation: passed' \
  'Post-agent validation: passed' \
  '### Pre-agent validation commands' \
  '### Post-agent validation commands' \
  'npm run check — exit 0, 3s' \
  'npm run test -- --[redacted] — exit 0, 12s' \
  '<details><summary>Original task prompt</summary>' \
  '</details>' \
  'Quality gate: passed' \
  'Secret scan: passed' \
  '## Run metadata' \
  'Model: requested openrouter/test-model; actual openrouter/actual-model' \
  'Generated by: Kaseki agent'; do
  if grep -Fq -- "$expected" <<<"$pr_body"; then
    pass "PR body contains: $expected"
  else
    fail "PR body missing expected text: $expected"
  fi
done

summary_line="$(grep -nF '## Summary' <<<"$pr_body" | head -n 1 | cut -d: -f1)"
validation_line="$(grep -nF '## Validation' <<<"$pr_body" | head -n 1 | cut -d: -f1)"
files_changed_line="$(grep -nF '## Files changed' <<<"$pr_body" | head -n 1 | cut -d: -f1)"
original_prompt_line="$(grep -nF '## Original task prompt' <<<"$pr_body" | head -n 1 | cut -d: -f1)"
run_metadata_line="$(grep -nF '## Run metadata' <<<"$pr_body" | head -n 1 | cut -d: -f1)"
if [ -n "$summary_line" ] && [ -n "$validation_line" ] && [ -n "$files_changed_line" ] && [ -n "$original_prompt_line" ] && [ -n "$run_metadata_line" ] \
  && [ "$summary_line" -lt "$validation_line" ] \
  && [ "$validation_line" -lt "$files_changed_line" ] \
  && [ "$files_changed_line" -lt "$original_prompt_line" ] \
  && [ "$original_prompt_line" -lt "$run_metadata_line" ]; then
  pass "PR body orders Summary, Validation, Files changed, Original task prompt, and Run metadata sections"
else
  fail "PR body sections were not in expected order"
fi

if [ "$summary_line" -lt "$original_prompt_line" ]; then
  pass "PR body places Summary before Original task prompt"
else
  fail "PR body did not place Summary before Original task prompt"
fi

prompt_start_line="$(grep -nF 'Fix OAuth flow for quoted "input" using [redacted] and [redacted].' <<<"$pr_body" | head -n 1 | cut -d: -f1)"
first_numbered_line="$(grep -nF '1. Preserve the redirect-state handoff.' <<<"$pr_body" | head -n 1 | cut -d: -f1)"
second_numbered_line="$(grep -nF '2. Add regression tests.' <<<"$pr_body" | head -n 1 | cut -d: -f1)"
bullet_line="$(grep -nF -- '- Keep reviewer notes readable.' <<<"$pr_body" | head -n 1 | cut -d: -f1)"
if [ -n "$prompt_start_line" ] && [ -n "$first_numbered_line" ] && [ -n "$second_numbered_line" ] && [ -n "$bullet_line" ] \
  && [ "$prompt_start_line" -lt "$first_numbered_line" ] \
  && [ "$first_numbered_line" -lt "$second_numbered_line" ] \
  && [ "$second_numbered_line" -lt "$bullet_line" ]; then
  pass "PR body preserves multiline task prompt bullet and numbered-list structure"
else
  fail "PR body did not preserve multiline task prompt structure"
fi

if awk '
  /Fix OAuth flow for quoted "input" using \[redacted\] and \[redacted\]\./ { in_prompt=1 }
  in_prompt && /^$/ { blanks++; if (blanks > 1) exit 1; next }
  in_prompt && /^## Run metadata$/ { exit 0 }
  in_prompt { blanks=0 }
' <<<"$pr_body"; then
  pass "PR body normalizes excessive blank lines in the task prompt"
else
  fail "PR body left excessive blank lines in the task prompt"
fi

if grep -Fq '## Quality checks' <<<"$pr_body"; then
  fail "PR body should not include a separate Quality checks section"
else
  pass "PR body folds quality checks into Validation"
fi

if grep -Eq 'Duration: 12[0-9]s' <<<"$pr_body"; then
  pass "PR body contains run duration"
else
  fail "PR body missing run duration"
fi

if grep -Fq 'This PR is in draft status. Please review before merging.' <<<"$pr_body"; then
  fail "Normal PR body should not include draft review sentence"
else
  pass "Normal PR body omits draft review sentence"
fi

if is_pr_draft_mode; then
  pr_draft_json=true
else
  pr_draft_json=false
fi

# Preserve the existing safe JSON encoding path used by the GitHub PR API payload.
run_node_subprocess pr_title_json "console.log(JSON.stringify(require('fs').readFileSync(0, 'utf8')))" "$pr_title" "$TMP_DIR/node.log"
run_node_subprocess pr_body_json "console.log(JSON.stringify(require('fs').readFileSync(0, 'utf8')))" "$pr_body" "$TMP_DIR/node.log"
payload="{\"title\": $pr_title_json, \"body\": $pr_body_json, \"head\": \"$feature_branch\", \"base\": \"$GIT_REF\", \"draft\": $pr_draft_json}"

PAYLOAD="$payload" node <<'NODE'
const payload = JSON.parse(process.env.PAYLOAD);
if (!payload.title.startsWith('fix: OAuth flow')) process.exit(1);
if (!payload.body.includes('## Original task prompt')) process.exit(2);
if (payload.draft !== false) process.exit(3);
NODE
pass "Explicit normal PR mode GitHub PR API payload marks the PR as ready for review"

KASEKI_PUBLISH_MODE='draft_pr'
draft_pr_body="$(build_pr_body)"
if grep -Fq 'This PR is in draft status. Please review before merging.' <<<"$draft_pr_body"; then
  pass "Draft PR body includes draft review sentence"
else
  fail "Draft PR body missing draft review sentence"
fi

if is_pr_draft_mode; then
  pr_draft_json=true
else
  pr_draft_json=false
fi
run_node_subprocess pr_body_json "console.log(JSON.stringify(require('fs').readFileSync(0, 'utf8')))" "$draft_pr_body" "$TMP_DIR/node.log"
payload="{\"title\": $pr_title_json, \"body\": $pr_body_json, \"head\": \"$feature_branch\", \"base\": \"$GIT_REF\", \"draft\": $pr_draft_json}"

PAYLOAD="$payload" node <<'NODE'
const payload = JSON.parse(process.env.PAYLOAD);
if (!payload.body.includes('This PR is in draft status. Please review before merging.')) process.exit(1);
if (payload.draft !== true) process.exit(2);
NODE
pass "Draft GitHub PR API payload marks the PR as draft"
