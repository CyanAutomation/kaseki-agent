#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="${1:?Usage: check-npm-version-unpublished.sh PACKAGE_NAME VERSION}"
VERSION="${2:?Usage: check-npm-version-unpublished.sh PACKAGE_NAME VERSION}"
VERSION_LIST_FILE="$(mktemp)"
trap 'rm -f "$VERSION_LIST_FILE"' EXIT

if npm view "$PACKAGE_NAME" versions --json --registry=https://registry.npmjs.org/ >"$VERSION_LIST_FILE"; then
  :
else
  status=$?
  echo "Failed to query published versions for $PACKAGE_NAME from npm." >&2
  exit "$status"
fi

node - "$PACKAGE_NAME" "$VERSION" "$VERSION_LIST_FILE" <<'NODE'
const fs = require("node:fs");

const [packageName, version, versionListFile] = process.argv.slice(2);
let versions;
try {
  versions = JSON.parse(fs.readFileSync(versionListFile, "utf8"));
} catch {
  console.error("npm registry returned invalid JSON while checking published versions.");
  process.exit(2);
}

if (!Array.isArray(versions) || versions.some((entry) => typeof entry !== "string")) {
  console.error("npm registry response for published versions was expected to be a JSON array.");
  process.exit(2);
}

if (versions.includes(version)) {
  console.error(`Target npm version ${packageName}@${version} already exists.`);
  process.exit(1);
}

console.log(`Confirmed ${packageName}@${version} is unpublished.`);
NODE
