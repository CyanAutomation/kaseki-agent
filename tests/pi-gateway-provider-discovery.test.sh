#!/usr/bin/env bash
# Fast local contract test for gateway provider registration from .pi-extensions.js.

set -euo pipefail

TEST_NAME="Pi gateway provider registration"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
KEY_FILE="$TMP_DIR/llm_gateway_api_key"
EXTENSION_COPY="$TMP_DIR/pi-extensions.mjs"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  echo "✗ FAIL: $TEST_NAME: $*" >&2
  exit 1
}

printf '%s\n' 'file-backed-gateway-key' > "$KEY_FILE"
chmod 600 "$KEY_FILE"
cp "$REPO_ROOT/.pi-extensions.js" "$EXTENSION_COPY"

echo "Verifying gateway extension registers provider configuration from LLM_GATEWAY_API_KEY_FILE"
LLM_GATEWAY_URL="https://gateway.example.invalid/v1" \
LLM_GATEWAY_API_KEY_FILE="$KEY_FILE" \
node - "$EXTENSION_COPY" <<'NODE' || fail "gateway provider registration contract failed"
const extensionPath = process.argv[2];
delete process.env.LLM_GATEWAY_API_KEY;

let registered;
const pi = {
  registerProvider(name, config) {
    registered = { name, config };
  },
};

const extension = await import(`file://${extensionPath}`);
extension.default(pi);

if (!registered) {
  console.error('gateway provider was not registered');
  process.exit(1);
}
if (registered.name !== 'gateway') {
  console.error(`unexpected provider name: ${registered.name}`);
  process.exit(1);
}
if (registered.config.apiKey !== 'file-backed-gateway-key') {
  console.error(`gateway apiKey did not come from file: ${registered.config.apiKey}`);
  process.exit(1);
}
if (registered.config.baseUrl !== 'https://gateway.example.invalid/v1') {
  console.error(`gateway baseURL did not come from LLM_GATEWAY_URL: ${registered.config.baseUrl}`);
  process.exit(1);
}
if (registered.config.api !== 'openai-completions') {
  console.error(`unexpected gateway api: ${registered.config.api}`);
  process.exit(1);
}
if (!Array.isArray(registered.config.models) || !registered.config.models.some((model) => model.id === 'dynamic/kaseki-agent')) {
  console.error(`expected dynamic/kaseki-agent model registration, got: ${JSON.stringify(registered.config.models)}`);
  process.exit(1);
}
NODE

echo "✓ PASS: $TEST_NAME"
