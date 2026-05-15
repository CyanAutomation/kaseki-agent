#!/usr/bin/env bash
#
# kaseki-init-container.sh — Initialize /agents directory permissions for API service
#
# This script runs in an init container (before the main kaseki-api service)
# to ensure the /agents directory is properly configured with correct ownership.
#
# Exit codes:
#   0 = success (directory is ready or was fixed)
#   1 = failure (directory not writable; manual intervention required)
#
# This approach allows graceful fallback: if init fails, the main API service
# still starts but logs clear instructions for Dockhand/Portainer users.

set -euo pipefail

# Configuration
KASEKI_ROOT="${KASEKI_ROOT:-/agents}"
CONTAINER_UID="${CONTAINER_UID:-10000}"
CONTAINER_GID="${CONTAINER_GID:-10000}"

# Color codes for output
RED='\033[0;31m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'  # No Color

# Logging functions
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

# --- Main initialization logic ---

main() {
  log_info "Init container: Initializing $KASEKI_ROOT"
  
  # Check if /agents exists
  if [ ! -d "$KASEKI_ROOT" ]; then
    log_info "  Creating $KASEKI_ROOT..."
    if mkdir -p "$KASEKI_ROOT" 2>/dev/null; then
      log_pass "Created $KASEKI_ROOT"
    else
      log_error "Failed to create $KASEKI_ROOT (parent directory not writable)"
      log_error "Fix: Run on host: sudo mkdir -p $KASEKI_ROOT"
      return 1
    fi
  fi
  
  # Verify it's writable by container UID
  if [ ! -w "$KASEKI_ROOT" ]; then
    log_warn "$KASEKI_ROOT exists but is not writable by container"
    log_info "  Attempting to fix permissions..."
    
    # Try to make it readable and executable for all (755)
    if chmod 755 "$KASEKI_ROOT" 2>/dev/null; then
      log_pass "Fixed permissions on $KASEKI_ROOT (chmod 755)"
      return 0
    else
      log_error "Failed to fix permissions on $KASEKI_ROOT (chmod failed)"
      log_error "This is expected in restricted environments (e.g., read-only volumes)"
      log_error ""
      log_error "Manual fix required. In your container platform (Dockhand/Portainer):"
      log_error "  1. Run on the host: sudo chown $CONTAINER_UID:$CONTAINER_GID $KASEKI_ROOT"
      log_error "  2. Run on the host: sudo chmod 755 $KASEKI_ROOT"
      log_error "  3. Restart the kaseki-api service"
      log_error ""
      log_error "Alternative: Use init container with elevated privileges (not recommended)"
      return 1
    fi
  fi
  
  log_pass "$KASEKI_ROOT is writable by container"
  log_pass "Init complete. API service can now proceed."
  return 0
}

# Execute main and report result
if main; then
  exit 0
else
  # Graceful failure: exit 1 but don't block the main API service from starting
  # The main service will detect the issue via startup-checks.sh and provide
  # actionable error messages to users
  exit 1
fi
