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

printf 'PASS: %s\n' "$TEST_NAME"
