#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_TARGET_DIR="/agents/kaseki-template"
TARGET_DIR="${KASEKI_TEMPLATE_DIR:-$DEFAULT_TARGET_DIR}"
IMAGE="${KASEKI_IMAGE:-docker.io/cyanautomation/kaseki-agent:latest}"
KASEKI_LOG_DIR="${KASEKI_LOG_DIR:-/var/log/kaseki}"
KASEKI_STRICT_HOST_LOGGING="${KASEKI_STRICT_HOST_LOGGING:-0}"
KASEKI_JSON_LOG_COMPONENT="deploy-pi-template"

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
  printf '{"timestamp":"%s","component":"%s","stage":"%s","status":"%s","instance":"%s","detail":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$KASEKI_JSON_LOG_COMPONENT" \
    "$(json_escape "$stage")" \
    "$(json_escape "$status")" \
    "template" \
    "$(json_escape "$detail")"
}

on_deploy_exit() {
  local code=$?
  if [ "$code" -eq 0 ]; then
    emit_json_log "deploy" "finished" "deploy-pi-template.sh completed successfully"
  else
    emit_json_log "deploy" "error" "deploy-pi-template.sh exited with code $code"
  fi
}

trap on_deploy_exit EXIT
emit_json_log "deploy" "started" "deploy-pi-template.sh starting"

setup_host_logging() {
  local base_name="$1"
  local stamp host_log_file
  if mkdir -p "$KASEKI_LOG_DIR" 2>/dev/null && [ -w "$KASEKI_LOG_DIR" ]; then
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    host_log_file="$KASEKI_LOG_DIR/${base_name}-${stamp}.log"
    exec > >(tee -a "$host_log_file") 2> >(tee -a "$host_log_file" >&2)
    printf 'Host log mirror: %s\n' "$host_log_file"
    return 0
  fi
  if [ "$KASEKI_STRICT_HOST_LOGGING" = "1" ]; then
    printf 'Error: strict host logging enabled, but KASEKI_LOG_DIR is not writable: %s\n' "$KASEKI_LOG_DIR" >&2
    exit 1
  fi
  printf 'Warning: host logging disabled; KASEKI_LOG_DIR is unavailable: %s\n' "$KASEKI_LOG_DIR" >&2
}

setup_host_logging "deploy-pi-template"

if [ "${1:-}" = "--help" ]; then
  cat <<HELP
Usage: KASEKI_TEMPLATE_DIR=$DEFAULT_TARGET_DIR $0

Deploys the current Kaseki runner files into KASEKI_TEMPLATE_DIR
(default: $DEFAULT_TARGET_DIR).

Idempotent behavior:
- Refuses to clean unexpected targets (guardrails require basename "kaseki-template"
  and path prefix "/agents/" or "$HOME/").
- Cleans destination root before install.
- Preserves existing destination subdirectories named run, result, cache, and secrets.
HELP
  exit 0
fi

is_allowed_target_dir() {
  local target="$1"
  local base
  base="$(basename "$target")"
  [ "$base" = "kaseki-template" ] || return 1
  case "$target" in
    /agents/*) return 0 ;;
    "$HOME"/*) return 0 ;;
  esac
  return 1
}

prepare_target_dir() {
  local target="$1"
  local abs_target
  local tmp_root
  local persistent
  local path

  mkdir -p "$target"
  abs_target="$(cd "$target" && pwd -P)"

  if ! is_allowed_target_dir "$abs_target"; then
    printf 'Error: refusing to clean unexpected target path: %s\n' "$abs_target" >&2
    printf "Expected basename \"kaseki-template\" and prefix \"/agents/\" or \"\$HOME/\".\n" >&2
    exit 1
  fi

  tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/kaseki-template-preserve.XXXXXX")"
  
  cleanup_or_restore() {
    if [ -d "$tmp_root" ]; then
      for persistent in run result cache secrets; do
        if [ -d "$tmp_root/$persistent" ] && [ ! -d "$abs_target/$persistent" ]; then
          mkdir -p "$abs_target"
          mv "$tmp_root/$persistent" "$abs_target/$persistent" 2>/dev/null || true
        fi
      done
      rm -rf "$tmp_root"
    fi
  }
  trap cleanup_or_restore EXIT INT TERM
  
  for persistent in run result cache secrets; do
    path="$abs_target/$persistent"
    if [ -d "$path" ]; then
      mv "$path" "$tmp_root/$persistent"
    fi
  done

  rm -rf "$abs_target"
  mkdir -p "$abs_target"

  for persistent in run result cache secrets; do
    if [ -d "$tmp_root/$persistent" ]; then
      mv "$tmp_root/$persistent" "$abs_target/$persistent"
    fi
  done
  trap - EXIT INT TERM
  rm -rf "$tmp_root"
}

prepare_target_dir "$TARGET_DIR"
emit_json_log "copy-template" "started" "syncing template files"

install_file() {
  local mode="$1"
  local source="$2"
  local target="$TARGET_DIR/$source"
  mkdir -p "$(dirname "$target")"
  install -m "$mode" "$SOURCE_DIR/$source" "$target"
}

install_file 0755 run-kaseki.sh
install_file 0755 kaseki
install_file 0755 cleanup-kaseki.sh
install_file 0755 kaseki-healthcheck.sh
install_file 0755 kaseki-agent.sh
install_file 0755 deploy-pi-template.sh
install_file 0755 github-app-token.js
install_file 0755 kaseki-cli.js
install_file 0755 kaseki-report.js
install_file 0755 pi-event-filter.js
install_file 0755 pi-progress-stream.js
install_file 0644 kaseki-cli-lib.js
install_file 0644 Dockerfile
install_file 0644 .dockerignore
install_file 0644 README.md
install_file 0644 CLAUDE.md
install_file 0644 package.json
install_file 0644 package-lock.json
install_file 0644 docker/workspace-cache/package.json
install_file 0644 docker/workspace-cache/package-lock.json
install_file 0644 docs/CLI.md
install_file 0644 docs/repo-maturity.md
install_file 0644 ops/logrotate/kaseki
emit_json_log "copy-template" "finished" "template files synced"

if command -v docker >/dev/null 2>&1; then
  emit_json_log "docker-check" "started" "checking docker image availability"
  printf 'Docker image configured for doctor: %s\n' "$IMAGE"
  if docker image inspect "$IMAGE" >/dev/null 2>&1; then
    printf 'Docker image: present\n'
    emit_json_log "docker-check" "finished" "docker image present locally"
  else
    printf 'Docker image: missing locally (%s)\n' "$IMAGE" >&2
    emit_json_log "docker-check" "error" "docker image missing locally"
  fi
fi

printf 'Deployed Kaseki template to %s\n' "$TARGET_DIR"
