#!/usr/bin/env bash
set -euo pipefail

KASEKI_ROOT="${KASEKI_ROOT:-/agents}"
KASEKI_TEMPLATE_DIR="${KASEKI_TEMPLATE_DIR:-$KASEKI_ROOT/kaseki-template}"
KASEKI_CHECKOUT_DIR="${KASEKI_CHECKOUT_DIR:-$KASEKI_ROOT/kaseki-agent}"
KASEKI_LOG_DIR="${KASEKI_LOG_DIR:-/var/log/kaseki}"
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
    run_privileged chown "$(id -u):$KASEKI_CONTAINER_GID" "$dir" 2>/dev/null || true
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

status=0

ensure_dir "$KASEKI_ROOT" 0775 || status=1
ensure_dir "$KASEKI_ROOT/kaseki-results" 0775 || status=1
ensure_dir "$KASEKI_ROOT/kaseki-runs" 0775 || status=1
ensure_dir "$KASEKI_ROOT/kaseki-cache" 0775 || status=1
ensure_dir "$KASEKI_LOG_DIR" 0775 || true

check_writable "$KASEKI_ROOT/kaseki-results" || status=1

if [ -d "$HOME/secrets" ]; then
  printf 'ok: host secrets directory found at %s/secrets\n' "$HOME"
else
  printf 'warning: host secrets directory not found at %s/secrets\n' "$HOME"
fi

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
