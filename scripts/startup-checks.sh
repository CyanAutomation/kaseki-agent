#!/usr/bin/env bash
#
# startup-checks.sh — Validate Docker environment and permissions
#
# This script runs as an early-stage check in docker-entrypoint.sh
# to catch permission and configuration issues before they cause failures.
#
# Exit codes:
#   0 = all checks passed
#   1 = configuration error (missing API key, invalid paths, etc.)
#   2 = permission error (not writable, can't fix automatically)
#   3 = warning (something is suboptimal but execution can continue)

set -euo pipefail

# --- Configuration ---
KASEKI_ROOT="${KASEKI_ROOT:-/agents}"
KASEKI_TEMPLATE_DIR="${KASEKI_TEMPLATE_DIR:-$KASEKI_ROOT/kaseki-template}"
KASEKI_RESULTS_DIR="${KASEKI_RESULTS_DIR:-$KASEKI_ROOT/results}"
KASEKI_RUNS_DIR="${KASEKI_RUNS_DIR:-$KASEKI_ROOT/runs}"
MODE="${1:-all}"  # all, permissions, bootstrap, or quick

# Current UID inside container (typically UID 10000 for non-root user)
CONTAINER_UID="${CONTAINER_UID:-$(id -u)}"
CONTAINER_GID="${CONTAINER_GID:-$(id -g)}"

# Color codes for output
RED='\033[0;31m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'  # No Color

# --- Helper functions ---

log_pass() {
  echo -e "${GREEN}✓${NC} $*" >&2
}

log_warn() {
  echo -e "${YELLOW}⚠${NC} $*" >&2
}

log_error() {
  echo -e "${RED}✗${NC} $*" >&2
}

log_info() {
  echo -e "${BLUE}ℹ${NC} $*" >&2
}

# Check if a directory is writable (even if it doesn't exist yet)
is_writable_or_creatable() {
  local target_dir="$1"
  local parent_dir
  
  # If directory exists, check if it's writable
  if [ -d "$target_dir" ]; then
    if [ -w "$target_dir" ]; then
      return 0
    else
      return 1
    fi
  fi
  
  # If directory doesn't exist, walk up to find a writable parent
  parent_dir="$(dirname "$target_dir")"
  if [ "$parent_dir" = "$target_dir" ]; then
    # We've reached the root
    return 1
  fi
  
  # Check if parent is writable
  if [ -w "$parent_dir" ]; then
    return 0
  fi
  
  # Recursively check parent
  is_writable_or_creatable "$parent_dir"
}

# --- Permission checks ---

check_kaseki_root() {
  log_info "Checking $KASEKI_ROOT..."
  
  if [ ! -d "$KASEKI_ROOT" ]; then
    if is_writable_or_creatable "$KASEKI_ROOT"; then
      if mkdir -p "$KASEKI_ROOT"; then
        log_pass "$KASEKI_ROOT created (UID:GID $CONTAINER_UID:$CONTAINER_GID)"
        return 0
      else
        log_error "Failed to create $KASEKI_ROOT (permission denied)"
        return 2
      fi
    else
      log_error "$KASEKI_ROOT is not accessible and parent is not writable"
      return 2
    fi
  fi
  
  if [ ! -w "$KASEKI_ROOT" ]; then
    log_error "$KASEKI_ROOT exists but is not writable by UID $CONTAINER_UID"
    log_error "Fix: Run on host: sudo chown $CONTAINER_UID:$CONTAINER_GID $KASEKI_ROOT"
    return 2
  fi
  
  log_pass "$KASEKI_ROOT is writable by UID $CONTAINER_UID"
  return 0
}

check_subdirectories() {
  local -a subdirs=("$KASEKI_TEMPLATE_DIR" "$KASEKI_RESULTS_DIR" "$KASEKI_RUNS_DIR")
  local exit_code=0
  
  for subdir in "${subdirs[@]}"; do
    if [ ! -d "$subdir" ]; then
      if ! mkdir -p "$subdir" 2>/dev/null; then
        log_warn "Could not create $subdir (will try later)"
        exit_code=3
      else
        log_pass "$subdir created"
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
  
  local template_dir="$KASEKI_TEMPLATE_DIR"
  local run_script="$template_dir/run-kaseki.sh"
  
  if [ ! -f "$run_script" ]; then
    log_warn "Bootstrap incomplete: run-kaseki.sh missing at $run_script"
    log_info "  (This is normal on first startup; will be auto-initialized by API service)"
    return 3
  fi
  
  if [ ! -x "$run_script" ]; then
    log_warn "run-kaseki.sh exists but is not executable"
    if chmod +x "$run_script" 2>/dev/null; then
      log_pass "Fixed: run-kaseki.sh is now executable"
      return 0
    else
      log_error "Failed to make run-kaseki.sh executable"
      return 2
    fi
  fi
  
  log_pass "run-kaseki.sh is ready ($run_script)"
  return 0
}

# --- API Key validation ---

check_api_key() {
  # Check for OpenRouter API key (required for agent execution)
  local api_key_file="${OPENROUTER_API_KEY_FILE:-}"
  local api_key_env="${OPENROUTER_API_KEY:-}"
  
  log_info "Checking API key..."
  
  if [ -n "$api_key_env" ]; then
    log_pass "OPENROUTER_API_KEY is set (env var)"
    return 0
  fi
  
  if [ -n "$api_key_file" ] && [ -f "$api_key_file" ]; then
    if [ -r "$api_key_file" ]; then
      log_pass "OPENROUTER_API_KEY_FILE is readable ($api_key_file)"
      return 0
    else
      log_error "OPENROUTER_API_KEY_FILE exists but is not readable ($api_key_file)"
      return 2
    fi
  fi
  
  if [ -f ~/.kaseki/secrets.json ] && [ -r ~/.kaseki/secrets.json ]; then
    log_pass "API key found in ~/.kaseki/secrets.json"
    return 0
  fi
  
  log_warn "No API key configured yet"
  log_info "  Run: kaseki-agent init"
  return 3  # Warning, not error
}

# --- Network checks ---

check_port_availability() {
  local port="${1:-8080}"
  
  log_info "Checking if port $port is available..."
  
  if command -v ss &>/dev/null; then
    if ss -tuln 2>/dev/null | grep -q ":$port "; then
      log_warn "Port $port is already in use"
      return 3
    else
      log_pass "Port $port is available"
      return 0
    fi
  fi
  
  # Fallback if ss is not available
  return 0
}

# --- Main execution ---

main() {
  local overall_exit=0
  
  echo ""
  log_info "Starting kaseki-agent startup checks (mode: $MODE)"
  echo ""
  
  case "$MODE" in
    all)
      check_kaseki_root || overall_exit=$?
      check_subdirectories || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      check_bootstrap_status || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      check_api_key || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      ;;
    
    permissions)
      check_kaseki_root || overall_exit=$?
      check_subdirectories || overall_exit=$?
      ;;
    
    bootstrap)
      check_bootstrap_status || overall_exit=$?
      ;;
    
    quick)
      # Minimal checks (just essentials)
      check_kaseki_root || overall_exit=$?
      ;;
    
    *)
      log_error "Unknown mode: $MODE"
      echo "Usage: $0 [all|permissions|bootstrap|quick]"
      return 1
      ;;
  esac
  
  echo ""
  if [ "$overall_exit" -eq 0 ]; then
    log_pass "All checks passed"
  elif [ "$overall_exit" -eq 2 ]; then
    log_error "Configuration error detected; startup blocked"
  else
    log_warn "Some warnings detected; continuing anyway"
  fi
  echo ""
  
  return "$overall_exit"
}

main "$@"
