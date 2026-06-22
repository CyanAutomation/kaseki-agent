#!/bin/bash

###############################################################################
# setup-secrets.sh - Unified secrets and permissions setup
#
# Automatically configures secrets directories with proper permissions:
# - Docker deployment: /home/pi/secrets (GID 10000, mode 750)
# - Local development: ~/.kaseki/secrets (mode 700)
#
# USAGE
#   ./scripts/setup-secrets.sh [OPTIONS]
#
# OPTIONS
#   --docker         Setup for Docker deployment only
#   --local          Setup for local development only
#   --both           Setup both Docker and local (default)
#   --fix            Auto-fix permission issues (run this if startup fails)
#   --validate       Check that directories exist with correct permissions
#   --help           Show this help message
#
# EXIT CODES
#   0  Success - all checks passed
#   1  General error (permissions denied, disk full, etc.)
#   2  Validation failed (permissions incorrect)
#
# EXAMPLES
#   # Setup both Docker and local directories
#   ./scripts/setup-secrets.sh
#
#   # Setup Docker only
#   ./scripts/setup-secrets.sh --docker
#
#   # Validate current setup
#   ./scripts/setup-secrets.sh --validate
#
#   # Auto-fix permission issues
#   ./scripts/setup-secrets.sh --fix
#
###############################################################################

# shellcheck disable=SC2034
# Reference UID/GID constants defined below for Docker user configuration

set -euo pipefail

# Configuration
DOCKER_SECRETS_DIR="/home/pi/secrets"
LOCAL_SECRETS_DIR="$HOME/.kaseki/secrets"
KASEKI_UID=10000
KASEKI_GID=10000
KASEKI_GROUP="kaseki"

# Flags
MODE="both"          # docker, local, or both
FIX_MODE=false
VALIDATE_ONLY=false
VERBOSE=${VERBOSE:-0}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

###############################################################################
# Helper Functions
###############################################################################

log_info() {
  echo -e "${GREEN}✓${NC} $*"
}

log_warn() {
  echo -e "${YELLOW}⚠${NC} $*" >&2
}

log_error() {
  echo -e "${RED}✗${NC} $*" >&2
}

log_debug() {
  if [ "$VERBOSE" = "1" ]; then
    echo -e "${BLUE}→${NC} $*" >&2
  fi
}

print_help() {
  grep "^# " "$0" | sed 's/^# //'
}

###############################################################################
# Validation Functions
###############################################################################

# shellcheck disable=SC2317
check_permissions() {
  local path=$1
  local expected_mode=$2
  local expected_owner=$3

  if [ ! -d "$path" ]; then
    log_error "Directory does not exist: $path"
    return 1
  fi

  local actual_mode
  actual_mode=$(stat -c '%a' "$path" 2>/dev/null || stat -f '%OLp' "$path" 2>/dev/null | sed 's/^.*\([0-9]\{3\}\)$/\1/')

  if [ "$actual_mode" != "$expected_mode" ]; then
    log_error "Permission mismatch for $path: expected $expected_mode, got $actual_mode"
    return 1
  fi

  if [ -n "$expected_owner" ]; then
    local actual_owner
    actual_owner=$(stat -c '%U:%G' "$path" 2>/dev/null || stat -f '%Su:%Sg' "$path" 2>/dev/null)

    if [ "$actual_owner" != "$expected_owner" ]; then
      log_warn "Owner mismatch for $path: expected $expected_owner, got $actual_owner"
      return 1
    fi
  fi

  log_debug "Permissions OK: $path ($expected_mode, $expected_owner)"
  return 0
}

###############################################################################
# Setup Functions
###############################################################################

setup_kaseki_group() {
  # Check if group already exists
  if getent group "$KASEKI_GROUP" >/dev/null 2>&1; then
    local actual_gid
    actual_gid=$(getent group "$KASEKI_GROUP" | cut -d: -f3)
    log_debug "Group '$KASEKI_GROUP' already exists (GID: $actual_gid)"

    if [ "$actual_gid" != "$KASEKI_GID" ]; then
      log_warn "Group '$KASEKI_GROUP' exists with different GID: $actual_gid (expected $KASEKI_GID)"
      # Don't fail; just use the existing group
    fi
    return 0
  fi

  # Try to create the group
  if command -v groupadd >/dev/null 2>&1; then
    log_debug "Creating group '$KASEKI_GROUP' (GID: $KASEKI_GID)"
    if sudo groupadd --gid "$KASEKI_GID" "$KASEKI_GROUP" 2>/dev/null; then
      log_info "Created group '$KASEKI_GROUP' (GID: $KASEKI_GID)"
    else
      # Group might already exist with different GID, or we don't have sudo
      log_debug "Could not create group (may already exist or no sudo access)"
    fi
  else
    log_warn "groupadd not found; skipping group creation"
  fi

  return 0
}

setup_docker_secrets() {
  log_debug "Setting up Docker secrets directory: $DOCKER_SECRETS_DIR"

  # Check if we can write to /home/pi
  local parent_dir
  parent_dir=$(dirname "$DOCKER_SECRETS_DIR")
  if [ ! -d "$parent_dir" ]; then
    log_error "Parent directory does not exist: $parent_dir"
    log_error "Please create it first: sudo mkdir -p $parent_dir"
    return 1
  fi

  if [ ! -w "$parent_dir" ]; then
    # Try with sudo
    if command -v sudo >/dev/null 2>&1; then
      log_debug "Parent directory not writable; using sudo"
      if ! sudo mkdir -p "$DOCKER_SECRETS_DIR" 2>/dev/null; then
        log_error "Failed to create $DOCKER_SECRETS_DIR (permission denied)"
        log_error "Try: sudo mkdir -p $DOCKER_SECRETS_DIR"
        return 1
      fi
      if ! sudo chmod 750 "$DOCKER_SECRETS_DIR" 2>/dev/null; then
        log_error "Failed to chmod $DOCKER_SECRETS_DIR"
        return 1
      fi
      if ! sudo chgrp "$KASEKI_GROUP" "$DOCKER_SECRETS_DIR" 2>/dev/null; then
        log_warn "Failed to set group ownership (may not have sudo access)"
      fi
    else
      log_error "Cannot write to $parent_dir and sudo is not available"
      return 1
    fi
  else
    # We have write permission; create the directory
    mkdir -p "$DOCKER_SECRETS_DIR"
    chmod 750 "$DOCKER_SECRETS_DIR"
    if command -v chgrp >/dev/null 2>&1; then
      chgrp "$KASEKI_GROUP" "$DOCKER_SECRETS_DIR" 2>/dev/null || log_warn "Could not set group ownership"
    fi
  fi

  log_info "Docker secrets directory ready: $DOCKER_SECRETS_DIR (750)"
  return 0
}

setup_local_secrets() {
  log_debug "Setting up local secrets directory: $LOCAL_SECRETS_DIR"

  if mkdir -p "$LOCAL_SECRETS_DIR" 2>/dev/null; then
    chmod 700 "$LOCAL_SECRETS_DIR"
    log_info "Local secrets directory ready: $LOCAL_SECRETS_DIR (700)"
    return 0
  else
    log_error "Failed to create $LOCAL_SECRETS_DIR"
    return 1
  fi
}

###############################################################################
# Validation and Fix Functions
###############################################################################

validate_docker_secrets() {
  log_debug "Validating Docker secrets directory: $DOCKER_SECRETS_DIR"

  if [ ! -d "$DOCKER_SECRETS_DIR" ]; then
    log_error "Directory does not exist: $DOCKER_SECRETS_DIR"
    return 1
  fi

  # Get actual permissions
  local actual_mode
  actual_mode=$(stat -c '%a' "$DOCKER_SECRETS_DIR" 2>/dev/null || stat -f '%OLp' "$DOCKER_SECRETS_DIR" 2>/dev/null | sed 's/^.*\([0-9]\{3\}\)$/\1/')

  # Check that owner can read/write/execute (7), group can read/execute (5 or higher)
  if [[ "$actual_mode" =~ ^[7][5-7][0-7]$ ]]; then
    log_info "Docker secrets permissions OK: $DOCKER_SECRETS_DIR ($actual_mode)"
    return 0
  else
    log_error "Docker secrets permissions incorrect: $DOCKER_SECRETS_DIR (mode $actual_mode, expected 750)"
    return 1
  fi
}

validate_local_secrets() {
  log_debug "Validating local secrets directory: $LOCAL_SECRETS_DIR"

  if [ ! -d "$LOCAL_SECRETS_DIR" ]; then
    log_error "Directory does not exist: $LOCAL_SECRETS_DIR"
    return 1
  fi

  # Get actual permissions
  local actual_mode
  actual_mode=$(stat -c '%a' "$LOCAL_SECRETS_DIR" 2>/dev/null || stat -f '%OLp' "$LOCAL_SECRETS_DIR" 2>/dev/null | sed 's/^.*\([0-9]\{3\}\)$/\1/')

  # Check that only owner can read/write/execute (700)
  if [ "$actual_mode" = "700" ]; then
    log_info "Local secrets permissions OK: $LOCAL_SECRETS_DIR ($actual_mode)"
    return 0
  else
    log_error "Local secrets permissions incorrect: $LOCAL_SECRETS_DIR (mode $actual_mode, expected 700)"
    return 1
  fi
}

fix_docker_secrets() {
  log_debug "Fixing Docker secrets directory permissions: $DOCKER_SECRETS_DIR"

  if [ ! -d "$DOCKER_SECRETS_DIR" ]; then
    log_warn "Directory does not exist, creating: $DOCKER_SECRETS_DIR"
    setup_docker_secrets || return 1
  else
    # Try to fix permissions
    if [ -w "$DOCKER_SECRETS_DIR" ]; then
      chmod 750 "$DOCKER_SECRETS_DIR"
      log_info "Fixed Docker secrets permissions: $DOCKER_SECRETS_DIR (750)"
    elif command -v sudo >/dev/null 2>&1; then
      sudo chmod 750 "$DOCKER_SECRETS_DIR"
      sudo chgrp "$KASEKI_GROUP" "$DOCKER_SECRETS_DIR" 2>/dev/null || true
      log_info "Fixed Docker secrets permissions (with sudo): $DOCKER_SECRETS_DIR (750)"
    else
      log_error "Cannot fix permissions (no write access and no sudo)"
      return 1
    fi
  fi

  return 0
}

fix_local_secrets() {
  log_debug "Fixing local secrets directory permissions: $LOCAL_SECRETS_DIR"

  if [ ! -d "$LOCAL_SECRETS_DIR" ]; then
    log_warn "Directory does not exist, creating: $LOCAL_SECRETS_DIR"
    setup_local_secrets || return 1
  else
    chmod 700 "$LOCAL_SECRETS_DIR"
    log_info "Fixed local secrets permissions: $LOCAL_SECRETS_DIR (700)"
  fi

  return 0
}

###############################################################################
# Main Logic
###############################################################################

main() {
  # Parse arguments
  while [ $# -gt 0 ]; do
    case "$1" in
    --docker)
      MODE="docker"
      ;;
    --local)
      MODE="local"
      ;;
    --both)
      MODE="both"
      ;;
    --fix)
      FIX_MODE=true
      ;;
    --validate)
      VALIDATE_ONLY=true
      ;;
    --help | -h)
      print_help
      exit 0
      ;;
    *)
      log_error "Unknown option: $1"
      print_help
      exit 1
      ;;
    esac
    shift
  done

  log_debug "Mode: $MODE, Fix: $FIX_MODE, Validate: $VALIDATE_ONLY"

  # Check if we're running in a container
  if [ -f /.dockerenv ]; then
    log_warn "Running inside a container; Docker setup will be skipped"
    MODE="local"
  fi

  # Execute based on mode
  if $VALIDATE_ONLY; then
    # Validation mode
    log_info "Validating secrets setup..."
    local errors=0

    if [ "$MODE" = "docker" ] || [ "$MODE" = "both" ]; then
      if ! validate_docker_secrets; then
        ((errors++))
      fi
    fi

    if [ "$MODE" = "local" ] || [ "$MODE" = "both" ]; then
      if ! validate_local_secrets; then
        ((errors++))
      fi
    fi

    if [ $errors -gt 0 ]; then
      log_error "Validation failed ($errors issues)"
      log_info "Run: ./scripts/setup-secrets.sh --fix"
      exit 2
    else
      log_info "All checks passed!"
      exit 0
    fi
  elif $FIX_MODE; then
    # Fix mode
    log_info "Auto-fixing secrets setup..."

    if [ "$MODE" = "docker" ] || [ "$MODE" = "both" ]; then
      if ! fix_docker_secrets; then
        log_error "Failed to fix Docker secrets"
        exit 1
      fi
    fi

    if [ "$MODE" = "local" ] || [ "$MODE" = "both" ]; then
      if ! fix_local_secrets; then
        log_error "Failed to fix local secrets"
        exit 1
      fi
    fi

    log_info "Auto-fix complete! Run 'docker-compose restart kaseki-api' if deployed."
    exit 0
  else
    # Setup mode
    log_info "Setting up secrets directories..."

    # Ensure kaseki group exists
    setup_kaseki_group

    if [ "$MODE" = "docker" ] || [ "$MODE" = "both" ]; then
      if ! setup_docker_secrets; then
        log_error "Failed to setup Docker secrets"
        exit 1
      fi
    fi

    if [ "$MODE" = "local" ] || [ "$MODE" = "both" ]; then
      if ! setup_local_secrets; then
        log_error "Failed to setup local secrets"
        exit 1
      fi
    fi

    log_info "Secrets setup complete!"
    log_info "Next: Add secret files and run 'kaseki-agent init'"
    exit 0
  fi
}

main "$@"
