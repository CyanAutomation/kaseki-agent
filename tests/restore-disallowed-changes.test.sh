#!/usr/bin/env bash
# Tests for allowlist restoration behavior in kaseki-agent.sh.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Load allowlist helper functions used by restore_disallowed_changes().
# shellcheck source=../scripts/allowlist-helper.sh
. "$ROOT_DIR/scripts/allowlist-helper.sh"

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
  printf 'collect_git_artifacts should not be called when restored_count=0\n' >&2
  return 1
}

# Load restore_disallowed_changes() while redirecting its container-only absolute
# paths into this test's temporary workspace.
eval "$(awk '
  /^restore_disallowed_changes\(\)/ { emit=1 }
  /^generate_restoration_report\(\)/ { emit=0 }
  emit { print }
' "$ROOT_DIR/kaseki-agent.sh" | sed "s#/workspace/repo#$TMP_DIR/repo#g; s#/results#$TMP_DIR/results#g")"

mkdir -p "$TMP_DIR/results" "$TMP_DIR/repo"
{
  cd "$TMP_DIR/repo"
  git init --initial-branch=main -q
  git config user.email "test@kaseki.local"
  git config user.name "Test User"
  printf 'original\n' > allowed.txt
  git add allowed.txt
  git commit -q -m "initial"
  printf 'modified\n' > allowed.txt
}

printf 'allowed.txt\n' > "$TMP_DIR/results/changed-files.txt"
: > "$TMP_DIR/results/quality.log"
: > "$TMP_DIR/results/events.log"

# shellcheck disable=SC2034
KASEKI_RESTORE_DISALLOWED_CHANGES=1
KASEKI_CHANGED_FILES_ALLOWLIST='allowed.txt'

restore_disallowed_changes

if grep -Fq '[allowlist summary] Restored: 0 files; Kept: 1 files (coverage: 100%)' "$TMP_DIR/results/quality.log"; then
  pass 'restore_disallowed_changes summarizes 0 restored / 1 kept with coverage under set -u'
else
  fail 'restore_disallowed_changes did not write the expected 0 restored / 1 kept summary'
fi

if grep -Fq 'allowlist_restoration_complete restored=0 kept=1 coverage=100' "$TMP_DIR/results/events.log"; then
  pass 'restore_disallowed_changes emits completion event with computed coverage'
else
  fail 'restore_disallowed_changes did not emit expected coverage event'
fi


if grep -Fxq 'COPY kaseki-agent.sh /usr/local/bin/kaseki-agent' "$ROOT_DIR/Dockerfile"; then
  pass 'Docker image installs /usr/local/bin/kaseki-agent directly from repository kaseki-agent.sh'
else
  fail 'Dockerfile must copy repository kaseki-agent.sh to /usr/local/bin/kaseki-agent'
fi

printf '\n✅ restore_disallowed_changes tests passed\n'
