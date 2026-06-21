#!/bin/bash
# shellcheck disable=SC2086,SC2016
#
# Sentry Shell Client
# Sends error events to Sentry from shell scripts
#
# This helper provides a way to report errors from container/shell scripts
# to Sentry without requiring a full Node.js runtime.
#
# Environment Variables:
# - SENTRY_DSN: Sentry DSN (required to send events)
# - SENTRY_ENVIRONMENT: Environment name (default: "production")
# - SENTRY_ENABLED: Explicitly enable/disable (default: auto-detect from DSN)
# - KASEKI_INSTANCE: Instance ID for the run (e.g., "kaseki-123")
#
# Usage:
#   source scripts/sentry-shell-client.sh
#   sentry_event "error" "Phase failed" "git-clone" "1" "120"
#   sentry_event "warning" "Gate violation" "secret-scan" "0" "60"

# Detect if Sentry is enabled
sentry_is_enabled() {
  local dsn="${SENTRY_DSN:-}"
  local enabled="${SENTRY_ENABLED:-}"

  if [ "$enabled" = "1" ]; then
    return 0
  fi

  if [ "$enabled" = "0" ]; then
    return 1
  fi

  # Auto-detect: enabled if DSN is set
  if [ -n "$dsn" ]; then
    return 0
  fi

  return 1
}

# Extract project ID and token from Sentry DSN
# Format: https://examplePublicKey@o0.ingest.sentry.io/0
sentry_parse_dsn() {
  local dsn="$1"

  # Extract public key
  local key="${dsn#*://}"
  key="${key%%@*}"
  printf '%s' "$key"
}

# Extract host from Sentry DSN
sentry_parse_host() {
  local dsn="$1"

  # Extract host
  local host="${dsn#*@}"
  host="${host%%/*}"
  printf '%s' "$host"
}

# Extract project ID from Sentry DSN
sentry_parse_project_id() {
  local dsn="$1"

  # Extract project ID (last number after last slash)
  local project_id="${dsn##*/}"
  printf '%s' "$project_id"
}

# JSON escape a string for Sentry payload
sentry_json_escape() {
  local value="$1"

  # Escape backslashes first
  value="${value//\\/\\\\}"

  # Escape quotes
  value="${value//\"/\\\"}"

  # Escape newlines
  value="${value//$'\n'/\\n}"

  # Escape carriage returns
  value="${value//$'\r'/\\r}"

  # Escape tabs
  value="${value//$'\t'/\\t}"

  printf '%s' "$value"
}

# Send an event to Sentry
#
# Usage:
#   sentry_event <level> <message> <context_phase> <exit_code> [duration_seconds]
#
# Arguments:
#   level: "error", "warning", "info"
#   message: Event message/description
#   context_phase: Phase where error occurred (e.g., "git-clone", "npm-ci", "pi-invocation")
#   exit_code: Exit code from the failed command
#   duration_seconds: (optional) How long the phase ran
#
# Example:
#   sentry_event "error" "Git clone failed for repo" "git-clone" "128" "5"
sentry_event() {
  local level="${1:-error}"
  local message="${2:-Unknown error}"
  local phase="${3:-unknown}"
  local exit_code="${4:-1}"
  local duration_seconds="${5:-}"

  # Check if Sentry is enabled
  if ! sentry_is_enabled; then
    return 0
  fi

  local dsn="${SENTRY_DSN:-}"
  if [ -z "$dsn" ]; then
    return 1
  fi

  # Parse DSN
  local public_key host project_id
  public_key="$(sentry_parse_dsn "$dsn")"
  host="$(sentry_parse_host "$dsn")"
  project_id="$(sentry_parse_project_id "$dsn")"

  # Build the event payload
  local timestamp level_name
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  level_name="$level"

  # Escape strings for JSON
  local escaped_message escaped_phase
  escaped_message="$(sentry_json_escape "$message")"
  escaped_phase="$(sentry_json_escape "$phase")"

  # Build tags
  local tags='"component":"kaseki-agent"'
  if [ -n "${KASEKI_INSTANCE:-}" ]; then
    tags="$tags,\"instance\":\"${KASEKI_INSTANCE}\""
  fi
  tags="$tags,\"phase\":\"$escaped_phase\""

  # Build extra context
  local extra='"exit_code":'$exit_code
  if [ -n "$duration_seconds" ]; then
    extra="$extra,\"duration_seconds\":$duration_seconds"
  fi

  # Build complete Sentry event JSON
  local payload
  payload=$(cat <<EOF
{
  "event_id":"$(uuidgen 2>/dev/null || printf '%s' "unknown")",
  "timestamp":"$timestamp",
  "level":"$level_name",
  "message":"$escaped_message",
  "environment":"${SENTRY_ENVIRONMENT:-production}",
  "tags":{$tags},
  "extra":{$extra},
  "logger":"kaseki-shell",
  "platform":"bash"
}
EOF
)

  # Send to Sentry
  local url="https://${host}/api/${project_id}/store/?sentry_key=${public_key}&sentry_version=7"

  # Use curl to POST to Sentry (suppress output and errors)
  curl -s -X POST "$url" \
    -H "Content-Type: application/json" \
    -d "$payload" >/dev/null 2>&1 || true

  return 0
}

# Log and send an error event (convenience function)
#
# Usage:
#   sentry_error "Git clone failed" "git-clone" "$exit_code" "$duration"
sentry_error() {
  local message="$1"
  local phase="${2:-unknown}"
  local exit_code="${3:-1}"
  local duration="${4:-}"

  sentry_event "error" "$message" "$phase" "$exit_code" "$duration"
}

# Log and send a warning event (convenience function)
sentry_warning() {
  local message="$1"
  local phase="${2:-unknown}"
  local exit_code="${3:-0}"
  local duration="${4:-}"

  sentry_event "warning" "$message" "$phase" "$exit_code" "$duration"
}
