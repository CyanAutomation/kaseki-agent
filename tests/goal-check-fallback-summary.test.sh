#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

eval "$(awk '
  /^degrade_goal_check_evaluator_failure\(\)/ { capture=1; depth=0 }
  capture {
    print
    for (i = 1; i <= length($0); i++) {
      ch = substr($0, i, 1)
      if (ch == "{") depth++
      if (ch == "}") depth--
    }
    if (capture && depth == 0) exit
  }
' "$ROOT_DIR/kaseki-agent.sh")"

record_stage_timing() { :; }
emit_error_event() { :; }
emit_progress() { :; }
KASEKI_RESULTS_DIR="$TMP_DIR/results"
CRITICAL_CHANGE_EXPECTATIONS_ARTIFACT="$TMP_DIR/critical-change-expectations.json"
KASEKI_ALLOW_EMPTY_DIFF=1
mkdir -p "$KASEKI_RESULTS_DIR"
: > "$KASEKI_RESULTS_DIR/git.diff"
: > "$KASEKI_RESULTS_DIR/changed-files.txt"
printf '{"required_files":[]}\n' > "$CRITICAL_CHANGE_EXPECTATIONS_ARTIFACT"

degrade_goal_check_evaluator_failure typed_evaluation_unavailable

node - "$KASEKI_RESULTS_DIR/goal-check.json" <<'NODE'
const fs = require('node:fs');
const goalCheck = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (goalCheck.met !== true) throw new Error('controller-authorized no-op should satisfy the deterministic contract');
if (goalCheck.evaluation_unavailable !== true) throw new Error('fallback must retain the evaluator-unavailable marker');
if (/non-empty diff/i.test(goalCheck.summary)) throw new Error('fallback summary claimed a diff existed when none did');
if (!/no diff|empty diff/i.test(goalCheck.summary)) throw new Error('fallback summary did not explain why the no-op was accepted');
if (!/human review/i.test(goalCheck.summary)) throw new Error('fallback summary must retain the human-review requirement');
NODE

printf 'goal-check-fallback-summary.test.sh PASS\n'
