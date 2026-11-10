#!/usr/bin/env bash
#
# kaseki-setup.sh — Interactive setup for kaseki-agent on a local host
#
# This script:
# 1. Validates Docker installation (or guides to install)
# 2. Optionally stores the Kaseki machine token used for Senku decisions
# 3. Runs final health checks
#
# Usage: ./scripts/kaseki-setup.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SECRETS_DIR="$HOME/.kaseki/secrets"
SENKU_TOKEN_FILE="$SECRETS_DIR/senku_kaseki_api_token"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'  # No Color

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

# Check Docker installation
check_docker() {
  print_header "Checking Docker Installation"
  
  if command -v docker >/dev/null 2>&1; then
    print_success "Docker is installed"
    
    # Check if daemon is running
    if docker ps >/dev/null 2>&1; then
      print_success "Docker daemon is running"
      return 0
    else
      print_error "Docker daemon is not running"
      print_warning "Start Docker and try again"
      print_warning "  Linux: sudo systemctl start docker"
      print_warning "  macOS: open -a Docker"
      return 1
    fi
  else
    print_error "Docker is not installed"
    
    # Suggest installation
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
      print_warning "Install Docker with one of these commands:"
      print_warning ""
      print_warning "Debian/Ubuntu:"
      print_warning "  sudo apt update && sudo apt install -y docker.io"
      print_warning ""
      print_warning "Fedora/RHEL/CentOS:"
      print_warning "  sudo dnf install -y docker"
      print_warning ""
      print_warning "Arch:"
      print_warning "  sudo pacman -S --needed docker"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
      print_warning "Install Docker Desktop for macOS:"
      print_warning "  https://docs.docker.com/desktop/install/mac-install/"
      print_warning "Or via Homebrew:"
      print_warning "  brew install --cask docker"
    fi
    
    return 1
  fi
}

# Set up the optional Senku machine token
setup_decision_token() {
  print_header "Optional Senku Decision Credential"
  
  # Create secrets directory
  mkdir -p "$SECRETS_DIR"
  chmod 700 "$SECRETS_DIR"
  
  # Keep an existing credential unless the operator explicitly replaces it.
  if [ -f "$SENKU_TOKEN_FILE" ] && [ -s "$SENKU_TOKEN_FILE" ]; then
    chmod 600 "$SENKU_TOKEN_FILE"
    print_success "Senku decision credential already exists at $SENKU_TOKEN_FILE"
    return 0
  fi

  echo "A Senku Kaseki machine token is optional and is issued by the Senku operator."
  echo "Without it, coding and deterministic checks continue; decision stages degrade safely."
  read -p "Install the approved Kaseki machine token now? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_warning "Senku decision credential not installed; remote decision stages will degrade safely"
    return 0
  fi

  # Read the token without putting it in command history or the process list.
  read -rsp "Enter the approved Kaseki machine token: " SENKU_TOKEN
  echo
  if [ "${#SENKU_TOKEN}" -lt 32 ] || [[ "$SENKU_TOKEN" =~ [[:space:]] ]]; then
    unset SENKU_TOKEN
    print_error "Invalid Senku machine token format"
    return 1
  fi

  umask 077
  printf '%s' "$SENKU_TOKEN" > "$SENKU_TOKEN_FILE"
  unset SENKU_TOKEN
  chmod 600 "$SENKU_TOKEN_FILE"
  print_success "Senku machine token stored in $SENKU_TOKEN_FILE (mode 600)"
}

# Run preflight checks
run_preflight_checks() {
  print_header "Running Preflight Checks"
  
  # Use enhanced preflight script if available
  if [ -x "$SCRIPT_DIR/kaseki-preflight.sh" ]; then
    if "$SCRIPT_DIR/kaseki-preflight.sh" run; then
      print_success "All preflight checks passed"
      return 0
    else
      print_error "Some preflight checks failed"
      return 1
    fi
  else
    print_warning "kaseki-preflight.sh not found, skipping enhanced checks"
    return 0
  fi
}

# Run health check
run_health_check() {
  print_header "Running Health Check"
  
  cd "$PROJECT_ROOT"
  
  if ./run-kaseki.sh --doctor 2>&1 | tail -20; then
    print_success "Health check passed"
    return 0
  else
    print_error "Health check failed"
    return 1
  fi
}

# Optional: Add to shell profile
offer_shell_profile_update() {
  print_header "Shell Profile Configuration (Optional)"
  
  echo "Would you like to add the Senku decision token path to your shell profile?"
  echo "This makes the optional decision credential available to run-kaseki.sh."
  echo ""
  
  read -p "Add to shell profile? (y/n) " -n 1 -r
  echo
  
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    return 0
  fi
  
  # Detect shell
  if [ -f "$HOME/.bashrc" ]; then
    PROFILE_FILE="$HOME/.bashrc"
  elif [ -f "$HOME/.zshrc" ]; then
    PROFILE_FILE="$HOME/.zshrc"
  else
    print_warning "Could not detect shell profile. Skipping."
    return 0
  fi
  
  EXPORT_LINE="export SENKU_KASEKI_API_TOKEN_FILE=$SENKU_TOKEN_FILE"
  
  # Check if already in profile
  if grep -q "SENKU_KASEKI_API_TOKEN_FILE" "$PROFILE_FILE"; then
    print_warning "SENKU_KASEKI_API_TOKEN_FILE already in $PROFILE_FILE"
    return 0
  fi
  
  # Add to profile
  {
    echo ""
    echo "# Kaseki Agent API key (added by kaseki-setup.sh)"
    echo "$EXPORT_LINE"
  } >> "$PROFILE_FILE"
  
  print_success "Added to $PROFILE_FILE"
  echo ""
  echo "Reload your shell with:"
  echo "  source $PROFILE_FILE"
  echo "or restart your terminal"
}

# Main workflow
main() {
  echo ""
  echo "╔════════════════════════════════════════════════════════════╗"
  echo "║         Kaseki Agent - Interactive Setup Wizard             ║"
  echo "╚════════════════════════════════════════════════════════════╝"
  echo ""
  
  # Step 1: Check Docker
  if ! check_docker; then
    print_error "Setup cannot continue without Docker. Please install Docker first."
    exit 1
  fi
  echo ""
  
  # Step 2: Optionally set up the Senku decision token
  if ! setup_decision_token; then
    print_error "Failed to set up the Senku decision token."
    exit 1
  fi
  echo ""
  
  # Step 3: Run preflight checks
  if ! run_preflight_checks; then
    print_warning "Some checks failed. Installation may have issues."
  fi
  echo ""
  
  # Step 4: Run health check
  if ! run_health_check; then
    print_warning "Health check failed. Please review the output above."
  fi
  echo ""
  
  # Step 5: Offer shell profile update
  offer_shell_profile_update
  echo ""
  
  # Success message
  echo "╔════════════════════════════════════════════════════════════╗"
  echo -e "${GREEN}║                  Setup Complete! ✓                           ║${NC}"
  echo "╚════════════════════════════════════════════════════════════╝"
  echo ""
  echo "Next steps:"
  echo "  1. Reload your shell (or restart terminal):"
  echo "     source $HOME/.bashrc  # or .zshrc"
  echo ""
  echo "  2. Run your first task:"
  echo "     cd $PROJECT_ROOT"
  echo "     ./run-kaseki.sh https://github.com/your-org/your-repo main"
  echo ""
  echo "  3. Learn more:"
  echo "     - Single host: docs/SETUP_GUIDE.md"
  echo "     - Multi-host:  scripts/templates/MULTI_HOST_DISTRIBUTED.md"
  echo "     - REST API:    scripts/templates/REST_API_SERVICE.md"
  echo ""
}

# Run main
main "$@"
