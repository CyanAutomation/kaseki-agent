#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Load only the pure dependency-cache key helpers from kaseki-agent.sh.
eval "$(awk '
  /^dependency_cache_flags_identity\(\)/ { emit=1 }
  /^build_agent_prompt\(\)/ { emit=0 }
  emit { print }
' "$ROOT_DIR/kaseki-agent.sh")"

cat > "$TMP_DIR/package-lock.json" <<'LOCK'
{"lockfileVersion":3,"packages":{}}
LOCK

lock_hash="$(sha256sum "$TMP_DIR/package-lock.json" | awk '{print $1}')"
node_major="24"
KASEKI_NPM_OMIT_DEV=0
KASEKI_INSTALL_IGNORE_SCRIPTS=1
flags_hash="$(dependency_cache_flags_hash)"
cache_root="$TMP_DIR/cache"

REPO_URL="https://example.com/project.git" GIT_REF="feature-a"
path_a="$cache_root/$(dependency_cache_key "$lock_hash" "$node_major" "$flags_hash")/node_modules"
REPO_URL="https://example.com/project.git" GIT_REF="feature-b"
path_b="$cache_root/$(dependency_cache_key "$lock_hash" "$node_major" "$flags_hash")/node_modules"

if [ "$path_a" != "$path_b" ]; then
  printf 'Expected identical lockfile cache paths across refs:\n  %s\n  %s\n' "$path_a" "$path_b" >&2
  exit 1
fi

expected_prefix="$cache_root/npm/$lock_hash/node-$node_major/flags-$flags_hash/node_modules"
if [ "$path_a" != "$expected_prefix" ]; then
  printf 'Unexpected dependency cache path:\n  expected: %s\n  actual:   %s\n' "$expected_prefix" "$path_a" >&2
  exit 1
fi

KASEKI_NPM_OMIT_DEV=1
omit_dev_flags_hash="$(dependency_cache_flags_hash)"
omit_dev_path="$cache_root/$(dependency_cache_key "$lock_hash" "$node_major" "$omit_dev_flags_hash")/node_modules"
if [ "$path_a" = "$omit_dev_path" ]; then
  printf 'Expected install flags to produce a distinct dependency cache path: %s\n' "$path_a" >&2
  exit 1
fi
