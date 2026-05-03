#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_TARGET_DIR="/agents/kaseki-template"
TARGET_DIR="${KASEKI_TEMPLATE_DIR:-$DEFAULT_TARGET_DIR}"
IMAGE="${KASEKI_IMAGE:-docker.io/cyanautomation/kaseki-agent:latest}"
LOCAL_BUILD_IMAGE="${KASEKI_LOCAL_BUILD_IMAGE:-kaseki-agent:local}"
KASEKI_BUILD_IMAGE_IF_TEMPLATE_MISSING="${KASEKI_BUILD_IMAGE_IF_TEMPLATE_MISSING:-1}"
KASEKI_IMAGE_PULL_POLICY="${KASEKI_IMAGE_PULL_POLICY:-always}"
KASEKI_LOG_DIR="${KASEKI_LOG_DIR:-/var/log/kaseki}"
KASEKI_STRICT_HOST_LOGGING="${KASEKI_STRICT_HOST_LOGGING:-0}"
KASEKI_JSON_LOG_COMPONENT="deploy-pi-template"
CONTAINER=""

is_probably_digest_ref() {
  local image_ref="$1"
  case "$image_ref" in
    *@sha256:*) return 0 ;;
    *) return 1 ;;
  esac
}

resolve_local_repo_digest() {
  local image_ref="$1"
  docker image inspect "$image_ref" --format '{{index .RepoDigests 0}}' 2>/dev/null || true
}

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
  if [ -n "${CONTAINER:-}" ]; then
    docker rm "$CONTAINER" >/dev/null 2>&1 || true
  fi
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

Image behavior:
- Pulls KASEKI_IMAGE by default before using a local tag.
- Prefer immutable refs for KASEKI_IMAGE (digest or commit-SHA tag) to avoid ':latest' drift.
- Set KASEKI_IMAGE_PULL_POLICY=missing to pull only when absent.
- Set KASEKI_IMAGE_PULL_POLICY=never to use only local Docker images.
- If the image lacks a deployable /app template and
  KASEKI_BUILD_IMAGE_IF_TEMPLATE_MISSING=1, builds this checkout as
  $LOCAL_BUILD_IMAGE and deploys that image instead.
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
  local backup_root=""
  local persistent
  local path

  abs_target="$(cd "$(dirname "$target")" 2>/dev/null && pwd)/$(basename "$target")" || abs_target="$target"

  if ! is_allowed_target_dir "$abs_target"; then
    printf 'Error: target directory is not allowed: %s\n' "$abs_target" >&2
    printf 'Allowed paths: /agents/kaseki-template, %s/kaseki-template\n' "$HOME" >&2
    exit 2
  fi

  if [ -d "$target" ]; then
    backup_root="$(mktemp -d)"
    for persistent in run result cache secrets; do
      path="$target/$persistent"
      if [ -d "$path" ]; then
        printf 'Preserving: %s\n' "$path"
        mv "$path" "$backup_root/$persistent"
      fi
    done
  fi

  mkdir -p "$target"
  rm -rf "${target:?}"/*
  mkdir -p "$target"

  if [ -n "$backup_root" ]; then
    for persistent in run result cache secrets; do
      if [ -d "$backup_root/$persistent" ]; then
        mv "$backup_root/$persistent" "$target/$persistent"
        printf 'Restored: %s\n' "$target/$persistent"
      fi
    done
    rmdir "$backup_root" 2>/dev/null || true
  fi
}

image_has_template() {
  local image="$1"
  local probe_container=""
  probe_container="$(docker create "$image" 2>/dev/null)" || return 1
  if docker cp "$probe_container:/app/run-kaseki.sh" - >/dev/null 2>&1; then
    docker rm "$probe_container" >/dev/null 2>&1 || true
    return 0
  fi
  docker rm "$probe_container" >/dev/null 2>&1 || true
  return 1
}

ensure_deployable_image() {
  local local_image_present=0
  local resolved_digest=""

  docker image inspect "$IMAGE" >/dev/null 2>&1 || local_image_present=1

  case "$KASEKI_IMAGE_PULL_POLICY" in
    always)
      emit_json_log "deploy" "started" "Pulling Docker image: $IMAGE"
      if ! docker pull "$IMAGE"; then
        if [ "$local_image_present" -eq 0 ]; then
          emit_json_log "deploy" "warning" "Pull failed; using existing local Docker image: $IMAGE"
        else
          return 1
        fi
      fi
      ;;
    missing|if-not-present)
      if [ "$local_image_present" -eq 0 ]; then
        emit_json_log "deploy" "started" "Using local Docker image: $IMAGE"
      else
        emit_json_log "deploy" "started" "Pulling Docker image: $IMAGE"
        docker pull "$IMAGE"
      fi
      ;;
    never)
      if [ "$local_image_present" -eq 0 ]; then
        emit_json_log "deploy" "started" "Using local Docker image: $IMAGE"
      else
        printf 'Error: image is not present locally and KASEKI_IMAGE_PULL_POLICY=never: %s\n' "$IMAGE" >&2
        return 1
      fi
      ;;
    *)
      printf 'Error: invalid KASEKI_IMAGE_PULL_POLICY: %s (expected always, missing, if-not-present, or never)\n' "$KASEKI_IMAGE_PULL_POLICY" >&2
      return 2
      ;;
  esac

  resolved_digest="$(resolve_local_repo_digest "$IMAGE")"
  if [ -n "$resolved_digest" ] && ! is_probably_digest_ref "$IMAGE"; then
    emit_json_log "deploy" "started" "Resolved image tag to immutable digest: $resolved_digest"
    IMAGE="$resolved_digest"
  elif [ -z "$resolved_digest" ] && ! is_probably_digest_ref "$IMAGE"; then
    emit_json_log "deploy" "warning" "No repo digest found for image reference; continuing with tag: $IMAGE"
  fi

  if image_has_template "$IMAGE"; then
    return 0
  fi

  if [ "$KASEKI_BUILD_IMAGE_IF_TEMPLATE_MISSING" != "1" ]; then
    printf 'Error: image does not contain deployable /app template: %s\n' "$IMAGE" >&2
    return 1
  fi

  emit_json_log "deploy" "started" "Image lacks /app template; building $LOCAL_BUILD_IMAGE from checkout"
  printf 'Image lacks /app template, building local fallback: %s\n' "$LOCAL_BUILD_IMAGE"
  docker build --progress=plain -t "$LOCAL_BUILD_IMAGE" "$SOURCE_DIR"
  IMAGE="$LOCAL_BUILD_IMAGE"

  if ! image_has_template "$IMAGE"; then
    printf 'Error: locally built image still does not contain /app template: %s\n' "$IMAGE" >&2
    return 1
  fi
}

verify_template() {
  local target="$1"
  local missing=0
  local required
  for required in run-kaseki.sh kaseki kaseki-agent.sh scripts/kaseki-preflight.sh lib/pi-event-filter.js lib/pi-progress-stream.js lib/kaseki-report.js lib/github-app-token.js; do
    if [ ! -f "$target/$required" ]; then
      printf 'Missing deployed template file: %s\n' "$required" >&2
      missing=1
    fi
  done
  return "$missing"
}

write_image_metadata() {
  local target="$1"
  local image="$2"
  local repo_digest=""

  printf '%s\n' "$image" > "$target/.kaseki-image"
  repo_digest="$(docker image inspect "$image" --format '{{range .RepoDigests}}{{println .}}{{end}}' 2>/dev/null | head -n 1 || true)"
  if [ -n "$repo_digest" ]; then
    printf '%s\n' "$repo_digest" > "$target/.kaseki-image-digest"
  else
    rm -f "$target/.kaseki-image-digest"
  fi
}

printf 'Kaseki template deployment\n'
printf 'Source: %s\n' "$SOURCE_DIR"
printf 'Target: %s\n' "$TARGET_DIR"
printf 'Image: %s\n' "$IMAGE"

prepare_target_dir "$TARGET_DIR"

ensure_deployable_image

emit_json_log "deploy" "started" "Creating container for extraction"
CONTAINER=$(docker create "$IMAGE")

emit_json_log "deploy" "started" "Extracting files from container"
docker cp "$CONTAINER:/app/." "$TARGET_DIR/"

emit_json_log "deploy" "started" "Cleaning up container"
docker rm "$CONTAINER"
CONTAINER=""

write_image_metadata "$TARGET_DIR" "$IMAGE"
verify_template "$TARGET_DIR"

emit_json_log "deploy" "finished" "Deployment completed successfully"
printf '\n✓ Kaseki template deployed to: %s\n' "$TARGET_DIR"
