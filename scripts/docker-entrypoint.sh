#!/usr/bin/env bash
set -euo pipefail

# === Docker Entrypoint for Kaseki Agent ===
# Responsible for:
#   1. Auto-creating /agents/secrets if needed (for Docker Compose)
#   2. Running init container (if applicable) to fix /agents permissions
#   3. Running early startup checks
#   4. Dispatching to the appropriate command handler (api, agent, setup, etc.)

# Phase 0: Auto-create /agents/secrets directory if running as API service
# This ensures secrets directory exists even if not pre-created by user
if [ "${1:-agent}" = "api" ] || [ "${1:-agent}" = "kaseki-api" ]; then
  KASEKI_SECRETS_DIR="${KASEKI_SECRETS_DIR:-/home/pi/secrets}"
  AGENTS_SECRETS_DIR="/agents/secrets"

  # Auto-copy secrets from host mount to /agents/secrets if it exists
  # This handles the case where /home/pi/secrets is mounted at /agents/secrets
  if [ -d "$KASEKI_SECRETS_DIR" ]; then
    # Create /agents/secrets if it doesn't exist
    if [ ! -d "$AGENTS_SECRETS_DIR" ]; then
      mkdir -p "$AGENTS_SECRETS_DIR" 2>/dev/null || true
      chmod 750 "$AGENTS_SECRETS_DIR" 2>/dev/null || true
    fi

    # Copy any secret files from the mounted location
    if [ "$(ls -A "$KASEKI_SECRETS_DIR" 2>/dev/null)" ]; then
      cp -p "$KASEKI_SECRETS_DIR"/* "$AGENTS_SECRETS_DIR/" 2>/dev/null || true
      echo "✓ Copied secrets from $KASEKI_SECRETS_DIR to $AGENTS_SECRETS_DIR" >&2
    fi
  fi
fi

# Phase 1: Check if init container already ran (for debugging)
# The init container is a separate service in docker-compose and runs before this.
# If you're seeing permission errors here, the init container either:
#   - Failed to fix permissions (expected in restricted environments)
#   - Hasn't run yet (check depends_on conditions)
#   - Ran but the issue is fundamental to the environment

# Phase 2: Run early startup checks to catch permission and config issues
# This runs before any kaseki operation to prevent silent failures
if [ "${KASEKI_SKIP_STARTUP_CHECKS:-0}" != "1" ]; then
  /scripts/startup-checks.sh "${KASEKI_STARTUP_CHECK_MODE:-all}" || {
    exit_code=$?
    # Exit codes 1 and 2 are blocking setup/permission failures.
    # Exit code 3 is a warning that the API can surface through /api/preflight.
    if [ "$exit_code" != "3" ]; then
      echo "Startup checks failed: blocking startup issue detected (exit $exit_code)" >&2
      exit 1
    fi
  }
fi

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
