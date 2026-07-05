#!/usr/bin/env bash
# Built dist artifacts are intentionally required: this CLI smoke test copies
# dist/github-app-token.js into an installed-like bin directory to verify the
# package artifact emits structured JSON failures after installation. Run
# `npm run build` first, or use `npm run test:ci`, which builds immediately
# before this script.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

REQUIRED_DIST_ARTIFACTS=(
  "dist/github-app-token.js"
  "dist/github-utils.js"
  "dist/github-app-token-runtime.js"
  "dist/logger.js"
  "dist/secrets/host-secrets-reader.js"
  "dist/github-app-private-key.js"
)

missing_artifacts=()
for artifact in "${REQUIRED_DIST_ARTIFACTS[@]}"; do
  if [ ! -f "$ROOT_DIR/$artifact" ]; then
    missing_artifacts+=("$artifact")
  fi
done

if [ "${#missing_artifacts[@]}" -gt 0 ]; then
  printf '✗ github-app-token install-layout test requires built dist artifacts; missing: %s\n' "${missing_artifacts[*]}" >&2
  printf '  Run `npm run build` before `bash tests/github-app-token-install-layout.test.sh`.\n' >&2
  exit 1
fi

BIN_DIR="$TMP_DIR/usr/local/bin"
mkdir -p "$BIN_DIR/secrets"

install -m 0755 "$ROOT_DIR/dist/github-app-private-key.js" "$BIN_DIR/github-app-private-key.js"
install -m 0755 "$ROOT_DIR/dist/github-utils.js" "$BIN_DIR/github-utils.js"
install -m 0755 "$ROOT_DIR/dist/github-app-token-runtime.js" "$BIN_DIR/github-app-token-runtime.js"
install -m 0755 "$ROOT_DIR/dist/logger.js" "$BIN_DIR/logger.js"
install -m 0755 "$ROOT_DIR/dist/secrets/host-secrets-reader.js" "$BIN_DIR/secrets/host-secrets-reader.js"
install -m 0755 "$ROOT_DIR/dist/github-app-token.js" "$BIN_DIR/github-app-token"

PRIVATE_KEY_FILE="$TMP_DIR/not-a-private-key.pem"
printf '%s\n' 'not a private key' > "$PRIVATE_KEY_FILE"

STDOUT_FILE="$TMP_DIR/invalid-key-stdout.json"
STDERR_FILE="$TMP_DIR/invalid-key-stderr.log"
set +e
node "$BIN_DIR/github-app-token" 123 "$PRIVATE_KEY_FILE" owner repo >"$STDOUT_FILE" 2>"$STDERR_FILE"
status=$?
set -e

if [ "$status" -eq 0 ]; then
  printf '✗ github-app-token unexpectedly succeeded with an invalid private key\n' >&2
  cat "$STDOUT_FILE" >&2
  exit 1
fi

if grep -qE 'Cannot find module|ERR_MODULE_NOT_FOUND' "$STDOUT_FILE" "$STDERR_FILE"; then
  printf '✗ github-app-token output referenced a missing runtime module\n' >&2
  cat "$STDOUT_FILE" >&2
  cat "$STDERR_FILE" >&2
  exit 1
fi

node -e '
const fs = require("fs");
const output = fs.readFileSync(process.argv[1], "utf8").trim();
const jsonLine = output.split(/\r?\n/).findLast((line) => line.startsWith("{"));
let parsed;
try {
  parsed = JSON.parse(jsonLine || "null");
} catch (error) {
  console.error(`Expected structured JSON error, got: ${output}`);
  process.exit(1);
}
if (!parsed || typeof parsed.error !== "string" || !parsed.error.includes("private key")) {
  console.error(`Expected private-key validation error JSON, got: ${output}`);
  process.exit(1);
}
' "$STDOUT_FILE"

printf '✓ github-app-token installed layout emits structured JSON errors\n'
