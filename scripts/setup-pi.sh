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
API_BIND_ADDRESS_CONFIGURED="$API_BIND_ADDRESS"
API_BIND_ADDRESS="${API_BIND_ADDRESS:-127.0.0.1}"
API_MAX_CONCURRENT_RUNS="${KASEKI_API_MAX_CONCURRENT_RUNS:-$(read_env_value KASEKI_API_MAX_CONCURRENT_RUNS)}"
API_MAX_CONCURRENT_RUNS="${API_MAX_CONCURRENT_RUNS:-1}"
API_LOG_LEVEL="${KASEKI_API_LOG_LEVEL:-$(read_env_value KASEKI_API_LOG_LEVEL)}"
API_LOG_LEVEL="${API_LOG_LEVEL:-info}"
READY_TIMEOUT="${KASEKI_SETUP_READY_TIMEOUT_SECONDS:-180}"
GATEWAY_URL="${KASEKI_SETUP_LLM_GATEWAY_URL:-${LLM_GATEWAY_URL:-$(read_env_value LLM_GATEWAY_URL)}}"
GATEWAY_MODEL="${KASEKI_SETUP_LLM_GATEWAY_MODEL:-${LLM_GATEWAY_MODEL:-$(read_env_value LLM_GATEWAY_MODEL)}}"
GATEWAY_MODEL="${GATEWAY_MODEL:-dynamic/kaseki-agent}"
GATEWAY_KEY_SOURCE="${KASEKI_SETUP_LLM_GATEWAY_API_KEY_FILE:-${LLM_GATEWAY_API_KEY_FILE:-}}"

fail() {
  printf 'Setup error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: bash scripts/setup-pi.sh [--diagnose | --help]

Run the guided Raspberry Pi Compose setup, or inspect the current setup without
changing it with --diagnose. The default API binding is loopback (127.0.0.1).
The provider key is stored in a host file and setup never sends an inference
request.

Provider URL examples:
  Cloudflare AI Gateway: https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/compat
  OpenAI-compatible API: https://api.openai.com/v1
  Ollama on this network: http://<ollama-host>:11434/v1

Use LLM_GATEWAY_MODEL only when your gateway does not support the default
dynamic/kaseki-agent model route. Keep credentials out of the URL.
EOF
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

docker_cmd() {
  if docker info >/dev/null 2>&1; then
    command docker "$@"
  elif command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
    sudo docker "$@"
  else
    fail 'Docker is installed but its daemon is not available to this user or through sudo.'
  fi
}

compose_cmd() {
  docker_cmd compose --project-directory "$ROOT_DIR" --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.yml" "$@"
}

is_valid_ipv4() {
  local address="$1"
  local octet
  local -a octets
  IFS=. read -r -a octets <<< "$address"
  [ "${#octets[@]}" -eq 4 ] || return 1
  for octet in "${octets[@]}"; do
    [[ "$octet" =~ ^[0-9]{1,3}$ ]] || return 1
    (( 10#$octet <= 255 )) || return 1
  done
}

show_diagnostics() {
  log 'Kaseki setup diagnostics (read-only)'
  docker_cmd info >/dev/null 2>&1 || fail 'Docker daemon is not available to this user or through sudo.'
  docker_cmd compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is unavailable.'
  log 'Docker daemon: available'
  docker_cmd compose version

  if [ -f "$ENV_FILE" ]; then
    log "Environment file: present ($(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE") permissions)"
    configured_image="$(read_env_value KASEKI_API_IMAGE)"
    [ -z "$configured_image" ] || log "Configured image: $configured_image"
  else
    log "Environment file: not found ($ENV_FILE)"
  fi

  if [ -d "$SECRETS_DIR" ]; then
    log "Secret directory: present ($(stat -c '%a, group %g' "$SECRETS_DIR" 2>/dev/null || stat -f '%Lp' "$SECRETS_DIR") permissions)"
    for secret_name in llm_gateway_api_key kaseki_api_keys; do
      secret_path="$SECRETS_DIR/$secret_name"
      if [ -f "$secret_path" ]; then
        log "Secret file $secret_name: present ($(stat -c '%a, group %g' "$secret_path" 2>/dev/null || stat -f '%Lp' "$secret_path") permissions)"
      else
        log "Secret file $secret_name: missing"
      fi
    done
  else
    log "Secret directory: missing ($SECRETS_DIR)"
  fi

  log "Disk space:"
  df -h "$SECRETS_DIR" 2>/dev/null || df -h "$HOME"
  log "Published Docker ports on this host:"
  docker_cmd ps --format '{{.Names}} {{.Ports}}' 2>/dev/null || true
  log "Port $API_PORT users:"
  docker_cmd ps --filter "publish=$API_PORT" --format '{{.Names}}' 2>/dev/null || true
  health_status="$(docker_cmd inspect --format '{{.State.Health.Status}}' kaseki-api 2>/dev/null || true)"
  log "Kaseki API health: ${health_status:-container not found}"
}

case "${1:-}" in
  --help|-h) usage; exit 0 ;;
  --diagnose|doctor) [ "$#" -eq 1 ] || fail 'The diagnostics command does not accept additional arguments.'; SETUP_MODE='--diagnose' ;;
  '') SETUP_MODE='setup' ;;
  *) fail "Unknown option: $1 (use --help for usage)." ;;
esac

[[ "$API_IMAGE" =~ ^[[:alnum:]][[:alnum:]./_:@-]*$ ]] || \
  fail 'KASEKI_API_IMAGE must be a valid Docker image reference without whitespace.'
is_valid_ipv4 "$API_BIND_ADDRESS" || \
  fail 'KASEKI_API_BIND_ADDRESS must be a valid IPv4 address.'
[[ "$API_PORT" =~ ^[0-9]+$ ]] && (( 10#$API_PORT >= 1 && 10#$API_PORT <= 65535 )) || \
  fail 'KASEKI_API_PORT must be an integer from 1 to 65535.'
[[ "$API_MAX_CONCURRENT_RUNS" =~ ^[0-9]+$ ]] && (( 10#$API_MAX_CONCURRENT_RUNS >= 1 )) || \
  fail 'KASEKI_API_MAX_CONCURRENT_RUNS must be a positive integer.'
case "$API_LOG_LEVEL" in
  debug|info|warn|error) ;;
  *) fail 'KASEKI_API_LOG_LEVEL must be debug, info, warn, or error.' ;;
esac
[[ "$READY_TIMEOUT" =~ ^[0-9]+$ ]] || fail 'KASEKI_SETUP_READY_TIMEOUT_SECONDS must be a non-negative integer.'

log 'Stage 1/5: checking Docker and Compose...'
if ! command -v docker >/dev/null 2>&1; then
  fail 'Docker is required. Run scripts/bootstrap-pi.sh to install Docker Engine and Compose, then retry.'
fi
docker_cmd info >/dev/null 2>&1 || fail 'Docker daemon is not available to this user or through sudo.'
docker_cmd compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is required. Run scripts/bootstrap-pi.sh to install the Docker Compose plugin.'

if [ "$SETUP_MODE" = '--diagnose' ]; then
  show_diagnostics
  exit 0
fi

if [ -z "$GATEWAY_URL" ]; then
  log 'The gateway URL is the OpenAI-compatible base endpoint from your model provider.'
  log 'Examples: https://api.openai.com/v1 or https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/compat'
  log "Gateway API key file: $SECRETS_DIR/llm_gateway_api_key (the key value is never written to .env)."
  GATEWAY_URL="$(prompt_value 'Gateway base URL (required): ')"
fi
[[ "$GATEWAY_URL" =~ ^https?://[^[:space:]]+$ ]] || fail 'LLM_GATEWAY_URL must be a valid http(s) URL without spaces.'
gateway_authority="${GATEWAY_URL#*://}"
gateway_authority="${gateway_authority%%/*}"
[[ "$gateway_authority" != *@* && "$GATEWAY_URL" != *\?* && "$GATEWAY_URL" != *\#* ]] || \
  fail 'LLM_GATEWAY_URL must not contain credentials, query parameters, or a fragment. Store authentication in the key file.'
[[ "$GATEWAY_MODEL" =~ ^[^[:space:]]+$ ]] || fail 'LLM_GATEWAY_MODEL must be a non-empty model identifier without spaces.'
if [ -f "$ENV_FILE" ] && grep -Eq '^(LLM_GATEWAY_API_KEY|KASEKI_API_KEYS|OPENROUTER_API_KEY|GITHUB_APP_ID|GITHUB_APP_CLIENT_ID|GITHUB_APP_PRIVATE_KEY)=' "$ENV_FILE"; then
  fail "Inline credentials are present in $ENV_FILE. Move them to files in $SECRETS_DIR, remove the inline entries, and re-run setup."
fi

log 'Stage 2/5: configuring provider credentials...'
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

log 'Stage 3/5: preparing host directories and network binding...'
if [ -z "$API_BIND_ADDRESS_CONFIGURED" ] && [ -t 0 ]; then
  read -r -p 'Allow devices on your LAN to connect to the API? Requires firewall controls and the bearer token [y/N]: ' LAN_ACCESS
  case "$LAN_ACCESS" in
    y|Y|yes|YES) API_BIND_ADDRESS='0.0.0.0' ;;
    *) API_BIND_ADDRESS='127.0.0.1' ;;
  esac
fi

as_root mkdir -p "$AGENTS_DIR/kaseki-results" "$AGENTS_DIR/kaseki-runs" "$AGENTS_DIR/kaseki-cache" "$AGENTS_DIR/kaseki-template"
as_root chown 10000:10000 "$AGENTS_DIR" "$AGENTS_DIR/kaseki-results" "$AGENTS_DIR/kaseki-runs" "$AGENTS_DIR/kaseki-cache" "$AGENTS_DIR/kaseki-template"
as_root chmod 0755 "$AGENTS_DIR"

management_endpoints="$(docker_cmd ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | awk '/(^|[[:space:]])(0\.0\.0\.0:|\[::\]:|:::)?2375->|(0\.0\.0\.0:|\[::\]:|:::)?2376->/ { print }')"
if [ -n "$management_endpoints" ]; then
  log 'WARNING: a Docker management endpoint is published on this host:'
  log "$management_endpoints"
  log 'Review its firewall and access controls. Kaseki leaves existing containers unchanged.'
fi
other_container="$(docker_cmd ps --filter "publish=${API_PORT}" --format '{{.Names}}' 2>/dev/null | awk '$0 != "kaseki-api" { print; exit }')"
[ -z "$other_container" ] || fail "Host port $API_PORT is already published by container '$other_container'. Choose another KASEKI_API_PORT or stop that service."

write_env_file() {
  local image_ref="$1"
  local env_tmp
  mkdir -p "$(dirname "$ENV_FILE")"
  env_tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
  {
    printf 'KASEKI_API_IMAGE=%s\n' "$image_ref"
    printf 'KASEKI_IMAGE=%s\n' "$image_ref"
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
  } > "$env_tmp"
  if [ -f "$ENV_FILE" ]; then
    grep -Ev '^(KASEKI_API_IMAGE|KASEKI_IMAGE|KASEKI_HOST_SECRETS_DIR|KASEKI_API_PORT|KASEKI_API_BIND_ADDRESS|KASEKI_API_MAX_CONCURRENT_RUNS|KASEKI_API_LOG_LEVEL|DOCKER_GID|KASEKI_PROVIDER|LLM_GATEWAY_URL|LLM_GATEWAY_MODEL|KASEKI_MODEL)=' "$ENV_FILE" >> "$env_tmp" || true
  fi
  chmod 0600 "$env_tmp"
  mv "$env_tmp" "$ENV_FILE"
}

write_env_file "$API_IMAGE" || fail "Could not save setup configuration to $ENV_FILE."
log "Saved non-secret setup settings to $ENV_FILE so an interrupted image pull can resume."
log 'Stage 4/5: pulling the Kaseki image for this Pi architecture (Docker shows download progress)...'
docker_cmd pull "$API_IMAGE" || fail 'Image pull failed or was interrupted. Setup settings and credentials are saved; rerun setup to continue.'
PINNED_IMAGE="$(docker_cmd image inspect --format '{{index .RepoDigests 0}}' "$API_IMAGE" 2>/dev/null | head -n 1)"
[[ "$PINNED_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]] || fail 'Docker did not return an immutable image digest; refusing to write an unpinned setup.'
log "Pinned image digest: $PINNED_IMAGE"
IMAGE_SIZE_BYTES="$(docker_cmd image inspect --format '{{.Size}}' "$API_IMAGE" 2>/dev/null | head -n 1 || true)"
if [[ "$IMAGE_SIZE_BYTES" =~ ^[0-9]+$ ]]; then
  IMAGE_SIZE_MIB="$(awk -v bytes="$IMAGE_SIZE_BYTES" 'BEGIN { printf "%.1f", bytes / 1048576 }')"
  log "Installed image size: ${IMAGE_SIZE_MIB} MiB (local image size; download size varies with cached layers)."
fi

write_env_file "$PINNED_IMAGE" || fail "Could not pin the image digest in $ENV_FILE."

log 'Stage 5/5: validating Compose and waiting for API readiness...'
compose_cmd config --quiet || \
  fail "Compose configuration is invalid. Review $ENV_FILE and try again."
compose_cmd up -d || \
  fail "Compose could not start Kaseki. Check docker compose logs kaseki-api for the reported cause."

print_startup_diagnostics() {
  local status="$1"
  local logs secret_file secret
  printf 'Kaseki API did not become ready (health status: %s).\n' "${status:-unknown}" >&2
  compose_cmd ps >&2 || true
  logs="$(compose_cmd logs --tail=80 kaseki-api 2>&1 || true)"
  for secret_file in "$SECRETS_DIR"/*; do
    [ -f "$secret_file" ] || continue
    secret="$(cat "$secret_file" 2>/dev/null || true)"
    if [ -n "$secret" ]; then
      logs="${logs//"$secret"/[REDACTED]}"
    fi
  done
  logs="$(printf '%s\n' "$logs" | sed -E \
    -e 's/(Bearer[[:space:]]+)[^[:space:]"'"'"']+/\1[REDACTED]/Ig' \
    -e 's/(sk-or-v1-)[[:alnum:]_-]+/\1[REDACTED]/g' \
    -e 's/(cfut_)[[:alnum:]_-]+/\1[REDACTED]/g')"
  if [ -n "$logs" ]; then
    printf 'Redacted startup logs (last 80 lines):\n%s\n' "$logs" >&2
  fi
  printf 'Inspect later with: docker compose logs --tail=80 kaseki-api\n' >&2
}

log "Waiting up to ${READY_TIMEOUT}s for the container healthcheck (/ready)..."
READY_STARTED_AT="$SECONDS"
while :; do
  HEALTH_STATUS="$(docker_cmd inspect --format '{{.State.Health.Status}}' kaseki-api 2>/dev/null || true)"
  case "$HEALTH_STATUS" in
    healthy)
      log 'Kaseki API is ready (/ready healthcheck passed).'
      break
      ;;
    unhealthy)
      print_startup_diagnostics "$HEALTH_STATUS"
      exit 1
      ;;
  esac
  if (( SECONDS - READY_STARTED_AT >= READY_TIMEOUT )); then
    print_startup_diagnostics "${HEALTH_STATUS:-unknown}"
    exit 1
  fi
  REMAINING_SECONDS=$((READY_TIMEOUT - (SECONDS - READY_STARTED_AT)))
  if (( REMAINING_SECONDS < 3 )); then
    sleep "$REMAINING_SECONDS"
  else
    sleep 3
  fi
done

log 'Kaseki API setup completed.'
log "API endpoint: ${API_BIND_ADDRESS}:${API_PORT}"
log "Secrets are stored in $SECRETS_DIR with mode 0640 and are not written to .env."
log "Use the first line of $SECRETS_DIR/kaseki_api_keys as the bearer token."
log 'The gateway URL and key were not contacted; provider authentication and model access are not checked until you submit a task.'
log 'The API container can control host Docker through the mounted socket; protect its bearer token as a host-admin credential.'
log 'For ongoing diagnostics: bash scripts/setup-pi.sh --diagnose'
log 'Follow logs with: docker compose logs -f kaseki-api'
