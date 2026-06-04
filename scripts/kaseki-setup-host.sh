#!/usr/bin/env bash
set -euo pipefail

# Kaseki host setup — Prepare host for Kaseki API service
# Validates and fixes: /agents structure, secrets permissions, checkout freshness, bootstrap
# Integrates with unified validation-stages.sh infrastructure for consistency
#
# Exit codes:
#   0 = success (setup complete or already in good state)
#   1 = fatal error (blocking operation or check failed)
#   2 = permission/access error (likely fixable)

KASEKI_ROOT="${KASEKI_ROOT:-/agents}"
KASEKI_TEMPLATE_DIR="${KASEKI_TEMPLATE_DIR:-$KASEKI_ROOT/kaseki-template}"
KASEKI_CHECKOUT_DIR="${KASEKI_CHECKOUT_DIR:-$KASEKI_ROOT/kaseki-agent}"
KASEKI_LOG_DIR="${KASEKI_LOG_DIR:-/var/log/kaseki}"
KASEKI_CONTAINER_UID="${KASEKI_CONTAINER_UID:-10000}"
KASEKI_CONTAINER_GID="${KASEKI_CONTAINER_GID:-10000}"
KASEKI_FIX="${KASEKI_FIX:-0}"
KASEKI_CHECK_ONLY="${KASEKI_CHECK_ONLY:-0}"
KASEKI_RECREATE_API="${KASEKI_RECREATE_API:-0}"
KASEKI_PRIV_TOOL_TIMEOUT="${KASEKI_PRIV_TOOL_TIMEOUT:-2}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Phase 2: Timeout configuration for privilege operations
# These timeouts prevent privilege tool tests from hanging indefinitely on slow systems
# or virtualization environments with limited permissions. Configurable via env vars.
export KASEKI_PRIV_TOOL_TIMEOUT

# Source validation infrastructure (Phase 1 consolidation)
if [ -f "$SCRIPT_DIR/validation-stages.sh" ]; then
  # shellcheck source=/dev/null
  source "$SCRIPT_DIR/validation-stages.sh"
else
  printf 'error: validation-stages.sh not found at %s\n' "$SCRIPT_DIR/validation-stages.sh" >&2
  exit 1
fi

detect_invoking_home() {
  if [ -n "${KASEKI_HOST_HOME:-}" ]; then
    printf '%s\n' "$KASEKI_HOST_HOME"
    return 0
  fi
  if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ] && command -v getent >/dev/null 2>&1; then
    getent passwd "$SUDO_USER" | awk -F: '{print $6}'
    return 0
  fi
  printf '%s\n' "$HOME"
}

KASEKI_EFFECTIVE_HOST_HOME="$(detect_invoking_home)"
KASEKI_HOST_SECRETS_DIR="${KASEKI_HOST_SECRETS_DIR:-$KASEKI_EFFECTIVE_HOST_HOME/secrets}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --fix)
      KASEKI_FIX="1"
      ;;
    --check-only)
      KASEKI_CHECK_ONLY="1"
      ;;
    --recreate-api)
      KASEKI_RECREATE_API="1"
      ;;
    --help|-h)
      cat <<HELP
Usage: scripts/kaseki-setup-host.sh [--fix] [--check-only] [--recreate-api]

Validates and optionally prepares a Kaseki API host.

Options:
  --fix           Create/fix /agents, logs, secrets modes, and bootstrap when possible.
  --check-only    Validate host state without making any changes (implies --no-fix).
  --recreate-api  Remove/recreate the kaseki-api container after fixing bind mounts.

Environment:
  KASEKI_HOST_SECRETS_DIR=${KASEKI_EFFECTIVE_HOST_HOME:-~}/secrets
  KASEKI_CONTAINER_UID=$KASEKI_CONTAINER_UID
  KASEKI_CONTAINER_GID=$KASEKI_CONTAINER_GID

Outputs:
  ~/.kaseki/host-state.json       Host state and probe results
  ~/.kaseki/setup-results.json    Structured validation results (Phase 1+)

Examples:
  # Validate current state without changes
  kaseki-agent host setup --check-only

  # Fix host setup
  sudo kaseki-agent host setup --fix

  # Fix and verify
  sudo kaseki-agent host setup --fix && kaseki-agent host setup --check-only
HELP
      exit 0
      ;;
    *)
      printf 'Error: unknown option: %s\n' "$1" >&2
      exit 2
      ;;
  esac
  shift
done

# If --check-only is set, disable --fix
if [ "$KASEKI_CHECK_ONLY" = "1" ]; then
  KASEKI_FIX="0"
fi

run_privileged() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return
  fi
  if "$@" 2>/dev/null; then
    return
  fi
  if command -v sudo >/dev/null 2>&1; then
    sudo "$@"
    return
  fi
  "$@"
}

ensure_dir() {
  local dir="$1"
  local mode="$2"
  if [ "$KASEKI_FIX" = "1" ]; then
    run_privileged mkdir -p "$dir"
    run_privileged chown "$KASEKI_CONTAINER_UID:$KASEKI_CONTAINER_GID" "$dir" 2>/dev/null || true
    run_privileged chmod "$mode" "$dir" 2>/dev/null || true
  fi
  if [ -d "$dir" ]; then
    printf 'ok: %s\n' "$dir"
  else
    printf 'missing: %s\n' "$dir"
    return 1
  fi
}

check_writable() {
  local dir="$1"
  if [ -w "$dir" ]; then
    printf 'writable: %s\n' "$dir"
  else
    printf 'not writable: %s\n' "$dir"
    return 1
  fi
}

fix_checkout_permissions_if_exists() {
  # If checkout directory exists with potentially problematic ownership,
  # try to fix it to match container UID:GID (only when --fix is set)
  if [ "$KASEKI_FIX" != "1" ]; then
    return 0
  fi
  if [ ! -d "$KASEKI_CHECKOUT_DIR" ]; then
    return 0
  fi
  # Attempt to fix ownership to container UID:GID for consistency
  run_privileged chown -R "$KASEKI_CONTAINER_UID:$KASEKI_CONTAINER_GID" "$KASEKI_CHECKOUT_DIR" 2>/dev/null || true
}

resolve_uid_to_name() {
  local uid="$1"
  if ! command -v getent >/dev/null 2>&1; then
    printf ''
    return 0
  fi
  getent passwd "$uid" 2>/dev/null | awk -F: 'NR==1 && NF>=6 {print $1}'
}

resolve_gid_to_name() {
  local gid="$1"
  if ! command -v getent >/dev/null 2>&1; then
    printf ''
    return 0
  fi
  getent group "$gid" 2>/dev/null | awk -F: 'NR==1 && NF>=4 {print $1}'
}

normalize_secrets_dir() {
  local secrets_dir="$1"
  if [ ! -d "$secrets_dir" ]; then
    printf 'warning: host secrets directory not found at %s\n' "$secrets_dir"
    return 0
  fi

  if [ "$KASEKI_FIX" = "1" ]; then
    run_privileged chgrp "$KASEKI_CONTAINER_GID" "$secrets_dir" 2>/dev/null || true
    run_privileged chmod 0750 "$secrets_dir" 2>/dev/null || true
    find "$secrets_dir" -maxdepth 1 -type f -print0 2>/dev/null |
      while IFS= read -r -d '' file; do
        run_privileged chgrp "$KASEKI_CONTAINER_GID" "$file" 2>/dev/null || true
        run_privileged chmod 0640 "$file" 2>/dev/null || true
      done
    
    # Phase 2: Post-action verification (verify changes actually applied)
    local actual_mode
    actual_mode=$(stat -c '%a' "$secrets_dir" 2>/dev/null || stat -f '%OLp' "$secrets_dir" 2>/dev/null | sed 's/^.*\([0-9]\{3\}\)$/\1/' || echo "unknown")
    if [ "$actual_mode" != "unknown" ] && [ "$actual_mode" != "750" ]; then
      printf 'warning: secrets directory permissions not updated as expected (actual: %s, expected: 750). May be on read-only mount.\n' "$actual_mode"
    fi
  fi

  printf 'ok: host secrets directory found at %s\n' "$secrets_dir"
  for required_secret in openrouter_api_key github_app_id github_app_client_id github_app_private_key kaseki_api_keys; do
    if [ -f "$secrets_dir/$required_secret" ]; then
      printf 'ok: secret present: %s\n' "$required_secret"
    else
      printf 'warning: secret missing: %s\n' "$required_secret"
    fi
  done
}

run_checkout_freshness_probe() {
  local checkout_dir="$1"
  local probe_status="skipped"
  local probe_detail="Checkout freshness probe skipped because setup did not run bootstrap."
  local probe_remediation=""
  local stderr_file=""

  cleanup_probe_stderr_file() {
    if [ -n "$stderr_file" ]; then
      rm -f "$stderr_file"
    fi
  }

  if [ ! -d "$checkout_dir" ]; then
    probe_status="failed"
    probe_detail="Checkout freshness probe failed: expected checkout path ${checkout_dir} does not exist."
    probe_remediation="Fix ownership/permissions so ${checkout_dir} and ${checkout_dir}/.git are readable by UID:GID ${KASEKI_CONTAINER_UID}:${KASEKI_CONTAINER_GID}."
    printf '%s|%s|%s\n' "$probe_status" "$probe_detail" "$probe_remediation"
    cleanup_probe_stderr_file
    return 0
  fi

  if [ ! -d "$checkout_dir/.git" ]; then
    probe_status="failed"
    probe_detail="Checkout freshness probe failed: ${checkout_dir}/.git is missing or inaccessible."
    probe_remediation="Fix ownership/permissions so ${checkout_dir} and ${checkout_dir}/.git are readable by UID:GID ${KASEKI_CONTAINER_UID}:${KASEKI_CONTAINER_GID}."
    printf '%s|%s|%s\n' "$probe_status" "$probe_detail" "$probe_remediation"
    cleanup_probe_stderr_file
    return 0
  fi

  stderr_file="$(mktemp)"

  local probe_command=(git -C "$checkout_dir" rev-parse HEAD)

  local resolved_user_name=""
  local resolved_group_name=""
  resolved_user_name="$(resolve_uid_to_name "$KASEKI_CONTAINER_UID")"
  resolved_group_name="$(resolve_gid_to_name "$KASEKI_CONTAINER_GID")"

  # Phase 4: Use parallel privilege tool testing when running as root
  # Runs setpriv, runuser, and sudo in parallel; returns on first success
  # This reduces probe time from ~6 seconds (sequential 3×2s timeouts) to ~2 seconds (first success)
  if [ "$(id -u)" -eq "$KASEKI_CONTAINER_UID" ] && [ "$(id -g)" -eq "$KASEKI_CONTAINER_GID" ]; then
    "${probe_command[@]}" >/dev/null 2>"$stderr_file" || true
  elif [ "$(id -u)" -eq 0 ]; then
    # Phase 4: Parallel privilege tool testing
    run_privilege_tools_parallel "$checkout_dir" "${probe_command[@]}" "$stderr_file" "$resolved_user_name" "$resolved_group_name" || true
  else
    "${probe_command[@]}" >/dev/null 2>"$stderr_file" || true
  fi

  if [ -s "$stderr_file" ]; then
    probe_status="failed"
    local stderr_tail
    stderr_tail="$(tail -n 1 "$stderr_file" | tr -d '\r')"
    if printf '%s' "$stderr_tail" | grep -Eiq 'unknown user|unknown group|no passwd entry|user .* does not exist|group .* does not exist|sudo: .*unknown|sudo: .*invalid|runuser: .*does not exist|runuser: user .* does not exist|runuser: group .* does not exist|unable to initialize policy plugin|unable to set user context|timed out'; then
      probe_detail="Checkout freshness probe failed: probe could not impersonate UID:GID ${KASEKI_CONTAINER_UID}:${KASEKI_CONTAINER_GID} due to host user/group mapping, privilege-tool configuration issue, or timeout: ${stderr_tail}"
      probe_remediation="Configure a valid host method to run commands as UID:GID ${KASEKI_CONTAINER_UID}:${KASEKI_CONTAINER_GID} (or ensure passwd/group mappings exist for that UID/GID), then rerun ./scripts/kaseki-setup-host.sh --fix. If the issue is timeout, try increasing KASEKI_PRIV_TOOL_TIMEOUT."
    else
      probe_detail="Checkout freshness probe failed when running git metadata access as UID:GID ${KASEKI_CONTAINER_UID}:${KASEKI_CONTAINER_GID}: ${stderr_tail}"
      probe_remediation="Fix ownership/permissions so ${checkout_dir} and ${checkout_dir}/.git are readable by UID:GID ${KASEKI_CONTAINER_UID}:${KASEKI_CONTAINER_GID}."
    fi
  else
    probe_status="ok"
    probe_detail="Checkout freshness probe passed for ${checkout_dir} as UID:GID ${KASEKI_CONTAINER_UID}:${KASEKI_CONTAINER_GID}."
  fi
  cleanup_probe_stderr_file

  printf '%s|%s|%s\n' "$probe_status" "$probe_detail" "$probe_remediation"
}

write_host_state() {
  local home_dir="$1"
  local secrets_dir="$2"
  local checkout_probe_status="$3"
  local checkout_probe_detail="$4"
  local checkout_probe_remediation="$5"
  local kaseki_dir="$home_dir/.kaseki"
  local state_file="$kaseki_dir/host-state.json"

  mkdir -p "$kaseki_dir"
  chmod 0700 "$kaseki_dir"

  # Create state file with normalized secrets location
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  # Use a temporary file for atomic writes
  local temp_file="${state_file}.tmp"
  
  # Write JSON content to temp file
  # Ensure jq is available before attempting JSON generation
  if ! command -v jq >/dev/null 2>&1; then
    printf 'error: jq is required but not installed. Install it with: sudo apt install jq\n' >&2
    return 1
  fi

  # Write JSON content to temp file
  jq -n \
    --arg normalized_secrets_dir "$secrets_dir" \
    --arg timestamp "$timestamp" \
    --arg version "2" \
    --arg checkout_probe_status "$checkout_probe_status" \
    --arg checkout_probe_detail "$checkout_probe_detail" \
    --arg checkout_probe_remediation "$checkout_probe_remediation" \
    --arg checkout_dir "$KASEKI_CHECKOUT_DIR" \
    --arg uid "$KASEKI_CONTAINER_UID" \
    --arg gid "$KASEKI_CONTAINER_GID" \
    '{
      normalized_secrets_dir: $normalized_secrets_dir,
      timestamp: $timestamp,
      version: $version,
      checkout_freshness_probe: {
        status: $checkout_probe_status,
        detail: $checkout_probe_detail,
        remediation: $checkout_probe_remediation,
        checkout_dir: $checkout_dir,
        uid: $uid,
        gid: $gid
      }
    }' > "$temp_file"
  
  # Make file readable (0644) and move it into place atomically
  chmod 0644 "$temp_file"
  mv "$temp_file" "$state_file"
  
  printf 'ok: state file written to %s\n' "$state_file"
}

# Phase 4: Parallel privilege tool testing helper
# Runs privilege tools in parallel and returns success on first success
run_privilege_tools_parallel() {
  local checkout_dir="$1"
  local probe_command=("${2[@]}")
  local stderr_file="$3"
  local resolved_user_name="$4"
  local resolved_group_name="$5"
  
  local temp_dir
  temp_dir=$(mktemp -d)
  local success_marker="$temp_dir/success"
  local pids=()
  
  cleanup_parallel() {
    rm -rf "$temp_dir"
  }
  trap cleanup_parallel EXIT
  
  # Test 1: setpriv (fastest, preferred)
  if [ "$(id -u)" -eq 0 ] && command -v setpriv >/dev/null 2>&1; then
    (
      timeout "$KASEKI_PRIV_TOOL_TIMEOUT" setpriv --reuid "$KASEKI_CONTAINER_UID" --regid "$KASEKI_CONTAINER_GID" --clear-groups -- "${probe_command[@]}" >/dev/null 2>"$stderr_file" && touch "$success_marker"
    ) &
    pids+=("$!")
  fi
  
  # Test 2: runuser (if resolved user/group available)
  if [ "$(id -u)" -eq 0 ] && command -v runuser >/dev/null 2>&1 && [ -n "$resolved_user_name" ] && [ -n "$resolved_group_name" ]; then
    (
      timeout "$KASEKI_PRIV_TOOL_TIMEOUT" runuser -u "$resolved_user_name" -g "$resolved_group_name" -- "${probe_command[@]}" >/dev/null 2>"$stderr_file" && touch "$success_marker"
    ) &
    pids+=("$!")
  fi
  
  # Test 3: sudo (fallback, slowest)
  if [ "$(id -u)" -eq 0 ] && command -v sudo >/dev/null 2>&1; then
    (
      if [ -n "$resolved_user_name" ] && [ -n "$resolved_group_name" ]; then
        timeout "$KASEKI_PRIV_TOOL_TIMEOUT" sudo -u "$resolved_user_name" -g "$resolved_group_name" -- "${probe_command[@]}" >/dev/null 2>"$stderr_file"
      elif [ -n "$resolved_user_name" ]; then
        timeout "$KASEKI_PRIV_TOOL_TIMEOUT" sudo -u "$resolved_user_name" -- "${probe_command[@]}" >/dev/null 2>"$stderr_file"
      else
        timeout "$KASEKI_PRIV_TOOL_TIMEOUT" sudo -u "#${KASEKI_CONTAINER_UID}" -g "#${KASEKI_CONTAINER_GID}" -- "${probe_command[@]}" >/dev/null 2>"$stderr_file"
      fi && touch "$success_marker"
    ) &
    pids+=("$!")
  fi
  
  # Wait for any process to succeed (check success marker while processes run)
  local timeout_elapsed=0
  local max_wait=$((KASEKI_PRIV_TOOL_TIMEOUT + 1))
  while [ $timeout_elapsed -lt $max_wait ]; do
    if [ -f "$success_marker" ]; then
      # Kill remaining background processes
      for pid in "${pids[@]}"; do
        kill "$pid" 2>/dev/null || true
      done
      return 0
    fi
    sleep 0.1
    timeout_elapsed=$(( timeout_elapsed + 1 ))
  done
  
  # Wait for all processes to complete
  for pid in "${pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
  
  # Check if any succeeded
  [ -f "$success_marker" ] && return 0
  return 1
}

# Phase 4: Performance tracking helpers
track_stage_start() {
  local stage="$1"
  export "${stage}_start=$(date +%s%N)"
}

track_stage_end() {
  local stage="$1"
  local start_var="${stage}_start"
  local start_time="${!start_var:-0}"
  if [ "$start_time" -gt 0 ]; then
    local end_time
    end_time=$(date +%s%N)
    local elapsed_ms=$(( (end_time - start_time) / 1000000 ))
    export "${stage}_duration=$elapsed_ms"
  fi
}

# Phase 3: Enhanced setup results with structured output (with Phase 4 timing)
write_setup_results_enhanced() {
  local home_dir="$1"
  local exit_code="$2"
  local message="$3"
  local probe_status="${4:-unknown}"
  local template_status="${5:-unknown}"
  local kaseki_dir="$home_dir/.kaseki"
  local results_file="$kaseki_dir/setup-results.json"

  mkdir -p "$kaseki_dir"
  chmod 0700 "$kaseki_dir"

  if ! command -v jq >/dev/null 2>&1; then
    return 0  # jq not available, skip JSON generation
  fi

  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  local temp_file="${results_file}.tmp"
  local status_name="ok"
  [ "$exit_code" != "0" ] && status_name="failed"
  
  # Phase 4: Collect timing metrics from stage tracking
  local timing_obj="{}"
  if [ -n "${STAGE_1_duration:-}" ]; then
    timing_obj=$(echo "$timing_obj" | jq --arg k "stage_1_ms" --arg v "${STAGE_1_duration}" '. + {($k): ($v | tonumber)}' 2>/dev/null || echo "{}")
  fi
  if [ -n "${STAGE_6_duration:-}" ]; then
    timing_obj=$(echo "$timing_obj" | jq --arg k "probe_duration_ms" --arg v "${STAGE_6_duration}" '. + {($k): ($v | tonumber)}' 2>/dev/null || echo "{}")
  fi

  jq -n \
    --arg timestamp "$timestamp" \
    --arg mode "$([ "$KASEKI_CHECK_ONLY" = "1" ] && echo "check-only" || echo "setup")" \
    --arg status "$status_name" \
    --arg message "$message" \
    --arg exit_code "$exit_code" \
    --arg version "2" \
    --arg probe_status "$probe_status" \
    --arg template_status "$template_status" \
    --argjson timing "$timing_obj" \
    '{
      timestamp: $timestamp,
      mode: $mode,
      status: $status,
      message: $message,
      exit_code: ($exit_code | tonumber),
      version: $version,
      checks: {
        checkout_freshness_probe: $probe_status,
        template_ready: $template_status
      },
      performance: $timing
    }' > "$temp_file"

  chmod 0644 "$temp_file"
  mv "$temp_file" "$results_file"
}

write_setup_results() {
  local home_dir="$1"
  local exit_code="$2"
  local message="$3"
  local kaseki_dir="$home_dir/.kaseki"
  local results_file="$kaseki_dir/setup-results.json"

  mkdir -p "$kaseki_dir"
  chmod 0700 "$kaseki_dir"

  if ! command -v jq >/dev/null 2>&1; then
    return 0  # jq not available, skip JSON generation
  fi

  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  local temp_file="${results_file}.tmp"

  jq -n \
    --arg timestamp "$timestamp" \
    --arg mode "$([ "$KASEKI_CHECK_ONLY" = "1" ] && echo "check-only" || echo "setup")" \
    --arg status "$([ "$exit_code" = "0" ] && echo "ok" || echo "failed")" \
    --arg message "$message" \
    --arg exit_code "$exit_code" \
    --arg version "1" \
    '{
      timestamp: $timestamp,
      mode: $mode,
      status: $status,
      message: $message,
      exit_code: ($exit_code | tonumber),
      version: $version
    }' > "$temp_file"

  chmod 0644 "$temp_file"
  mv "$temp_file" "$results_file"
}

has_deleted_kaseki_bind_mount() {
  if ! command -v docker >/dev/null 2>&1; then
    return 1
  fi
  if ! docker inspect kaseki-api >/dev/null 2>&1; then
    return 1
  fi
  if [ ! -d "$KASEKI_ROOT" ]; then
    return 0
  fi
  if ! docker exec kaseki-api sh -lc "grep -q ' deleted\\|/deleted' /proc/self/mountinfo" 2>/dev/null; then
    return 1
  fi
  return 0
}

print_recreate_hint_if_needed() {
  if ! has_deleted_kaseki_bind_mount; then
    return
  fi
  printf 'warning: kaseki-api container has a deleted bind mount; recreate the container after this setup completes.\n'
}

bootstrap_checkout_if_possible() {
  if [ "$KASEKI_FIX" != "1" ]; then
    return 0
  fi
  if [ -x "$KASEKI_CHECKOUT_DIR/scripts/kaseki-activate.sh" ]; then
    export KASEKI_TEMPLATE_DIR="$KASEKI_TEMPLATE_DIR"
    export KASEKI_CHECKOUT_DIR="$KASEKI_CHECKOUT_DIR"
    "$KASEKI_CHECKOUT_DIR/scripts/kaseki-activate.sh" --controller --replace-stale bootstrap
    return $?
  fi
  if [ -x "$SCRIPT_DIR/kaseki-install.sh" ]; then
    printf 'bootstrapping checkout with %s/kaseki-install.sh\n' "$SCRIPT_DIR"
    export HOME="$KASEKI_EFFECTIVE_HOST_HOME"
    export KASEKI_HOST_SECRETS_DIR="$KASEKI_HOST_SECRETS_DIR"
    export KASEKI_CONTROLLER_MODE=1
    export KASEKI_REPLACE_STALE=1
    "$SCRIPT_DIR/kaseki-install.sh"
    return $?
  fi
  printf 'missing: checkout activator at %s/scripts/kaseki-activate.sh\n' "$KASEKI_CHECKOUT_DIR"
  printf 'remediation: install the npm package and run: kaseki-agent host setup --fix\n'
  return 1
}

ensure_git_safe_directory() {
  if ! command -v git >/dev/null 2>&1; then
    printf 'warning: git is unavailable; skipping safe.directory preflight for %s\n' "$KASEKI_CHECKOUT_DIR"
    return 0
  fi

  if [ ! -d "$KASEKI_CHECKOUT_DIR/.git" ]; then
    printf 'warning: %s/.git is missing; skipping safe.directory preflight\n' "$KASEKI_CHECKOUT_DIR"
    return 0
  fi

  local status_code=0

  # Configure safe.directory for current context (usually root when run via sudo)
  local existing_safe_dirs
  existing_safe_dirs="$(git config --global --get-all safe.directory 2>/dev/null || true)"
  if printf '%s\n' "$existing_safe_dirs" | grep -Fxq "$KASEKI_CHECKOUT_DIR"; then
    printf 'ok: git safe.directory already present for current user context\n'
  else
    if git config --global --add safe.directory "$KASEKI_CHECKOUT_DIR" >/dev/null 2>&1; then
      printf 'ok: configured git safe.directory for current user context\n'
    else
      printf 'warning: failed to configure git safe.directory for current user context\n'
      status_code=1
    fi
  fi

  # If running via sudo, also configure safe.directory for the invoking user
  if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
    local invoking_user_config
    invoking_user_config="$(sudo -u "$SUDO_USER" git config --global --get-all safe.directory 2>/dev/null || true)"
    if printf '%s\n' "$invoking_user_config" | grep -Fxq "$KASEKI_CHECKOUT_DIR"; then
      printf 'ok: git safe.directory already present for invoking user (%s)\n' "$SUDO_USER"
    else
      if sudo -u "$SUDO_USER" git config --global --add safe.directory "$KASEKI_CHECKOUT_DIR" >/dev/null 2>&1; then
        printf 'ok: configured git safe.directory for invoking user (%s)\n' "$SUDO_USER"
      else
        printf 'warning: failed to configure git safe.directory for invoking user (%s)\n' "$SUDO_USER"
        status_code=1
      fi
    fi
  fi

  if [ "$status_code" -ne 0 ]; then
    printf 'remediation: if you see dubious ownership errors, try manually running as the invoking user:\n'
    if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
      printf '  sudo -u %s git config --global --add safe.directory "%s"\n' "$SUDO_USER" "$KASEKI_CHECKOUT_DIR"
    fi
    printf '  And as root: git config --global --add safe.directory "%s"\n' "$KASEKI_CHECKOUT_DIR"
  fi

  return 0
}

verify_git_safe_directory() {
  # Verify that safe.directory is actually configured before bootstrap
  if ! command -v git >/dev/null 2>&1; then
    return 0
  fi

  if [ ! -d "$KASEKI_CHECKOUT_DIR/.git" ]; then
    return 0
  fi

  local existing_safe_dirs
  existing_safe_dirs="$(git config --global --get-all safe.directory 2>/dev/null || true)"
  if printf '%s\n' "$existing_safe_dirs" | grep -Fxq "$KASEKI_CHECKOUT_DIR"; then
    return 0
  fi

  # Not configured in current context; check if sudo user context has it
  if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
    local invoking_user_config
    invoking_user_config="$(sudo -u "$SUDO_USER" git config --global --get-all safe.directory 2>/dev/null || true)"
    if printf '%s\n' "$invoking_user_config" | grep -Fxq "$KASEKI_CHECKOUT_DIR"; then
      return 0
    fi
  fi

  # Safe.directory not configured anywhere; warn but don't fail (bootstrap might still work)
  printf 'warning: git safe.directory not found for checkout. If bootstrap fails with "dubious ownership", run:\n'
  if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
    printf '  sudo -u %s git config --global --add safe.directory "%s"\n' "$SUDO_USER" "$KASEKI_CHECKOUT_DIR"
  fi
  printf '  git config --global --add safe.directory "%s"\n' "$KASEKI_CHECKOUT_DIR"
  return 0
}

recreate_api_if_requested() {
  if [ "$KASEKI_RECREATE_API" != "1" ]; then
    return 0
  fi
  if ! command -v docker >/dev/null 2>&1; then
    printf 'warning: docker is unavailable; cannot recreate kaseki-api\n'
    return 0
  fi
  if ! docker inspect kaseki-api >/dev/null 2>&1 && [ ! -f "$KASEKI_CHECKOUT_DIR/docker-compose.yml" ]; then
    return 0
  fi
  if docker inspect kaseki-api >/dev/null 2>&1; then
    printf 'recreating: removing existing kaseki-api container\n'
    docker rm -f kaseki-api >/dev/null 2>&1 || true
  fi
  if [ -f "$KASEKI_CHECKOUT_DIR/docker-compose.yml" ]; then
    printf 'recreating: docker compose up -d kaseki-api\n'
    (cd "$KASEKI_CHECKOUT_DIR" && docker compose up -d --no-deps kaseki-api)
  fi
}

status=0

# Phase 1: Host Prerequisites validation
log_info "Stage 1: Host Prerequisites"
track_stage_start "STAGE_1"
validate_host_prerequisites || status=$?
track_stage_end "STAGE_1"
echo ""

# Early exit if prerequisites fail in check-only mode
if [ "$KASEKI_CHECK_ONLY" = "1" ] && [ "$status" -gt 0 ]; then
  write_setup_results "$KASEKI_EFFECTIVE_HOST_HOME" "$status" "Prerequisites validation failed"
  exit "$status"
fi

# Ensure directories exist (only if --fix is set)
if [ "$KASEKI_FIX" = "1" ]; then
  log_info "Stage 2: Creating/fixing directories"
  ensure_dir "$KASEKI_ROOT" 0775 || status=1
  ensure_dir "$KASEKI_ROOT/kaseki-results" 0775 || status=1
  ensure_dir "$KASEKI_ROOT/kaseki-runs" 0775 || status=1
  ensure_dir "$KASEKI_ROOT/kaseki-cache" 0775 || status=1
  ensure_dir "$KASEKI_LOG_DIR" 0775 || true

  check_writable "$KASEKI_ROOT/kaseki-results" || status=1
  echo ""

  # Normalize secrets permissions
  log_info "Stage 3: Normalizing secrets directory"
  normalize_secrets_dir "$KASEKI_HOST_SECRETS_DIR"
  echo ""

  # Fix checkout permissions and git safe.directory
  log_info "Stage 4: Configuring git and checkout permissions"
  fix_checkout_permissions_if_exists
  ensure_git_safe_directory
  verify_git_safe_directory
  echo ""
else
  # Check-only: report current state without changes
  log_info "Stage 2-5: Check-only mode (no changes)"
  printf 'using host secrets directory: %s\n' "$KASEKI_HOST_SECRETS_DIR"
  check_writable "$KASEKI_ROOT/kaseki-results" || status=1
  echo ""
fi

# Checkout freshness probe (Phase 2: used to conditionally run bootstrap)
log_info "Stage 6: Checkout freshness probe"
track_stage_start "STAGE_6"
probe_payload="$(run_checkout_freshness_probe "$KASEKI_CHECKOUT_DIR")"
track_stage_end "STAGE_6"
IFS="|" read -r checkout_probe_status checkout_probe_detail checkout_probe_remediation <<< "$probe_payload"
printf "checkout-freshness-probe: %s\n" "$checkout_probe_status"
printf "%s\n" "$checkout_probe_detail"
if [ "$checkout_probe_status" != "ok" ] && [ -n "$checkout_probe_remediation" ]; then
  printf "remediation: %s\n" "$checkout_probe_remediation"
fi
echo ""

# Phase 2: Conditional bootstrap (only run if probe succeeded)
if [ "$KASEKI_FIX" = "1" ] && [ "$checkout_probe_status" = "ok" ]; then
  log_info "Stage 5: Bootstrap checkout (probe passed, proceeding)"
  bootstrap_checkout_if_possible || status=$?
  echo ""
elif [ "$KASEKI_FIX" = "1" ] && [ "$checkout_probe_status" != "ok" ]; then
  log_warn "Stage 5: Bootstrap skipped (probe failed)"
  printf "remediation: Fix permissions and rerun: sudo kaseki-agent host setup --fix\n"
  echo ""
fi

# Phase 2: Verify fixes applied (if --fix was used)
if [ "$KASEKI_FIX" = "1" ]; then
  log_info "Stage 7: Verifying fixes applied"
  validate_host_fixes_applied || status=$?
  echo ""
fi

# Write host state
write_host_state "$KASEKI_EFFECTIVE_HOST_HOME" "$KASEKI_HOST_SECRETS_DIR" "$checkout_probe_status" "$checkout_probe_detail" "$checkout_probe_remediation"
print_recreate_hint_if_needed

# Phase 2: Template verification (hardened - check executability, not just existence)
log_info "Stage 8: Template verification"
template_status="unknown"
if [ ! -f "$KASEKI_TEMPLATE_DIR/run-kaseki.sh" ]; then
  printf 'missing: template runner at %s/run-kaseki.sh\n' "$KASEKI_TEMPLATE_DIR"
  printf 'remediation: run kaseki-agent host setup --fix\n'
  template_status="missing"
  if [ "$KASEKI_FIX" != "1" ]; then
    status=1
  fi
elif [ ! -x "$KASEKI_TEMPLATE_DIR/run-kaseki.sh" ]; then
  printf 'error: template runner exists but is not executable: %s/run-kaseki.sh\n' "$KASEKI_TEMPLATE_DIR"
  printf 'remediation: run chmod +x %s/run-kaseki.sh\n' "$KASEKI_TEMPLATE_DIR"
  template_status="not-executable"
  if [ "$KASEKI_FIX" = "1" ]; then
    chmod +x "$KASEKI_TEMPLATE_DIR/run-kaseki.sh" 2>/dev/null || true
  fi
  status=1
else
  log_pass "Template runner is ready and executable"
  template_status="ok"
fi
echo ""

# API recreation (if requested)
if [ "$KASEKI_RECREATE_API" = "1" ]; then
  log_info "Stage 9: API container recreation"
  recreate_api_if_requested || status=$?
  echo ""
fi

# Phase 3: Final results with enhanced structured output
write_setup_results_enhanced "$KASEKI_EFFECTIVE_HOST_HOME" "$status" "Setup complete" "$checkout_probe_status" "$template_status"

if [ "$status" -ne 0 ]; then
  log_error "Kaseki host setup incomplete. Details above." >&2
  printf '\n' >&2
  printf 'Common remediation steps:\n' >&2
  printf '\n' >&2
  printf '1. Ensure git safe.directory is configured:\n' >&2
  if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
    printf '   sudo -u %s git config --global --add safe.directory "%s"\n' "$SUDO_USER" "$KASEKI_CHECKOUT_DIR" >&2
  fi
  printf '   git config --global --add safe.directory "%s"\n' "$KASEKI_CHECKOUT_DIR" >&2
  printf '\n' >&2
  printf '2. Fix directory permissions/ownership:\n' >&2
  printf '   sudo chown -R %d:%d "%s"\n' "$KASEKI_CONTAINER_UID" "$KASEKI_CONTAINER_GID" "$KASEKI_ROOT" >&2
  printf '\n' >&2
  printf '3. Retry setup:\n' >&2
  printf '   sudo kaseki-agent host setup --fix\n' >&2
fi

exit "$status"
