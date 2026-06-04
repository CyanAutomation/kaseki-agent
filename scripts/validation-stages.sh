#!/usr/bin/env bash
#
# validation-stages.sh — Unified validation infrastructure for Kaseki host setup and container startup
#
# This script consolidates common validation logic used by:
#   - kaseki-setup-host.sh (host preparation before API service)
#   - startup-checks.sh (container startup validation)
#   - CI/CD pipelines (preflight checks before agent runs)
#
# Each validation stage returns exit codes:
#   0 = all checks passed
#   1 = fatal error (blocking operation)
#   2 = permission/access error (fixable)
#   3 = warning (non-blocking, can continue)
#
# Structured output goes to stdout as plain text or JSON (if jq available).
#
# Usage:
#   source scripts/validation-stages.sh
#   validate_host_prerequisites
#   validate_host_fixes_applied
#   validate_container_entry all
#   validate_operation_ready
#

set -euo pipefail

# --- Configuration ---
KASEKI_ROOT="${KASEKI_ROOT:-/agents}"
KASEKI_TEMPLATE_DIR="${KASEKI_TEMPLATE_DIR:-$KASEKI_ROOT/kaseki-template}"
KASEKI_RESULTS_DIR="${KASEKI_RESULTS_DIR:-$KASEKI_ROOT/kaseki-results}"
KASEKI_RUNS_DIR="${KASEKI_RUNS_DIR:-$KASEKI_ROOT/kaseki-runs}"
KASEKI_CONTAINER_UID="${KASEKI_CONTAINER_UID:-10000}"
KASEKI_CONTAINER_GID="${KASEKI_CONTAINER_GID:-10000}"
KASEKI_CHECKOUT_DIR="${KASEKI_CHECKOUT_DIR:-$KASEKI_ROOT/kaseki-agent}"
KASEKI_SECRETS_DIR="${KASEKI_SECRETS_DIR:-/run/secrets/kaseki}"
KASEKI_LOG_DIR="${KASEKI_LOG_DIR:-/var/log/kaseki}"

# Color codes for human-readable output
RED='\033[0;31m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

# --- Utilities ---

log_pass()  { echo -e "${GREEN}✓${NC} $*"; }
log_warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
log_error() { echo -e "${RED}✗${NC} $*"; }
log_info()  { echo -e "${BLUE}ℹ${NC} $*"; }

log_pass_stderr()  { echo -e "${GREEN}✓${NC} $*" >&2; }
log_warn_stderr()  { echo -e "${YELLOW}⚠${NC} $*" >&2; }
log_error_stderr() { echo -e "${RED}✗${NC} $*" >&2; }
log_info_stderr()  { echo -e "${BLUE}ℹ${NC} $*" >&2; }

# Create JSON object for validation result (if jq is available)
create_json_result() {
  local stage="$1" status="$2" message="$3" remediation="${4:-}"
  
  if ! command -v jq >/dev/null 2>&1; then
    return 0  # jq not available, skip JSON generation
  fi
  
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  
  jq -n \
    --arg stage "$stage" \
    --arg status "$status" \
    --arg message "$message" \
    --arg remediation "$remediation" \
    --arg timestamp "$timestamp" \
    '{
      stage: $stage,
      status: $status,
      message: $message,
      remediation: $remediation,
      timestamp: $timestamp
    }'
}

# Check if path components are traversable
check_path_components_traversable() {
  local target_path="$1"
  local current=""
  local component
  local -a components

  if [ -z "$target_path" ]; then
    return 0
  fi

  case "$target_path" in
    /*) current="/" ;;
    *) current="." ;;
  esac

  IFS='/' read -r -a components <<< "$target_path"
  for component in "${components[@]}"; do
    [ -z "$component" ] && continue

    if [ "$current" = "/" ]; then
      current="/$component"
    elif [ "$current" = "." ]; then
      current="$component"
    else
      current="$current/$component"
    fi

    if [ -d "$current" ]; then
      if [ ! -x "$current" ]; then
        return 2
      fi
    elif [ -e "$current" ]; then
      return 0
    else
      return 0
    fi
  done

  return 0
}

# --- Stage 1: Host Prerequisites ---

# validate_host_prerequisites — Check if host is ready for setup
# Validates: directories exist, git configured, secrets path accessible
validate_host_prerequisites() {
  local exit_code=0

  log_info "Validating host prerequisites..."

  # Check KASEKI_ROOT exists or can be created
  if [ ! -d "$KASEKI_ROOT" ]; then
    log_error "KASEKI_ROOT does not exist: $KASEKI_ROOT"
    log_info "  Remediation: mkdir -p $KASEKI_ROOT && chmod 0775 $KASEKI_ROOT"
    return 1
  fi

  if [ ! -w "$KASEKI_ROOT" ]; then
    log_warn "KASEKI_ROOT is not writable: $KASEKI_ROOT"
    log_info "  Remediation: sudo chown $KASEKI_CONTAINER_UID:$KASEKI_CONTAINER_GID $KASEKI_ROOT && sudo chmod 0775 $KASEKI_ROOT"
    exit_code=2
  else
    log_pass "KASEKI_ROOT is writable: $KASEKI_ROOT"
  fi

  # Check git is available
  if ! command -v git >/dev/null 2>&1; then
    log_warn "git is not installed"
    exit_code=$((exit_code > 3 ? exit_code : 3))
  else
    log_pass "git is available"
  fi

  # Check secrets path is traversable
  if ! check_path_components_traversable "$KASEKI_SECRETS_DIR"; then
    log_warn "Secrets path is not fully traversable: $KASEKI_SECRETS_DIR"
    exit_code=$((exit_code > 2 ? exit_code : 2))
  else
    log_pass "Secrets path is traversable: $KASEKI_SECRETS_DIR"
  fi

  return "$exit_code"
}

# --- Stage 2: Host Fixes Verification ---

# validate_host_fixes_applied — Verify that setup fixes were actually applied
# Validates: ownership, permissions, bootstrap status
validate_host_fixes_applied() {
  local exit_code=0

  log_info "Validating that host fixes were applied..."

  # Check directory ownership
  for dir in "$KASEKI_ROOT" "$KASEKI_TEMPLATE_DIR" "$KASEKI_RESULTS_DIR"; do
    if [ ! -d "$dir" ]; then
      log_warn "Directory does not exist: $dir"
      exit_code=$((exit_code > 3 ? exit_code : 3))
      continue
    fi

    local actual_owner actual_group
    actual_owner=$(stat -c '%U' "$dir" 2>/dev/null || stat -f '%Su' "$dir" 2>/dev/null || echo "unknown")
    actual_group=$(stat -c '%G' "$dir" 2>/dev/null || stat -f '%Sg' "$dir" 2>/dev/null || echo "unknown")

    if [ "$actual_owner" = "unknown" ] || [ "$actual_group" = "unknown" ]; then
      log_warn "Could not determine ownership of $dir"
      continue
    fi

    log_pass "$dir is owned by $actual_owner:$actual_group"
  done

  # Check template runner executable
  if [ -f "$KASEKI_TEMPLATE_DIR/run-kaseki.sh" ]; then
    if [ -x "$KASEKI_TEMPLATE_DIR/run-kaseki.sh" ]; then
      log_pass "Template runner is executable: $KASEKI_TEMPLATE_DIR/run-kaseki.sh"
    else
      log_error "Template runner exists but is not executable: $KASEKI_TEMPLATE_DIR/run-kaseki.sh"
      exit_code=$((exit_code > 1 ? exit_code : 1))
    fi
  else
    log_warn "Template runner not yet deployed: $KASEKI_TEMPLATE_DIR/run-kaseki.sh"
    exit_code=$((exit_code > 3 ? exit_code : 3))
  fi

  return "$exit_code"
}

# --- Stage 3: Container Entry Validation ---

# validate_container_entry [mode] — Container startup validation
# Modes: all, permissions, bootstrap, quick, worker
validate_container_entry() {
  local mode="${1:-all}"
  local exit_code=0

  log_info "Validating container entry (mode: $mode)..."

  case "$mode" in
    all)
      # Full startup validation
      local subdir
      for subdir in "$KASEKI_RESULTS_DIR" "$KASEKI_RUNS_DIR" "$KASEKI_TEMPLATE_DIR"; do
        if [ ! -d "$subdir" ]; then
          if mkdir -p "$subdir" 2>/dev/null; then
            log_pass "Created $subdir"
          else
            log_warn "Could not create $subdir"
            exit_code=$((exit_code > 3 ? exit_code : 3))
          fi
        elif [ -w "$subdir" ]; then
          log_pass "$subdir is writable"
        else
          log_warn "$subdir exists but is not writable"
          exit_code=$((exit_code > 3 ? exit_code : 3))
        fi
      done
      ;;
    permissions)
      # Check root directory permissions only
      if [ ! -d "$KASEKI_ROOT" ]; then
        log_error "KASEKI_ROOT does not exist: $KASEKI_ROOT"
        return 2
      fi
      if [ ! -w "$KASEKI_ROOT" ]; then
        log_error "KASEKI_ROOT is not writable: $KASEKI_ROOT"
        return 2
      fi
      log_pass "KASEKI_ROOT is writable"
      ;;
    bootstrap)
      # Check if bootstrap is ready
      if [ -f "$KASEKI_TEMPLATE_DIR/run-kaseki.sh" ] && [ -x "$KASEKI_TEMPLATE_DIR/run-kaseki.sh" ]; then
        log_pass "Bootstrap is ready: $KASEKI_TEMPLATE_DIR/run-kaseki.sh"
      else
        log_warn "Bootstrap not ready; run 'kaseki-agent host setup --fix'"
        exit_code=3
      fi
      ;;
    quick)
      # Minimal check for root directory
      if [ ! -d "$KASEKI_ROOT" ]; then
        log_error "KASEKI_ROOT does not exist: $KASEKI_ROOT"
        return 1
      fi
      log_pass "KASEKI_ROOT exists"
      ;;
    worker)
      # Worker container checks
      local -a worker_paths=(/workspace /results /cache)
      for path in "${worker_paths[@]}"; do
        if [ ! -d "$path" ]; then
          log_error "$path is not mounted"
          exit_code=$((exit_code > 2 ? exit_code : 2))
        elif [ ! -w "$path" ]; then
          log_error "$path is not writable"
          exit_code=$((exit_code > 2 ? exit_code : 2))
        else
          log_pass "$path is writable"
        fi
      done

      # Check results writability with test file
      if [ -d "$KASEKI_RESULTS_DIR" ] && [ -w "$KASEKI_RESULTS_DIR" ]; then
        local test_file="$KASEKI_RESULTS_DIR/.kaseki-writable-test-$$"
        if touch "$test_file" 2>/dev/null && rm -f "$test_file" 2>/dev/null; then
          log_pass "Results directory is fully writable"
        else
          log_warn "Results directory write test failed"
          exit_code=$((exit_code > 3 ? exit_code : 3))
        fi
      fi
      ;;
    *)
      log_error "Unknown validation mode: $mode"
      return 1
      ;;
  esac

  return "$exit_code"
}

# --- Stage 4: Operation Ready ---

# validate_operation_ready — Final validation before agent execution
# Validates: secrets available, API key present, GitHub App configured
validate_operation_ready() {
  local exit_code=0

  log_info "Validating operation readiness..."

  # Check API key
  if [ -n "${OPENROUTER_API_KEY:-}" ]; then
    log_pass "OPENROUTER_API_KEY is set (from environment)"
  elif [ -f "$KASEKI_SECRETS_DIR/openrouter_api_key" ] && [ -r "$KASEKI_SECRETS_DIR/openrouter_api_key" ]; then
    log_pass "OPENROUTER_API_KEY found: $KASEKI_SECRETS_DIR/openrouter_api_key"
  else
    log_error "OPENROUTER_API_KEY not found"
    log_info "  Remediation: Set OPENROUTER_API_KEY env var or place key at $KASEKI_SECRETS_DIR/openrouter_api_key"
    exit_code=$((exit_code > 1 ? exit_code : 1))
  fi

  # Check GitHub App credentials (optional)
  if [ "${GITHUB_APP_ENABLED:-1}" = "1" ]; then
    if [ -f "$KASEKI_SECRETS_DIR/github_app_id" ] && [ -r "$KASEKI_SECRETS_DIR/github_app_id" ]; then
      log_pass "GitHub App ID found"
    else
      log_warn "GitHub App ID not found; GitHub features will be limited"
      exit_code=$((exit_code > 3 ? exit_code : 3))
    fi
  else
    log_info "GitHub App disabled (GITHUB_APP_ENABLED=0)"
  fi

  return "$exit_code"
}

# --- Export functions for sourcing ---

export -f log_pass log_warn log_error log_info
export -f log_pass_stderr log_warn_stderr log_error_stderr log_info_stderr
export -f create_json_result check_path_components_traversable
export -f validate_host_prerequisites validate_host_fixes_applied
export -f validate_container_entry validate_operation_ready
