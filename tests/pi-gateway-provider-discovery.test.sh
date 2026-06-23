#!/usr/bin/env bash
# Integration/package regression test for the runtime image's real Pi CLI
# gateway provider extension discovery.

set -euo pipefail

TEST_NAME="Pi CLI gateway provider discovery"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_TAG="${KASEKI_RUNTIME_IMAGE:-kaseki-agent:pi-gateway-provider-discovery}"
TMP_DIR="$(mktemp -d)"
RUN_LOG="$TMP_DIR/pi-gateway-provider-discovery.log"
KEY_FILE="$TMP_DIR/llm_gateway_api_key"
EXTENSION_COPY="$TMP_DIR/pi-extensions.mjs"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  echo "✗ FAIL: $TEST_NAME: $*" >&2
  if [ -f "$RUN_LOG" ]; then
    echo "--- docker/pi output ---" >&2
    cat "$RUN_LOG" >&2
    echo "--- end output ---" >&2
  fi
  exit 1
}

printf '%s\n' 'file-backed-gateway-key' > "$KEY_FILE"
chmod 600 "$KEY_FILE"
cp "$REPO_ROOT/.pi-extensions.js" "$EXTENSION_COPY"

echo "Verifying gateway extension resolves API key from LLM_GATEWAY_API_KEY_FILE"
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

if ! command -v docker >/dev/null 2>&1; then
  echo "⚠ SKIP: $TEST_NAME runtime image check requires docker in PATH"
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  echo "⚠ SKIP: $TEST_NAME runtime image check requires a running Docker daemon"
  exit 0
fi

if [ -z "${KASEKI_RUNTIME_IMAGE:-}" ]; then
  echo "Building runtime image under test: $IMAGE_TAG"
  docker build --target runtime -t "$IMAGE_TAG" "$REPO_ROOT"
else
  echo "Using runtime image under test from KASEKI_RUNTIME_IMAGE: $IMAGE_TAG"
fi

echo "Running real Pi CLI provider discovery inside runtime image"
set +e
docker run --rm \
  --entrypoint /bin/bash \
  -e KASEKI_PROVIDER=gateway \
  -e LLM_GATEWAY_URL=https://gateway.example.invalid/v1 \
  -e LLM_GATEWAY_API_KEY_FILE=/secrets/llm_gateway_api_key \
  -v "$KEY_FILE:/secrets/llm_gateway_api_key:ro" \
  "$IMAGE_TAG" \
  -l -c 'set -euo pipefail; pi --version; pi --list-models' >"$RUN_LOG" 2>&1
run_exit=$?
set -e

if [ "$run_exit" -ne 0 ]; then
  fail "pi --list-models exited $run_exit; gateway extension discovery did not complete"
fi

if ! grep -Eiq '(^|[^[:alnum:]_-])gateway([^[:alnum:]_-]|$)' "$RUN_LOG"; then
  fail "pi --list-models did not report provider gateway"
fi

if ! grep -Eq '\bPi\b|\bpi\b' "$RUN_LOG"; then
  fail "output did not include Pi CLI version/banner, so the real pi executable may not have run"
fi

echo "✓ PASS: $TEST_NAME"
