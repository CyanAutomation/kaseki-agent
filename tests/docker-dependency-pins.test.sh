#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dockerfile="$repo_root/Dockerfile"
toolchain_manifest="$repo_root/docker/image-toolchain/package.json"

if ! jq -e '
  .dependencies.npm == "11.21.0" and
  .dependencies["@earendil-works/pi-coding-agent"] == "0.87.1" and
  .dependencies["@earendil-works/pi-server"] == "0.87.1" and
  .dependencies["brace-expansion"] == "5.0.11" and
  .dependencies["brace-expansion-v1"] == "npm:brace-expansion@1.1.20" and
  .dependencies["brace-expansion-v2"] == "npm:brace-expansion@2.1.6" and
  (.dependencies | has("brace-expansion-v3") | not) and
  .dependencies.undici == "8.10.2" and
  .dependencies["undici-v6"] == "npm:undici@6.28.1" and
  .dependencies["undici-v7"] == "npm:undici@7.29.1" and
  .overrides.npm["brace-expansion"] == "5.0.11" and
  .overrides.npm.undici == "6.28.1" and
  .overrides["@earendil-works/pi-coding-agent"]["brace-expansion"] == "5.0.11" and
  .overrides["@earendil-works/pi-coding-agent"].undici == "8.10.2" and
  .overrides["@earendil-works/pi-server"]["brace-expansion"] == "5.0.11" and
  .overrides["@earendil-works/pi-server"].undici == "8.10.2"
' "$toolchain_manifest" >/dev/null; then
  echo 'Image toolchain dependencies must use the reviewed versions and scoped security overrides.' >&2
  exit 1
fi

if ! grep -Fq 'COPY docker/image-toolchain/package.json docker/image-toolchain/package-lock.json ./' "$dockerfile"; then
  echo 'Dockerfile must install global tools from the lockfile-backed image toolchain.' >&2
  exit 1
fi

if grep -Eq 'npm install -g' "$dockerfile"; then
  echo 'Dockerfile must not install image tools outside the lockfile-backed dependency tree.' >&2
  exit 1
fi

if [[ "$(grep -Fc 'verify-image-dependency-versions.mjs' "$dockerfile")" -lt 2 ]]; then
  echo 'Dockerfile must verify the global and application dependency trees.' >&2
  exit 1
fi

if [[ "$(grep -Fc 'patch-image-dependency-bundles.mjs' "$dockerfile")" -lt 2 ]]; then
  echo 'Dockerfile must replace vulnerable bundled dependencies in both image trees.' >&2
  exit 1
fi

printf 'Image toolchain pins and dependency-tree checks are present.\n'
