#!/usr/bin/env bash
# Validation timeout selection shared by the worker and its contract test.

validation_timeout_or_default() {
  local value="$1"
  local default_value="$2"

  if ! [[ "$default_value" =~ ^[1-9][0-9]*$ ]]; then
    printf 'ERROR: validation timeout default must be a positive integer, got: %s\n' "$default_value" >&2
    return 2
  fi

  if [[ "$value" =~ ^[1-9][0-9]*$ ]]; then
    printf '%s\n' "$value"
  else
    printf '%s\n' "$default_value"
  fi
}

validation_timeout_for_command() {
  local command="$1"
  local timeout_value
# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source kaseki-agent.sh to access required functions
# shellcheck source=/dev/null
source "$SCRIPT_DIR/../kaseki-agent.sh" || {
    echo "ERROR: Failed to source kaseki-agent.sh"
    exit 1
}

elapsed_time=$(get_process_elapsed_time "$pid")

  case "$command" in
    *" run build"*|*" build "*|build|*"next build"*)
      timeout_value="${KASEKI_BUILD_VALIDATION_TIMEOUT_SECONDS:-}"
      default_value=900
      ;;
    *)
      timeout_value="${KASEKI_VALIDATION_TIMEOUT_SECONDS:-}"
      default_value=300
      ;;
  esac

  validation_timeout_or_default "$timeout_value" "$default_value"
}
