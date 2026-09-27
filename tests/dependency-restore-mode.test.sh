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

arm64_key="$(dependency_cache_key "$lock_hash" "$node_major" "$flags_hash" linux arm64 131)"
amd64_key="$(dependency_cache_key "$lock_hash" "$node_major" "$flags_hash" linux x64 131)"
different_abi_key="$(dependency_cache_key "$lock_hash" "$node_major" "$flags_hash" linux arm64 127)"
[ "$arm64_key" != "$amd64_key" ] || fail "Dependency cache keys must isolate native packages by OS/architecture"
[ "$arm64_key" != "$different_abi_key" ] || fail "Dependency cache keys must isolate native packages by Node module ABI"
case "$arm64_key" in
  *"platform-linux/arch-arm64/abi-131"*) ;;
  *) fail "Dependency cache key does not expose its native environment identity: $arm64_key" ;;
esac
pass "dependency cache keys isolate OS, architecture, and Node module ABI"

cache_diagnostics="$TMP_DIR/cache-diagnostics.log"
npm_ls_failure=$'npm ERR! ELSPROBLEMS\nnpm ls https://user:secret@example.invalid/pkg failed'
dependency_cache_write_restore_diagnostic \
  "$cache_diagnostics" workspace npm_ls_failed_after_restore hardlink_fallback_copy 1 "$npm_ls_failure"
grep -q '^reason=npm_ls_failed_after_restore$' "$cache_diagnostics" || fail "cache restore diagnostics omitted npm ls failure reason"
grep -q '^restore_method=hardlink_fallback_copy$' "$cache_diagnostics" || fail "cache restore diagnostics omitted actual restore method"
grep -q '^node_arch=' "$cache_diagnostics" || fail "cache restore diagnostics omitted runtime architecture"
grep -q '^node_abi=' "$cache_diagnostics" || fail "cache restore diagnostics omitted Node module ABI"
grep -q 'npm ls https://\[REDACTED\]@example.invalid/pkg failed' "$cache_diagnostics" || fail "cache restore diagnostics omitted sanitized npm output"
if grep -q 'user:secret' "$cache_diagnostics"; then fail "cache restore diagnostics leaked URL credentials"; fi
pass "cache restore diagnostics retain npm ls context without URL credentials"

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

# Auto mode selects the isolated path even when both directories are on the
# same filesystem and hardlinks would technically be available.
[ "$(resolve_dependency_restore_mode "$TMP_DIR/cache/node_modules" "$TMP_DIR/workspace/node_modules" auto)" = "copy" ] \
  || fail "Auto restore did not select the isolated copy path"
pass "auto restore resolves to isolated copy on the same filesystem"

# Auto reports the optimized method only after an actual reflink capability
# probe succeeds; this keeps telemetry aligned with the restore operation.
(
  dependency_reflink_supported() { return 0; }
  [ "$(resolve_dependency_restore_mode "$TMP_DIR/cache/node_modules" "$TMP_DIR/workspace/node_modules" auto)" = "reflink" ] \
    || fail "Auto restore did not select reflink after a successful capability probe"
)
pass "auto restore selects reflink only after a successful capability probe"

# A successful cp exit alone is insufficient: reject and remove an incomplete
# tree so disk-full and faulty-copy scenarios cannot be reported as restored.
rm -rf "$TMP_DIR/workspace/incomplete-node_modules"
if (
  cp() { return 0; }
  copy_dependency_tree_isolated "$TMP_DIR/cache/node_modules" "$TMP_DIR/workspace/incomplete-node_modules"
); then
  fail "Incomplete dependency copy was accepted"
fi
[ ! -e "$TMP_DIR/workspace/incomplete-node_modules" ] || fail "Incomplete dependency copy was not cleaned up"
pass "isolated copy verifies content before reporting success"

# The default restore must never give a job writable access to persistent
# cache inodes, even when cache and workspace reside on the same filesystem.
rm -rf "$TMP_DIR/workspace/node_modules"
restore_node_modules_from_cache "$TMP_DIR/cache/node_modules" "$TMP_DIR/workspace/node_modules" auto
[ "${DEPENDENCY_RESTORE_METHOD:-}" = "copy" ] || fail "Expected auto mode to select isolated copy, got ${DEPENDENCY_RESTORE_METHOD:-unset}"
printf 'workspace mutation\n' > "$TMP_DIR/workspace/node_modules/pkg/index.js"
grep -qx 'cached package' "$TMP_DIR/cache/node_modules/pkg/index.js" \
  || fail "Workspace dependency write mutated the persistent cache entry"
pass "auto restore isolates persistent cache files from workspace writes"

# Explicit hardlink mode is experimental, but must detach its staging links
# before returning control to the job.
rm -rf "$TMP_DIR/workspace/node_modules"
restore_node_modules_from_cache "$TMP_DIR/cache/node_modules" "$TMP_DIR/workspace/node_modules" hardlink
[ "${DEPENDENCY_RESTORE_METHOD:-}" = "hardlink_isolated" ] || fail "Expected isolated hardlink method, got ${DEPENDENCY_RESTORE_METHOD:-unset}"
[ "$(stat -c %i "$TMP_DIR/cache/node_modules/pkg/index.js")" != "$(stat -c %i "$TMP_DIR/workspace/node_modules/pkg/index.js")" ] \
  || fail "Hardlink restore reported success while cache and workspace still shared an inode"
printf 'hardlink workspace mutation\n' > "$TMP_DIR/workspace/node_modules/pkg/index.js"
grep -qx 'cached package' "$TMP_DIR/cache/node_modules/pkg/index.js" \
  || fail "Experimental hardlink restore left cache and workspace inodes linked"
pass "hardlink restore detaches workspace files before job execution"

rm -rf "$TMP_DIR/workspace/node_modules" "$TMP_DIR/published"
ln -s "$TMP_DIR/cache/node_modules" "$TMP_DIR/workspace/node_modules"
publish_node_modules_cache "$TMP_DIR/workspace/node_modules" "$TMP_DIR/published"
[ -d "$TMP_DIR/published" ] || fail "Published cache path is not a directory"
[ ! -L "$TMP_DIR/published" ] || fail "Published cache path must not be a symlink"
[ -f "$TMP_DIR/published/pkg/index.js" ] || fail "Published real directory is missing package file"
pass "cache publication materializes a real directory from symlinked node_modules"

rm -rf "$TMP_DIR/prune-cache"
mkdir -p \
  "$TMP_DIR/prune-cache/npm/lock-old/node-24/platform-linux/arch-x64/abi-131/flags-a/node_modules/pkg" \
  "$TMP_DIR/prune-cache/npm/lock-new/node-24/platform-linux/arch-arm64/abi-131/flags-b/node_modules/pkg"
printf '%2048s\n' x > "$TMP_DIR/prune-cache/npm/lock-old/node-24/platform-linux/arch-x64/abi-131/flags-a/node_modules/pkg/blob.txt"
printf '%2048s\n' y > "$TMP_DIR/prune-cache/npm/lock-new/node-24/platform-linux/arch-arm64/abi-131/flags-b/node_modules/pkg/blob.txt"
printf '4096\n' > "$TMP_DIR/prune-cache/npm/lock-old/node-24/platform-linux/arch-x64/abi-131/flags-a/.entry-size-bytes"
printf '4096\n' > "$TMP_DIR/prune-cache/npm/lock-new/node-24/platform-linux/arch-arm64/abi-131/flags-b/.entry-size-bytes"
touch -t 202501010000 "$TMP_DIR/prune-cache/npm/lock-old/node-24/platform-linux/arch-x64/abi-131/flags-a"
metrics_file="$TMP_DIR/prune-cache/.kaseki-cache-metrics"
prune_limit=$(($(dependency_cache_disk_usage_bytes "$TMP_DIR/prune-cache") - 1))
prune_dependency_cache "$TMP_DIR/prune-cache" "$prune_limit" 0 "$metrics_file"
[ ! -d "$TMP_DIR/prune-cache/npm/lock-old/node-24/platform-linux/arch-x64/abi-131/flags-a" ] || fail "Oldest dependency cache entry was not pruned"
[ -f "$metrics_file" ] || fail "Dependency cache metrics file was not written"
grep -q '^size_bytes=' "$metrics_file" || fail "Dependency cache metrics missing size_bytes"
grep -q '^entry_count=1$' "$metrics_file" || fail "Dependency cache metrics missing pruned entry_count"
pass "dependency cache pruning removes oldest entries and writes metrics"

# Explicit access records, rather than atime, keep a recently used entry even
# when its directory itself is old. A truly idle peer remains eligible for
# maximum-age eviction.
rm -rf "$TMP_DIR/access-age-cache"
age_active="$TMP_DIR/access-age-cache/npm/lock-active/node-24/platform-linux/arch-x64/abi-131/flags-active"
age_idle="$TMP_DIR/access-age-cache/npm/lock-idle/node-24/platform-linux/arch-x64/abi-131/flags-idle"
mkdir -p "$age_active/node_modules/pkg" "$age_idle/node_modules/pkg"
printf '1\n' > "$age_active/.entry-size-bytes"
printf '1\n' > "$age_idle/.entry-size-bytes"
old_epoch=$(($(date +%s) - 3 * 86400))
printf '%s\n' "$old_epoch" > "$age_idle/.last-access"
touch -t 202501010000 "$age_active" "$age_idle"
update_dependency_cache_access "$age_active"
prune_dependency_cache "$TMP_DIR/access-age-cache" 0 1 "$TMP_DIR/access-age-cache.metrics"
[ -d "$age_active" ] || fail "Recently accessed old dependency cache entry was removed by maximum age"
[ ! -e "$age_idle" ] || fail "Genuinely idle dependency cache entry survived maximum-age pruning"
[ -f "$age_active/.last-access" ] || fail "Dependency cache access record was not published"
[ ! -e "$age_active/.last-access.tmp.$$" ] || fail "Temporary dependency cache access record was not renamed atomically"
pass "dependency cache access records protect old entries from age eviction"

# Size pruning must use the same access record. Make the active entry's
# directory older than the idle entry to prove directory mtime/atime does not
# influence selection when an explicit record exists.
rm -rf "$TMP_DIR/access-size-cache"
size_active="$TMP_DIR/access-size-cache/npm/lock-active/node-24/platform-linux/arch-x64/abi-131/flags-active"
size_idle="$TMP_DIR/access-size-cache/npm/lock-idle/node-24/platform-linux/arch-x64/abi-131/flags-idle"
mkdir -p "$size_active/node_modules/pkg" "$size_idle/node_modules/pkg"
printf '4096\n' > "$size_active/.entry-size-bytes"
printf '4096\n' > "$size_idle/.entry-size-bytes"
printf '%s\n' "$old_epoch" > "$size_idle/.last-access"
touch -t 202501010000 "$size_active"
update_dependency_cache_access "$size_active"
access_size_limit=$(($(dependency_cache_disk_usage_bytes "$TMP_DIR/access-size-cache") - 1))
prune_dependency_cache "$TMP_DIR/access-size-cache" "$access_size_limit" 0 "$TMP_DIR/access-size-cache.metrics"
[ -d "$size_active" ] || fail "Recently accessed old dependency cache entry was selected for size eviction"
[ ! -e "$size_idle" ] || fail "Genuinely idle dependency cache entry survived size eviction"
pass "dependency cache access records protect old entries from size eviction"

du() { fail "dependency_cache_size_bytes must not recursively scan the shared cache"; }
[ "$(dependency_cache_size_bytes "$TMP_DIR/prune-cache")" = "4096" ] || fail "metadata-based cache size was incorrect"
unset -f du
pass "dependency cache size accounting avoids synchronous whole-cache scans"

# Interrupted atomic publications are charged to real disk usage until they can
# be removed. Cleanup must coordinate with the entry publisher's lock.
orphan_cache="$TMP_DIR/orphan-cache"
orphan_entry="$orphan_cache/npm/lock-orphan/node-24/platform-linux/arch-x64/abi-131/flags-orphan"
mkdir -p "$orphan_entry/node_modules.tmp.11/pkg" "$orphan_entry/node_modules.old.22/pkg"
printf 'temporary\n' > "$orphan_entry/node_modules.tmp.11/pkg/file"
printf 'old\n' > "$orphan_entry/node_modules.old.22/pkg/file"
exec {orphan_lock_fd}>"${orphan_entry}.lock"
flock "$orphan_lock_fd"
prune_dependency_cache "$orphan_cache" 0 0 "$orphan_cache/metrics"
[ -d "$orphan_entry/node_modules.tmp.11" ] || fail "Pruning removed a temporary publication while its entry lock was held"
flock -u "$orphan_lock_fd"
exec {orphan_lock_fd}>&-
prune_dependency_cache "$orphan_cache" 0 0 "$orphan_cache/metrics"
[ ! -e "$orphan_entry/node_modules.tmp.11" ] || fail "Abandoned temporary publication was not removed"
[ ! -e "$orphan_entry/node_modules.old.22" ] || fail "Abandoned old publication was not removed"
grep -q '^cleanup_count=2$' "$orphan_cache/metrics" || fail "Orphan cleanup count was not reported"
grep -q '^cleanup_reasons=abandoned_tmp,abandoned_old$' "$orphan_cache/metrics" || fail "Orphan cleanup reasons were not reported"
pass "dependency cache cleanup locks and reports abandoned publication directories"

# Invalid metadata must never be interpreted by awk as a partial or negative
# number, and bounded caches retire entries that cannot be accounted reliably.
malformed_cache="$TMP_DIR/malformed-cache"
valid_entry="$malformed_cache/npm/valid/node-24/platform-linux/arch-x64/abi-131/flags-valid"
malformed_entry="$malformed_cache/npm/bad/node-24/platform-linux/arch-x64/abi-131/flags-bad"
mkdir -p "$valid_entry/node_modules" "$malformed_entry/node_modules"
printf '1234\n' > "$valid_entry/.entry-size-bytes"
printf '999garbage\n' > "$malformed_entry/.entry-size-bytes"
[ "$(dependency_cache_size_bytes "$malformed_cache")" = "1234" ] || fail "Malformed metadata distorted the recorded cache total"
prune_dependency_cache "$malformed_cache" 999999999 0 "$malformed_cache/metrics"
[ ! -e "$malformed_entry" ] || fail "Entry with malformed size metadata was not retired"
grep -q 'cleanup_reasons=.*invalid_size_metadata' "$malformed_cache/metrics" || fail "Invalid metadata cleanup reason was not reported"
pass "dependency cache accounting rejects malformed size metadata"

# The first prune reconciles actual allocation. A deliberately tiny recorded
# total must not bypass the byte limit when entry and cache-level files consume
# substantially more space.
drift_cache="$TMP_DIR/drift-cache"
drift_entry="$drift_cache/npm/drift/node-24/platform-linux/arch-x64/abi-131/flags-drift"
mkdir -p "$drift_entry/node_modules/pkg"
printf '%16384s' x > "$drift_entry/node_modules/pkg/blob"
printf '%8192s' y > "$drift_cache/cache-level-file"
printf '1\n' > "$drift_entry/.entry-size-bytes"
prune_dependency_cache "$drift_cache" 4096 0 "$drift_cache/metrics"
[ ! -e "$drift_entry" ] || fail "Reconciled disk usage did not enforce the byte limit"
grep -q '^recorded_size_bytes=0$' "$drift_cache/metrics" || fail "Metrics omitted the post-cleanup recorded byte count"
grep -Eq '^reconciled_size_bytes=[1-9][0-9]*$' "$drift_cache/metrics" || fail "Metrics omitted reconciled disk usage including cache-level files"
grep -q '^reconciliation_reason=periodic$' "$drift_cache/metrics" || fail "Metrics omitted the reconciliation reason"
grep -q 'cleanup_reasons=.*max_bytes' "$drift_cache/metrics" || fail "Metrics omitted the threshold enforcement cleanup reason"
pass "dependency cache reconciliation enforces actual disk usage and reports drift"

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

bin_check_dir="$TMP_DIR/bin-check"
mkdir -p "$bin_check_dir/node_modules/.bin"
cat > "$bin_check_dir/package.json" <<'JSON'
{"devDependencies":{"typescript":"^5.0.0","eslint":"^9.0.0"}}
JSON
(
  cd "$bin_check_dir"
  if dependency_cache_required_bins_valid package.json; then
    fail "cache integrity check accepted missing package executables"
  fi
  printf '#!/bin/sh\nexit 0\n' > node_modules/.bin/tsc
  printf '#!/bin/sh\nexit 0\n' > node_modules/.bin/eslint
  chmod +x node_modules/.bin/tsc node_modules/.bin/eslint
  dependency_cache_required_bins_valid package.json || fail "cache integrity check rejected executable package bins"
)
pass "dependency cache integrity validates required package executables"

repair_dir="$TMP_DIR/bin-repair"
mkdir -p \
  "$repair_dir/node_modules/typescript/bin" \
  "$repair_dir/node_modules/eslint/bin"
cat > "$repair_dir/package.json" <<'JSON'
{"scripts":{"build":"tsc --version"},"devDependencies":{"typescript":"^5.0.0","eslint":"^9.0.0"}}
JSON
cat > "$repair_dir/node_modules/typescript/package.json" <<'JSON'
{"name":"typescript","bin":{"tsc":"bin/tsc"}}
JSON
cat > "$repair_dir/node_modules/eslint/package.json" <<'JSON'
{"name":"eslint","bin":{"eslint":"bin/eslint.js"}}
JSON
printf '#!/bin/sh\necho tsc-ok\n' > "$repair_dir/node_modules/typescript/bin/tsc"
printf '#!/bin/sh\necho eslint-ok\n' > "$repair_dir/node_modules/eslint/bin/eslint.js"
chmod +x "$repair_dir/node_modules/typescript/bin/tsc" "$repair_dir/node_modules/eslint/bin/eslint.js"
(
  cd "$repair_dir"
  # Models restore -> copy fallback/reinstall output where package directories
  # exist but npm's .bin links disappeared before the build/scouting boundary.
  validate_or_repair_required_dependency_bins package.json node_modules || fail "required package executable repair failed"
  [ "${DEPENDENCY_CACHE_BIN_REPAIRED:-0}" = "1" ] || fail "dependency executable repair telemetry was not set"
  [ -x node_modules/.bin/tsc ] || fail "tsc link was not repaired"
  [ -x node_modules/.bin/eslint ] || fail "eslint link was not repaired"
  PATH="$PWD/node_modules/.bin:$PATH" tsc --version | grep -q tsc-ok || fail "build boundary could not invoke repaired tsc"
  PATH="$PWD/node_modules/.bin:$PATH" eslint --version | grep -q eslint-ok || fail "scouting boundary could not invoke repaired eslint"
)
pass "cache restore/reinstall repair preserves package executables through build and scouting boundaries"

legacy_entry="$TMP_DIR/prune-cache/npm/lock-legacy/node-24/flags-c"
mkdir -p "$legacy_entry/node_modules/pkg"
prune_dependency_cache "$TMP_DIR/prune-cache" 5000 0 "$metrics_file"
[ ! -e "$legacy_entry" ] || fail "unmetered legacy cache entry was not removed"
pass "cache pruning retires legacy entries without recursively scanning them"
