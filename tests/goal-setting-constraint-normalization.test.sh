#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

KASEKI_RESULTS_DIR="$TMP_DIR/results"
KASEKI_SCRIPT_DIR="$ROOT_DIR"
export KASEKI_SCRIPT_DIR
mkdir -p "$KASEKI_RESULTS_DIR"

# Extract only the production validator so this regression test exercises the
# same contract used by the worker without starting a full agent run.
eval "$(awk '
  /^validate_goal_setting_artifact_with_node\(\)/ { emit=1 }
  /^create_fallback_goal_setting_artifact\(\)/ { emit=0 }
  emit { print }
' "$ROOT_DIR/kaseki-agent.sh")"

candidate="$TMP_DIR/goal-setting-candidate.json"
cat > "$candidate" <<'JSON'
{
  "original_prompt": "Fix the parser",
  "upgraded_goal": "Fix the parser and preserve behavior",
  "outcome_policy": "change_required",
  "key_requirements": ["Keep behavior stable"],
  "success_criteria": [{"criterion":"Parser tests pass","smart_score":"high"}],
  "anti_patterns": {"do_not_break":["Existing API contracts"]},
  "constraints": {
    "operational": "Change only the parser",
    "technical": ["Must pass tests"]
  },
  "reasoning": "The parser needs a bounded fix",
  "confidence": "high"
}
JSON

reason_file="$TMP_DIR/reason.txt"
validate_goal_setting_artifact_with_node "$candidate" "$reason_file"

node - "$candidate" "$KASEKI_RESULTS_DIR/goal-setting-validation-notes.txt" <<'NODE'
const artifact = require(process.argv[2]);
if (!Array.isArray(artifact.constraints.operational)) throw new Error('operational constraint was not normalized');
if (artifact.constraints.operational[0] !== 'Change only the parser') throw new Error('normalized value changed');
if (!require('node:fs').readFileSync(process.argv[3], 'utf8').includes('normalized_constraint_category')) throw new Error('normalization warning missing');
NODE

echo '✓ goal-setting string constraints are normalized and recorded'
