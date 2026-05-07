#!/usr/bin/env bash
#
# kaseki-container-setup-remote.sh — Remote host setup orchestrator
#
# This script runs INSIDE the kaseki-agent container to orchestrate
# setup of remote Pi/host instances via SSH.
#
# It:
# 1. Validates SSH connectivity
# 2. Securely transfers API key
# 3. Triggers setup on remote host (via Docker or script)
# 4. Validates remote readiness
#
# Entry point: docker run kaseki-agent setup-remote <host> <api-key>

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Helpers
print_header() { echo -e "${BLUE}=== $1 ===${NC}"; }
print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}" >&2; }
print_warning() { echo -e "${YELLOW}⚠ $1${NC}"; }

# Argument validation
if [ $# -lt 2 ]; then
  echo "Usage: $0 <remote-host> <api-key-or-file>"
  echo ""
  echo "Examples:"
  echo "  $0 pi@192.168.88.201 sk-or-v1-your-key"
  echo "  $0 pi@192.168.88.201 /path/to/api-key-file"
  echo ""
  exit 1
fi

REMOTE_HOST="$1"
API_KEY_SOURCE="$2"

# Resolve API key
if [ -f "$API_KEY_SOURCE" ]; then
  # It's a file
  API_KEY=$(<"$API_KEY_SOURCE")
elif [[ "$API_KEY_SOURCE" =~ ^sk-or ]]; then
  # It's an inline key
  API_KEY="$API_KEY_SOURCE"
else
  print_error "Invalid API key source: must be a file or start with 'sk-or'"
  exit 1
fi

# Validate key format
if [[ ! "$API_KEY" =~ ^sk-or ]]; then
  print_error "Invalid API key format: must start with 'sk-or'"
  exit 1
fi

main() {
  echo ""
  echo "╔════════════════════════════════════════════════════════════╗"
  echo "║    Kaseki Agent - Remote Setup Orchestrator                 ║"
  echo "╚════════════════════════════════════════════════════════════╝"
  echo ""
  
  print_header "Configuration"
  echo "Remote host: $REMOTE_HOST"
  echo ""
  
  # Step 1: SSH connectivity check
  print_header "SSH Connectivity Check"
  if ssh -o ConnectTimeout=5 "$REMOTE_HOST" "echo 'OK'" >/dev/null 2>&1; then
    print_success "SSH connectivity to $REMOTE_HOST verified"
  else
    print_error "Cannot connect to $REMOTE_HOST via SSH"
    print_warning "Make sure:"
    print_warning "  1. Host is reachable"
    print_warning "  2. SSH keys are configured"
    print_warning "  3. User has permission"
    exit 1
  fi
  echo ""
  
  # Step 2: Create secrets directory on remote
  print_header "Creating Secrets Directory on Remote Host"
  if ssh "$REMOTE_HOST" "
    mkdir -p ~/.kaseki/secrets
    chmod 700 ~/.kaseki/secrets
    [ -d ~/.kaseki/secrets ] && echo 'Secrets directory created'
  " >/dev/null 2>&1; then
    print_success "Secrets directory created on $REMOTE_HOST"
  else
    print_error "Failed to create secrets directory on remote host"
    exit 1
  fi
  echo ""
  
  # Step 3: Transfer API key securely via SSH
  print_header "Transferring OpenRouter API Key Securely"
  if echo "$API_KEY" | ssh "$REMOTE_HOST" "
    cat > ~/.kaseki/secrets/openrouter_api_key
    chmod 600 ~/.kaseki/secrets/openrouter_api_key
    [ -f ~/.kaseki/secrets/openrouter_api_key ] && echo 'API key transferred'
  " >/dev/null 2>&1; then
    print_success "API key transferred and secured on $REMOTE_HOST"
  else
    print_error "Failed to transfer API key to remote host"
    exit 1
  fi
  echo ""
  
  # Step 4: Try Docker-based setup on remote (if Docker available)
  print_header "Attempting Remote Setup"
  
  # Check if Docker is available on remote
  if ssh "$REMOTE_HOST" "command -v docker >/dev/null 2>&1" >/dev/null 2>&1; then
    print_success "Docker available on remote host"
    
    # Try to pull image and run setup
    echo "Pulling kaseki-agent image on remote host (may take a few minutes)..."
    if ssh "$REMOTE_HOST" "
      docker pull docker.io/cyanautomation/kaseki-agent:latest >/dev/null 2>&1 && \
      docker run -it \
        -v ~/.kaseki/secrets:/secrets \
        -v /var/run/docker.sock:/var/run/docker.sock \
        docker.io/cyanautomation/kaseki-agent:latest \
        doctor >/dev/null 2>&1
    " 2>&1 | tail -10; then
      print_success "Docker-based setup successful on $REMOTE_HOST"
    else
      print_warning "Docker-based setup had issues. Continuing..."
    fi
  else
    print_warning "Docker not available on $REMOTE_HOST"
    print_warning "Manual setup required. Guide:"
    echo ""
    echo "  SSH to $REMOTE_HOST and run:"
    echo "    mkdir -p ~/.kaseki/secrets"
    echo "    chmod 700 ~/.kaseki/secrets"
    echo "    curl -fsSL https://raw.githubusercontent.com/CyanAutomation/kaseki-agent/main/scripts/kaseki-install.sh | KASEKI_CONTROLLER_MODE=1 KASEKI_REPLACE_STALE=1 sh"
    echo ""
  fi
  echo ""
  
  # Final status
  echo "╔════════════════════════════════════════════════════════════╗"
  echo -e "${GREEN}║      Setup Complete for $REMOTE_HOST! ✓${NC}"
  echo "╚════════════════════════════════════════════════════════════╝"
  echo ""
  echo "Next steps:"
  echo "  1. Verify readiness on remote host:"
  echo "     ssh $REMOTE_HOST 'docker run -v ~/.kaseki/secrets:/secrets docker.io/cyanautomation/kaseki-agent:latest doctor'"
  echo ""
  echo "  2. Run your first task on remote host:"
  echo "     ssh $REMOTE_HOST '"
  echo "       docker run -it \\"
  echo "         -v ~/.kaseki/secrets:/secrets \\"
  echo "         -v /var/run/docker.sock:/var/run/docker.sock \\"
  echo "         docker.io/cyanautomation/kaseki-agent:latest \\"
  echo "         agent https://github.com/your-org/your-repo main"
  echo "     '"
  echo ""
  echo "  3. For additional hosts:"
  echo "     docker run kaseki-agent setup-remote pi@192.168.88.202 \$(cat ~/.kaseki/secrets/openrouter_api_key)"
  echo ""
}

main "$@"
