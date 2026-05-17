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

  # Check both primary (Docker) and fallback (local) paths
  local primary_secrets_dir="/home/pi/secrets"
  local fallback_secrets_dir="$HOME/.kaseki/secrets"
  local secrets_dir_found=false
  local exit_code=0

  # Try primary location first
  if [ -d "$primary_secrets_dir" ]; then
    log_pass "Docker secrets directory found: $primary_secrets_dir"

    # Check permissions
    local mode
    mode=$(stat -c '%a' "$primary_secrets_dir" 2>/dev/null || stat -f '%OLp' "$primary_secrets_dir" 2>/dev/null | sed 's/^.*\([0-9]\{3\}\)$/\1/')

    # Mode should be at least 750 (owner rwx, group rx, others nothing)
    if [[ ! "$mode" =~ ^[7][5-7][0-7]$ ]]; then
      log_error "Docker secrets directory has incorrect permissions: $primary_secrets_dir (mode: $mode, expected: 750)"
      log_info "  Fix with: ./scripts/setup-secrets.sh --fix"
      exit_code=2
    else
      log_pass "Docker secrets permissions are correct: $primary_secrets_dir (mode: $mode)"
    fi

    secrets_dir_found=true
  fi

  # Try fallback location
  if [ ! "$secrets_dir_found" = true ] && [ -d "$fallback_secrets_dir" ]; then
    log_pass "Local secrets directory found: $fallback_secrets_dir (falling back from Docker)"

    local mode
    mode=$(stat -c '%a' "$fallback_secrets_dir" 2>/dev/null || stat -f '%OLp' "$fallback_secrets_dir" 2>/dev/null | sed 's/^.*\([0-9]\{3\}\)$/\1/')

    if [ "$mode" != "700" ]; then
      log_error "Local secrets directory has incorrect permissions: $fallback_secrets_dir (mode: $mode, expected: 700)"
      log_info "  Fix with: ./scripts/setup-secrets.sh --fix"
      exit_code=2
    else
      log_pass "Local secrets permissions are correct: $fallback_secrets_dir (mode: $mode)"
    fi

    secrets_dir_found=true
  fi

  if [ ! "$secrets_dir_found" = true ]; then
    log_warn "No secrets directory found ($primary_secrets_dir or $fallback_secrets_dir)"
    log_info "  Create one with: ./scripts/setup-secrets.sh"
    return 3
  fi

  return "$exit_code"
}

check_api_key() {
  log_info "Checking API key..."

  if [ -n "${OPENROUTER_API_KEY:-}" ]; then
    log_pass "OPENROUTER_API_KEY is set (from environment)"
    return 0
  fi

  # Check file-based sources
  local api_key_sources=(
    "${OPENROUTER_API_KEY_FILE:-}"
    "/home/pi/secrets/openrouter_api_key"
    "$HOME/.kaseki/secrets/openrouter_api_key"
  )

  local api_key_found=false
  for api_key_file in "${api_key_sources[@]}"; do
    [ -z "$api_key_file" ] && continue

    if [ -f "$api_key_file" ]; then
      if [ -r "$api_key_file" ]; then
        log_pass "API key file found and readable: $api_key_file"
        api_key_found=true
        break
      else
        log_error "API key file exists but is not readable: $api_key_file"
        log_info "  Fix with: ./scripts/setup-secrets.sh --fix"
        return 2
      fi
    fi
  done

  if [ ! "$api_key_found" = true ]; then
    log_warn "No OpenRouter API key configured"
    log_info "  Set up with: kaseki-agent init"
    return 3
  fi

  return 0
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

