#!/usr/bin/env bash
# shellcheck disable=SC2016
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
install -m 0755 "$ROOT_DIR/dist/logger.js" "$BIN_DIR/logger.js"
install -m 0755 "$ROOT_DIR/dist/secrets/host-secrets-reader.js" "$BIN_DIR/secrets/host-secrets-reader.js"
install -m 0755 "$ROOT_DIR/dist/github-app-token.js" "$BIN_DIR/github-app-token"

for helper in github-utils.js logger.js secrets/host-secrets-reader.js; do
  helper_path="$BIN_DIR/$helper"
  marker="kaseki-install-layout helper-loaded: $helper from "
  tmp_helper="$TMP_DIR/$(echo "$helper" | tr '/' '_').instrumented"
  {
    printf 'process.stderr.write(%s + new URL(import.meta.url).pathname + "\\n");\n' "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$marker")"
    cat "$helper_path"
  } > "$tmp_helper"
  install -m 0755 "$tmp_helper" "$helper_path"
done

assert_no_missing_module_output() {
  local stdout_file="$1"
  local stderr_file="$2"
  if grep -qE 'Cannot find module|ERR_MODULE_NOT_FOUND' "$stdout_file" "$stderr_file"; then
    printf '✗ github-app-token output referenced a missing runtime module\n' >&2
    cat "$stdout_file" >&2
    cat "$stderr_file" >&2
    exit 1
  fi
}

assert_target_helper_loaded() {
  local stderr_file="$1"
  local helper="$2"
  local expected="kaseki-install-layout helper-loaded: $helper from $BIN_DIR/$helper"
  if ! grep -Fqx "$expected" "$stderr_file"; then
    printf '✗ github-app-token did not resolve %s from the installed target layout\n' "$helper" >&2
    printf 'Expected marker: %s\n' "$expected" >&2
    cat "$stderr_file" >&2
    exit 1
  fi
}

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

assert_no_missing_module_output "$STDOUT_FILE" "$STDERR_FILE"
assert_target_helper_loaded "$STDERR_FILE" "github-utils.js"
assert_target_helper_loaded "$STDERR_FILE" "logger.js"
assert_target_helper_loaded "$STDERR_FILE" "secrets/host-secrets-reader.js"

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

MOCK_HTTPS_IMPORT="$TMP_DIR/mock-https.mjs"
cat > "$MOCK_HTTPS_IMPORT" <<'MOCK'
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';

const calls = [];
https.request = (options, callback) => {
  calls.push({ method: options.method, path: options.path });
  process.stderr.write(`kaseki-install-layout token-request: ${options.method} ${options.path}\n`);

  const req = new EventEmitter();
  req.setTimeout = () => req;
  req.destroy = (error) => {
    if (error) req.emit('error', error);
    return req;
  };
  req.end = () => {
    const res = new EventEmitter();
    if (options.path === '/repos/owner/repo/installation') {
      res.statusCode = 200;
      callback(res);
      res.emit('data', Buffer.from('{"id":4242}'));
      res.emit('end');
      return req;
    }
    if (options.path === '/app/installations/4242/access_tokens') {
      res.statusCode = 201;
      callback(res);
      res.emit('data', Buffer.from('{"token":"mock-token","expires_at":"2026-07-04T00:00:00Z"}'));
      res.emit('end');
      return req;
    }
    res.statusCode = 500;
    callback(res);
    res.emit('data', Buffer.from(JSON.stringify({ calls })));
    res.emit('end');
    return req;
  };
  return req;
};

syncBuiltinESMExports();
MOCK

VALID_PRIVATE_KEY_FILE="$TMP_DIR/github-app-private-key.pem"
node -e '
const { generateKeyPairSync } = require("crypto");
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.stdout.write(privateKey.export({ type: "pkcs8", format: "pem" }));
' > "$VALID_PRIVATE_KEY_FILE"

SUCCESS_STDOUT_FILE="$TMP_DIR/success-stdout.json"
SUCCESS_STDERR_FILE="$TMP_DIR/success-stderr.log"
set +e
NODE_OPTIONS="--import=$MOCK_HTTPS_IMPORT" node "$BIN_DIR/github-app-token" 123 "$VALID_PRIVATE_KEY_FILE" owner repo >"$SUCCESS_STDOUT_FILE" 2>"$SUCCESS_STDERR_FILE"
success_status=$?
set -e

if [ "$success_status" -ne 0 ]; then
  printf '✗ mocked success path failed unexpectedly (exit code %d)\n' "$success_status" >&2
  cat "$SUCCESS_STDOUT_FILE" >&2
  cat "$SUCCESS_STDERR_FILE" >&2
  exit 1
fi

assert_no_missing_module_output "$SUCCESS_STDOUT_FILE" "$SUCCESS_STDERR_FILE"
assert_target_helper_loaded "$SUCCESS_STDERR_FILE" "github-utils.js"
assert_target_helper_loaded "$SUCCESS_STDERR_FILE" "logger.js"
assert_target_helper_loaded "$SUCCESS_STDERR_FILE" "secrets/host-secrets-reader.js"
if ! grep -Fqx 'kaseki-install-layout token-request: GET /repos/owner/repo/installation' "$SUCCESS_STDERR_FILE"; then
  printf '✗ mocked success path did not reach installation lookup after module loading\n' >&2
  cat "$SUCCESS_STDERR_FILE" >&2
  exit 1
fi
if ! grep -Fqx 'kaseki-install-layout token-request: POST /app/installations/4242/access_tokens' "$SUCCESS_STDERR_FILE"; then
  printf '✗ mocked success path did not reach token request after module loading\n' >&2
  cat "$SUCCESS_STDERR_FILE" >&2
  exit 1
fi

node -e '
const fs = require("fs");
const output = fs.readFileSync(process.argv[1], "utf8").trim();
const parsed = JSON.parse(output.split(/\r?\n/).findLast((line) => line.startsWith("{")) || "null");
if (parsed.token !== "mock-token" || parsed.expires_at !== "2026-07-04T00:00:00Z" || parsed.error) {
  console.error(`Expected mocked token JSON, got: ${output}`);
  process.exit(1);
}
' "$SUCCESS_STDOUT_FILE"

printf '✓ github-app-token installed layout resolves target helpers and reaches token requests\n'
