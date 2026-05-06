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

DEPENDENCY_CACHE_LOG="$TMP_DIR/dependency-cache.log"
: > "$DEPENDENCY_CACHE_LOG"

mkdir -p "$TMP_DIR/cache/node_modules/pkg" "$TMP_DIR/workspace"
printf 'cached package\n' > "$TMP_DIR/cache/node_modules/pkg/index.js"

(
  cd "$TMP_DIR/workspace"
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
if ! grep -q 'hardlink restore failed; falling back to copy' "$DEPENDENCY_CACHE_LOG"; then
  fail "Expected dependency-cache.log to include hardlink fallback message"
fi
pass "hardlink restore falls back to copy when cp -al fails"

rm -rf "$TMP_DIR/workspace/node_modules" "$TMP_DIR/published"
ln -s "$TMP_DIR/cache/node_modules" "$TMP_DIR/workspace/node_modules"
publish_node_modules_cache "$TMP_DIR/workspace/node_modules" "$TMP_DIR/published"
[ -d "$TMP_DIR/published" ] || fail "Published cache path is not a directory"
[ ! -L "$TMP_DIR/published" ] || fail "Published cache path must not be a symlink"
[ -f "$TMP_DIR/published/pkg/index.js" ] || fail "Published real directory is missing package file"
pass "cache publication materializes a real directory from symlinked node_modules"
