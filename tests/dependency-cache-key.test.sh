#!/usr/bin/env bash
# shellcheck disable=SC2034
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Source the pure dependency-cache key helpers directly.
# shellcheck source=/dev/null
. "$ROOT_DIR/scripts/dependency-cache-helpers.sh"

# Cache-key contract (implemented by scripts/dependency-cache-helpers.sh and
# consumed by kaseki-agent.sh): dependency cache entries are keyed by dependency
# inputs that affect node_modules contents (lockfile hash, Node major version,
# and npm install flags), not by the checked-out Git ref. Keep this test at that
# contract level so it does not freeze the private on-disk directory layout.
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

if [ "$key_a" != "$key_b" ]; then
  printf 'Expected identical dependency cache entries across refs:\n  %s\n  %s\n' "$key_a" "$key_b" >&2
  exit 1
fi

if printf '%s\n' "$key_a" | grep -Fq "feature-"; then
  printf 'Expected dependency cache entry to avoid embedding Git refs: %s\n' "$key_a" >&2
  exit 1
fi

KASEKI_NPM_OMIT_DEV=1
omit_dev_flags_hash="$(dependency_cache_flags_hash)"
omit_dev_key="$(dependency_cache_key "$lock_hash" "$node_major" "$omit_dev_flags_hash")"
if [ "$key_a" = "$omit_dev_key" ]; then
  printf 'Expected install flags to produce a distinct dependency cache entry: %s\n' "$key_a" >&2
  exit 1
fi
