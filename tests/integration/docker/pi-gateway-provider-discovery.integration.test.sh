#!/usr/bin/env bash
# Integration/package contract test for packaged Pi CLI discovery of the gateway provider.

set -euo pipefail

TEST_NAME="Packaged Pi CLI gateway provider discovery"
TMP_DIR="$(mktemp -d)"
RUN_LOG="$TMP_DIR/pi-gateway-provider-discovery.log"
KEY_FILE="$TMP_DIR/llm_gateway_api_key"

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

IMAGE_TAG="${1:-${KASEKI_RUNTIME_IMAGE:-}}"
if [ -z "$IMAGE_TAG" ]; then
  fail "provide an explicit image tag as argv[1] or KASEKI_RUNTIME_IMAGE for this packaging integration test"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "⚠ SKIP: $TEST_NAME requires docker in PATH"
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  echo "⚠ SKIP: $TEST_NAME requires a running Docker daemon"
  exit 0
fi

printf '%s\n' 'file-backed-gateway-key' > "$KEY_FILE"
chmod 600 "$KEY_FILE"

echo "Running real Pi CLI provider discovery inside explicit runtime image: $IMAGE_TAG"
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
  fail "pi --list-models exited $run_exit; packaged gateway extension discovery did not complete"
fi

if ! grep -Eiq '(^|[^[:alnum:]_-])gateway([^[:alnum:]_-]|$)' "$RUN_LOG"; then
  fail "pi --list-models did not report provider gateway"
fi

# Use explicit POSIX character class boundaries instead of \b for portable grep -E behavior.
if ! grep -Eq '(^|[^[:alnum:]])Pi([^[:alnum:]]|$)|(^|[^[:alnum:]])pi([^[:alnum:]]|$)' "$RUN_LOG"; then
  fail "output did not include Pi CLI version/banner, so the real pi executable may not have run"
fi

echo "✓ PASS: $TEST_NAME"
