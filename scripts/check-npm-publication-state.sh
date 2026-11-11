#!/usr/bin/env bash

set -euo pipefail

PACKAGE_NAME="${1:?Usage: check-npm-publication-state.sh PACKAGE_NAME VERSION TARBALL ALLOW_EXISTING}"
VERSION="${2:?Usage: check-npm-publication-state.sh PACKAGE_NAME VERSION TARBALL ALLOW_EXISTING}"
TARBALL="${3:?Usage: check-npm-publication-state.sh PACKAGE_NAME VERSION TARBALL ALLOW_EXISTING}"
ALLOW_EXISTING="${4:?Usage: check-npm-publication-state.sh PACKAGE_NAME VERSION TARBALL ALLOW_EXISTING}"
REGISTRY='https://registry.npmjs.org/'
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSIONS_FILE="$(mktemp)"
REGISTRY_ERROR_FILE="$(mktemp)"
INTEGRITY_FILE="$(mktemp)"
trap 'rm -f "$VERSIONS_FILE" "$REGISTRY_ERROR_FILE" "$INTEGRITY_FILE"' EXIT

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]] || {
  printf 'Invalid npm package version: %s\n' "$VERSION" >&2
  exit 2
}
[[ -f "$TARBALL" ]] || {
  printf 'npm package tarball does not exist: %s\n' "$TARBALL" >&2
  exit 2
}
[[ "$ALLOW_EXISTING" == true || "$ALLOW_EXISTING" == false ]] || {
  printf 'ALLOW_EXISTING must be true or false\n' >&2
  exit 2
}

if [[ "$ALLOW_EXISTING" == false ]]; then
  "$SCRIPT_DIR/check-npm-version-unpublished.sh" "$PACKAGE_NAME" "$VERSION" >&2
  printf 'publish=true\n'
  exit 0
fi

if npm view "$PACKAGE_NAME" versions --json --registry="$REGISTRY" \
  >"$VERSIONS_FILE" 2>"$REGISTRY_ERROR_FILE"; then
  :
else
  status=$?
  if node - "$VERSIONS_FILE" <<'NODE'
const fs = require('node:fs');

let response;
try {
  response = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
} catch {
  process.exit(1);
}

process.exit(response?.error?.code === 'E404' ? 0 : 1);
NODE
  then
    printf '[]\n' >"$VERSIONS_FILE"
  else
    printf 'Failed to query published versions for %s from npm.\n' "$PACKAGE_NAME" >&2
    cat "$VERSIONS_FILE" "$REGISTRY_ERROR_FILE" >&2
    exit "$status"
  fi
fi

version_exists="$(node - "$VERSION" "$VERSIONS_FILE" <<'NODE'
const fs = require('node:fs');

const [version, file] = process.argv.slice(2);
let versions;
try {
  versions = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch {
  console.error('npm registry returned invalid JSON while checking published versions.');
  process.exit(2);
}

if (!Array.isArray(versions) || versions.some((entry) => typeof entry !== 'string')) {
  console.error('npm registry response for published versions was expected to be a JSON array.');
  process.exit(2);
}

process.stdout.write(versions.includes(version) ? 'true' : 'false');
NODE
)"

if [[ "$version_exists" == false ]]; then
  printf 'publish=true\n'
  exit 0
fi

if ! npm view "$PACKAGE_NAME@$VERSION" dist.integrity --json --registry="$REGISTRY" \
  >"$INTEGRITY_FILE" 2>"$REGISTRY_ERROR_FILE"; then
  printf 'Failed to query integrity for published package %s@%s.\n' "$PACKAGE_NAME" "$VERSION" >&2
  cat "$INTEGRITY_FILE" "$REGISTRY_ERROR_FILE" >&2
  exit 1
fi

local_integrity="$(node - "$TARBALL" <<'NODE'
const fs = require('node:fs');
const { createHash } = require('node:crypto');

const tarball = fs.readFileSync(process.argv[2]);
process.stdout.write(`sha512-${createHash('sha512').update(tarball).digest('base64')}`);
NODE
)"
published_integrity="$(node - "$INTEGRITY_FILE" <<'NODE'
const fs = require('node:fs');

let integrity;
try {
  integrity = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
} catch {
  console.error('npm registry returned invalid package integrity JSON.');
  process.exit(2);
}

if (typeof integrity !== 'string' || !integrity.startsWith('sha512-')) {
  console.error('npm registry response did not include a SHA-512 package integrity.');
  process.exit(2);
}

process.stdout.write(integrity);
NODE
)"

if [[ "$published_integrity" != "$local_integrity" ]]; then
  printf 'Published package %s@%s does not match the release tarball integrity.\n' \
    "$PACKAGE_NAME" "$VERSION" >&2
  exit 1
fi

printf 'Confirmed published package %s@%s matches the release tarball.\n' \
  "$PACKAGE_NAME" "$VERSION" >&2
printf 'publish=false\n'
