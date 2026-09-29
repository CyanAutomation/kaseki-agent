#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT_DIR/scripts/lib/phase-budget.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_budget() {
  local phase="$1" context="$2" turns="$3" tool_output="$4" output="$5"
  configure_phase_budget "$phase"
  [[ "$KASEKI_PHASE_MAX_CONTEXT_TOKENS" == "$context" ]] || fail "$phase context target: $KASEKI_PHASE_MAX_CONTEXT_TOKENS != $context"
  [[ "$KASEKI_PHASE_MAX_TURNS" == "$turns" ]] || fail "$phase turn target: $KASEKI_PHASE_MAX_TURNS != $turns"
  [[ "$KASEKI_PHASE_MAX_TOOL_OUTPUT_TOKENS" == "$tool_output" ]] || fail "$phase tool-output target: $KASEKI_PHASE_MAX_TOOL_OUTPUT_TOKENS != $tool_output"
  [[ "$KASEKI_PHASE_OUTPUT_TOKEN_TARGET" == "$output" ]] || fail "$phase output target: $KASEKI_PHASE_OUTPUT_TOKEN_TARGET != $output"
  [[ "$KASEKI_PHASE_BUDGET_ENFORCEMENT" == "soft_target" ]] || fail "$phase enforcement must remain soft"
}

unset KASEKI_PHASE_MAX_TOOL_OUTPUT_TOKENS KASEKI_PHASE_MAX_CONTEXT_TOKENS KASEKI_PHASE_MAX_TURNS
unset KASEKI_PHASE_MAX_TOOL_OUTPUT_TOKENS_OVERRIDE
assert_budget scouting 20000 6 4000 2048
assert_budget goal-setting 18000 6 4000 2048
assert_budget goal-check 24000 6 3000 1536
assert_budget run-evaluation 24000 6 3000 1536
assert_budget coding 32000 36 8000 4096

KASEKI_CODING_MAX_CONTEXT_TOKENS=36000 KASEKI_CODING_MAX_TURNS=40 KASEKI_CODING_MAX_TOOL_OUTPUT_TOKENS=9000 KASEKI_CODING_OUTPUT_TOKEN_TARGET=12000
export KASEKI_CODING_MAX_CONTEXT_TOKENS KASEKI_CODING_MAX_TURNS KASEKI_CODING_MAX_TOOL_OUTPUT_TOKENS KASEKI_CODING_OUTPUT_TOKEN_TARGET
assert_budget coding 36000 40 9000 12000

KASEKI_PHASE_MAX_TOOL_OUTPUT_TOKENS_OVERRIDE=12000
export KASEKI_PHASE_MAX_TOOL_OUTPUT_TOKENS_OVERRIDE
assert_budget goal-check 24000 6 12000 1536

echo "✓ Phase budget targets vary by phase, remain advisory, and accept overrides"
