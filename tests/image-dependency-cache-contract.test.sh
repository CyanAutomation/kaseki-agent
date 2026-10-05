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
grep -q 'build-essential' "$ROOT_DIR/Dockerfile"
grep -q 'golang-go' "$ROOT_DIR/Dockerfile"
runtime_stage_packages="$(awk '/^FROM base AS runtime$/{in_runtime=1} in_runtime && /^FROM / && $0 != "FROM base AS runtime"{exit} in_runtime{print}' "$ROOT_DIR/Dockerfile")"
final_stage_packages="$(awk '/^FROM base AS final$/{in_final=1} in_final && /^FROM / && $0 != "FROM base AS final"{exit} in_final{print}' "$ROOT_DIR/Dockerfile")"
grep -Eq 'apt-get install.*(^|[[:space:]])libpcre2-8-0([[:space:]]|$)' <<<"$runtime_stage_packages" || {
  printf 'Runtime image does not explicitly install the patched libpcre2 package\n' >&2
  exit 1
}
grep -Eq 'apt-get install.*(^|[[:space:]])make([[:space:]]|$)' <<<"$final_stage_packages" || {
  printf 'Final worker image does not install make for make-based validation commands\n' >&2
  exit 1
}
grep -Eq 'apt-get install.*(^|[[:space:]])libpcre2-8-0([[:space:]]|$)' <<<"$final_stage_packages" || {
  printf 'Final worker image does not explicitly install the patched libpcre2 package\n' >&2
  exit 1
}

printf 'image dependency cache contract tests passed\n'
