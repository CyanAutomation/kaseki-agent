#!/usr/bin/env bash
# Regression test: pipeline-free scouting allowlist parsing survives pipefail with large multi-line output.

set -euo pipefail

TEST_NAME="scouting allowlist pipefail parser"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
RUN_LOG="$TMP_DIR/run.log"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "FAIL: $TEST_NAME: $*" >&2
  [ ! -f "$RUN_LOG" ] || cat "$RUN_LOG" >&2
  exit 1
}

SCOUTING_ARTIFACT="$TMP_DIR/scouting.json"
printf '%s\n' '{}' > "$SCOUTING_ARTIFACT"

{
  sed -n '/^derive_allowlist_from_scouting() {/,/^validate_allowlist_patterns() {/p' "$REPO_ROOT/kaseki-agent.sh" | sed '$d'
  sed -n '/^validate_allowlist_patterns() {/,/^merge_allowlists() {/p' "$REPO_ROOT/kaseki-agent.sh" | sed '$d'
  sed -n '/^merge_allowlists() {/,/^run_scouting_allowlist_coverage() {/p' "$REPO_ROOT/kaseki-agent.sh" | sed '$d'
  cat <<'HARNESS'
set -euo pipefail
build_allowlist_regex() { printf '%s' "${1:-}"; }
derive_allowlist_from_scouting() {
  printf 'package.json\n'
  python3 -c "print('ignored/' * 200000)"
  printf 'package-lock.json'
}
set_current_stage() { printf 'stage=%s\n' "$1"; }
emit_progress() { printf 'progress=%s %s\n' "$1" "$2"; }
append_jsonl_object() { :; }
run_scouting_allowlist_coverage() { :; }

printf '==> derive allowlist from scouting\n'
set_current_stage "derive allowlist from scouting"
emit_progress "derive allowlist from scouting" "started"
scouting_agent_patterns=""
scouting_validation_patterns=""
allowlist_merge_status="skipped"
if scouting_output="$(derive_allowlist_from_scouting "$SCOUTING_ARTIFACT" 2>&1)"; then
  split_scouting_allowlist_output "$scouting_output"
  validate_allowlist_patterns "$scouting_agent_patterns"
  validate_allowlist_patterns "$scouting_validation_patterns"
  user_agent_patterns=""
  user_validation_patterns=""
  merged_agent_allowlist="$(merge_allowlists "$scouting_agent_patterns" "$user_agent_patterns")"
  merged_validation_allowlist="$(merge_allowlists "$scouting_validation_patterns" "$user_validation_patterns")"
  export KASEKI_CHANGED_FILES_ALLOWLIST="$merged_agent_allowlist"
  export KASEKI_VALIDATION_ALLOWLIST="$merged_validation_allowlist"
  allowlist_merge_status="merged"
  emit_progress "derive allowlist from scouting" "finished (status=$allowlist_merge_status)"
fi
printf 'after derive stage\n'
printf 'agent=%s\nvalidation=%s\n' "$KASEKI_CHANGED_FILES_ALLOWLIST" "$KASEKI_VALIDATION_ALLOWLIST"
HARNESS
} > "$TMP_DIR/harness.sh"

SCOUTING_ARTIFACT="$SCOUTING_ARTIFACT" bash "$TMP_DIR/harness.sh" > "$RUN_LOG" 2>&1 || fail "harness failed under pipefail"

grep -q 'after derive stage' "$RUN_LOG" || fail "script did not proceed past derive allowlist from scouting"
grep -q '^agent=package.json$' "$RUN_LOG" || fail "first derived allowlist line was not selected"
grep -q '^validation=package-lock.json$' "$RUN_LOG" || fail "last derived allowlist line was not selected"

echo "PASS: $TEST_NAME"
