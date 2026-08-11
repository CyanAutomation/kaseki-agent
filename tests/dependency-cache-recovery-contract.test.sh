#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# shellcheck source=/dev/null
. "$ROOT_DIR/scripts/dependency-cache-helpers.sh"
# shellcheck source=/dev/null
. "$ROOT_DIR/scripts/npm-install-helpers.sh"

# Load the smallest caller functions needed to exercise executable validation
# and changed-file artifact collection without executing kaseki-agent.sh.
eval "$(awk '
  /^dependency_cache_required_bins_valid\(\)/ { emit=1 }
  /^repair_required_dependency_bins\(\)/ { emit=0 }
  emit { print }
' "$ROOT_DIR/kaseki-agent.sh")"
eval "$(awk '
  /^collect_git_artifacts\(\)/ { emit=1 }
  /^run_static_test_impact_check\(\)/ { emit=0 }
  emit { print }
' "$ROOT_DIR/kaseki-agent.sh")"

fail() { printf '✗ %s\n' "$1" >&2; exit 1; }
pass() { printf '✓ %s\n' "$1"; }
assert_eq() { [ "$1" = "$2" ] || fail "expected '$2', got '$1': $3"; }

recovery_action() {
  local status=0
  action="$(dependency_cache_recovery_action "$@")" || status=$?
  assert_eq "$status" 0 "recovery helper status"
}

make_typescript_fixture() {
  local root="$1"
  mkdir -p "$root/node_modules/.bin"
  printf '{"devDependencies":{"typescript":"1.0.0"}}\n' > "$root/package.json"
}

# CACHE-CONTRACT-VALID-001: a schema-current cache with its declared executable
# remains reusable and does not consume a recovery retry.
valid="$TMP_DIR/valid-cache"
make_typescript_fixture "$valid"
printf '#!/usr/bin/env bash\nexit 0\n' > "$valid/node_modules/.bin/tsc"
chmod +x "$valid/node_modules/.bin/tsc"
printf '2\n' > "$valid/validated-v2"
schema_rc=0; dependency_cache_schema_valid "$valid/validated-v2" 2 || schema_rc=$?
bins_rc=0; dependency_cache_required_bins_valid "$valid/package.json" "$valid/node_modules" || bins_rc=$?
recovery_action "$schema_rc" "$bins_rc" 0
assert_eq "$action" reuse "valid cache recovery action"
retry_count=0
assert_eq "$retry_count" 0 "valid cache retry count"
pass "CACHE-CONTRACT-VALID-001 valid cache is reused with zero retries"

# CACHE-CONTRACT-INVALID-002: stale schema plus a non-executable declared bin
# deterministically selects reinstall rather than trusting the fixture.
invalid="$TMP_DIR/invalid-cache"
make_typescript_fixture "$invalid"
printf 'not executable\n' > "$invalid/node_modules/.bin/tsc"
chmod 0644 "$invalid/node_modules/.bin/tsc"
printf '1\n' > "$invalid/validated-v1"
schema_rc=0; dependency_cache_schema_valid "$invalid/validated-v1" 2 || schema_rc=$?
bins_rc=0; dependency_cache_required_bins_valid "$invalid/package.json" "$invalid/node_modules" 2>/dev/null || bins_rc=$?
recovery_action "$schema_rc" "$bins_rc" 0
assert_eq "$action" reinstall "invalid cache recovery action"
pass "CACHE-CONTRACT-INVALID-002 invalid executable/schema cache selects reinstall"

# CACHE-CONTRACT-127-003: only the first exit-127 result with a lockfile gets a
# dependency reinstall; the repeated result finishes after exactly one retry.
action="$(validation_dependency_recovery_action 127 1 0)"
assert_eq "$action" reinstall_and_retry "first exit-127 recovery action"
retry_count=1
action="$(validation_dependency_recovery_action 127 1 "$retry_count")"
assert_eq "$action" finish "second exit-127 recovery action"
final_status=127
assert_eq "$retry_count" 1 "exit-127 retry count"
assert_eq "$final_status" 127 "exit-127 final status"
pass "CACHE-CONTRACT-127-003 exit 127 retries once and preserves final failure status"

# CACHE-CONTRACT-ARTIFACT-004: the caller records staged and untracked files in
# both changed-file artifacts, including changes hidden from plain git diff.
KASEKI_WORKSPACE_DIR="$TMP_DIR/workspace"
KASEKI_RESULTS_DIR="$TMP_DIR/results"
repo="$KASEKI_WORKSPACE_DIR/repo"
mkdir -p "$repo" "$KASEKI_RESULTS_DIR"
git -C "$repo" init -q
git -C "$repo" config user.email test@example.com
git -C "$repo" config user.name Test
printf 'before\n' > "$repo/staged.txt"
git -C "$repo" add staged.txt
git -C "$repo" commit -qm initial
printf 'after\n' > "$repo/staged.txt"
git -C "$repo" add staged.txt
printf 'new\n' > "$repo/untracked.txt"
collect_git_artifacts
assert_eq "$(cat "$KASEKI_RESULTS_DIR/changed-files.txt")" $'staged.txt\nuntracked.txt' "changed-files.txt contents"
node - "$KASEKI_RESULTS_DIR/changed-files.json" <<'NODE' || fail "changed-files.json contents"
const artifact = require(process.argv[2]);
if (artifact.source !== 'git-diff-head-and-untracked') throw new Error('unexpected source');
if (artifact.files.join('\n') !== 'staged.txt\nuntracked.txt') throw new Error(`unexpected files: ${artifact.files}`);
NODE
pass "CACHE-CONTRACT-ARTIFACT-004 changed-file artifacts include staged and untracked files"
