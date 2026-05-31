#!/usr/bin/env bash
# shellcheck disable=SC1091,SC2034
# Tests cleanup-phase allowlist enforcement for cleanup-created files.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# shellcheck source=../scripts/allowlist-helper.sh
. "$ROOT_DIR/scripts/allowlist-helper.sh"

pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }

merge_allowlists() {
  local scouting_patterns user_patterns
  scouting_patterns="${1:-}"
  user_patterns="${2:-}"
  if [ -n "$scouting_patterns" ] && [ -n "$user_patterns" ]; then
    printf '%s %s' "$scouting_patterns" "$user_patterns"
  elif [ -n "$scouting_patterns" ]; then
    printf '%s' "$scouting_patterns"
  else
    printf '%s' "$user_patterns"
  fi
}

emit_event() {
  printf '%s' "$1" >> "$TMP_DIR/results/events.log"
  shift
  while [ "$#" -gt 0 ]; do
    printf ' %s' "$1" >> "$TMP_DIR/results/events.log"
    shift
  done
  printf '\n' >> "$TMP_DIR/results/events.log"
}

emit_error_event() { emit_event "$@"; }
collect_git_artifacts() { printf 'collect_git_artifacts\n' >> "$TMP_DIR/results/events.log"; }
test_check_allowlist_rejects_disallowed() {
    source "$KASEKI_AGENT"

    export KASEKI_CHANGED_FILES_ALLOWLIST="src/** tests/**"
    local cleanup_files="build/generated.txt
docs/extra.md"

    # Should FAIL (return 1) because files are outside allowlist
    if check_auto_lint_cleanup_allowlist "$cleanup_files"; then
        echo "FAIL: check_auto_lint_cleanup_allowlist should reject disallowed files"
        return 1
    fi
    echo "PASS: check_auto_lint_cleanup_allowlist correctly rejects disallowed files"
}
: > "$TMP_DIR/results/quality.log"
: > "$TMP_DIR/results/auto-lint-cleanup.log"
AUTO_LINT_CLEANUP_LOG="$TMP_DIR/results/auto-lint-cleanup.log"

cd "$TMP_DIR/repo"
git init --initial-branch=main -q
git config user.email "test@kaseki.local"
git config user.name "Test User"
printf 'original\n' > allowed.txt
git add allowed.txt
git commit -q -m initial

# Disallowed cleanup-created files fail the cleanup allowlist check when
# restoration is disabled.
QUALITY_EXIT=0
AUTO_LINT_CLEANUP_EXIT=0
QUALITY_FAILURE_REASON=""
KASEKI_CHANGED_FILES_ALLOWLIST='src/**'
KASEKI_VALIDATION_ALLOWLIST=''
KASEKI_RESTORE_DISALLOWED_CHANGES=0
collect_changed_file_set "$TMP_DIR/results/before.txt"
printf 'generated\n' > generated.log
collect_changed_file_set "$TMP_DIR/results/after.txt"

if check_auto_lint_cleanup_allowlist "$TMP_DIR/results/before.txt" "$TMP_DIR/results/after.txt"; then
  fail 'cleanup allowlist should fail for a cleanup-created file outside the allowlist'
fi
[ "$QUALITY_EXIT" -eq 7 ] || fail "expected QUALITY_EXIT=7, got $QUALITY_EXIT"
case "$QUALITY_FAILURE_REASON" in
  auto_lint_cleanup_allowlist:*) pass 'cleanup allowlist failure uses the expected quality failure reason' ;;
  *) fail "unexpected QUALITY_FAILURE_REASON: $QUALITY_FAILURE_REASON" ;;
esac
[ -f generated.log ] || fail 'disallowed file should remain when restoration is disabled'

# The same disallowed cleanup-created file is restored and does not fail the
# stage when restoration is enabled.
git clean -f -q -- generated.log
QUALITY_EXIT=0
AUTO_LINT_CLEANUP_EXIT=0
QUALITY_FAILURE_REASON=""
KASEKI_RESTORE_DISALLOWED_CHANGES=1
collect_changed_file_set "$TMP_DIR/results/before-restore.txt"
printf 'generated\n' > generated.log
collect_changed_file_set "$TMP_DIR/results/after-restore.txt"

if ! check_auto_lint_cleanup_allowlist "$TMP_DIR/results/before-restore.txt" "$TMP_DIR/results/after-restore.txt"; then
  fail 'cleanup allowlist should pass after restoring a disallowed cleanup-created file'
fi
[ "$QUALITY_EXIT" -eq 0 ] || fail "expected QUALITY_EXIT=0 after restore, got $QUALITY_EXIT"
[ ! -e generated.log ] || fail 'disallowed cleanup-created file should be removed by restoration'
if grep -Fq 'auto_lint_cleanup_allowlist_restoration_complete restored=1 unrestored=0' "$TMP_DIR/results/events.log"; then
  pass 'cleanup allowlist restoration emits a completion event'
else
  fail 'cleanup allowlist restoration did not emit the expected completion event'
fi

# Validation-specific generated files are accepted through KASEKI_VALIDATION_ALLOWLIST.
QUALITY_EXIT=0
AUTO_LINT_CLEANUP_EXIT=0
QUALITY_FAILURE_REASON=""
KASEKI_RESTORE_DISALLOWED_CHANGES=0
KASEKI_VALIDATION_ALLOWLIST='generated.log'
collect_changed_file_set "$TMP_DIR/results/before-validation-allowlist.txt"
printf 'generated\n' > generated.log
collect_changed_file_set "$TMP_DIR/results/after-validation-allowlist.txt"

if check_auto_lint_cleanup_allowlist "$TMP_DIR/results/before-validation-allowlist.txt" "$TMP_DIR/results/after-validation-allowlist.txt"; then
  pass 'cleanup allowlist accepts files covered by KASEKI_VALIDATION_ALLOWLIST'
else
  fail 'cleanup allowlist should accept validation-allowlisted generated files'
fi
[ "$QUALITY_EXIT" -eq 0 ] || fail "expected QUALITY_EXIT=0 for validation allowlist, got $QUALITY_EXIT"

printf '\n✅ auto-lint cleanup allowlist tests passed\n'
