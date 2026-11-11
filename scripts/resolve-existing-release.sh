#!/usr/bin/env bash

set -euo pipefail

VERSION="${1:?Usage: resolve-existing-release.sh VERSION}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]] || {
  printf 'Invalid recovery version: %s\n' "$VERSION" >&2
  exit 2
}

tag="v$VERSION"
release_sha="$(git rev-parse --verify "refs/tags/$tag^{commit}")"
git merge-base --is-ancestor "$release_sha" HEAD || {
  printf 'Release tag %s is not reachable from the selected main checkout\n' "$tag" >&2
  exit 1
}

tagged_package_version="$(git show "$tag:package.json" | node -e '
const fs = require("node:fs");
const packageJson = JSON.parse(fs.readFileSync(0, "utf8"));
process.stdout.write(String(packageJson.version ?? ""));
')"
[[ "$tagged_package_version" == "$VERSION" ]] || {
  printf 'Release tag %s contains package version %s\n' "$tag" "$tagged_package_version" >&2
  exit 1
}

gh release view "$tag" >/dev/null
printf 'version=%s\nsha=%s\n' "$VERSION" "$release_sha"
