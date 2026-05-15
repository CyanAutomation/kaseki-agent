#!/usr/bin/env bash
set -euo pipefail

KASEKI_ROOT="${KASEKI_ROOT:-/agents}"
KASEKI_TEMPLATE_DIR="${KASEKI_TEMPLATE_DIR:-$KASEKI_ROOT/kaseki-template}"
KASEKI_CHECKOUT_DIR="${KASEKI_CHECKOUT_DIR:-$KASEKI_ROOT/kaseki-agent}"
KASEKI_LOG_DIR="${KASEKI_LOG_DIR:-/var/log/kaseki}"
KASEKI_CONTAINER_UID="${KASEKI_CONTAINER_UID:-10000}"
KASEKI_CONTAINER_GID="${KASEKI_CONTAINER_GID:-10000}"
KASEKI_FIX="${KASEKI_FIX:-0}"

if [ "${1:-}" = "--fix" ]; then
  KASEKI_FIX="1"
fi

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

print_recreate_hint_if_needed() {
  if ! command -v docker >/dev/null 2>&1; then
    return
  fi
  if ! docker inspect kaseki-api >/dev/null 2>&1; then
    return
  fi
  if [ ! -d "$KASEKI_ROOT" ]; then
    printf 'warning: kaseki-api container exists but %s is missing on the host.\n' "$KASEKI_ROOT"
    printf 'remediation: recreate %s, then recreate the container so Docker drops stale/deleted bind mounts.\n' "$KASEKI_ROOT"
    return
  fi
  if ! docker exec kaseki-api sh -lc "grep -q ' deleted\\|/deleted' /proc/self/mountinfo" 2>/dev/null; then
    return
  fi
  printf 'warning: kaseki-api container has a deleted bind mount; recreate the container after this setup completes.\n'
}

status=0

ensure_dir "$KASEKI_ROOT" 0775 || status=1
ensure_dir "$KASEKI_ROOT/kaseki-results" 0775 || status=1
ensure_dir "$KASEKI_ROOT/kaseki-runs" 0775 || status=1
ensure_dir "$KASEKI_ROOT/kaseki-cache" 0775 || status=1
ensure_dir "$KASEKI_LOG_DIR" 0775 || true

check_writable "$KASEKI_ROOT/kaseki-results" || status=1

normalize_secrets_dir "${KASEKI_HOST_SECRETS_DIR:-$HOME/secrets}"
print_recreate_hint_if_needed

if [ -x "$KASEKI_CHECKOUT_DIR/scripts/kaseki-activate.sh" ] && [ "$KASEKI_FIX" = "1" ]; then
  KASEKI_TEMPLATE_DIR="$KASEKI_TEMPLATE_DIR" \
  KASEKI_CHECKOUT_DIR="$KASEKI_CHECKOUT_DIR" \
  "$KASEKI_CHECKOUT_DIR/scripts/kaseki-activate.sh" --controller --replace-stale bootstrap || status=$?
elif [ ! -x "$KASEKI_TEMPLATE_DIR/run-kaseki.sh" ]; then
  printf 'missing: template runner at %s/run-kaseki.sh\n' "$KASEKI_TEMPLATE_DIR"
  printf 'remediation: run scripts/kaseki-activate.sh --controller bootstrap\n'
  if [ "$KASEKI_FIX" != "1" ]; then
    status=1
  fi
fi

if [ "$status" -ne 0 ]; then
  printf 'kaseki host setup incomplete. Re-run with --fix to create directories and bootstrap when possible.\n' >&2
fi

exit "$status"
