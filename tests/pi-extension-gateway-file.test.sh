#!/usr/bin/env bash
# Verifies the Pi gateway extension reads the worker-mounted API key file.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

KEY_FILE="$TMP_DIR/llm_gateway_api_key"
EXTENSION_COPY="$TMP_DIR/llm-gateway.mjs"
printf '%s\n' 'file-backed-gateway-key' > "$KEY_FILE"
cp "$PROJECT_ROOT/.pi-extensions.js" "$EXTENSION_COPY"

LLM_GATEWAY_URL="https://gateway.example.invalid/v1" \
LLM_GATEWAY_API_KEY_FILE="$KEY_FILE" \
node - "$EXTENSION_COPY" <<'NODE'
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
NODE

printf '✓ Pi gateway extension reads LLM_GATEWAY_API_KEY_FILE\n'
