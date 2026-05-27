#!/usr/bin/env bash
#
# kaseki-container-setup.sh — Setup wizard inside the container
#
# This script runs INSIDE the kaseki-agent container during setup mode.
# It:
# 1. Securely prompts for OpenRouter API key (or accepts from env var)
# 2. Creates /secrets directory with proper permissions
# 3. Validates the API key
# 4. Runs health checks
#
# Entry point: docker run -it kaseki-agent setup
# Or: docker run -e OPENROUTER_API_KEY=sk-or-... kaseki-agent setup

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

# Get API key from various sources
get_api_key() {
  print_header "OpenRouter API Key Configuration"
  
  # Priority 1: Check if API key file already exists (mounted)
  if [ -f "/secrets/openrouter_api_key" ] && [ -s "/secrets/openrouter_api_key" ]; then
    print_warning "API key file already exists at /secrets/openrouter_api_key"
    read -p "Use existing key? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      API_KEY=$(<"/secrets/openrouter_api_key")
      return 0
    fi
  fi
  
  # Priority 2: Check environment variable
  if [ -n "${OPENROUTER_API_KEY:-}" ]; then
    print_success "Using API key from OPENROUTER_API_KEY environment variable"
    API_KEY="$OPENROUTER_API_KEY"
    return 0
  fi
  
  # Priority 3: Prompt interactively
  echo "You can obtain an API key from: https://openrouter.ai/keys"
  echo ""
  read -rsp "Enter your OpenRouter API key (sk-or-v1-...): " API_KEY
  echo
  
  # Validate key format
  if [[ ! "$API_KEY" =~ ^sk-or ]]; then
    print_error "Invalid API key format. Must start with 'sk-or'"
    return 1
  fi
  
  return 0
}

# Store API key securely
store_api_key() {
  local api_key="$1"
  local secrets_dir="${2:-/secrets}"
  local key_file="$secrets_dir/openrouter_api_key"
  
  # Write key to file with restrictive permissions
  echo "$api_key" > "$key_file"
  chmod 600 "$key_file"
  
  # Verify
  if [ ! -f "$key_file" ] || [ ! -r "$key_file" ]; then
    print_error "Failed to write API key to $key_file"
    return 1
  fi
  
  print_success "API key stored securely at $key_file (mode 600)"
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
  
  # Check API key file is readable
  if [ -f "/secrets/openrouter_api_key" ] && [ -r "/secrets/openrouter_api_key" ]; then
    print_success "API key file is readable"
  else
    print_error "API key file is missing or unreadable"
    return 1
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
  
  # Step 2: Get API key
  if ! get_api_key; then
    print_error "Failed to configure API key"
    exit 1
  fi
  echo ""
  
  # Step 3: Store API key
  if ! store_api_key "$API_KEY" "/secrets"; then
    print_error "Failed to store API key"
    exit 1
  fi
  echo ""
  
  # Step 4: Run health checks
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
