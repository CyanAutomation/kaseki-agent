#!/usr/bin/env bash
set -euo pipefail

case "${1:-agent}" in
  setup)
    # Interactive setup wizard inside container
    # Usage: docker run -it -v ~/.kaseki/secrets:/secrets kaseki-agent setup
    shift || true
    exec /scripts/kaseki-container-setup.sh "$@"
    ;;
  
  doctor)
    # Health check and diagnostics
    # Usage: docker run kaseki-agent doctor
    shift || true
    exec /usr/local/bin/kaseki-agent --doctor
    ;;
  
  run-mode)
    # One-command run with API key from environment variable
    # Usage: docker run -e OPENROUTER_API_KEY=sk-or-... kaseki-agent run-mode <repo> <ref>
    shift || true
    
    # Validate API key is provided
    if [ -z "${OPENROUTER_API_KEY:-}" ]; then
      echo "Error: OPENROUTER_API_KEY environment variable is required for run-mode" >&2
      exit 2
    fi
    
    # Create secrets directory and store key securely
    mkdir -p /secrets
    echo "$OPENROUTER_API_KEY" > /secrets/openrouter_api_key
    chmod 600 /secrets/openrouter_api_key
    
    # Clear env var to avoid exposure in child process
    unset OPENROUTER_API_KEY
    
    # Set required variables and execute agent
    export OPENROUTER_API_KEY_FILE=/secrets/openrouter_api_key
    export KASEKI_INSTANCE="${KASEKI_INSTANCE:-kaseki-run}"
    export KASEKI_RESULTS_DIR="${KASEKI_RESULTS_DIR:-/results}"
    
    exec /usr/local/bin/kaseki-agent "$@"
    ;;
  
  setup-remote)
    # Remote host setup orchestration (runs from controller container)
    # Usage: docker run kaseki-agent setup-remote <host> <api-key>
    shift || true
    exec /scripts/kaseki-container-setup-remote.sh "$@"
    ;;
  
  agent|kaseki-agent)
    # Standard agent execution (existing mode)
    # Usage: docker run kaseki-agent agent <repo> <ref>
    shift || true
    exec /usr/local/bin/kaseki-agent "$@"
    ;;
  
  api|kaseki-api)
    # REST API service (existing mode)
    # Usage: docker run kaseki-agent api
    shift || true
    exec node /app/dist/kaseki-api-service.js "$@"
    ;;
  
  *)
    # Passthrough mode for debugging
    exec "$@"
    ;;
esac
