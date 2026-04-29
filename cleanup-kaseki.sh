#!/usr/bin/env bash
set -euo pipefail

ROOT="${KASEKI_ROOT:-/agents}"
RUNS="$ROOT/kaseki-runs"
RESULTS="$ROOT/kaseki-results"
OLDER_THAN_DAYS="${KASEKI_CLEANUP_DAYS:-1}"
DRY_RUN=0
DOCKER_CLEANUP=0
FORCE=0
KASEKI_LOG_DIR="${KASEKI_LOG_DIR:-/var/log/kaseki}"
KASEKI_STRICT_HOST_LOGGING="${KASEKI_STRICT_HOST_LOGGING:-0}"

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

show_help() {
  cat <<HELP
Usage: KASEKI_CLEANUP_DAYS=1 $0 [--docker] [--dry-run] [--force]

Deletes finalized kaseki-N workspaces older than the configured age.
Results under $RESULTS are preserved.
Transient staging directories (for example: .staging-run-kaseki-N-XXXXXX)
are created and cleaned automatically by run-kaseki.sh.

Options:
  --docker   Also remove stopped kaseki containers and prune Docker build cache.
  --dry-run  Print what would be removed.
  --force    Required with --docker to actually prune Docker build cache.
HELP
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      show_help
      exit 0
      ;;
    --docker)
      DOCKER_CLEANUP=1
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    --force)
      FORCE=1
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      show_help >&2
      exit 2
      ;;
  esac
  shift
done

setup_host_logging "cleanup-kaseki"

run_or_print() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '+ %q' "$1"
    shift
    while [ "$#" -gt 0 ]; do
      printf ' %q' "$1"
      shift
    done
    printf '\n'
  else
    "$@"
  fi
}

printf 'Kaseki cleanup\n'
printf 'Root: %s\n' "$ROOT"
printf 'Runs: %s\n' "$RUNS"
printf 'Results preserved: %s\n' "$RESULTS"

if [ -d "$RUNS" ]; then
  find "$RUNS" -mindepth 1 -maxdepth 1 -type d -name 'kaseki-[0-9]*' -mtime +"$OLDER_THAN_DAYS" -print |
    while IFS= read -r run_dir; do
      run_or_print rm -rf "$run_dir"
    done
else
  printf 'No Kaseki runs directory found: %s\n' "$RUNS"
fi

if [ "$DOCKER_CLEANUP" -eq 1 ]; then
  if ! command -v docker >/dev/null 2>&1; then
    printf 'Docker: missing; skipping Docker cleanup\n' >&2
    exit 0
  fi

  printf '\nDocker disk usage before cleanup:\n'
  docker system df || true

  docker ps -a --format '{{.ID}} {{.Names}}' |
    awk '$2 ~ /^kaseki-[0-9]+$/ { print $1 }' |
    while IFS= read -r container_id; do
      [ -z "$container_id" ] && continue
      run_or_print docker rm "$container_id"
    done

  if [ "$FORCE" -eq 1 ]; then
    run_or_print docker builder prune -f --filter until=24h
    run_or_print docker image prune -f
  else
    printf 'Docker build/image prune skipped; pass --force with --docker to prune cache and dangling images.\n'
  fi

  printf '\nDocker disk usage after cleanup:\n'
  docker system df || true
fi
