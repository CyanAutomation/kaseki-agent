#!/usr/bin/env bash
#
# startup-checks.sh — Validate Docker environment before startup
#
# Checks that required directories and secret files are accessible.
# Reports issues with clear fix instructions. Does NOT attempt auto-fixes.
#
# Exit codes:
#   0 = all checks passed
#   2 = error (missing required resource or unreadable secret)
#   3 = warning (suboptimal but execution can continue)

set -euo pipefail

# --- Configuration ---
KASEKI_ROOT="${KASEKI_ROOT:-/agents}"
KASEKI_TEMPLATE_DIR="${KASEKI_TEMPLATE_DIR:-$KASEKI_ROOT/kaseki-template}"
KASEKI_RESULTS_DIR="${KASEKI_RESULTS_DIR:-$KASEKI_ROOT/kaseki-results}"
KASEKI_RUNS_DIR="${KASEKI_RUNS_DIR:-$KASEKI_ROOT/kaseki-runs}"
MODE="${1:-all}"

CONTAINER_UID="${CONTAINER_UID:-$(id -u)}"
CONTAINER_GID="${CONTAINER_GID:-$(id -g)}"

RED='\033[0;31m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_pass()  { echo -e "${GREEN}✓${NC} $*" >&2; }
log_warn()  { echo -e "${YELLOW}⚠${NC} $*" >&2; }
log_error() { echo -e "${RED}✗${NC} $*" >&2; }
log_info()  { echo -e "${BLUE}ℹ${NC} $*" >&2; }

# --- Checks ---

check_kaseki_root() {
  log_info "Checking $KASEKI_ROOT..."

  if [ ! -d "$KASEKI_ROOT" ]; then
    if mkdir -p "$KASEKI_ROOT" 2>/dev/null; then
      log_pass "$KASEKI_ROOT created"
      return 0
    fi
    log_error "$KASEKI_ROOT does not exist and could not be created"
    log_error "  Fix: sudo mkdir -p $KASEKI_ROOT && sudo chown $CONTAINER_UID:$CONTAINER_GID $KASEKI_ROOT && sudo chmod 755 $KASEKI_ROOT"
    return 2
  fi

  if [ ! -w "$KASEKI_ROOT" ]; then
    log_error "$KASEKI_ROOT is not writable by UID $CONTAINER_UID"
    log_error "  Fix: sudo chown $CONTAINER_UID:$CONTAINER_GID $KASEKI_ROOT && sudo chmod 755 $KASEKI_ROOT"
    return 2
  fi

  log_pass "$KASEKI_ROOT is writable"
  return 0
}

check_subdirectories() {
  local -a subdirs=("$KASEKI_TEMPLATE_DIR" "$KASEKI_RESULTS_DIR" "$KASEKI_RUNS_DIR")
  local exit_code=0

  for subdir in "${subdirs[@]}"; do
    if [ ! -d "$subdir" ]; then
      if mkdir -p "$subdir" 2>/dev/null; then
        log_pass "$subdir created"
      else
        log_warn "Could not create $subdir (will retry later)"
        exit_code=3
      fi
    elif [ ! -w "$subdir" ]; then
      log_warn "$subdir exists but is not writable"
      exit_code=3
    else
      log_pass "$subdir is ready"
    fi
  done

  return "$exit_code"
}

check_bootstrap_status() {
  log_info "Checking bootstrap status..."

  local run_script="$KASEKI_TEMPLATE_DIR/run-kaseki.sh"

  if [ ! -f "$run_script" ]; then
    log_warn "Bootstrap incomplete: run-kaseki.sh not yet present (normal on first startup)"
    return 3
  fi

  if [ ! -x "$run_script" ] && ! chmod +x "$run_script" 2>/dev/null; then
    log_error "run-kaseki.sh is not executable and could not be fixed"
    return 2
  fi

  log_pass "run-kaseki.sh is ready"
  return 0
}

check_secret_paths() {
  log_info "Checking secret paths..."

  local secrets_dir="${KASEKI_SECRETS_DIR:-/agents/secrets}"
  local exit_code=0

  if [ ! -d "$secrets_dir" ]; then
    log_warn "Secrets directory not mounted: $secrets_dir"
    log_info "  Ensure the host secrets directory is mounted at $secrets_dir"
    log_info "  See docs/QUICK_START.md for setup instructions"
    return 3
  fi

  if [ ! -x "$secrets_dir" ]; then
    log_error "Secrets directory is not traversable: $secrets_dir"
    log_error "  Fix on host: sudo chmod 750 $secrets_dir"
    return 2
  fi

  log_pass "Secrets directory is accessible: $secrets_dir"

  # Check API key file readability if it's already present
  local api_key_file="${OPENROUTER_API_KEY_FILE:-$secrets_dir/openrouter_api_key}"
  if [ -f "$api_key_file" ] && [ ! -r "$api_key_file" ]; then
    log_error "API key file exists but is not readable: $api_key_file"
    log_error "  Fix on host: sudo chmod 640 $api_key_file"
    exit_code=2
  fi

  return "$exit_code"
}

check_api_key() {
  log_info "Checking API key..."

  if [ -n "${OPENROUTER_API_KEY:-}" ]; then
    log_pass "OPENROUTER_API_KEY is set"
    return 0
  fi

  local api_key_file="${OPENROUTER_API_KEY_FILE:-}"
  if [ -n "$api_key_file" ] && [ -f "$api_key_file" ]; then
    if [ -r "$api_key_file" ]; then
      log_pass "API key file is readable: $api_key_file"
      return 0
    fi
    log_error "API key file exists but is not readable: $api_key_file"
    log_error "  Fix on host: sudo chmod 640 $api_key_file"
    return 2
  fi

  log_warn "No API key configured — agent runs will fail without one"
  log_info "  Run: kaseki-agent init"
  return 3
}

check_worker_mounts() {
  local -a worker_paths=(/workspace /results /cache)
  local exit_code=0
  local mount_path

  log_info "Checking worker container mounts..."

  for mount_path in "${worker_paths[@]}"; do
    if [ ! -d "$mount_path" ]; then
      log_error "$mount_path is not mounted"
      exit_code=2
    elif [ ! -w "$mount_path" ]; then
      log_error "$mount_path is not writable by UID $CONTAINER_UID"
      exit_code=2
    else
      log_pass "$mount_path is writable"
    fi
  done

  return "$exit_code"
}

# --- Main execution ---

main() {
  local overall_exit=0

  echo ""
  log_info "Kaseki startup checks (mode: $MODE)"
  echo ""

  case "$MODE" in
    all)
      check_kaseki_root || overall_exit=$?
      check_subdirectories || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      check_bootstrap_status || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      check_secret_paths || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      check_api_key || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      ;;
    permissions)
      check_kaseki_root || overall_exit=$?
      check_subdirectories || overall_exit=$?
      ;;
    bootstrap)
      check_bootstrap_status || overall_exit=$?
      ;;
    quick|boot)
      check_kaseki_root || overall_exit=$?
      ;;
    worker)
      check_worker_mounts || overall_exit=$?
      check_secret_paths || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      check_api_key || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      ;;
    baseline-validation)
      check_kaseki_root || overall_exit=$?
      check_subdirectories || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      check_bootstrap_status || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      check_secret_paths || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      ;;
    *)
      log_error "Unknown mode: $MODE"
      echo "Usage: $0 [all|permissions|bootstrap|quick|boot|baseline-validation|worker]" >&2
      return 1
      ;;
  esac

  echo ""
  if [ "$overall_exit" -eq 0 ]; then
    log_pass "All checks passed"
  elif [ "$overall_exit" -eq 2 ]; then
    log_error "Error detected; startup blocked"
  else
    log_warn "Some warnings detected; continuing"
  fi
  echo ""

  return "$overall_exit"
}

main "$@"

