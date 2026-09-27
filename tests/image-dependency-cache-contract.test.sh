#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../scripts/dependency-cache-helpers.sh
. "$ROOT_DIR/scripts/dependency-cache-helpers.sh"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
mkdir -p "$tmpdir/node_modules"

cache_key="$(dependency_cache_publish_image_seed \
  "$ROOT_DIR/docker/workspace-cache/package-lock.json" \
  "$tmpdir/node_modules" \
  "$tmpdir/image-cache")"
expected_key="$(dependency_cache_key \
  "$(sha256sum "$ROOT_DIR/docker/workspace-cache/package-lock.json" | awk '{print $1}')" \
  "$(node -p 'process.versions.node.split(".")[0]')" \
  "$(dependency_cache_flags_hash)")"
schema_version="$(dependency_cache_schema_version)"

test "$cache_key" = "$expected_key"
test -d "$tmpdir/image-cache/$expected_key/node_modules"
dependency_cache_schema_valid \
  "$tmpdir/image-cache/$expected_key/validated-v${schema_version}" \
  "$schema_version"

# Keep the Docker publisher and runtime lookup tied to the shared contract.
grep -q 'dependency_cache_publish_image_seed' "$ROOT_DIR/Dockerfile"
grep -q 'image_cache_dir="${image_cache_root}/node_modules"' "$ROOT_DIR/kaseki-agent.sh"
grep -q 'dependency_cache_schema_valid "$image_validation_marker"' "$ROOT_DIR/kaseki-agent.sh"
grep -q '"image_cache_absent"' "$ROOT_DIR/kaseki-agent.sh"
grep -q '"image_cache_key_mismatch"' "$ROOT_DIR/kaseki-agent.sh"
grep -Eq 'apt-get install[^\\n]*build-essential[^\\n]*golang-go' "$ROOT_DIR/Dockerfile"

printf 'image dependency cache contract tests passed\n'
