#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
cleanup() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    for file in "$TMP_DIR/setup.log" "$TMP_DIR/rerun.log" "$TMP_DIR/missing-url.log" "$TMP_DIR/unsafe-url.log" "$TMP_DIR/invalid-image.log" "$TMP_DIR/invalid-bind.log" "$TMP_DIR/invalid-timeout.log" "$TMP_DIR/interrupted-pull.log" "$TMP_DIR/resume.log" "$TMP_DIR/diagnose.log" "$TMP_DIR/startup-failure.log" "$TMP_DIR/docker.log"; do
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
  'ps --format '* ) printf 'hawser-senku 0.0.0.0:2375->2375/tcp\n' ;;
  'ps --filter publish='*) exit 0 ;;
  'inspect --format '*) printf '%s\n' "${DOCKER_HEALTH_STATUS:-healthy}" ;;
  'pull '*) [ "${DOCKER_PULL_FAIL:-0}" != 1 ] ;;
  'image inspect --format {{.Size}} '*) printf '572522496\n' ;;
  'image inspect '*) printf 'docker.io/cyanautomation/kaseki-agent@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n' ;;
  *' logs --tail=80 '*) printf 'startup diagnostic contains provider-key-do-not-print\n' ;;
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
grep -q 'Kaseki API is ready' "$TMP_DIR/setup.log"
grep -q 'gateway URL and key were not contacted' "$TMP_DIR/setup.log"
grep -q 'Installed image size: 546.0 MiB' "$TMP_DIR/setup.log"
grep -q 'Docker management endpoint' "$TMP_DIR/setup.log"
grep -q '2375->' "$TMP_DIR/setup.log"
grep -q 'mounted socket; protect its bearer token' "$TMP_DIR/setup.log"
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

mkdir -p "$TMP_DIR/interrupted"
: > "$DOCKER_LOG"
if DOCKER_PULL_FAIL=1 KASEKI_SETUP_ENV_FILE="$TMP_DIR/interrupted/.env" \
  bash "$ROOT_DIR/scripts/setup-pi.sh" > "$TMP_DIR/interrupted-pull.log" 2>&1; then
  echo 'setup unexpectedly accepted an interrupted image pull' >&2
  exit 1
fi
grep -q '^LLM_GATEWAY_URL=https://gateway.example/v1$' "$TMP_DIR/interrupted/.env"
grep -q 'rerun setup to continue' "$TMP_DIR/interrupted-pull.log"
if grep -q 'docker compose .* up' "$DOCKER_LOG"; then
  echo 'setup started Compose after the image pull failed' >&2
  exit 1
fi

: > "$DOCKER_LOG"
(
  unset KASEKI_SETUP_LLM_GATEWAY_URL KASEKI_SETUP_LLM_GATEWAY_MODEL KASEKI_API_IMAGE
  KASEKI_SETUP_ENV_FILE="$TMP_DIR/interrupted/.env" bash "$ROOT_DIR/scripts/setup-pi.sh" > "$TMP_DIR/resume.log" 2>&1
)
grep -q 'Kaseki API is ready' "$TMP_DIR/resume.log"

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

: > "$DOCKER_LOG"
if KASEKI_SETUP_LLM_GATEWAY_URL='https://user:not-a-real-secret@gateway.example/v1' \
  bash "$ROOT_DIR/scripts/setup-pi.sh" > "$TMP_DIR/unsafe-url.log" 2>&1; then
  echo 'setup unexpectedly accepted credentials embedded in the gateway URL' >&2
  exit 1
fi
grep -q 'must not contain credentials' "$TMP_DIR/unsafe-url.log"
if grep -q 'docker compose .* up' "$DOCKER_LOG" || grep -q 'not-a-real-secret' "$TMP_DIR/unsafe-url.log"; then
  echo 'unsafe gateway URL reached Compose or was printed' >&2
  exit 1
fi

: > "$DOCKER_LOG"
if KASEKI_API_IMAGE=$'bad-image\nKASEKI_PROVIDER=openrouter' \
  bash "$ROOT_DIR/scripts/setup-pi.sh" > "$TMP_DIR/invalid-image.log" 2>&1; then
  echo 'setup unexpectedly accepted a malformed image reference' >&2
  exit 1
fi
grep -q 'KASEKI_API_IMAGE must be a valid Docker image reference' "$TMP_DIR/invalid-image.log"
if grep -q 'docker pull ' "$DOCKER_LOG"; then
  echo 'setup attempted to pull an image before validating its reference' >&2
  exit 1
fi

: > "$DOCKER_LOG"
if KASEKI_API_BIND_ADDRESS='999.999.999.999' bash "$ROOT_DIR/scripts/setup-pi.sh" > "$TMP_DIR/invalid-bind.log" 2>&1; then
  echo 'setup unexpectedly accepted an invalid API bind address' >&2
  exit 1
fi
grep -q 'must be a valid IPv4 address' "$TMP_DIR/invalid-bind.log"
if grep -q 'docker pull ' "$DOCKER_LOG"; then
  echo 'setup attempted to pull an image before validating its bind address' >&2
  exit 1
fi

: > "$DOCKER_LOG"
if KASEKI_SETUP_READY_TIMEOUT_SECONDS=invalid bash "$ROOT_DIR/scripts/setup-pi.sh" > "$TMP_DIR/invalid-timeout.log" 2>&1; then
  echo 'setup unexpectedly accepted an invalid readiness timeout' >&2
  exit 1
fi
if grep -q 'docker compose .* up' "$DOCKER_LOG"; then
  echo 'setup started Compose after rejecting an invalid timeout' >&2
  exit 1
fi

: > "$DOCKER_LOG"
bash "$ROOT_DIR/scripts/setup-pi.sh" --diagnose > "$TMP_DIR/diagnose.log" 2>&1
if grep -Eq 'docker (pull|compose .* (config|up))' "$DOCKER_LOG"; then
  echo 'diagnostics changed the Docker deployment' >&2
  exit 1
fi
grep -q 'Kaseki setup diagnostics' "$TMP_DIR/diagnose.log"
grep -q 'llm_gateway_api_key' "$TMP_DIR/diagnose.log"
grep -q 'Disk space:' "$TMP_DIR/diagnose.log"
grep -q 'Published Docker ports on this host:' "$TMP_DIR/diagnose.log"
grep -q 'Kaseki API health: healthy' "$TMP_DIR/diagnose.log"
if grep -q 'provider-key-do-not-print' "$TMP_DIR/diagnose.log"; then
  echo 'diagnostics printed a secret value' >&2
  exit 1
fi

: > "$DOCKER_LOG"
if DOCKER_HEALTH_STATUS=unhealthy KASEKI_SETUP_READY_TIMEOUT_SECONDS=0 \
  bash "$ROOT_DIR/scripts/setup-pi.sh" > "$TMP_DIR/startup-failure.log" 2>&1; then
  echo 'setup unexpectedly accepted an unhealthy API container' >&2
  exit 1
fi
grep -q 'Kaseki API did not become ready' "$TMP_DIR/startup-failure.log"
grep -q '\[REDACTED\]' "$TMP_DIR/startup-failure.log"
if grep -q 'provider-key-do-not-print' "$TMP_DIR/startup-failure.log"; then
  echo 'startup diagnostics printed a secret value' >&2
  exit 1
fi

echo 'Pi setup contract tests passed'
