#!/usr/bin/env bash
set -euo pipefail

# === Docker Entrypoint for Kaseki Agent ===
# Four-Phase Startup Orchestration
#
# Phase 1: Entrypoint Dispatch
#   - Determines which command to run (api, agent, setup, etc.)
#   - Mounted below
#
# Phase 2: Early Filesystem Checks (startup-checks.sh)
#   - Validates /agents directories, permissions, template bootstrap
#   - Runs BEFORE any kaseki operation to catch permission/config issues early
#   - Exit codes: 0/1/2 (blocking), 3 (warning-level, continues)
#
# Phase 3: API Initialization + Container Preflight Diagnostics (kaseki-api-service.ts)
#   - Bootstraps all services (scheduler, cache, validator, etc.)
#   - Runs container-safe startup checks (no root required)
#   - Checks: setup completeness, git freshness, safe.directory config, deleted mounts
#   - Exit code 3 semantics: Non-blocking warnings logged to stdout/stderr
#   - Results cached in memory and accessible via /api/preflight endpoint
#
# Phase 4: HTTP Server Listening
#   - Express server starts listening on configured port
#   - Ready to accept requests

# Export shared container path defaults before command dispatch so every mode
# (including the default agent branch) inherits the same core paths.
export KASEKI_RESULTS_DIR="${KASEKI_RESULTS_DIR:-/results}"
export KASEKI_WORKSPACE_DIR="${KASEKI_WORKSPACE_DIR:-/workspace}"
export KASEKI_WORKSPACE_BASELINE_DIR="${KASEKI_WORKSPACE_BASELINE_DIR:-${KASEKI_WORKSPACE_DIR}/baseline}"
export KASEKI_APP_LIB_DIR="${KASEKI_APP_LIB_DIR:-/app/lib}"
export KASEKI_CACHE_DIR="${KASEKI_CACHE_DIR:-/cache}"
export KASEKI_AGENT_BIN="${KASEKI_AGENT_BIN:-/usr/local/bin/kaseki-agent}"

# shellcheck source=scripts/startup-check-packaging.sh
. "${KASEKI_STARTUP_CHECK_PACKAGING_CONFIG:-/app/scripts/startup-check-packaging.sh}"

if [ -n "${HOME:-}" ]; then
  mkdir -p "$HOME" 2>/dev/null || true
fi

# Phase 2: Run early startup checks to catch permission and config issues
# This runs before any kaseki operation to prevent silent failures
# Auto-remediation enabled by default (KASEKI_STARTUP_CHECK_AUTO_REMEDIATE=1)
# Set KASEKI_STARTUP_CHECK_AUTO_REMEDIATE=0 to disable auto-fixes (e.g., git safe.directory config)
if [ "${KASEKI_SKIP_STARTUP_CHECKS:-0}" != "1" ]; then
  kaseki_run_startup_checks || {
    exit_code=$?
    # Exit codes 1 and 2 are blocking setup/permission failures.
    # Exit code 3 is a warning that the API can surface through /api/preflight.
    if [ "$exit_code" != "3" ]; then
      echo "Startup checks failed: blocking startup issue detected (exit $exit_code)" >&2
      exit 1
    fi
  }
fi

# Phase 2b: Validate directory permissions for container user (UID 10000)
# This is a critical check before the API starts—if directories aren't writable,
# the API will fail to store results. Container runs as UID 10000:10000 per docker-compose.yml
validate_directory_permissions() {
  local uid="${KASEKI_CONTAINER_UID:-10000}"
  local gid="${KASEKI_CONTAINER_GID:-10000}"
  
  # Directories that must be writable by the container user
  local required_dirs=(
    "${KASEKI_ROOT:-/agents}"
    "${KASEKI_ROOT:-/agents}/kaseki-results"
    "${KASEKI_ROOT:-/agents}/kaseki-runs"
    "${KASEKI_ROOT:-/agents}/kaseki-cache"
  )
  
  for dir in "${required_dirs[@]}"; do
    if [ ! -d "$dir" ]; then
      echo "warning: required directory does not exist: $dir" >&2
      echo "  remediation: run 'sudo kaseki-agent host setup --fix' on the host" >&2
      continue
    fi
    
    # Test write access by the current process (running as UID 10000)
    if ! [ -w "$dir" ]; then
      echo "error: directory is not writable by container user ($uid:$gid): $dir" >&2
      echo "  current ownership: $(stat -c '%U:%G' "$dir")" >&2
      echo "  remediation: run 'sudo kaseki-agent host setup --fix' on the host" >&2
      return 1
    fi
  done
  
  return 0
}

# Only validate permissions for API mode (not for agent or one-off runs)
# Can be skipped via KASEKI_SKIP_PERMISSION_VALIDATION=1 (useful for test isolation)
if [ "${KASEKI_SKIP_PERMISSION_VALIDATION:-0}" != "1" ] && { [ "${1:-agent}" = "api" ] || [ "${1:-agent}" = "kaseki-api" ]; }; then
  validate_directory_permissions || {
    echo "error: directory permissions validation failed; cannot start API" >&2
    exit 1
  }
fi

# Phase 1: Dispatch to appropriate command handler
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
    exec "$KASEKI_AGENT_BIN" --doctor
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
    exec "$KASEKI_AGENT_BIN" "$@"
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
    exec "$KASEKI_AGENT_BIN" "$@"
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
