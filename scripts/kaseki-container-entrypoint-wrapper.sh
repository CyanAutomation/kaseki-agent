#!/usr/bin/env bash
#
# kaseki-container-entrypoint-wrapper.sh — Credential handling helper
#
# Internal helper used by docker-entrypoint.sh to safely handle credentials
# in container entry point modes (setup, run-mode, etc).
#
# Not directly invoked by users; called from docker-entrypoint.sh

set -euo pipefail

# Securely handle credentials from environment variable
# Args: <env_var_name> <target_file> [mode]
handle_env_credential() {
  local env_var="$1"
  local target_file="$2"
  local mode="${3:-600}"
  
  # Read from environment
  local credential="${!env_var:-}"
  
  if [ -z "$credential" ]; then
    echo "Error: $env_var environment variable is empty" >&2
    return 1
  fi
  
  # Ensure directory exists
  mkdir -p "$(dirname "$target_file")"
  
  # Write to file with restricted permissions
  # Using a temp file first to avoid truncation on error
  local temp_file="$target_file.tmp.$$"
  echo "$credential" > "$temp_file"
  chmod "$mode" "$temp_file"
  mv "$temp_file" "$target_file"
  
  # Clear environment variable (security: avoid exposure in process list)
  export "${env_var}="
  
  return 0
}

# Verify credential file exists and is readable
verify_credential() {
  local credential_file="$1"
  local description="${2:-Credential}"
  
  if [ ! -f "$credential_file" ]; then
    echo "Error: $description file not found: $credential_file" >&2
    return 1
  fi
  
  if [ ! -r "$credential_file" ]; then
    echo "Error: $description file not readable: $credential_file" >&2
    return 1
  fi
  
  return 0
}

# Check if credential file has valid format
validate_credential_format() {
  local credential_file="$1"
  local pattern="$2"  # regex pattern to match
  
  if ! grep -q "$pattern" "$credential_file" 2>/dev/null; then
    echo "Error: Credential file has invalid format" >&2
    return 1
  fi
  
  return 0
}

# Export credential as environment variable for child processes
# (only for backward compatibility; prefer file-based approach)
export_credential_env() {
  local credential_file="$1"
  local env_var_name="$2"
  
  if [ ! -f "$credential_file" ]; then
    echo "Error: Credential file not found: $credential_file" >&2
    return 1
  fi
  
  local credential
  credential=$(<"$credential_file")
  export "$env_var_name=$credential"
  
  return 0
}

# Main router: called from docker-entrypoint.sh
case "${1:-}" in
  handle-env)
    shift
    handle_env_credential "$@"
    ;;
  verify)
    shift
    verify_credential "$@"
    ;;
  validate-format)
    shift
    validate_credential_format "$@"
    ;;
  export-env)
    shift
    export_credential_env "$@"
    ;;
  *)
    echo "Usage: $0 <command> [args]"
    echo "Commands:"
    echo "  handle-env <env_var> <target_file> [mode]     # Read from env, write to file"
    echo "  verify <file> [description]                    # Verify file exists and readable"
    echo "  validate-format <file> <regex>                 # Validate file content format"
    echo "  export-env <file> <env_var>                    # Export file to env var"
    exit 1
    ;;
esac
