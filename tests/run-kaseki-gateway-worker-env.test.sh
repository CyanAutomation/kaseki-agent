#!/usr/bin/env bash
# Verifies run-kaseki.sh passes gateway URL and key file paths to the worker.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

FAKE_BIN="$TMP_DIR/bin"
mkdir -p "$FAKE_BIN"

cat > "$FAKE_BIN/git" <<'EOF_GIT'
#!/usr/bin/env bash
if [ "${1:-}" = "ls-remote" ]; then
  exit 0
fi
exec /usr/bin/git "$@"
EOF_GIT
chmod +x "$FAKE_BIN/git"

cat > "$FAKE_BIN/docker" <<'EOF_DOCKER'
#!/usr/bin/env bash
if [ "${1:-}" = "image" ] && [ "${2:-}" = "inspect" ]; then
  exit 0
fi
if [ "${1:-}" = "run" ]; then
  : "${DOCKER_ARGS_CAPTURE:?DOCKER_ARGS_CAPTURE is required}"
  : > "$DOCKER_ARGS_CAPTURE"
  for arg in "$@"; do
    printf '%s\n' "$arg" >> "$DOCKER_ARGS_CAPTURE"
  done
  exit 0
fi
exit 0
EOF_DOCKER
chmod +x "$FAKE_BIN/docker"

KASEKI_ROOT="$TMP_DIR/kaseki"
OUTPUT_LOG="$TMP_DIR/run-output.log"
DOCKER_ARGS_CAPTURE="$TMP_DIR/docker-args.txt"
GATEWAY_KEY_FILE="$TMP_DIR/llm_gateway_api_key"
printf '%s' 'test-gateway-key' > "$GATEWAY_KEY_FILE"
chmod 0600 "$GATEWAY_KEY_FILE"

PATH="$FAKE_BIN:$PATH" \
DOCKER_ARGS_CAPTURE="$DOCKER_ARGS_CAPTURE" \
KASEKI_ROOT="$KASEKI_ROOT" \
OPENROUTER_API_KEY="test-openrouter-key" \
KASEKI_PROVIDER="gateway" \
LLM_GATEWAY_URL="https://gateway.example.invalid/v1/responses" \
LLM_GATEWAY_API_KEY_FILE="$GATEWAY_KEY_FILE" \
REPO_URL="https://github.com/acme/widgets" \
GIT_REF="main" \
GITHUB_APP_ENABLED="0" \
KASEKI_PUBLISH_MODE="none" \
"$PROJECT_ROOT/run-kaseki.sh" >"$OUTPUT_LOG" 2>&1

if [ ! -s "$DOCKER_ARGS_CAPTURE" ]; then
  printf '✗ docker run arguments were not captured\n'
  cat "$OUTPUT_LOG"
  exit 1
fi

assert_arg_present() {
  local expected="$1"
  local description="$2"
  if ! grep -Fxq -- "$expected" "$DOCKER_ARGS_CAPTURE"; then
    printf '✗ missing docker argument for %s: %s\n' "$description" "$expected"
    printf '%s\n' '--- captured docker args ---'
    cat "$DOCKER_ARGS_CAPTURE"
    printf '%s\n' '--- run-kaseki output ---'
    cat "$OUTPUT_LOG"
    exit 1
  fi
}

assert_arg_present 'KASEKI_PROVIDER=gateway' 'gateway provider'
assert_arg_present 'LLM_GATEWAY_URL=https://gateway.example.invalid/v1/responses' 'gateway URL worker env'
assert_arg_present 'LLM_GATEWAY_API_KEY_FILE=/run/secrets/kaseki/llm_gateway_api_key' 'gateway key worker file env'
if ! grep -Eq '.+/llm_gateway_api_key:/run/secrets/kaseki/llm_gateway_api_key:ro$' "$DOCKER_ARGS_CAPTURE"; then
  printf '✗ missing docker volume mount for gateway key worker secret path\n'
  printf '%s\n' '--- captured docker args ---'
  cat "$DOCKER_ARGS_CAPTURE"
  printf '%s\n' '--- run-kaseki output ---'
  cat "$OUTPUT_LOG"
  exit 1
fi

printf '✓ run-kaseki.sh passes gateway worker URL and key file env vars\n'
