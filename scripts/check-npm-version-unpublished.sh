#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="${1:?Usage: check-npm-version-unpublished.sh PACKAGE_NAME VERSION}"
VERSION="${2:?Usage: check-npm-version-unpublished.sh PACKAGE_NAME VERSION}"
VERSION_LIST_FILE="$(mktemp)"
REGISTRY_ERROR_FILE="$(mktemp)"
trap 'rm -f "$VERSION_LIST_FILE" "$REGISTRY_ERROR_FILE"' EXIT

if npm view "$PACKAGE_NAME" versions --json --registry=https://registry.npmjs.org/ >"$VERSION_LIST_FILE" 2>"$REGISTRY_ERROR_FILE"; then
  :
else
  status=$?
  if node - "$VERSION_LIST_FILE" <<'NODE'
const fs = require("node:fs");

let response;
try {
  response = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
} catch {
  process.exit(1);
}

process.exit(response?.error?.code === "E404" ? 0 : 1);
NODE
  then
    echo "Package $PACKAGE_NAME was not found in the npm registry; treating $PACKAGE_NAME@$VERSION as unpublished."
    printf '[]\n' >"$VERSION_LIST_FILE"
  else
    echo "Failed to query published versions for $PACKAGE_NAME from npm." >&2
    cat "$VERSION_LIST_FILE" "$REGISTRY_ERROR_FILE" >&2
    exit "$status"
  fi
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
