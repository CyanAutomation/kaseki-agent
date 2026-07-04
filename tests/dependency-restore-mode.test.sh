#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC2034

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Source the pure key helpers and load only dependency restore/cache helper functions from kaseki-agent.sh.
# shellcheck source=/dev/null
. "$ROOT_DIR/scripts/dependency-cache-helpers.sh"

eval "$(awk '
  /^set_dependency_cache_status\(\)/ { emit=1 }
  /^npm_run_script_name\(\)/ { emit=0 }
  emit { print }
' "$ROOT_DIR/kaseki-agent.sh")"

fail() { printf '✗ %s\n' "$1" >&2; exit 1; }
pass() { printf '✓ %s\n' "$1"; }
emit_event() { :; }

DEPENDENCY_CACHE_LOG="$TMP_DIR/dependency-cache.log"
: > "$DEPENDENCY_CACHE_LOG"
export KASEKI_DEPENDENCY_CACHE_PRUNE=1
export KASEKI_DEPENDENCY_CACHE_MAX_BYTES=1024
export KASEKI_DEPENDENCY_CACHE_MAX_AGE_DAYS=30


# Documentation-driven dependency cache strategy contract: docs/DEPLOYMENT.md
# describes dependency cache keys as deterministic from dependency inputs. Keep
# branch/ref names out of helper-generated keys so feature branches sharing the
# same lockfile, Node major version, and install flags can reuse cache entries.
cat > "$TMP_DIR/package-lock.json" <<'LOCK'
{"lockfileVersion":3,"packages":{}}
LOCK

lock_hash="$(sha256sum "$TMP_DIR/package-lock.json" | awk '{print $1}')"
node_major="24"

KASEKI_NPM_OMIT_DEV=0
KASEKI_INSTALL_IGNORE_SCRIPTS=1
flags_hash="$(dependency_cache_flags_hash)"

REPO_URL="https://example.com/project.git" GIT_REF="feature-a"
key_a="$(dependency_cache_key "$lock_hash" "$node_major" "$flags_hash")"
REPO_URL="https://example.com/project.git" GIT_REF="feature-b"
key_b="$(dependency_cache_key "$lock_hash" "$node_major" "$flags_hash")"

[ "$key_a" = "$key_b" ] || fail "Dependency cache key must be stable across Git refs when dependency inputs are unchanged"
if printf '%s\n' "$key_a" | grep -Fq "feature-"; then
  fail "Dependency cache key must not embed branch/ref names such as feature-*: $key_a"
fi

KASEKI_NPM_OMIT_DEV=1
omit_dev_flags_hash="$(dependency_cache_flags_hash)"
omit_dev_key="$(dependency_cache_key "$lock_hash" "$node_major" "$omit_dev_flags_hash")"
[ "$key_a" != "$omit_dev_key" ] || fail "Dependency cache install flags hash must produce a distinct key"
pass "dependency cache strategy/spec key contract ignores Git refs and varies by install flags"

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

if grep -q 'workspace cache failed npm ls validation; reinstalling' "$DEPENDENCY_CACHE_LOG"; then
  fail "validated workspace cache should not be discarded by redundant npm ls validation"
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
printf '4096\n' > "$TMP_DIR/prune-cache/npm/lock-old/node-24/flags-a/.entry-size-bytes"
printf '4096\n' > "$TMP_DIR/prune-cache/npm/lock-new/node-24/flags-b/.entry-size-bytes"
touch -t 202501010000 "$TMP_DIR/prune-cache/npm/lock-old/node-24/flags-a"
metrics_file="$TMP_DIR/prune-cache/.kaseki-cache-metrics"
prune_dependency_cache "$TMP_DIR/prune-cache" 5000 0 "$metrics_file"
[ ! -d "$TMP_DIR/prune-cache/npm/lock-old/node-24/flags-a" ] || fail "Oldest dependency cache entry was not pruned"
[ -f "$metrics_file" ] || fail "Dependency cache metrics file was not written"
grep -q '^size_bytes=' "$metrics_file" || fail "Dependency cache metrics missing size_bytes"
grep -q '^entry_count=1$' "$metrics_file" || fail "Dependency cache metrics missing pruned entry_count"
pass "dependency cache pruning removes oldest entries and writes metrics"

du() { fail "dependency_cache_size_bytes must not recursively scan the shared cache"; }
[ "$(dependency_cache_size_bytes "$TMP_DIR/prune-cache")" = "4096" ] || fail "metadata-based cache size was incorrect"
unset -f du
pass "dependency cache size accounting avoids synchronous whole-cache scans"

invalid_root="$TMP_DIR/invalid-cache"
mkdir -p "$invalid_root/node_modules/pkg"
touch "$invalid_root/stamp.txt" "$invalid_root/repo-ref-metadata.tsv"
invalidate_workspace_dependency_cache \
  "$invalid_root/node_modules" \
  "$invalid_root/stamp.txt" \
  "$invalid_root/repo-ref-metadata.tsv"
[ ! -e "$invalid_root/node_modules" ] || fail "invalid node_modules cache was not removed"
[ ! -e "$invalid_root/stamp.txt" ] || fail "invalid cache stamp was not removed"
[ ! -e "$invalid_root/repo-ref-metadata.tsv" ] || fail "invalid cache metadata was not removed"
pass "failed cache validation invalidates the workspace cache entry immediately"

legacy_entry="$TMP_DIR/prune-cache/npm/lock-legacy/node-24/flags-c"
mkdir -p "$legacy_entry/node_modules/pkg"
prune_dependency_cache "$TMP_DIR/prune-cache" 5000 0 "$metrics_file"
[ ! -e "$legacy_entry" ] || fail "unmetered legacy cache entry was not removed"
pass "cache pruning retires legacy entries without recursively scanning them"
