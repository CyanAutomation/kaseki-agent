#!/usr/bin/env bash
set -euo pipefail

COMMAND="${1:-bootstrap}"
shift || true

KASEKI_REPO_URL="${KASEKI_REPO_URL:-https://github.com/CyanAutomation/kaseki-agent.git}"
KASEKI_REF="${KASEKI_REF:-main}"
KASEKI_ROOT="${KASEKI_ROOT:-/agents}"
KASEKI_CHECKOUT_DIR="${KASEKI_CHECKOUT_DIR:-$KASEKI_ROOT/kaseki-agent}"
KASEKI_TEMPLATE_DIR="${KASEKI_TEMPLATE_DIR:-$KASEKI_ROOT/kaseki-template}"
KASEKI_LOG_DIR="${KASEKI_LOG_DIR:-/var/log/kaseki}"
KASEKI_STRICT_HOST_LOGGING="${KASEKI_STRICT_HOST_LOGGING:-0}"
KASEKI_JSON_LOG_COMPONENT="kaseki-activate"

json_escape() {
  local value="${1-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

emit_json_log() {
  local stage="$1"
  local status="$2"
  local detail="${3-}"
  printf '{"timestamp":"%s","component":"%s","stage":"%s","status":"%s","detail":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$KASEKI_JSON_LOG_COMPONENT" \
    "$(json_escape "$stage")" \
    "$(json_escape "$status")" \
    "$(json_escape "$detail")"
}

setup_host_logging() {
  local stamp host_log_file
  if mkdir -p "$KASEKI_LOG_DIR" 2>/dev/null && [ -w "$KASEKI_LOG_DIR" ]; then
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    host_log_file="$KASEKI_LOG_DIR/kaseki-activate-${stamp}.log"
    exec > >(tee -a "$host_log_file") 2> >(tee -a "$host_log_file" >&2)
    emit_json_log "logging" "ok" "$host_log_file"
    return 0
  fi
  if [ "$KASEKI_STRICT_HOST_LOGGING" = "1" ]; then
    emit_json_log "logging" "error" "KASEKI_LOG_DIR is not writable: $KASEKI_LOG_DIR"
    exit 1
  fi
  emit_json_log "logging" "warning" "host log mirroring disabled: $KASEKI_LOG_DIR"
}

show_help() {
  cat <<HELP
Usage: scripts/kaseki-activate.sh [bootstrap|install|deploy|doctor|run|status|clean] [run args...]

Host-side activation entrypoint for local or SSH-launched agents.

Commands:
  bootstrap  Install/update checkout, deploy template, then run doctor.
  install    Clone or fast-forward KASEKI_CHECKOUT_DIR to KASEKI_REF.
  deploy     Deploy KASEKI_TEMPLATE_DIR from the configured image or local build.
  doctor     Run /agents/kaseki-template/run-kaseki.sh --doctor.
  run        Run /agents/kaseki-template/run-kaseki.sh with remaining args.
  status     Print template presence and recent Kaseki instances.
  clean      Remove template, runs, results, cache, and checkout.

Useful environment:
  KASEKI_REPO_URL=$KASEKI_REPO_URL
  KASEKI_REF=$KASEKI_REF
  KASEKI_ROOT=$KASEKI_ROOT
  KASEKI_CHECKOUT_DIR=$KASEKI_CHECKOUT_DIR
  KASEKI_TEMPLATE_DIR=$KASEKI_TEMPLATE_DIR
HELP
}

require_bin() {
  local bin="$1"
  if ! command -v "$bin" >/dev/null 2>&1; then
    emit_json_log "preflight" "error" "missing required binary: $bin"
    exit 1
  fi
}

install_checkout() {
  require_bin git
  mkdir -p "$(dirname "$KASEKI_CHECKOUT_DIR")"
  if [ -d "$KASEKI_CHECKOUT_DIR/.git" ]; then
    emit_json_log "install" "started" "updating $KASEKI_CHECKOUT_DIR"
    git -C "$KASEKI_CHECKOUT_DIR" fetch --prune origin
  else
    rm -rf "$KASEKI_CHECKOUT_DIR"
    emit_json_log "install" "started" "cloning $KASEKI_REPO_URL to $KASEKI_CHECKOUT_DIR"
    git clone "$KASEKI_REPO_URL" "$KASEKI_CHECKOUT_DIR"
  fi
  git -C "$KASEKI_CHECKOUT_DIR" checkout "$KASEKI_REF"
  git -C "$KASEKI_CHECKOUT_DIR" pull --ff-only origin "$KASEKI_REF" 2>/dev/null || true
  emit_json_log "install" "finished" "$(git -C "$KASEKI_CHECKOUT_DIR" rev-parse --short HEAD)"
}

deploy_template() {
  require_bin docker
  emit_json_log "deploy" "started" "$KASEKI_TEMPLATE_DIR"
  KASEKI_TEMPLATE_DIR="$KASEKI_TEMPLATE_DIR" "$KASEKI_CHECKOUT_DIR/scripts/deploy-pi-template.sh"
  emit_json_log "deploy" "finished" "$KASEKI_TEMPLATE_DIR"
}

run_doctor() {
  if [ ! -x "$KASEKI_TEMPLATE_DIR/run-kaseki.sh" ]; then
    emit_json_log "doctor" "error" "template is not deployed: $KASEKI_TEMPLATE_DIR"
    exit 2
  fi
  emit_json_log "doctor" "started" "$KASEKI_TEMPLATE_DIR"
  "$KASEKI_TEMPLATE_DIR/run-kaseki.sh" --doctor
  emit_json_log "doctor" "finished" "$KASEKI_TEMPLATE_DIR"
}

run_kaseki() {
  local code
  if [ ! -x "$KASEKI_TEMPLATE_DIR/run-kaseki.sh" ]; then
    emit_json_log "run" "error" "template is not deployed: $KASEKI_TEMPLATE_DIR"
    exit 2
  fi
  emit_json_log "run" "started" "run-kaseki.sh with $(($# > 0 ? $# : 0)) arguments"
  set +e
  "$KASEKI_TEMPLATE_DIR/run-kaseki.sh" "$@"
  code=$?
  set -e
  if [ "$code" -eq 0 ]; then
    emit_json_log "run" "finished" "$*"
  else
    emit_json_log "run" "error" "run-kaseki.sh exited with code $code"
  fi
  return "$code"
}

show_status() {
  emit_json_log "status" "started" "$KASEKI_ROOT"
  printf 'checkout=%s\n' "$KASEKI_CHECKOUT_DIR"
  if [ -d "$KASEKI_CHECKOUT_DIR/.git" ]; then
    printf 'checkout_ref=%s\n' "$(git -C "$KASEKI_CHECKOUT_DIR" rev-parse --short HEAD)"
  fi
  printf 'template=%s\n' "$KASEKI_TEMPLATE_DIR"
  [ -x "$KASEKI_TEMPLATE_DIR/run-kaseki.sh" ] && printf 'template_ready=true\n' || printf 'template_ready=false\n'
  if [ -x "$KASEKI_TEMPLATE_DIR/kaseki" ]; then
    "$KASEKI_TEMPLATE_DIR/kaseki" list || true
  fi
  emit_json_log "status" "finished" "$KASEKI_ROOT"
}

clean_all() {
  emit_json_log "clean" "started" "$KASEKI_ROOT"
  rm -rf "$KASEKI_TEMPLATE_DIR" \
    "$KASEKI_ROOT/kaseki-runs" \
    "$KASEKI_ROOT/kaseki-results" \
    "$KASEKI_ROOT/kaseki-cache" \
    "$KASEKI_CHECKOUT_DIR"
  emit_json_log "clean" "finished" "$KASEKI_ROOT"
}

setup_host_logging

case "$COMMAND" in
  bootstrap)
    install_checkout
    deploy_template
    run_doctor
    ;;
  install)
    install_checkout
    ;;
  deploy)
    deploy_template
    ;;
  doctor)
    run_doctor
    ;;
  run)
    run_kaseki "$@"
    ;;
  status)
    show_status
    ;;
  clean)
    clean_all
    ;;
  --help|-h|help)
    show_help
    ;;
  *)
    emit_json_log "usage" "error" "unknown command: $COMMAND"
    show_help >&2
    exit 2
    ;;
esac
