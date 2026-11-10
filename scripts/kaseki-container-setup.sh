#!/usr/bin/env bash
#
# kaseki-container-setup.sh — Setup wizard inside the container
#
# This script runs INSIDE the kaseki-agent container during setup mode.
# It:
# 1. Creates /secrets directory with proper permissions
# 2. Optionally stores an approved Kaseki machine token for Senku decisions
# 3. Runs health checks
#
# Entry point: docker run -it kaseki-agent setup
# A missing Senku token does not block coding or deterministic checks.

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Helper functions
print_header() {
  echo -e "${BLUE}=== $1 ===${NC}"
}

print_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
  echo -e "${RED}✗ $1${NC}" >&2
}

print_warning() {
  echo -e "${YELLOW}⚠ $1${NC}"
}

# Setup secrets directory
setup_secrets_dir() {
  SECRETS_DIR="${1:-.}/secrets"
  mkdir -p "$SECRETS_DIR"
  chmod 700 "$SECRETS_DIR"
  print_success "Secrets directory ready: $SECRETS_DIR"
}

# Optionally install an approved Senku Kaseki machine token.
setup_decision_token() {
  local token_file="/secrets/senku_kaseki_api_token"
  if [ -f "$token_file" ] && [ -s "$token_file" ]; then
    chmod 600 "$token_file"
    print_success "Senku decision credential is already present"
    return 0
  fi

  echo "The Senku Kaseki machine token is issued by the Senku operator."
  echo "Leave it unset to continue; decision stages will degrade safely."
  if [ -n "${SENKU_KASEKI_API_TOKEN:-}" ]; then
    DECISION_TOKEN="$SENKU_KASEKI_API_TOKEN"
  else
    read -p "Install the approved Kaseki machine token now? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      print_warning "Senku decision credential not installed"
      return 0
    fi
    read -rsp "Enter the approved Kaseki machine token: " DECISION_TOKEN
    echo
  fi

  if [ "${#DECISION_TOKEN}" -lt 32 ] || [[ "$DECISION_TOKEN" =~ [[:space:]] ]]; then
    unset DECISION_TOKEN
    print_error "Invalid Senku machine token format"
    return 1
  fi
  umask 077
  printf '%s' "$DECISION_TOKEN" > "$token_file"
  unset DECISION_TOKEN
  chmod 600 "$token_file"
  print_success "Senku machine token stored at $token_file (mode 600)"
  return 0
}

# Run health checks
run_health_checks() {
  print_header "Running Health Checks"
  
  # Check Docker daemon
  if docker ps >/dev/null 2>&1; then
    print_success "Docker daemon is accessible"
  else
    print_error "Docker daemon is not accessible"
    print_warning "Make sure Docker socket is mounted: -v /var/run/docker.sock:/var/run/docker.sock"
    return 1
  fi
  
  # Check jq (required for metadata/report JSON processing)
  if command -v jq >/dev/null 2>&1; then
    print_success "jq is available"
  else
    print_error "jq is not available"
    return 1
  fi

  # Check Pi CLI
  if command -v pi >/dev/null 2>&1; then
    print_success "Pi CLI is available"
  else
    print_error "Pi CLI is not available"
    return 1
  fi
  
  # The Senku decision credential is optional.
  if [ -f "/secrets/senku_kaseki_api_token" ] && [ -r "/secrets/senku_kaseki_api_token" ]; then
    print_success "Senku decision credential file is readable"
  else
    print_warning "Senku decision credential is unavailable; decision stages will degrade safely"
  fi
  
  print_success "All health checks passed"
  return 0
}

# Main workflow
main() {
  echo ""
  echo "╔════════════════════════════════════════════════════════════╗"
  echo "║      Kaseki Agent - Container Setup Wizard                  ║"
  echo "╚════════════════════════════════════════════════════════════╝"
  echo ""
  
  # Step 1: Setup secrets directory
  setup_secrets_dir "/secrets"
  echo ""
  
  # Step 2: Optionally install the Senku decision token
  if ! setup_decision_token; then
    print_error "Failed to configure the Senku decision token"
    exit 1
  fi
  echo ""

  # Step 3: Run health checks
  if ! run_health_checks; then
    print_warning "Some health checks failed. Setup may have issues."
  fi
  echo ""
  
  # Success message
  echo "╔════════════════════════════════════════════════════════════╗"
  echo -e "${GREEN}║              Setup Complete! ✓                             ║${NC}"
  echo "╚════════════════════════════════════════════════════════════╝"
  echo ""
  echo "Next steps:"
  echo "  1. Run your first task:"
  echo "     docker run -it \\"
  echo "       -v ~/.kaseki/secrets:/secrets \\"
  echo "       -v /var/run/docker.sock:/var/run/docker.sock \\"
  echo "       docker.io/cyanautomation/kaseki-agent:latest \\"
  echo "       agent https://github.com/your-org/your-repo main"
  echo ""
  echo "  2. Or use the convenience wrapper (if installed):"
  echo "     ./kaseki agent https://github.com/your-org/your-repo main"
  echo ""
  echo "  3. For help:"
  echo "     docker run kaseki-agent --help"
  echo ""
}

# Run main
main "$@"
