#!/usr/bin/env bash
set -euo pipefail

KASEKI_ROOT="${KASEKI_ROOT:-/agents}"
KASEKI_TEMPLATE_DIR="${KASEKI_TEMPLATE_DIR:-$KASEKI_ROOT/kaseki-template}"
KASEKI_CHECKOUT_DIR="${KASEKI_CHECKOUT_DIR:-$KASEKI_ROOT/kaseki-agent}"
KASEKI_LOG_DIR="${KASEKI_LOG_DIR:-/var/log/kaseki}"
KASEKI_CONTAINER_UID="${KASEKI_CONTAINER_UID:-10000}"
KASEKI_CONTAINER_GID="${KASEKI_CONTAINER_GID:-10000}"
KASEKI_FIX="${KASEKI_FIX:-0}"
KASEKI_RECREATE_API="${KASEKI_RECREATE_API:-0}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

detect_invoking_home() {
  if [ -n "${KASEKI_HOST_HOME:-}" ]; then
    printf '%s\n' "$KASEKI_HOST_HOME"
    return 0
  fi
  if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ] && command -v getent >/dev/null 2>&1; then
    getent passwd "$SUDO_USER" | awk -F: '{print $6}'
    return 0
  fi
  printf '%s\n' "$HOME"
}

KASEKI_EFFECTIVE_HOST_HOME="$(detect_invoking_home)"
KASEKI_HOST_SECRETS_DIR="${KASEKI_HOST_SECRETS_DIR:-$KASEKI_EFFECTIVE_HOST_HOME/secrets}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --fix)
      KASEKI_FIX="1"
      ;;
    --recreate-api)
      KASEKI_RECREATE_API="1"
      ;;
    --help|-h)
      cat <<HELP
Usage: scripts/kaseki-setup-host.sh [--fix] [--recreate-api]

Checks and optionally prepares a Kaseki API host.

Options:
  --fix           Create/fix /agents, logs, secrets modes, and bootstrap when possible.
  --recreate-api  Remove/recreate the kaseki-api container after fixing bind mounts.

Environment:
  KASEKI_HOST_SECRETS_DIR=$KASEKI_HOST_SECRETS_DIR
  KASEKI_CONTAINER_UID=$KASEKI_CONTAINER_UID
  KASEKI_CONTAINER_GID=$KASEKI_CONTAINER_GID
HELP
      exit 0
      ;;
    *)
      printf 'Error: unknown option: %s\n' "$1" >&2
      exit 2
      ;;
  esac
  shift
done

run_privileged() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return
  fi
  if "$@" 2>/dev/null; then
    return
  fi
  if command -v sudo >/dev/null 2>&1; then
    sudo "$@"
    return
  fi
  "$@"
}

ensure_dir() {
  local dir="$1"
  local mode="$2"
  if [ "$KASEKI_FIX" = "1" ]; then
    run_privileged mkdir -p "$dir"
    run_privileged chown "$KASEKI_CONTAINER_UID:$KASEKI_CONTAINER_GID" "$dir" 2>/dev/null || true
    run_privileged chmod "$mode" "$dir" 2>/dev/null || true
  fi
  if [ -d "$dir" ]; then
    printf 'ok: %s\n' "$dir"
  else
    printf 'missing: %s\n' "$dir"
    return 1
  fi
}

check_writable() {
  local dir="$1"
  if [ -w "$dir" ]; then
    printf 'writable: %s\n' "$dir"
  else
    printf 'not writable: %s\n' "$dir"
    return 1
  fi
}

normalize_secrets_dir() {
  local secrets_dir="$1"
  if [ ! -d "$secrets_dir" ]; then
    printf 'warning: host secrets directory not found at %s\n' "$secrets_dir"
    return 0
  fi

  if [ "$KASEKI_FIX" = "1" ]; then
    run_privileged chgrp "$KASEKI_CONTAINER_GID" "$secrets_dir" 2>/dev/null || true
    run_privileged chmod 0750 "$secrets_dir" 2>/dev/null || true
    find "$secrets_dir" -maxdepth 1 -type f -print0 2>/dev/null |
      while IFS= read -r -d '' file; do
        run_privileged chgrp "$KASEKI_CONTAINER_GID" "$file" 2>/dev/null || true
        run_privileged chmod 0640 "$file" 2>/dev/null || true
      done
  fi

  printf 'ok: host secrets directory found at %s\n' "$secrets_dir"
  for required_secret in openrouter_api_key github_app_id github_app_client_id github_app_private_key kaseki_api_keys; do
    if [ -f "$secrets_dir/$required_secret" ]; then
      printf 'ok: secret present: %s\n' "$required_secret"
    else
      printf 'warning: secret missing: %s\n' "$required_secret"
    fi
  done
}

has_deleted_kaseki_bind_mount() {
  if ! command -v docker >/dev/null 2>&1; then
    return 1
  fi
  if ! docker inspect kaseki-api >/dev/null 2>&1; then
    return 1
  fi
  if [ ! -d "$KASEKI_ROOT" ]; then
    return 0
  fi
  if ! docker exec kaseki-api sh -lc "grep -q ' deleted\\|/deleted' /proc/self/mountinfo" 2>/dev/null; then
    return 1
  fi
  return 0
}

print_recreate_hint_if_needed() {
  if ! has_deleted_kaseki_bind_mount; then
    return
  fi
  printf 'warning: kaseki-api container has a deleted bind mount; recreate the container after this setup completes.\n'
}

bootstrap_checkout_if_possible() {
  if [ "$KASEKI_FIX" != "1" ]; then
    return 0
  fi
  if [ -x "$KASEKI_CHECKOUT_DIR/scripts/kaseki-activate.sh" ]; then
    export KASEKI_TEMPLATE_DIR="$KASEKI_TEMPLATE_DIR"
    export KASEKI_CHECKOUT_DIR="$KASEKI_CHECKOUT_DIR"
    "$KASEKI_CHECKOUT_DIR/scripts/kaseki-activate.sh" --controller --replace-stale bootstrap
    return $?
  fi
  if [ -x "$SCRIPT_DIR/kaseki-install.sh" ]; then
    printf 'bootstrapping checkout with %s/kaseki-install.sh\n' "$SCRIPT_DIR"
    export HOME="$KASEKI_EFFECTIVE_HOST_HOME"
    export KASEKI_HOST_SECRETS_DIR="$KASEKI_HOST_SECRETS_DIR"
    export KASEKI_CONTROLLER_MODE=1
    export KASEKI_REPLACE_STALE=1
    "$SCRIPT_DIR/kaseki-install.sh"
    return $?
  fi
  printf 'missing: checkout activator at %s/scripts/kaseki-activate.sh\n' "$KASEKI_CHECKOUT_DIR"
  printf 'remediation: install the npm package and run: kaseki-agent host setup --fix\n'
  return 1
}

recreate_api_if_requested() {
  if [ "$KASEKI_RECREATE_API" != "1" ]; then
    return 0
  fi
  if ! command -v docker >/dev/null 2>&1; then
    printf 'warning: docker is unavailable; cannot recreate kaseki-api\n'
    return 0
  fi
  if ! docker inspect kaseki-api >/dev/null 2>&1 && [ ! -f "$KASEKI_CHECKOUT_DIR/docker-compose.yml" ]; then
    return 0
  fi
  if docker inspect kaseki-api >/dev/null 2>&1; then
    printf 'recreating: removing existing kaseki-api container\n'
    docker rm -f kaseki-api >/dev/null 2>&1 || true
  fi
  if [ -f "$KASEKI_CHECKOUT_DIR/docker-compose.yml" ]; then
    printf 'recreating: docker compose up -d kaseki-api\n'
    (cd "$KASEKI_CHECKOUT_DIR" && docker compose up -d --no-deps kaseki-api)
  fi
}

status=0

ensure_dir "$KASEKI_ROOT" 0775 || status=1
ensure_dir "$KASEKI_ROOT/kaseki-results" 0775 || status=1
ensure_dir "$KASEKI_ROOT/kaseki-runs" 0775 || status=1
ensure_dir "$KASEKI_ROOT/kaseki-cache" 0775 || status=1
ensure_dir "$KASEKI_LOG_DIR" 0775 || true

check_writable "$KASEKI_ROOT/kaseki-results" || status=1

printf 'using host secrets directory: %s\n' "$KASEKI_HOST_SECRETS_DIR"
normalize_secrets_dir "$KASEKI_HOST_SECRETS_DIR"
print_recreate_hint_if_needed

bootstrap_checkout_if_possible || status=$?

if [ ! -x "$KASEKI_TEMPLATE_DIR/run-kaseki.sh" ]; then
  printf 'missing: template runner at %s/run-kaseki.sh\n' "$KASEKI_TEMPLATE_DIR"
  printf 'remediation: run kaseki-agent host setup --fix\n'
  if [ "$KASEKI_FIX" != "1" ]; then
    status=1
  fi
fi

recreate_api_if_requested || status=$?

if [ "$status" -ne 0 ]; then
  printf 'kaseki host setup incomplete. Re-run with --fix to create directories and bootstrap when possible.\n' >&2
fi

exit "$status"
