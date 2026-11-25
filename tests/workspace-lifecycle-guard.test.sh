#!/usr/bin/env bash
set -euo pipefail

TEST_NAME="workspace lifecycle guard"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  printf 'FAIL: %s: %s\n' "$TEST_NAME" "$*" >&2
  exit 1
}

# Extract only the clone lifecycle helpers. The active-session guard runs
# before any git command, so this tests the production behavior without a
# network clone or a full worker fixture.
HELPERS="$TMP_DIR/helpers.sh"
awk '/^run_direct_clone\(\)/,/^clone_with_git_cache\(\)/ { if (!/^clone_with_git_cache\(\)/) print }' "$REPO_ROOT/kaseki-agent.sh" > "$HELPERS"
[ -s "$HELPERS" ] || fail "could not extract clone lifecycle helpers"

EVENTS="$TMP_DIR/events.log"
emit_error_event() { printf '%s\n' "$*" >> "$EVENTS"; }

KASEKI_WORKSPACE_DIR="$TMP_DIR/workspace"
KASEKI_REPO_DIR="$KASEKI_WORKSPACE_DIR/repo"
KASEKI_REPO_SESSION_MARKER="$KASEKI_WORKSPACE_DIR/.kaseki-repo-session"
KASEKI_REPO_STAGING_DIR=""
KASEKI_REPO_SESSION_ACTIVE=0
INSTANCE_NAME="guard-test"
mkdir -p "$KASEKI_REPO_DIR"
printf 'must-survive\n' > "$KASEKI_REPO_DIR/sentinel"

# shellcheck source=/dev/null
. "$HELPERS"

printf '%s\n' "$$" > "$KASEKI_REPO_SESSION_MARKER"
if prepare_repo_staging; then
  fail "allowed replacement of a repository owned by a live process"
fi
[ -f "$KASEKI_REPO_DIR/sentinel" ] || fail "active repository was modified"
grep -q 'workspace_replacement_blocked' "$EVENTS" || fail "missing replacement-blocked diagnostic"

rm -f "$KASEKI_REPO_SESSION_MARKER"
KASEKI_REPO_SESSION_ACTIVE=1
if prepare_repo_staging; then
  fail "allowed replacement after this worker entered its repository session"
fi
[ -f "$KASEKI_REPO_DIR/sentinel" ] || fail "session repository was modified"

SOURCE_REPO="$TMP_DIR/source"
ORIGIN="$TMP_DIR/origin.git"
PINNED_WORKSPACE="$TMP_DIR/pinned-workspace"
git init --bare -q "$ORIGIN"
git init -q "$SOURCE_REPO"
git -C "$SOURCE_REPO" config user.name "Kaseki Test"
git -C "$SOURCE_REPO" config user.email "kaseki-test@example.invalid"
printf 'base\n' > "$SOURCE_REPO/file.txt"
git -C "$SOURCE_REPO" add file.txt
git -C "$SOURCE_REPO" commit -qm "base"
BASE_SHA="$(git -C "$SOURCE_REPO" rev-parse HEAD)"
git -C "$SOURCE_REPO" branch -M main
git -C "$SOURCE_REPO" remote add origin "$ORIGIN"
git -C "$SOURCE_REPO" push -q origin main
printf 'new tip\n' > "$SOURCE_REPO/file.txt"
git -C "$SOURCE_REPO" commit -qam "new tip"
git -C "$SOURCE_REPO" push -q origin main

KASEKI_REPO_DIR="$PINNED_WORKSPACE/repo"
KASEKI_REPO_SESSION_MARKER="$PINNED_WORKSPACE/.kaseki-repo-session"
KASEKI_REPO_SESSION_ACTIVE=0
KASEKI_REPO_STAGING_DIR=""
KASEKI_BASE_SHA="$BASE_SHA"
REPO_URL="$ORIGIN"
GIT_REF="main"
prepare_repo_staging || fail "could not prepare the pinned workspace"
run_direct_clone || fail "could not clone the current branch tip"
promote_staged_repository || fail "could not promote the clone at the pinned base"
ACTUAL_SHA="$(git -C "$KASEKI_REPO_DIR" rev-parse HEAD)"
[ "$ACTUAL_SHA" = "$BASE_SHA" ] || fail "workspace was not checked out at KASEKI_BASE_SHA"

printf 'PASS: %s\n' "$TEST_NAME"
