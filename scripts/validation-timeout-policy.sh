#!/usr/bin/env bash
# Validation timeout selection shared by the worker and its contract test.

validation_timeout_or_default() {
  local value="$1"
  local default_value="$2"

  if [[ "$value" =~ ^[1-9][0-9]*$ ]]; then
    printf '%s\n' "$value"
  else
    printf '%s\n' "$default_value"
  fi
}

TIMEOUT_SECONDS="${1:-60}"

# Validate TIMEOUT_SECONDS is a positive integer
if ! [[ "$TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || [[ "$TIMEOUT_SECONDS" -le 0 ]]; then
    echo "ERROR: TIMEOUT_SECONDS must be a positive integer, got: $TIMEOUT_SECONDS"
    exit 1
fi
  local command="$1"
  local timeout_value
  local default_value

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
