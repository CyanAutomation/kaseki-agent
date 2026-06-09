#!/usr/bin/env bash
# tests/run-kaseki-github-app-worker-env.test.sh
# Verifies run-kaseki.sh passes explicit GitHub App secret file paths to the worker.

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

PRIVATE_KEY_FILE="$TMP_DIR/private-key.pem"
printf '%s\n' \
  '-----BEGIN RSA PRIVATE KEY-----' \
  'fixture-private-key-body' \
  '-----END RSA PRIVATE KEY-----' > "$PRIVATE_KEY_FILE"

KASEKI_ROOT="$TMP_DIR/kaseki"
OUTPUT_LOG="$TMP_DIR/run-output.log"
DOCKER_ARGS_CAPTURE="$TMP_DIR/docker-args.txt"

PATH="$FAKE_BIN:$PATH" \
DOCKER_ARGS_CAPTURE="$DOCKER_ARGS_CAPTURE" \
KASEKI_ROOT="$KASEKI_ROOT" \
OPENROUTER_API_KEY="test-openrouter-key" \
REPO_URL="https://github.com/acme/widgets" \
GIT_REF="main" \
GITHUB_APP_ENABLED="1" \
GITHUB_APP_ID="123456" \
GITHUB_APP_CLIENT_ID="Iv1.testclient" \
GITHUB_APP_PRIVATE_KEY_FILE="$PRIVATE_KEY_FILE" \
KASEKI_PUBLISH_MODE="branch" \
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

assert_arg_matches() {
  local pattern="$1"
  local description="$2"
  if ! grep -Eq -- "$pattern" "$DOCKER_ARGS_CAPTURE"; then
    printf '✗ missing docker argument for %s matching: %s\n' "$description" "$pattern"
    printf '%s\n' '--- captured docker args ---'
    cat "$DOCKER_ARGS_CAPTURE"
    printf '%s\n' '--- run-kaseki output ---'
    cat "$OUTPUT_LOG"
    exit 1
  fi
}

assert_arg_present 'GITHUB_APP_ENABLED=1' 'GitHub App enabled flag'
assert_arg_present 'GITHUB_APP_ID_FILE=/run/secrets/github_app_id' 'GitHub App ID worker file env'
assert_arg_present 'GITHUB_APP_CLIENT_ID_FILE=/run/secrets/github_app_client_id' 'GitHub App Client ID worker file env'
assert_arg_present 'GITHUB_APP_PRIVATE_KEY_FILE=/run/secrets/github_app_private_key' 'GitHub App private key worker file env'
assert_arg_matches '.*/github_app_id:/run/secrets/github_app_id:ro$' 'GitHub App ID root-level secret mount'
assert_arg_matches '.*/github_app_client_id:/run/secrets/github_app_client_id:ro$' 'GitHub App Client ID root-level secret mount'
assert_arg_matches '.*/github_app_private_key:/run/secrets/github_app_private_key:ro$' 'GitHub App private key root-level secret mount'

if grep -Fxq -- 'KASEKI_SECRETS_DIR=/run/secrets' "$DOCKER_ARGS_CAPTURE"; then
  printf '✗ launcher should pass explicit GitHub App file env vars instead of KASEKI_SECRETS_DIR\n'
  cat "$DOCKER_ARGS_CAPTURE"
  exit 1
fi

printf '✓ run-kaseki.sh passes explicit GitHub App worker secret file env vars\n'
