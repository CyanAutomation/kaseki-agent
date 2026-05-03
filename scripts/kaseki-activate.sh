#!/usr/bin/env bash
set -euo pipefail

KASEKI_REPO_URL="${KASEKI_REPO_URL:-https://github.com/CyanAutomation/kaseki-agent.git}"
KASEKI_REF="${KASEKI_REF:-main}"
KASEKI_ROOT="${KASEKI_ROOT:-/agents}"
KASEKI_CHECKOUT_DIR="${KASEKI_CHECKOUT_DIR:-$KASEKI_ROOT/kaseki-agent}"
KASEKI_TEMPLATE_DIR="${KASEKI_TEMPLATE_DIR:-$KASEKI_ROOT/kaseki-template}"
KASEKI_LOG_DIR="${KASEKI_LOG_DIR:-/var/log/kaseki}"
KASEKI_STRICT_HOST_LOGGING="${KASEKI_STRICT_HOST_LOGGING:-0}"
KASEKI_OUTPUT_FORMAT="${KASEKI_OUTPUT_FORMAT:-text}"
KASEKI_CONTROLLER_MODE="${KASEKI_CONTROLLER_MODE:-0}"
KASEKI_BUILD_IMAGE_IF_TEMPLATE_MISSING="${KASEKI_BUILD_IMAGE_IF_TEMPLATE_MISSING:-1}"
KASEKI_IMAGE_PULL_POLICY="${KASEKI_IMAGE_PULL_POLICY:-always}"
KASEKI_REPLACE_STALE="${KASEKI_REPLACE_STALE:-0}"
KASEKI_JSON_LOG_COMPONENT="kaseki-activate"
COMMAND=""
COMMAND_ARGS=()

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
  local line
  line="$(printf '{"timestamp":"%s","component":"%s","stage":"%s","status":"%s","detail":"%s"}' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$KASEKI_JSON_LOG_COMPONENT" \
    "$(json_escape "$stage")" \
    "$(json_escape "$status")" \
    "$(json_escape "$detail")")"
  if [ "$KASEKI_OUTPUT_FORMAT" = "json" ]; then
    printf '%s\n' "$line" >&2
  else
    printf '%s\n' "$line"
  fi
}

json_string() {
  printf '"%s"' "$(json_escape "${1-}")"
}

json_bool() {
  case "${1-}" in
    1|true|TRUE|yes|YES) printf 'true' ;;
    *) printf 'false' ;;
  esac
}

parse_args() {
  for arg in "$@"; do
    case "$arg" in
      --json)
        KASEKI_OUTPUT_FORMAT="json"
        ;;
      --jsonl)
        KASEKI_OUTPUT_FORMAT="jsonl"
        ;;
      --format=json)
        KASEKI_OUTPUT_FORMAT="json"
        ;;
      --format=jsonl)
        KASEKI_OUTPUT_FORMAT="jsonl"
        ;;
      --format=text)
        KASEKI_OUTPUT_FORMAT="text"
        ;;
      --controller)
        KASEKI_CONTROLLER_MODE="1"
        KASEKI_OUTPUT_FORMAT="json"
        KASEKI_BUILD_IMAGE_IF_TEMPLATE_MISSING="0"
        KASEKI_IMAGE_PULL_POLICY="always"
        ;;
      --no-build)
        KASEKI_BUILD_IMAGE_IF_TEMPLATE_MISSING="0"
        ;;
      --replace-stale)
        KASEKI_REPLACE_STALE="1"
        ;;
      *)
        if [ -z "$COMMAND" ]; then
          COMMAND="$arg"
        else
          COMMAND_ARGS+=("$arg")
        fi
        ;;
    esac
  done
  COMMAND="${COMMAND:-bootstrap}"
}

print_command_json() {
  local command="$1"
  local exit_code="$2"
  local message="${3-}"
  local result_dir="${4-}"
  local instance="${5-}"
  local checkout_ref=""
  local template_ready="false"
  if [ -d "$KASEKI_CHECKOUT_DIR/.git" ]; then
    checkout_ref="$(git -C "$KASEKI_CHECKOUT_DIR" rev-parse --short HEAD 2>/dev/null || true)"
  fi
  [ -x "$KASEKI_TEMPLATE_DIR/run-kaseki.sh" ] && template_ready="true"
  cat <<JSON
{"command":$(json_string "$command"),"exit_code":$exit_code,"ok":$(json_bool "$([ "$exit_code" -eq 0 ] && printf 1 || printf 0)"),"message":$(json_string "$message"),"instance":$(json_string "$instance"),"result_dir":$(json_string "$result_dir"),"checkout":$(json_string "$KASEKI_CHECKOUT_DIR"),"checkout_ref":$(json_string "$checkout_ref"),"template":$(json_string "$KASEKI_TEMPLATE_DIR"),"template_ready":$template_ready}
JSON
}

setup_host_logging() {
  local stamp host_log_file
  if [ "$KASEKI_OUTPUT_FORMAT" = "json" ]; then
    return 0
  fi
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
Usage: scripts/kaseki-activate.sh [--json|--jsonl] [bootstrap|install|deploy|doctor|run|status|clean] [run args...]

Host-side activation entrypoint for local or SSH-launched agents.

Commands:
  bootstrap  Install/update checkout, deploy template, then run doctor.
  install    Clone or fast-forward KASEKI_CHECKOUT_DIR to KASEKI_REF.
  deploy     Deploy KASEKI_TEMPLATE_DIR from the configured image or local build.
  doctor     Run /agents/kaseki-template/run-kaseki.sh --doctor.
  run        Run /agents/kaseki-template/run-kaseki.sh with remaining args.
  status     Print template presence and recent Kaseki instances.
  clean      Remove template, runs, results, cache, and checkout.

Output:
  --json     Print a final machine-readable JSON object for status, doctor, and run.
  --jsonl    Keep newline-delimited JSON progress logs on stdout.

Controller options:
  --controller  JSON output, pull registry image, and fail instead of building locally.
  --no-build    Fail deployment if the registry image cannot be used.
  --replace-stale
              Reset and clean an existing dirty checkout before updating it.

Useful environment:
  KASEKI_REPO_URL=$KASEKI_REPO_URL
  KASEKI_REF=$KASEKI_REF
  KASEKI_ROOT=$KASEKI_ROOT
  KASEKI_CHECKOUT_DIR=$KASEKI_CHECKOUT_DIR
  KASEKI_TEMPLATE_DIR=$KASEKI_TEMPLATE_DIR
  KASEKI_CONTROLLER_MODE=$KASEKI_CONTROLLER_MODE
  KASEKI_IMAGE_PULL_POLICY=$KASEKI_IMAGE_PULL_POLICY
  KASEKI_BUILD_IMAGE_IF_TEMPLATE_MISSING=$KASEKI_BUILD_IMAGE_IF_TEMPLATE_MISSING
  KASEKI_REPLACE_STALE=$KASEKI_REPLACE_STALE
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
    if [ -n "$(git -C "$KASEKI_CHECKOUT_DIR" status --porcelain)" ]; then
      if [ "$KASEKI_REPLACE_STALE" = "1" ]; then
        emit_json_log "install" "warning" "dirty checkout detected; resetting because KASEKI_REPLACE_STALE=1"
        git -C "$KASEKI_CHECKOUT_DIR" reset --hard HEAD >&2
        git -C "$KASEKI_CHECKOUT_DIR" clean -fdx >&2
      else
        emit_json_log "install" "error" "dirty checkout at $KASEKI_CHECKOUT_DIR; rerun with --replace-stale or KASEKI_REPLACE_STALE=1 to reset it"
        [ "$KASEKI_OUTPUT_FORMAT" = "json" ] && print_command_json "install" 3 "dirty checkout; use --replace-stale to reset stale local files" "" ""
        exit 3
      fi
    fi
    emit_json_log "install" "started" "updating $KASEKI_CHECKOUT_DIR"
    git -C "$KASEKI_CHECKOUT_DIR" fetch --prune origin >&2
  else
    rm -rf "$KASEKI_CHECKOUT_DIR"
    emit_json_log "install" "started" "cloning $KASEKI_REPO_URL to $KASEKI_CHECKOUT_DIR"
    git clone "$KASEKI_REPO_URL" "$KASEKI_CHECKOUT_DIR" >&2
  fi
  git -C "$KASEKI_CHECKOUT_DIR" checkout "$KASEKI_REF" >&2
  git -C "$KASEKI_CHECKOUT_DIR" pull --ff-only origin "$KASEKI_REF" >&2 || true
  emit_json_log "install" "finished" "$(git -C "$KASEKI_CHECKOUT_DIR" rev-parse --short HEAD)"
  if [ "$KASEKI_OUTPUT_FORMAT" = "json" ] && [ "$COMMAND" = "install" ]; then
    print_command_json "install" 0 "checkout installed" "" ""
  fi
}

deploy_template() {
  local code output_file
  require_bin docker
  emit_json_log "deploy" "started" "$KASEKI_TEMPLATE_DIR"
  if [ "$KASEKI_OUTPUT_FORMAT" = "json" ]; then
    output_file="$(mktemp)"
    set +e
    KASEKI_TEMPLATE_DIR="$KASEKI_TEMPLATE_DIR" \
      KASEKI_IMAGE_PULL_POLICY="$KASEKI_IMAGE_PULL_POLICY" \
      KASEKI_BUILD_IMAGE_IF_TEMPLATE_MISSING="$KASEKI_BUILD_IMAGE_IF_TEMPLATE_MISSING" \
      "$KASEKI_CHECKOUT_DIR/scripts/deploy-pi-template.sh" >"$output_file" 2>&1
    code=$?
    set -e
    cat "$output_file" >&2
    if [ "$COMMAND" = "deploy" ]; then
      print_command_json "deploy" "$code" "$(tail -n 20 "$output_file")" "" ""
    fi
    rm -f "$output_file"
    [ "$code" -eq 0 ] || exit "$code"
  else
    KASEKI_TEMPLATE_DIR="$KASEKI_TEMPLATE_DIR" \
      KASEKI_IMAGE_PULL_POLICY="$KASEKI_IMAGE_PULL_POLICY" \
      KASEKI_BUILD_IMAGE_IF_TEMPLATE_MISSING="$KASEKI_BUILD_IMAGE_IF_TEMPLATE_MISSING" \
      "$KASEKI_CHECKOUT_DIR/scripts/deploy-pi-template.sh"
  fi
  emit_json_log "deploy" "finished" "$KASEKI_TEMPLATE_DIR"
}

run_doctor() {
  local code output_file
  if [ ! -x "$KASEKI_TEMPLATE_DIR/run-kaseki.sh" ]; then
    emit_json_log "doctor" "error" "template is not deployed: $KASEKI_TEMPLATE_DIR"
    [ "$KASEKI_OUTPUT_FORMAT" = "json" ] && print_command_json "doctor" 2 "template is not deployed" "" ""
    exit 2
  fi
  emit_json_log "doctor" "started" "$KASEKI_TEMPLATE_DIR"
  if [ "$KASEKI_OUTPUT_FORMAT" = "json" ]; then
    output_file="$(mktemp)"
    set +e
    "$KASEKI_TEMPLATE_DIR/run-kaseki.sh" --doctor >"$output_file" 2>&1
    code=$?
    set -e
    print_command_json "doctor" "$code" "$(tail -n 20 "$output_file")" "" ""
    rm -f "$output_file"
    [ "$code" -eq 0 ] || exit "$code"
  else
    "$KASEKI_TEMPLATE_DIR/run-kaseki.sh" --doctor
  fi
  emit_json_log "doctor" "finished" "$KASEKI_TEMPLATE_DIR"
}

run_kaseki() {
  local code output_file instance result_dir
  if [ ! -x "$KASEKI_TEMPLATE_DIR/run-kaseki.sh" ]; then
    emit_json_log "run" "error" "template is not deployed: $KASEKI_TEMPLATE_DIR"
    [ "$KASEKI_OUTPUT_FORMAT" = "json" ] && print_command_json "run" 2 "template is not deployed" "" ""
    exit 2
  fi
  emit_json_log "run" "started" "run-kaseki.sh with $(($# > 0 ? $# : 0)) arguments"
  set +e
  if [ "$KASEKI_OUTPUT_FORMAT" = "json" ]; then
    output_file="$(mktemp)"
    "$KASEKI_TEMPLATE_DIR/run-kaseki.sh" "$@" >"$output_file" 2>&1
  else
    "$KASEKI_TEMPLATE_DIR/run-kaseki.sh" "$@"
  fi
  code=$?
  set -e
  if [ "$KASEKI_OUTPUT_FORMAT" = "json" ]; then
    instance="$(awk '/^kaseki-[0-9]+$/ { value=$0 } END { print value }' "$output_file")"
    result_dir="$(awk -F= '/^result_dir=/ { value=$2 } END { print value }' "$output_file")"
    print_command_json "run" "$code" "$(tail -n 40 "$output_file")" "$result_dir" "$instance"
    rm -f "$output_file"
  fi
  if [ "$code" -eq 0 ]; then
    emit_json_log "run" "finished" "$*"
  else
    emit_json_log "run" "error" "run-kaseki.sh exited with code $code"
  fi
  return "$code"
}

show_status() {
  emit_json_log "status" "started" "$KASEKI_ROOT"
  if [ "$KASEKI_OUTPUT_FORMAT" = "json" ]; then
    local checkout_ref="" template_ready="false" instances_json="[]"
    if [ -d "$KASEKI_CHECKOUT_DIR/.git" ]; then
      checkout_ref="$(git -C "$KASEKI_CHECKOUT_DIR" rev-parse --short HEAD 2>/dev/null || true)"
    fi
    [ -x "$KASEKI_TEMPLATE_DIR/run-kaseki.sh" ] && template_ready="true"
    if [ -d "$KASEKI_ROOT/kaseki-results" ]; then
      instances_json="$(
        find "$KASEKI_ROOT/kaseki-results" -mindepth 1 -maxdepth 1 -type d -name 'kaseki-*' -print 2>/dev/null |
          sort -Vr |
          awk -v root="$KASEKI_ROOT/kaseki-results" '
            BEGIN { printf "[" }
            {
              name=$0
              sub("^" root "/", "", name)
              if (count++ > 0) printf ","
              printf "{\"instance\":\"%s\",\"result_dir\":\"%s\"}", name, $0
            }
            END { printf "]" }
          '
      )"
    fi
    cat <<JSON
{"command":"status","exit_code":0,"ok":true,"checkout":$(json_string "$KASEKI_CHECKOUT_DIR"),"checkout_ref":$(json_string "$checkout_ref"),"template":$(json_string "$KASEKI_TEMPLATE_DIR"),"template_ready":$template_ready,"results_dir":$(json_string "$KASEKI_ROOT/kaseki-results"),"instances":$instances_json}
JSON
    emit_json_log "status" "finished" "$KASEKI_ROOT"
    return 0
  fi
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
  if [ "$KASEKI_OUTPUT_FORMAT" = "json" ]; then
    print_command_json "clean" 0 "removed Kaseki checkout, template, runs, results, and cache" "" ""
  fi
}

parse_args "$@"
if [ "$KASEKI_CONTROLLER_MODE" = "1" ]; then
  KASEKI_OUTPUT_FORMAT="json"
  KASEKI_BUILD_IMAGE_IF_TEMPLATE_MISSING="0"
  KASEKI_IMAGE_PULL_POLICY="always"
fi
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
    run_kaseki "${COMMAND_ARGS[@]}"
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
