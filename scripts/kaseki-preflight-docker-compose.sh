#!/bin/bash
# kaseki-preflight-docker-compose.sh
# Pre-deployment validation for Docker Compose setup
# Detects common permission and configuration issues before running docker-compose up -d
# shellcheck disable=SC2034
# Note: Exit code constants defined below for external reference

set -o errexit

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Exit codes
EXIT_OK=0
EXIT_ERRORS=1
EXIT_WARNINGS=0  # Warnings are non-blocking

# Counters
ERRORS=0
WARNINGS=0

# Logging functions
log_header() {
  echo -e "\n${BLUE}ℹ $1${NC}"
}

log_pass() {
  echo -e "${GREEN}✓ $1${NC}"
}

log_warning() {
  echo -e "${YELLOW}⚠ $1${NC}"
  ((WARNINGS++))
}

log_error() {
  echo -e "${RED}✗ $1${NC}"
  ((ERRORS++))
}

log_info() {
  echo -e "  $1"
}

# ============================================================================
# Check: /agents directory exists and has correct ownership
# ============================================================================
check_agents_directory() {
  log_header "Checking /agents directory..."
  
  if [[ ! -d /agents ]]; then
    log_error "/agents directory does not exist"
    log_info "Fix: Run on host:"
    log_info "  sudo mkdir -p /agents"
    log_info "  sudo chown 10000:10000 /agents"
    log_info "  sudo chmod 755 /agents"
    return 1
  fi
  
  log_pass "/agents directory exists"
  
  # Check ownership
  local owner_uid; owner_uid=$(stat -c %U /agents 2>/dev/null || stat -f %Su /agents 2>/dev/null)
  local owner_gid; owner_gid=$(stat -c %G /agents 2>/dev/null || stat -f %Sg /agents 2>/dev/null)
  local numeric_uid; numeric_uid=$(stat -c %u /agents 2>/dev/null || stat -f %u /agents 2>/dev/null)
  local numeric_gid; numeric_gid=$(stat -c %g /agents 2>/dev/null || stat -f %g /agents 2>/dev/null)
  
  if [[ "$numeric_uid" != "10000" ]] || [[ "$numeric_gid" != "10000" ]]; then
    log_error "/agents is owned by $owner_uid:$owner_gid (UID:GID $numeric_uid:$numeric_gid), should be 10000:10000"
    log_info "Fix: Run on host:"
    log_info "  sudo chown 10000:10000 /agents"
    return 1
  fi
  
  log_pass "/agents is owned by UID:GID 10000:10000"
  
  # Check permissions (should be at least rwx for owner, rx for others)
  local perms; perms=$(stat -c %a /agents 2>/dev/null || stat -f %A /agents 2>/dev/null)
  if [[ "$perms" != "755" && "$perms" != "750" && "$perms" != "700" ]]; then
    log_warning "/agents has permissions $perms (expected 755, 750, or 700)"
    log_info "Suggestion: Run on host:"
    log_info "  sudo chmod 755 /agents"
    return 0  # Non-blocking
  fi
  
  log_pass "/agents has permissions $perms (OK)"
  return 0
}

# ============================================================================
# Check: Docker daemon is accessible
# ============================================================================
check_docker_daemon() {
  log_header "Checking Docker daemon..."
  
  if ! command -v docker &> /dev/null; then
    log_error "docker command not found in PATH"
    log_info "Fix: Install Docker or ensure it's in PATH"
    return 1
  fi
  
  log_pass "docker command found"
  
  if ! docker ps > /dev/null 2>&1; then
    log_error "cannot connect to Docker daemon (permission denied?)"
    log_info "Fix: Ensure current user can access Docker:"
    log_info "  sudo usermod -aG docker \$USER"
    log_info "  newgrp docker  # or restart shell"
    return 1
  fi
  
  log_pass "Docker daemon is accessible"
  return 0
}

# ============================================================================
# Check: docker-compose is available
# ============================================================================
check_docker_compose() {
  log_header "Checking docker-compose..."
  
  if ! command -v docker-compose &> /dev/null && ! docker compose version > /dev/null 2>&1; then
    log_error "docker-compose not found"
    log_info "Fix: Install docker-compose (v2+recommended)"
    return 1
  fi
  
  log_pass "docker-compose is available"
  return 0
}

# ============================================================================
# Check: docker-compose.yml exists and is readable
# ============================================================================
check_compose_file() {
  log_header "Checking docker-compose.yml..."
  # shellcheck disable=SC2120
  local compose_file="${1:-docker-compose.yml}"
  
  if [[ ! -f "$compose_file" ]]; then
    log_error "docker-compose.yml not found at $compose_file"
    log_info "Fix: Ensure you're in the kaseki-agent repo root directory"
    return 1
  fi
  
  log_pass "docker-compose.yml found"
  
  if ! docker-compose config > /dev/null 2>&1 && ! docker compose config > /dev/null 2>&1; then
    log_error "docker-compose.yml validation failed"
    log_info "Fix: Check docker-compose.yml for syntax errors"
    return 1
  fi
  
  log_pass "docker-compose.yml is valid"
  return 0
}

# ============================================================================
# Check: Required environment variables
# ============================================================================
check_environment_variables() {
  log_header "Checking environment variables..."
  
  local required_vars=(
    "OPENROUTER_API_KEY_FILE"
  )
  
  local missing_vars=0
  
  for var in "${required_vars[@]}"; do
    if [[ -z "${!var}" ]]; then
      log_warning "$var not set (will use default: /run/secrets/kaseki/openrouter_api_key)"
      ((missing_vars++))
    fi
  done
  
  if (( missing_vars > 0 )); then
    log_info "Suggestion: Set in .env or docker-compose.yml"
    log_info "  OPENROUTER_API_KEY_FILE=/path/to/api/key/file"
    return 0  # Non-blocking
  fi
  
  log_pass "Environment variables OK"
  return 0
}

# ============================================================================
# Check: Secrets directory exists (if using file-based secrets)
# ============================================================================
check_secrets_directory() {
  log_header "Checking secrets directory..."
  
  local secrets_dir="${KASEKI_SECRETS_DIR:-/home/pi/secrets}"
  
  if [[ ! -d "$secrets_dir" ]]; then
    log_warning "Secrets directory does not exist: $secrets_dir"
    log_info "This is OK if you're providing secrets via Docker secrets or env vars"
    log_info "For file-based secrets, create with: mkdir -p $secrets_dir"
    return 0  # Non-blocking
  fi
  
  log_pass "Secrets directory exists: $secrets_dir"
  
  # Check for API key file
  local api_key_file="${OPENROUTER_API_KEY_FILE:-$secrets_dir/openrouter_api_key}"
  
  if [[ ! -f "$api_key_file" ]]; then
    log_warning "API key file not found: $api_key_file"
    log_info "The API service will start but jobs will fail without an API key"
    log_info "Add the key file before running: kaseki-agent init"
    return 0  # Non-blocking
  fi
  
  log_pass "API key file exists: $api_key_file"
  return 0
}

# ============================================================================
# Check: Disk space
# ============================================================================
check_disk_space() {
  log_header "Checking disk space..."
  
  local available_mb; available_mb=$(df /agents 2>/dev/null | tail -1 | awk '{print $4}')
  
  if [[ -z "$available_mb" ]]; then
    log_warning "Could not determine disk space for /agents"
    return 0  # Non-blocking
  fi
  
  local required_mb=5000  # 5 GB minimum
  
  if (( available_mb < required_mb )); then
    log_warning "Low disk space: $(( available_mb / 1024 )) GB available, recommend at least 5 GB"
    log_info "Clean up old artifacts: rm -rf /agents/kaseki-results/kaseki-* /agents/kaseki-runs/kaseki-*"
    return 0  # Non-blocking
  fi
  
  log_pass "Disk space OK: $(( available_mb / 1024 )) GB available"
  return 0
}

# ============================================================================
# Summary and Exit
# ============================================================================
print_summary() {
  echo ""
  echo "═════════════════════════════════════════════════════════════════"
  
  if (( ERRORS == 0 )); then
    echo -e "${GREEN}✓ All critical checks passed!${NC}"
    echo ""
    echo "You can now run:"
    echo "  docker-compose up -d"
    echo ""
    echo "Monitor startup:"
    echo "  docker-compose logs -f kaseki-api"
    echo "═════════════════════════════════════════════════════════════════"
    return 0
  else
    echo -e "${RED}✗ $ERRORS critical error(s) detected.${NC}"
    echo ""
    echo "Fix the errors above and run this script again:"
    echo "  $0"
    echo "═════════════════════════════════════════════════════════════════"
    return 1
  fi
}

# ============================================================================
# Main
# ============================================================================
main() {
  echo ""
  echo "╔═════════════════════════════════════════════════════════════════╗"
  echo "║  Kaseki Agent - Docker Compose Pre-flight Validation           ║"
  echo "║  Checks configuration before docker-compose up -d              ║"
  echo "╚═════════════════════════════════════════════════════════════════╝"
  echo ""
  
  # Run all checks (continue on failure to report all issues at once)
  check_agents_directory || true
  check_docker_daemon || true
  check_docker_compose || true
  check_compose_file "$@" || true
  check_environment_variables || true
  check_secrets_directory || true
  check_disk_space || true
  
  # Print summary and exit
  print_summary
}

main "$@"
