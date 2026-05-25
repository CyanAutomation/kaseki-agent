#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Load only dependency restore/cache helper functions from kaseki-agent.sh.
eval "$(awk '
  /^set_dependency_cache_status\(\)/ { emit=1 }
  /^dependency_cache_flags_identity\(\)/ { emit=0 }
  emit { print }
' "$ROOT_DIR/kaseki-agent.sh")"

fail() { printf '✗ %s\n' "$1" >&2; exit 1; }
pass() { printf '✓ %s\n' "$1"; }
emit_event() { :; }

DEPENDENCY_CACHE_LOG="$TMP_DIR/dependency-cache.log"
: > "$DEPENDENCY_CACHE_LOG"
KASEKI_DEPENDENCY_CACHE_PRUNE=1
KASEKI_DEPENDENCY_CACHE_MAX_BYTES=1024
KASEKI_DEPENDENCY_CACHE_MAX_AGE_DAYS=30

mkdir -p "$TMP_DIR/cache/node_modules/pkg" "$TMP_DIR/workspace"
printf 'cached package\n' > "$TMP_DIR/cache/node_modules/pkg/index.js"

(
  cd "$TMP_DIR/workspace"
  # shellcheck disable=SC2317
  cp() {
    if [ "${1:-}" = "-al" ]; then
      return 1
    fi
    command cp "$@"
  }
  restore_node_modules_from_cache "$TMP_DIR/cache/node_modules" ./node_modules hardlink
  [ "${DEPENDENCY_RESTORE_METHOD:-}" = "hardlink_fallback_copy" ] || fail "Expected hardlink fallback method, got ${DEPENDENCY_RESTORE_METHOD:-unset}"
)

[ -f "$TMP_DIR/workspace/node_modules/pkg/index.js" ] || fail "Fallback copy did not restore package file"
if ! grep -q 'hardlink restore fallback to copy (reason=hardlink_failed)' "$DEPENDENCY_CACHE_LOG"; then
  fail "Expected dependency-cache.log to include normalized hardlink fallback message"
fi
pass "hardlink restore falls back to copy when cp -al fails"

rm -rf "$TMP_DIR/workspace/node_modules"
: > "$DEPENDENCY_CACHE_LOG"
(
  cd "$TMP_DIR/workspace"
  # shellcheck disable=SC2317
  cp() {
    if [ "${1:-}" = "-al" ]; then
      printf 'cp: cannot create hard link %q to %q: Invalid cross-device link\n' "$3" "$2" >&2
      return 1
    fi
    command cp "$@"
  }
  restore_node_modules_from_cache "$TMP_DIR/cache/node_modules" ./node_modules hardlink
  [ "${DEPENDENCY_RESTORE_METHOD:-}" = "hardlink_fallback_copy" ] || fail "Expected hardlink fallback method, got ${DEPENDENCY_RESTORE_METHOD:-unset}"
)

[ -f "$TMP_DIR/workspace/node_modules/pkg/index.js" ] || fail "EXDEV fallback copy did not restore package file"
if grep -q 'cp: cannot create hard link .*Invalid cross-device link' "$DEPENDENCY_CACHE_LOG"; then
  fail "Expected dependency-cache.log to suppress raw cp EXDEV stderr"
fi
if ! grep -q 'hardlink restore fallback to copy (reason=hardlink_cross_device)' "$DEPENDENCY_CACHE_LOG"; then
  fail "Expected dependency-cache.log to include normalized hardlink fallback reason"
fi
pass "hardlink EXDEV stderr uses normalized fallback logging without raw cp noise"

rm -rf "$TMP_DIR/workspace/node_modules" "$TMP_DIR/published"
ln -s "$TMP_DIR/cache/node_modules" "$TMP_DIR/workspace/node_modules"
publish_node_modules_cache "$TMP_DIR/workspace/node_modules" "$TMP_DIR/published"
[ -d "$TMP_DIR/published" ] || fail "Published cache path is not a directory"
[ ! -L "$TMP_DIR/published" ] || fail "Published cache path must not be a symlink"
[ -f "$TMP_DIR/published/pkg/index.js" ] || fail "Published real directory is missing package file"
pass "cache publication materializes a real directory from symlinked node_modules"

rm -rf "$TMP_DIR/prune-cache"
mkdir -p \
  "$TMP_DIR/prune-cache/npm/lock-old/node-24/flags-a/node_modules/pkg" \
  "$TMP_DIR/prune-cache/npm/lock-new/node-24/flags-b/node_modules/pkg"
printf '%2048s\n' x > "$TMP_DIR/prune-cache/npm/lock-old/node-24/flags-a/node_modules/pkg/blob.txt"
printf '%2048s\n' y > "$TMP_DIR/prune-cache/npm/lock-new/node-24/flags-b/node_modules/pkg/blob.txt"
touch -t 202501010000 "$TMP_DIR/prune-cache/npm/lock-old/node-24/flags-a"
metrics_file="$TMP_DIR/prune-cache/.kaseki-cache-metrics"
prune_dependency_cache "$TMP_DIR/prune-cache" 5000 0 "$metrics_file"
[ ! -d "$TMP_DIR/prune-cache/npm/lock-old/node-24/flags-a" ] || fail "Oldest dependency cache entry was not pruned"
[ -f "$metrics_file" ] || fail "Dependency cache metrics file was not written"
grep -q '^size_bytes=' "$metrics_file" || fail "Dependency cache metrics missing size_bytes"
grep -q '^entry_count=1$' "$metrics_file" || fail "Dependency cache metrics missing pruned entry_count"
pass "dependency cache pruning removes oldest entries and writes metrics"
