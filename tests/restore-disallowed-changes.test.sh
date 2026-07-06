#!/usr/bin/env bash
# shellcheck disable=SC1091,SC2034
# Tests for allowlist restoration behavior in restore-disallowed-changes.sh.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

export KASEKI_WORKSPACE_DIR="$TMP_DIR"
export KASEKI_RESULTS_DIR="$TMP_DIR/results"

# Load dependencies and the sourceable helper under test.
# shellcheck source=../scripts/allowlist-helper.sh
. "$ROOT_DIR/scripts/allowlist-helper.sh"
# shellcheck source=../scripts/restore-disallowed-changes.sh
. "$ROOT_DIR/scripts/restore-disallowed-changes.sh"

pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }

emit_event() {
  printf '%s' "$1" >> "$TMP_DIR/results/events.log"
  shift
  while [ "$#" -gt 0 ]; do
    printf ' %s' "$1" >> "$TMP_DIR/results/events.log"
    shift
  done
  printf '\n' >> "$TMP_DIR/results/events.log"
}

collect_git_artifacts() {
  printf 'collect_git_artifacts\n' >> "$TMP_DIR/results/collect-git-artifacts.log"
}

append_quality_violation() {
  printf '%s %s %s %s\n' "$1" "$2" "$3" "$4" >> "$TMP_DIR/results/quality-violations.log"
}

mkdir -p "$TMP_DIR/results" "$TMP_DIR/repo"
{
  cd "$TMP_DIR/repo"
  git init --initial-branch=main -q
  git config user.email "test@kaseki.local"
  git config user.name "Test User"
  printf 'allowed original\n' > allowed.txt
  printf 'disallowed original\n' > disallowed.txt
  git add allowed.txt disallowed.txt
  git commit -q -m "initial"
  printf 'allowed modified\n' > allowed.txt
  printf 'disallowed modified\n' > disallowed.txt
  printf 'generated\n' > generated.log
}

{
  printf 'allowed.txt\n'
  printf 'disallowed.txt\n'
  printf 'generated.log\n'
} > "$TMP_DIR/results/changed-files.txt"
: > "$TMP_DIR/results/quality.log"
: > "$TMP_DIR/results/events.log"
: > "$TMP_DIR/results/quality-violations.log"
: > "$TMP_DIR/results/collect-git-artifacts.log"

KASEKI_RESTORE_DISALLOWED_CHANGES=1
KASEKI_CHANGED_FILES_ALLOWLIST='allowed.txt'

restore_disallowed_changes

if grep -Fq '[allowlist summary] Restored: 2 files; Kept: 1 files (coverage: 33%)' "$TMP_DIR/results/quality.log"; then
  pass 'restore_disallowed_changes summarizes kept/restored counts and coverage'
else
  fail 'restore_disallowed_changes did not write the expected kept/restored summary'
fi

if grep -Fq 'allowlist_restoration_complete restored=2 kept=1 coverage=33' "$TMP_DIR/results/events.log"; then
  pass 'restore_disallowed_changes emits completion event fields'
else
  fail 'restore_disallowed_changes did not emit expected completion event fields'
fi

if [ "$(grep -Fc 'quality_gate_rule_evaluated rule=allowlist_restore passed=true file=' "$TMP_DIR/results/events.log")" -eq 2 ]; then
  pass 'restore_disallowed_changes emits one allowlist_restore event per restored file'
else
  fail 'restore_disallowed_changes did not emit expected per-file restore events'
fi

if grep -Fq '"event":"file_evaluated","file":"allowed.txt","status":"kept","reason":"matched_allowlist"' "$TMP_DIR/results/restoration.jsonl" \
  && grep -Fq '"event":"file_restored","file":"disallowed.txt","status":"restored","reason":"not_in_allowlist"' "$TMP_DIR/results/restoration.jsonl" \
  && grep -Fq '"event":"file_restored","file":"generated.log","status":"restored","reason":"not_in_allowlist"' "$TMP_DIR/results/restoration.jsonl"; then
  pass 'restore_disallowed_changes records semantic restoration fields'
else
  fail 'restore_disallowed_changes did not record expected restoration.jsonl fields'
fi

if [ "$(grep -Fc 'file_outside_allowlist_restored' "$TMP_DIR/results/quality-violations.log")" -eq 2 ]; then
  pass 'restore_disallowed_changes records a quality violation for each restored file'
else
  fail 'restore_disallowed_changes did not record expected quality violations'
fi

if grep -Fxq 'collect_git_artifacts' "$TMP_DIR/results/collect-git-artifacts.log"; then
  pass 'restore_disallowed_changes collects git artifacts after restoring files'
else
  fail 'restore_disallowed_changes did not collect git artifacts after restoring files'
fi

{
  cd "$TMP_DIR/repo"
  [ "$(cat allowed.txt)" = "allowed modified" ] || fail 'allowed file should remain modified'
  [ "$(cat disallowed.txt)" = "disallowed original" ] || fail 'tracked disallowed file should be restored'
  [ ! -e generated.log ] || fail 'untracked disallowed file should be removed'
  git diff --name-only | grep -Fxq 'allowed.txt' || fail 'allowed file should be the only tracked worktree diff'
  [ "$(git diff --name-only | wc -l | tr -d ' ')" -eq 1 ] || fail 'repository should contain only the allowed tracked diff'
  [ -z "$(git ls-files --others --exclude-standard)" ] || fail 'repository should not contain untracked files after restore'
}
pass 'restore_disallowed_changes preserves allowed changes and restores disallowed worktree state'

printf '\n✅ restore_disallowed_changes tests passed\n'
