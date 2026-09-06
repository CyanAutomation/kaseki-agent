#!/usr/bin/env bash
# Regression: pre-agent validation must not leak framework/config mutations.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
export KASEKI_WORKSPACE_DIR="$TMP_DIR"
export KASEKI_RESULTS_DIR="$TMP_DIR/results"

emit_event() { :; }
mkdir -p "$KASEKI_WORKSPACE_DIR/repo" "$KASEKI_RESULTS_DIR"
git -C "$KASEKI_WORKSPACE_DIR/repo" init -q
git -C "$KASEKI_WORKSPACE_DIR/repo" config user.email test@kaseki.local
git -C "$KASEKI_WORKSPACE_DIR/repo" config user.name Kaseki
printf 'original\n' > "$KASEKI_WORKSPACE_DIR/repo/tsconfig.json"
git -C "$KASEKI_WORKSPACE_DIR/repo" add tsconfig.json
git -C "$KASEKI_WORKSPACE_DIR/repo" commit -qm initial

# Extract the helpers without executing the rest of the runner.
eval "$(awk '
  /^capture_pre_validation_workspace_state\(\)/ { emit=1 }
  /^read_goal_check_json\(\)/ { emit=0 }
  emit { print }
' "$ROOT_DIR/kaseki-agent.sh")"

capture_pre_validation_workspace_state
printf 'next-generated\n' > "$KASEKI_WORKSPACE_DIR/repo/tsconfig.json"
printf 'generated\n' > "$KASEKI_WORKSPACE_DIR/repo/.next-types.d.ts"
restore_pre_validation_workspace_state

git -C "$KASEKI_WORKSPACE_DIR/repo" diff --exit-code --quiet || {
  echo 'FAIL: tracked pre-validation mutation leaked into the coding workspace' >&2; exit 1;
}
[ ! -e "$KASEKI_WORKSPACE_DIR/repo/.next-types.d.ts" ] || {
  echo 'FAIL: untracked pre-validation mutation leaked into the coding workspace' >&2; exit 1;
}
grep -Fq 'pre_validation_workspace_restored' "$KASEKI_RESULTS_DIR/restoration.jsonl"
echo 'PASS: pre-agent validation workspace isolation'
