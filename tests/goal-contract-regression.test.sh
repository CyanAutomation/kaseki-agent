#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

get_caveman_instruction() { :; }
critical_change_contract_allows_noop() { return 1; }
eval "$(awk '
  /^build_goal_setting_prompt\(\)/ { emit=1 }
  /^validate_goal_setting_artifact\(\)/ { emit=0 }
  emit { print }
' "$ROOT_DIR/kaseki-agent.sh")"

ORIGINAL_TASK_PROMPT="Inspect the repository"
GOAL_SETTING_CANDIDATE_ARTIFACT="$TMP_DIR/goal-setting-candidate.json"
KASEKI_TASK_MODE="patch"
patch_prompt="$(build_goal_setting_prompt)"
grep -Fq '"outcome_policy": "change_required"' <<< "$patch_prompt" || {
  printf 'FAIL: patch goal-setting prompt did not require a change\n' >&2
  exit 1
}
KASEKI_TASK_MODE="inspect"
inspect_prompt="$(build_goal_setting_prompt)"
grep -Fq '"outcome_policy": "change_or_noop"' <<< "$inspect_prompt" || {
  printf 'FAIL: inspect goal-setting prompt did not allow a verified no-op\n' >&2
  exit 1
}

results_dir="$TMP_DIR/results"
mkdir -p "$results_dir"
cat > "$results_dir/goal-setting.json" <<'JSON'
{
  "outcome_policy": "change_required",
  "success_criteria": [
    {"criterion": "If the candidate is rejected, add a verified alternative"}
  ]
}
JSON
KASEKI_TASK_MODE="patch" node "$ROOT_DIR/dist/jev-workflow-evaluator.js" goal-check "$results_dir"
node - "$results_dir/goal-check.json" <<'NODE'
const fs = require('node:fs');
const result = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (result.retryable !== false) throw new Error('invalid goal contract must suppress coding retries');
if (result.contract_validation?.valid !== false) throw new Error('invalid contract was not recorded');
if (!result.contradictions?.length) throw new Error('contract contradiction was not retained');
if (result.classifier?.provider !== 'deterministic-contract-check') throw new Error('invalid contract should not invoke a classifier');
NODE

printf 'goal-contract-regression.test.sh PASS\n'
