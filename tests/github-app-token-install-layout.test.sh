#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

BIN_DIR="$TMP_DIR/usr/local/bin"
mkdir -p "$BIN_DIR"

install -m 0755 "$ROOT_DIR/dist/github-app-private-key.js" "$BIN_DIR/github-app-private-key.js"
install -m 0755 "$ROOT_DIR/dist/github-app-token.js" "$BIN_DIR/github-app-token"

PRIVATE_KEY_FILE="$TMP_DIR/not-a-private-key.pem"
printf '%s\n' 'not a private key' > "$PRIVATE_KEY_FILE"

STDOUT_FILE="$TMP_DIR/stdout.json"
STDERR_FILE="$TMP_DIR/stderr.log"
set +e
node "$BIN_DIR/github-app-token" 123 "$PRIVATE_KEY_FILE" owner repo >"$STDOUT_FILE" 2>"$STDERR_FILE"
status=$?
set -e

if [ "$status" -eq 0 ]; then
  printf '✗ github-app-token unexpectedly succeeded with an invalid private key\n' >&2
  cat "$STDOUT_FILE" >&2
  exit 1
fi

if grep -q 'ERR_MODULE_NOT_FOUND' "$STDOUT_FILE" "$STDERR_FILE"; then
  printf '✗ github-app-token failed because a runtime module was missing\n' >&2
  cat "$STDOUT_FILE" >&2
  cat "$STDERR_FILE" >&2
  exit 1
fi

node -e '
const fs = require("fs");
const output = fs.readFileSync(process.argv[1], "utf8").trim();
let parsed;
try {
  parsed = JSON.parse(output);
} catch (error) {
  console.error(`Expected structured JSON error, got: ${output}`);
  process.exit(1);
}
if (!parsed || typeof parsed.error !== "string" || !parsed.error.includes("private key")) {
  console.error(`Expected private-key validation error JSON, got: ${output}`);
  process.exit(1);
}
' "$STDOUT_FILE"

printf '✓ github-app-token reports structured private-key errors from installed layout\n'
