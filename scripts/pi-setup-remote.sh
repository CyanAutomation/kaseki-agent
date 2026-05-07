#!/usr/bin/env bash
#
# pi-setup-remote.sh — Remote setup for kaseki-agent via SSH
#
# This script bootstraps a remote Pi or host for kaseki-agent execution.
# It:
# 1. Validates SSH connectivity
# 2. Creates secrets directory on remote host
# 3. Securely transfers OpenRouter API key
# 4. Runs kaseki bootstrap (installs/deploys kaseki-agent)
# 5. Validates readiness with health check
#
# Usage:
#   ./scripts/pi-setup-remote.sh pi@192.168.88.201 sk-or-v1-xxx
#   ./scripts/pi-setup-remote.sh pi@192.168.88.201 ~/my-openrouter-key.txt

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

# Validate arguments
if [ $# -lt 2 ]; then
  echo "Usage: $0 <remote-host> <api-key-or-file>"
  echo ""
  echo "Examples:"
  echo "  $0 pi@192.168.88.201 sk-or-v1-your-key"
  echo "  $0 pi@192.168.88.201 ~/my-openrouter-key.txt"
  echo ""
  exit 1
fi

REMOTE_HOST="$1"
API_KEY_SOURCE="$2"
REMOTE_SECRETS_DIR="$HOME/.kaseki/secrets"
REMOTE_API_KEY_FILE="$REMOTE_SECRETS_DIR/openrouter_api_key"
REMOTE_KASEKI_TEMPLATE="/agents/kaseki-template"
REMOTE_KASEKI_INSTALL_SCRIPT="$REMOTE_KASEKI_TEMPLATE/scripts/kaseki-install.sh"

# Determine if API_KEY_SOURCE is a file or inline key
if [ -f "$API_KEY_SOURCE" ]; then
  # It's a file, read it
  if [ ! -r "$API_KEY_SOURCE" ]; then
    print_error "Cannot read API key file: $API_KEY_SOURCE"
    exit 1
  fi
  API_KEY=$(<"$API_KEY_SOURCE")
elif [[ "$API_KEY_SOURCE" =~ ^sk-or ]]; then
  # It's an inline key
  API_KEY="$API_KEY_SOURCE"
else
  print_error "Invalid API key source. Must be either:"
  print_error "  - A file path"
  print_error "  - An inline key starting with 'sk-or'"
  exit 1
fi

# Validate API key format
if [[ ! "$API_KEY" =~ ^sk-or ]]; then
  print_error "Invalid API key format. Must start with 'sk-or'"
  exit 1
fi

main() {
  echo ""
  echo "╔════════════════════════════════════════════════════════════╗"
  echo "║       Kaseki Agent - Remote Setup via SSH                   ║"
  echo "╚════════════════════════════════════════════════════════════╝"
  echo ""
  
  print_header "Setup Configuration"
  echo "Remote host:     $REMOTE_HOST"
  echo "Secrets dir:     $REMOTE_SECRETS_DIR"
  echo "API key file:    $REMOTE_API_KEY_FILE"
  echo "Kaseki template: $REMOTE_KASEKI_TEMPLATE"
  echo ""
  
  # Step 1: Test SSH connectivity
  print_header "SSH Connectivity Check"
  if ssh -o ConnectTimeout=5 "$REMOTE_HOST" "echo 'SSH OK'" >/dev/null 2>&1; then
    print_success "SSH connectivity to $REMOTE_HOST"
  else
    print_error "Cannot connect to $REMOTE_HOST via SSH"
    print_warning "Make sure:"
    print_warning "  1. Host is reachable"
    print_warning "  2. SSH keys are configured (or use -i flag)"
    print_warning "  3. You have permission to connect"
    exit 1
  fi
  echo ""
  
  # Step 2: Create secrets directory
  print_header "Creating Secrets Directory on Remote Host"
  # shellcheck disable=SC2029
  if ssh "$REMOTE_HOST" "
    mkdir -p '$REMOTE_SECRETS_DIR'
    chmod 700 '$REMOTE_SECRETS_DIR'
    [ -d '$REMOTE_SECRETS_DIR' ] && echo 'Secrets directory created'
  " >/dev/null 2>&1; then
    print_success "Secrets directory created/verified"
  else
    print_error "Failed to create secrets directory on remote host"
    exit 1
  fi
  echo ""
  
  # Step 3: Transfer API key securely via SSH
  print_header "Transferring OpenRouter API Key"
  echo "API key:"
  echo "  Source: $([ -f "$API_KEY_SOURCE" ] && echo "$API_KEY_SOURCE" || echo 'inline')"
  echo "  Destination: $REMOTE_HOST:$REMOTE_API_KEY_FILE"
  echo ""
  
  # Use stdin to pipe key to remote host (avoids exposing in process list)
  # shellcheck disable=SC2029
  if echo "$API_KEY" | ssh "$REMOTE_HOST" "
    cat > '$REMOTE_API_KEY_FILE'
    chmod 600 '$REMOTE_API_KEY_FILE'
    [ -f '$REMOTE_API_KEY_FILE' ] && echo 'API key transferred'
  " >/dev/null 2>&1; then
    print_success "API key transferred securely"
  else
    print_error "Failed to transfer API key"
    exit 1
  fi
  echo ""
  
  # Step 4: Bootstrap kaseki-agent on remote host
  print_header "Bootstrapping Kaseki Agent"
  echo "This may take a few minutes the first time (cloning repo, pulling image)..."
  echo ""
  
  # Bootstrap via remote kaseki-install.sh if it exists, else via curl
  # shellcheck disable=SC2029
  BOOTSTRAP_CMD='
    if [ -f '"$REMOTE_KASEKI_INSTALL_SCRIPT"' ]; then
      KASEKI_CONTROLLER_MODE=1 KASEKI_REPLACE_STALE=1 '"$REMOTE_KASEKI_INSTALL_SCRIPT"'
    else
      echo "Kaseki template not found. Installing via curl..." >&2
      curl -fsSL https://raw.githubusercontent.com/CyanAutomation/kaseki-agent/main/scripts/kaseki-install.sh | \
        KASEKI_CONTROLLER_MODE=1 KASEKI_REPLACE_STALE=1 sh
    fi
  '
  
  # shellcheck disable=SC2029
  if ssh "$REMOTE_HOST" "${BOOTSTRAP_CMD}" 2>&1 | tail -20; then
    print_success "Bootstrap completed"
  else
    print_error "Bootstrap failed. Check the output above."
    exit 1
  fi
  echo ""
  
  # Step 5: Verify readiness with health check
  print_header "Verifying Readiness (Running --doctor)"
  # shellcheck disable=SC2029
  HEALTH_CHECK_CMD="
    export OPENROUTER_API_KEY_FILE=$REMOTE_API_KEY_FILE
    $REMOTE_KASEKI_TEMPLATE/run-kaseki.sh --doctor
  "
  
  # shellcheck disable=SC2029
  if ssh "$REMOTE_HOST" "${HEALTH_CHECK_CMD}" 2>&1 | tail -15; then
    print_success "Health check passed"
  else
    print_warning "Health check reported issues. Review the output above."
  fi
  echo ""
  
  # Success message
  echo "╔════════════════════════════════════════════════════════════╗"
  echo -e "${GREEN}║            Setup Complete for $REMOTE_HOST! ✓           ║${NC}"
  echo "╚════════════════════════════════════════════════════════════╝"
  echo ""
  echo "Next steps:"
  echo "  1. Test a remote run:"
  echo "     ssh $REMOTE_HOST '"
  echo "       OPENROUTER_API_KEY_FILE=$REMOTE_API_KEY_FILE \\"
  echo "       $REMOTE_KASEKI_TEMPLATE/run-kaseki.sh \\"
  echo "       https://github.com/your-org/your-repo main"
  echo "     '"
  echo ""
  echo "  2. Retrieve results:"
  echo "     scp -r $REMOTE_HOST:/agents/kaseki-results/kaseki-1 ~/results/"
  echo ""
  echo "  3. For multi-host setup, repeat for other hosts:"
  echo "     $0 pi@192.168.88.202 \$(cat ~/.kaseki/secrets/openrouter_api_key)"
  echo ""
}

# Run main
main "$@"
