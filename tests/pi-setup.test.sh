#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
cleanup() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    for file in "$TMP_DIR/setup.log" "$TMP_DIR/rerun.log" "$TMP_DIR/missing-url.log" "$TMP_DIR/docker.log"; do
      [ ! -f "$file" ] || { printf '\n--- %s ---\n' "$file" >&2; cat "$file" >&2; }
    done
  fi
  rm -rf "$TMP_DIR"
  exit "$status"
}
trap cleanup EXIT

BIN_DIR="$TMP_DIR/bin"
mkdir -p "$BIN_DIR" "$TMP_DIR/project" "$TMP_DIR/secrets"
printf 'CUSTOM_SETTING=keep-me\n' > "$TMP_DIR/project/.env"
printf 'provider-key-do-not-print\n' > "$TMP_DIR/provider-key"
chmod 600 "$TMP_DIR/provider-key"
DOCKER_LOG="$TMP_DIR/docker.log"

cat > "$BIN_DIR/docker" <<'MOCK_DOCKER'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "docker $*" >> "$DOCKER_LOG"
case "$*" in
  info) exit 0 ;;
  'compose version') printf 'Docker Compose version v2.0.0\n' ;;
  'pull '*) ;;
  'image inspect '*) printf 'docker.io/cyanautomation/kaseki-agent@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n' ;;
  compose*) ;;
esac
exit 0
MOCK_DOCKER
cat > "$BIN_DIR/sudo" <<'MOCK_SUDO'
#!/usr/bin/env bash
set -euo pipefail
"$@"
MOCK_SUDO
cat > "$BIN_DIR/chown" <<'MOCK_CHOWN'
#!/usr/bin/env bash
exit 0
MOCK_CHOWN
cat > "$BIN_DIR/chgrp" <<'MOCK_CHGRP'
#!/usr/bin/env bash
exit 0
MOCK_CHGRP
cat > "$BIN_DIR/getent" <<'MOCK_GETENT'
#!/usr/bin/env bash
printf 'kaseki:x:10000:\n'
MOCK_GETENT
chmod +x "$BIN_DIR"/*

export PATH="$BIN_DIR:$PATH"
export DOCKER_LOG
export KASEKI_SETUP_ENV_FILE="$TMP_DIR/project/.env"
export KASEKI_HOST_SECRETS_DIR="$TMP_DIR/secrets"
export KASEKI_SETUP_AGENTS_DIR="$TMP_DIR/agents"
export KASEKI_SETUP_LLM_GATEWAY_URL='https://gateway.example/v1'
export KASEKI_SETUP_LLM_GATEWAY_MODEL='vendor/model'
export KASEKI_SETUP_LLM_GATEWAY_API_KEY_FILE="$TMP_DIR/provider-key"
export KASEKI_API_BIND_ADDRESS='127.0.0.1'
export KASEKI_API_IMAGE='docker.io/cyanautomation/kaseki-agent:latest'
export DOCKER_GID=985

docker info >/dev/null || { echo 'fake Docker daemon probe failed' >&2; exit 1; }
docker compose version >/dev/null || { echo 'fake Compose version probe failed' >&2; exit 1; }

bash "$ROOT_DIR/scripts/setup-pi.sh" > "$TMP_DIR/setup.log" 2>&1

grep -q '^KASEKI_API_IMAGE=docker.io/cyanautomation/kaseki-agent@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$' "$KASEKI_SETUP_ENV_FILE"
grep -q '^KASEKI_IMAGE=docker.io/cyanautomation/kaseki-agent@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$' "$KASEKI_SETUP_ENV_FILE"
grep -q '^LLM_GATEWAY_URL=https://gateway.example/v1$' "$KASEKI_SETUP_ENV_FILE"
grep -q '^LLM_GATEWAY_MODEL=vendor/model$' "$KASEKI_SETUP_ENV_FILE"
grep -q '^CUSTOM_SETTING=keep-me$' "$KASEKI_SETUP_ENV_FILE"
if grep -q 'provider-key-do-not-print' "$KASEKI_SETUP_ENV_FILE" "$TMP_DIR/setup.log"; then
  echo 'provider credential leaked to setup output or .env' >&2
  exit 1
fi
mode_for() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}
test "$(mode_for "$KASEKI_HOST_SECRETS_DIR/llm_gateway_api_key")" = 640
test "$(mode_for "$KASEKI_HOST_SECRETS_DIR/kaseki_api_keys")" = 640
grep -q 'docker compose .* config' "$DOCKER_LOG"
grep -q 'docker compose .* up' "$DOCKER_LOG"
grep -q 'KASEKI_API_IMAGE:' "$ROOT_DIR/docker-compose.yml"
grep -q 'KASEKI_IMAGE:' "$ROOT_DIR/docker-compose.yml"
grep -q 'KASEKI_MODEL:' "$ROOT_DIR/docker-compose.yml"
grep -q 'LLM_GATEWAY_MODEL:' "$ROOT_DIR/docker-compose.yml"
grep -q 'restart: on-failure:3' "$ROOT_DIR/docker-compose.yml"
grep -q '127.0.0.1:8080:8080' "$ROOT_DIR/scripts/kaseki-api.service"
grep -q '/home/pi/secrets:/run/secrets/kaseki:ro' "$ROOT_DIR/scripts/kaseki-api.service"
grep -q -- '--user 10000:10000' "$ROOT_DIR/scripts/kaseki-api.service"
if grep -q 'KASEKI_API_KEYS=' "$ROOT_DIR/scripts/kaseki-api.service" "$ROOT_DIR/docs/DEPLOYMENT.md"; then
  echo 'deployment examples must not put API credentials in environment values' >&2
  exit 1
fi
if grep -Eq 'chown -R 10000:10000 /agents([[:space:]]|$)|chmod -R 755 /agents([[:space:]]|$)|chmod 777 /agents' "$ROOT_DIR/docs/DEPLOYMENT.md"; then
  echo 'deployment guidance must not recursively change /agents or make it world-writable' >&2
  exit 1
fi
config_line="$(grep -n 'docker compose .* config' "$DOCKER_LOG" | cut -d: -f1)"
up_line="$(grep -n 'docker compose .* up' "$DOCKER_LOG" | cut -d: -f1)"
test "$config_line" -lt "$up_line"

: > "$DOCKER_LOG"
(
  unset KASEKI_SETUP_LLM_GATEWAY_URL KASEKI_SETUP_LLM_GATEWAY_MODEL KASEKI_API_IMAGE
  bash "$ROOT_DIR/scripts/setup-pi.sh" > "$TMP_DIR/rerun.log" 2>&1
)
grep -q 'docker compose .* config' "$DOCKER_LOG"
grep -q 'docker compose .* up' "$DOCKER_LOG"

: > "$DOCKER_LOG"
if KASEKI_SETUP_ENV_FILE="$TMP_DIR/missing/.env" KASEKI_SETUP_LLM_GATEWAY_URL='' bash "$ROOT_DIR/scripts/setup-pi.sh" > "$TMP_DIR/missing-url.log" 2>&1; then
  echo 'setup unexpectedly accepted a missing gateway URL' >&2
  exit 1
fi
if grep -q 'docker compose .* up' "$DOCKER_LOG"; then
  echo 'setup attempted to start Compose after a failed preflight' >&2
  exit 1
fi

echo 'Pi setup contract tests passed'
