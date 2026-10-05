#!/usr/bin/env bash
# One-command, host-Node-free setup for a Raspberry Pi Docker Compose host.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${KASEKI_SETUP_ENV_FILE:-${ROOT_DIR}/.env}"
read_env_value() {
  local key="$1"
  local value=''
  [ -f "$ENV_FILE" ] || return 0
  value="$(awk -v prefix="${key}=" 'index($0, prefix) == 1 { print substr($0, length(prefix) + 1); exit }' "$ENV_FILE")"
  if [ "${value:0:1}" = '"' ] && [ "${value: -1}" = '"' ]; then
    value="${value:1:${#value}-2}"
  elif [ "${value:0:1}" = "'" ] && [ "${value: -1}" = "'" ]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

SECRETS_DIR="${KASEKI_HOST_SECRETS_DIR:-$(read_env_value KASEKI_HOST_SECRETS_DIR)}"
SECRETS_DIR="${SECRETS_DIR:-${HOME}/secrets}"
AGENTS_DIR="${KASEKI_SETUP_AGENTS_DIR:-/agents}"
API_IMAGE="${KASEKI_API_IMAGE:-$(read_env_value KASEKI_API_IMAGE)}"
API_IMAGE="${API_IMAGE:-docker.io/cyanautomation/kaseki-agent:latest}"
API_PORT="${KASEKI_API_PORT:-$(read_env_value KASEKI_API_PORT)}"
API_PORT="${API_PORT:-8080}"
API_BIND_ADDRESS="${KASEKI_API_BIND_ADDRESS:-$(read_env_value KASEKI_API_BIND_ADDRESS)}"
API_BIND_ADDRESS="${API_BIND_ADDRESS:-127.0.0.1}"
API_MAX_CONCURRENT_RUNS="${KASEKI_API_MAX_CONCURRENT_RUNS:-$(read_env_value KASEKI_API_MAX_CONCURRENT_RUNS)}"
API_MAX_CONCURRENT_RUNS="${API_MAX_CONCURRENT_RUNS:-1}"
API_LOG_LEVEL="${KASEKI_API_LOG_LEVEL:-$(read_env_value KASEKI_API_LOG_LEVEL)}"
API_LOG_LEVEL="${API_LOG_LEVEL:-info}"
GATEWAY_URL="${KASEKI_SETUP_LLM_GATEWAY_URL:-${LLM_GATEWAY_URL:-$(read_env_value LLM_GATEWAY_URL)}}"
GATEWAY_MODEL="${KASEKI_SETUP_LLM_GATEWAY_MODEL:-${LLM_GATEWAY_MODEL:-$(read_env_value LLM_GATEWAY_MODEL)}}"
GATEWAY_MODEL="${GATEWAY_MODEL:-dynamic/kaseki-agent}"
GATEWAY_KEY_SOURCE="${KASEKI_SETUP_LLM_GATEWAY_API_KEY_FILE:-${LLM_GATEWAY_API_KEY_FILE:-}}"

fail() {
  printf 'Setup error: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '%s\n' "$*"
}

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    fail "Root permission is required for $1. Install sudo or run this script as root."
  fi
}

prompt_value() {
  local prompt="$1"
  local value=''
  if [ ! -t 0 ]; then
    fail "$prompt Set KASEKI_SETUP_LLM_GATEWAY_URL or run this script in a terminal."
  fi
  IFS= read -r -p "$prompt" value
  printf '%s' "$value"
}

if ! command -v docker >/dev/null 2>&1; then
  fail 'Docker is required. Install Docker Engine and re-run this script.'
fi
docker info >/dev/null 2>&1 || fail 'Docker is installed but the daemon is not available to this user.'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is required. Install the Docker Compose plugin.'

if [ -z "$GATEWAY_URL" ]; then
  GATEWAY_URL="$(prompt_value 'OpenAI-compatible gateway URL (required): ')"
fi
[[ "$GATEWAY_URL" =~ ^https?://[^[:space:]]+$ ]] || fail 'LLM_GATEWAY_URL must be a valid http(s) URL without spaces.'
[[ "$GATEWAY_MODEL" =~ ^[^[:space:]]+$ ]] || fail 'LLM_GATEWAY_MODEL must be a non-empty model identifier without spaces.'
if [ -f "$ENV_FILE" ] && grep -Eq '^(LLM_GATEWAY_API_KEY|KASEKI_API_KEYS|OPENROUTER_API_KEY|GITHUB_APP_ID|GITHUB_APP_CLIENT_ID|GITHUB_APP_PRIVATE_KEY)=' "$ENV_FILE"; then
  fail "Inline credentials are present in $ENV_FILE. Move them to files in $SECRETS_DIR, remove the inline entries, and re-run setup."
fi

mkdir -p "$SECRETS_DIR"
if [ -z "$GATEWAY_KEY_SOURCE" ] && [ -s "$SECRETS_DIR/llm_gateway_api_key" ]; then
  GATEWAY_KEY_SOURCE="$SECRETS_DIR/llm_gateway_api_key"
fi

GATEWAY_KEY_DEST="$SECRETS_DIR/llm_gateway_api_key"
if [ -n "$GATEWAY_KEY_SOURCE" ]; then
  [ -s "$GATEWAY_KEY_SOURCE" ] || fail "Gateway key file is missing or empty: $GATEWAY_KEY_SOURCE"
  if [ "$(cd "$(dirname "$GATEWAY_KEY_SOURCE")" && pwd)/$(basename "$GATEWAY_KEY_SOURCE")" != \
       "$(cd "$SECRETS_DIR" && pwd)/llm_gateway_api_key" ]; then
    install -m 0600 "$GATEWAY_KEY_SOURCE" "$GATEWAY_KEY_DEST"
  fi
elif [ -t 0 ]; then
  IFS= read -r -s -p 'LLM Gateway API key (input hidden): ' GATEWAY_KEY
  printf '\n'
  [ -n "$GATEWAY_KEY" ] || fail 'The gateway API key cannot be empty.'
  (umask 077; printf '%s\n' "$GATEWAY_KEY" > "$GATEWAY_KEY_DEST")
  unset GATEWAY_KEY
else
  fail "Gateway key file not found. Place it at $GATEWAY_KEY_DEST or set KASEKI_SETUP_LLM_GATEWAY_API_KEY_FILE."
fi
[ ! -L "$GATEWAY_KEY_DEST" ] || fail "Secret file must not be a symlink: $GATEWAY_KEY_DEST"

if [ ! -s "$SECRETS_DIR/kaseki_api_keys" ]; then
  if command -v openssl >/dev/null 2>&1; then
    API_KEY="$(openssl rand -hex 32)"
  else
    API_KEY="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  fi
  (umask 077; printf '%s\n' "$API_KEY" > "$SECRETS_DIR/kaseki_api_keys")
  unset API_KEY
fi
[ ! -L "$SECRETS_DIR/kaseki_api_keys" ] || fail "Secret file must not be a symlink: $SECRETS_DIR/kaseki_api_keys"

# The API container runs as UID/GID 10000. Give that group read access to
# secret files while keeping all other host users out.
if ! getent group 10000 >/dev/null 2>&1; then
  as_root groupadd --gid 10000 kaseki
fi
as_root chown "$(id -u):10000" "$SECRETS_DIR"
as_root chgrp 10000 "$SECRETS_DIR"
as_root chmod 0750 "$SECRETS_DIR"
for secret_file in "$SECRETS_DIR"/*; do
  [ -f "$secret_file" ] || continue
  [ ! -L "$secret_file" ] || fail "Secret files must not be symlinks: $secret_file"
  as_root chgrp 10000 "$secret_file"
  as_root chmod 0640 "$secret_file"
done

if ! [[ "${DOCKER_GID:-}" =~ ^[0-9]+$ ]]; then
  DOCKER_GID="$(stat -c '%g' /var/run/docker.sock 2>/dev/null || true)"
fi
[[ "${DOCKER_GID:-}" =~ ^[0-9]+$ ]] || fail 'Could not determine Docker socket GID. Set DOCKER_GID and re-run.'

as_root mkdir -p "$AGENTS_DIR/kaseki-results" "$AGENTS_DIR/kaseki-runs" "$AGENTS_DIR/kaseki-cache" "$AGENTS_DIR/kaseki-template"
as_root chown 10000:10000 "$AGENTS_DIR" "$AGENTS_DIR/kaseki-results" "$AGENTS_DIR/kaseki-runs" "$AGENTS_DIR/kaseki-cache" "$AGENTS_DIR/kaseki-template"
as_root chmod 0755 "$AGENTS_DIR"

other_container="$(docker ps --filter "publish=${API_PORT}" --format '{{.Names}}' 2>/dev/null | awk '$0 != "kaseki-api" { print; exit }')"
[ -z "$other_container" ] || fail "Host port $API_PORT is already published by container '$other_container'. Choose another KASEKI_API_PORT or stop that service."

log "Pulling $API_IMAGE for this Pi's architecture..."
docker pull "$API_IMAGE"
PINNED_IMAGE="$(docker image inspect --format '{{index .RepoDigests 0}}' "$API_IMAGE" 2>/dev/null | head -n 1)"
[[ "$PINNED_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]] || fail 'Docker did not return an immutable image digest; refusing to write an unpinned setup.'

mkdir -p "$(dirname "$ENV_FILE")"
ENV_TMP="$(mktemp "${ENV_FILE}.XXXXXX")"
trap 'rm -f "${ENV_TMP:-}"' EXIT
{
  printf 'KASEKI_API_IMAGE=%s\n' "$PINNED_IMAGE"
  printf 'KASEKI_IMAGE=%s\n' "$PINNED_IMAGE"
  printf 'KASEKI_HOST_SECRETS_DIR=%s\n' "$SECRETS_DIR"
  printf 'KASEKI_API_PORT=%s\n' "$API_PORT"
  printf 'KASEKI_API_BIND_ADDRESS=%s\n' "$API_BIND_ADDRESS"
  printf 'KASEKI_API_MAX_CONCURRENT_RUNS=%s\n' "$API_MAX_CONCURRENT_RUNS"
  printf 'KASEKI_API_LOG_LEVEL=%s\n' "$API_LOG_LEVEL"
  printf 'DOCKER_GID=%s\n' "$DOCKER_GID"
  printf 'KASEKI_PROVIDER=gateway\n'
  printf 'LLM_GATEWAY_URL=%s\n' "$GATEWAY_URL"
  printf 'LLM_GATEWAY_MODEL=%s\n' "$GATEWAY_MODEL"
  printf 'KASEKI_MODEL=%s\n' "$GATEWAY_MODEL"
} > "$ENV_TMP"
if [ -f "$ENV_FILE" ]; then
  grep -Ev '^(KASEKI_API_IMAGE|KASEKI_IMAGE|KASEKI_HOST_SECRETS_DIR|KASEKI_API_PORT|KASEKI_API_BIND_ADDRESS|KASEKI_API_MAX_CONCURRENT_RUNS|KASEKI_API_LOG_LEVEL|DOCKER_GID|KASEKI_PROVIDER|LLM_GATEWAY_URL|LLM_GATEWAY_MODEL|KASEKI_MODEL)=' "$ENV_FILE" >> "$ENV_TMP" || true
fi
chmod 0600 "$ENV_TMP"
mv "$ENV_TMP" "$ENV_FILE"
trap - EXIT

docker compose --project-directory "$ROOT_DIR" --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.yml" config --quiet || \
  fail "Compose configuration is invalid. Review $ENV_FILE and try again."
docker compose --project-directory "$ROOT_DIR" --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.yml" up -d || \
  fail "Compose could not start Kaseki. Check docker compose logs kaseki-api for the reported cause."

log 'Kaseki API setup completed.'
log "API endpoint: ${API_BIND_ADDRESS}:${API_PORT}"
log "Secrets are stored in $SECRETS_DIR with mode 0640 and are not written to .env."
log "Use the first line of $SECRETS_DIR/kaseki_api_keys as the bearer token."
log 'Check startup with: docker compose logs -f kaseki-api'
