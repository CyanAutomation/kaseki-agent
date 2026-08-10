#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cat >"$TMP/goal-setting.json" <<'JSON'
{"objective":"Add stable handoff","criteria":["Add stable handoff","Run focused tests"]}
JSON
cat >"$TMP/scouting.json" <<'JSON'
{"requirements":["Add stable handoff","Add stable handoff"],"relevant_files":[{"path":"a.sh","reason":"contains prompt"}]}
JSON
printf 'a.sh\na.sh\n' >"$TMP/changed-files.txt"
printf 'command\tduration\texit_code\nunit test\t1\t0\nunit test\t1\t0\n' >"$TMP/validation-timings.tsv"
TASK_PROMPT_VALUE=$'Add stable handoff\nAdd stable handoff' RETRY_FEEDBACK_VALUE=$'Fix retry delta\nFix retry delta' \
  node "$ROOT/scripts/context-handoff.js" "$TMP" coding 'Evaluate only the remaining delta.'
node - "$TMP/context-handoff.json" <<'NODE'
const h=require(process.argv[2]);
const count=(a,s)=>a.filter(x=>x===s).length;
if(count(h.requirements,'Add stable handoff')!==1) throw Error('requirement was duplicated');
if(count(h.requirements,'Fix retry delta')!==1) throw Error('retry delta was duplicated');
if(h.changed_files.length!==1 || h.validation_outcomes.length!==1) throw Error('progress evidence was duplicated');
if(JSON.stringify(h).includes('complete prior context')) throw Error('retry serialized prior context');
NODE
printf '{"stage":"coding","message":"started"}\n{"stage":"coding","message":"started"}\n{"stage":"coding","message":"finished"}\n' >"$TMP/progress.jsonl"
export KASEKI_RESULTS_DIR="$TMP" TASK_PROMPT='Add stable handoff' GOAL_SETTING_ARTIFACT="$TMP/goal-setting.json" SCOUTING_ARTIFACT="$TMP/scouting.json" TEST_IMPACT_WARNINGS_ARTIFACT="$TMP/no-warnings" KASEKI_CAVEMAN_LEVEL=1
get_caveman_instruction(){ :; }
source "$ROOT/scripts/evaluation-prompts.sh"
construct_context_handoff(){ TASK_PROMPT_VALUE="$TASK_PROMPT" node "$ROOT/scripts/context-handoff.js" "$TMP" "$1" "$2"; }
snapshot="$(build_goal_check_prompt)"
[[ "$snapshot" != *'last 80 lines'* ]]
[[ "$(grep -o 'coding: started' <<<"$snapshot" | wc -l)" -eq 1 ]]
[[ "$snapshot" == *'context-handoff.json (read first)'* ]]
echo 'context handoff prompt snapshots passed'
