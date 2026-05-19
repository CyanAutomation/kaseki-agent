#!/usr/bin/env bash
#
# startup-checks.sh — Validate Docker environment before startup
#
# Checks that required directories and secret files are accessible.
# Reports issues with clear fix instructions. Does NOT attempt auto-fixes.
#
# Exit codes:
#   0 = all checks passed
#   2 = error (missing required resource or unreadable secret)
#   3 = warning (suboptimal but execution can continue)

set -euo pipefail

# --- Configuration ---
KASEKI_ROOT="${KASEKI_ROOT:-/agents}"
KASEKI_TEMPLATE_DIR="${KASEKI_TEMPLATE_DIR:-$KASEKI_ROOT/kaseki-template}"
KASEKI_RESULTS_DIR="${KASEKI_RESULTS_DIR:-$KASEKI_ROOT/kaseki-results}"
KASEKI_RUNS_DIR="${KASEKI_RUNS_DIR:-$KASEKI_ROOT/kaseki-runs}"
KASEKI_SECRETS_DIR="${KASEKI_SECRETS_DIR:-/run/secrets/kaseki}"
MODE="${1:-all}"
KASEKI_ALLOW_LOCAL_DEV_SECRET_FALLBACK="${KASEKI_ALLOW_LOCAL_DEV_SECRET_FALLBACK:-0}"

CONTAINER_UID="${CONTAINER_UID:-$(id -u)}"
CONTAINER_GID="${CONTAINER_GID:-$(id -g)}"

RED='\033[0;31m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_pass()  { echo -e "${GREEN}✓${NC} $*" >&2; }
log_warn()  { echo -e "${YELLOW}⚠${NC} $*" >&2; }
log_error() { echo -e "${RED}✗${NC} $*" >&2; }
log_info()  { echo -e "${BLUE}ℹ${NC} $*" >&2; }

# --- Checks ---

check_kaseki_root() {
  log_info "Checking $KASEKI_ROOT..."

  if [ ! -d "$KASEKI_ROOT" ]; then
    if mkdir -p "$KASEKI_ROOT" 2>/dev/null; then
      log_pass "$KASEKI_ROOT created"
      return 0
    fi
    log_error "$KASEKI_ROOT does not exist and could not be created"
    log_error "  Fix: sudo mkdir -p $KASEKI_ROOT && sudo chown $CONTAINER_UID:$CONTAINER_GID $KASEKI_ROOT && sudo chmod 755 $KASEKI_ROOT"
    return 2
  fi

  if [ ! -w "$KASEKI_ROOT" ]; then
    log_error "$KASEKI_ROOT is not writable by UID $CONTAINER_UID"
    log_error "  Fix: sudo chown $CONTAINER_UID:$CONTAINER_GID $KASEKI_ROOT && sudo chmod 755 $KASEKI_ROOT"
    return 2
  fi

  log_pass "$KASEKI_ROOT is writable"
  return 0
}

check_subdirectories() {
  local -a subdirs=("$KASEKI_TEMPLATE_DIR" "$KASEKI_RESULTS_DIR" "$KASEKI_RUNS_DIR")
  local exit_code=0

  for subdir in "${subdirs[@]}"; do
    if [ ! -d "$subdir" ]; then
      if mkdir -p "$subdir" 2>/dev/null; then
        log_pass "$subdir created"
      else
        log_warn "Could not create $subdir (will retry later)"
        exit_code=3
      fi
    elif [ ! -w "$subdir" ]; then
      log_warn "$subdir exists but is not writable"
      exit_code=3
    else
      log_pass "$subdir is ready"
    fi
  done

  return "$exit_code"
}

check_bootstrap_status() {
  log_info "Checking bootstrap status..."

  local run_script="$KASEKI_TEMPLATE_DIR/run-kaseki.sh"

  if [ ! -f "$run_script" ]; then
    log_warn "Bootstrap incomplete: run-kaseki.sh not yet present (normal on first startup)"
    return 3
  fi

  if [ ! -x "$run_script" ] && ! chmod +x "$run_script" 2>/dev/null; then
    log_error "run-kaseki.sh is not executable and could not be fixed"
    return 2
  fi

  log_pass "run-kaseki.sh is ready"
  return 0
}

check_secret_paths() {
  log_info "Checking secret paths..."

  # Check the configured container path first, then the local-dev fallback.
  local primary_secrets_dir="$KASEKI_SECRETS_DIR"
  local fallback_secrets_dir="$HOME/.kaseki/secrets"
  local secrets_dir_found=false
  local exit_code=0

  if [ -d "$primary_secrets_dir" ]; then
    log_pass "Secrets directory found: $primary_secrets_dir"

    local mode
    mode=$(stat -c '%a' "$primary_secrets_dir" 2>/dev/null || stat -f '%OLp' "$primary_secrets_dir" 2>/dev/null | sed 's/^.*\([0-9]\{3\}\)$/\1/')

    if [ ! -r "$primary_secrets_dir" ] || [ ! -x "$primary_secrets_dir" ]; then
      log_error "Secrets directory is not readable/traversable: $primary_secrets_dir (mode: $mode)"
      log_info "  Fix host permissions so UID/GID $CONTAINER_UID:$CONTAINER_GID can read it, or set KASEKI_SECRETS_DIR to the mounted path"
      exit_code=2
    else
      log_pass "Secrets directory is readable: $primary_secrets_dir (mode: $mode)"
    fi

    secrets_dir_found=true
  fi

  # Try fallback location
  if [ ! "$secrets_dir_found" = true ] && [ -d "$fallback_secrets_dir" ]; then
    log_pass "Local secrets directory found: $fallback_secrets_dir (falling back from Docker)"

    local mode
    mode=$(stat -c '%a' "$fallback_secrets_dir" 2>/dev/null || stat -f '%OLp' "$fallback_secrets_dir" 2>/dev/null | sed 's/^.*\([0-9]\{3\}\)$/\1/')

    if [ "$mode" != "700" ]; then
      log_error "Local secrets directory has incorrect permissions: $fallback_secrets_dir (mode: $mode, expected: 700)"
      log_info "  Fix with: ./scripts/setup-secrets.sh --fix"
      exit_code=2
    else
      log_pass "Local secrets permissions are correct: $fallback_secrets_dir (mode: $mode)"
    fi

    secrets_dir_found=true
  fi

  if [ ! "$secrets_dir_found" = true ]; then
    log_warn "No secrets directory found ($primary_secrets_dir or $fallback_secrets_dir)"
    log_info "  Mount the host secrets directory to $primary_secrets_dir or run: kaseki-agent init"
    return 3
  fi

  return "$exit_code"
}

check_secret_file_sources() {
  local label="$1"
  shift
  local secret_found=false
  local secret_file

  for secret_file in "$@"; do
    [ -z "$secret_file" ] && continue

    if [ -f "$secret_file" ]; then
      if [ -r "$secret_file" ]; then
        log_pass "$label found and readable: $secret_file"
        secret_found=true
        break
      else
        log_error "$label exists but is not readable: $secret_file"
        log_info "  Fix with: ./scripts/setup-secrets.sh --fix"
        return 2
      fi
    fi
  done

  if [ "$secret_found" = true ]; then
    return 0
  fi
  return 3
}

check_api_key() {
  log_info "Checking OpenRouter API key..."

  if [ -n "${OPENROUTER_API_KEY:-}" ]; then
    log_pass "OPENROUTER_API_KEY is set (from environment)"
    return 0
  fi

  if check_secret_file_sources \
    "OpenRouter API key" \
    "${OPENROUTER_API_KEY_FILE:-}" \
    "$KASEKI_SECRETS_DIR/openrouter_api_key" \
    "$HOME/.kaseki/secrets/openrouter_api_key"; then
    return 0
  fi
  local exit_code=$?
  if [ "$exit_code" -eq 2 ]; then
    return 2
  fi

  log_warn "No OpenRouter API key configured"
  log_info "  Create: $KASEKI_SECRETS_DIR/openrouter_api_key or run: kaseki-agent init"
  return 3
}

check_github_app_secrets() {
  log_info "Checking GitHub App credentials..."

  local exit_code=0
  local github_app_id_file github_app_client_id_file github_app_private_key_file
  github_app_id_file="$(resolve_github_secret_file "GITHUB_APP_ID_FILE" "github_app_id")"
  github_app_client_id_file="$(resolve_github_secret_file "GITHUB_APP_CLIENT_ID_FILE" "github_app_client_id")"
  github_app_private_key_file="$(resolve_github_secret_file "GITHUB_APP_PRIVATE_KEY_FILE" "github_app_private_key")"

  check_secret_file_sources \
    "GitHub App ID" \
    "$github_app_id_file" || exit_code=$((exit_code > $? ? exit_code : $?))

  check_secret_file_sources \
    "GitHub App Client ID" \
    "$github_app_client_id_file" || exit_code=$((exit_code > $? ? exit_code : $?))

  check_secret_file_sources \
    "GitHub App private key" \
    "$github_app_private_key_file" || exit_code=$((exit_code > $? ? exit_code : $?))

  if [ "$exit_code" -eq 0 ]; then
    return 0
  fi
  if [ "$exit_code" -eq 2 ]; then
    return 2
  fi

  log_warn "GitHub App credentials are incomplete; default PR creation will not work"
  log_info "  Create: github_app_id, github_app_client_id, and github_app_private_key in /run/secrets/kaseki (or KASEKI_SECRETS_DIR) or run: kaseki-agent init"
  return 3
}

# must match host preflight/API secret resolution contract.
resolve_github_secret_file() {
  local env_name="$1"
  local default_name="$2"
  local explicit_value canonical_path local_dev_path
  explicit_value="${!env_name:-}"
  if [ -n "$explicit_value" ]; then
    printf '%s' "$explicit_value"
    return 0
  fi
  canonical_path="${KASEKI_SECRETS_DIR:-/run/secrets/kaseki}/$default_name"
  if [ -r "$canonical_path" ]; then
    printf '%s' "$canonical_path"
    return 0
  fi
  if [ "$KASEKI_ALLOW_LOCAL_DEV_SECRET_FALLBACK" = "1" ]; then
    local_dev_path="$HOME/.kaseki/secrets/$default_name"
    if [ -r "$local_dev_path" ]; then
      printf '%s' "$local_dev_path"
      return 0
    fi
  fi
  printf '%s' "$canonical_path"
}

check_worker_mounts() {
  local -a worker_paths=(/workspace /results /cache)
  local exit_code=0
  local mount_path

  log_info "Checking worker container mounts..."

  for mount_path in "${worker_paths[@]}"; do
    if [ ! -d "$mount_path" ]; then
      log_error "$mount_path is not mounted"
      exit_code=2
    elif [ ! -w "$mount_path" ]; then
      log_error "$mount_path is not writable by UID $CONTAINER_UID"
      exit_code=2
    else
      log_pass "$mount_path is writable"
    fi
  done

  return "$exit_code"
}

# --- Main execution ---

main() {
  local overall_exit=0

  echo ""
  log_info "Kaseki startup checks (mode: $MODE)"
  echo ""

  case "$MODE" in
    all)
      check_kaseki_root || overall_exit=$?
      check_subdirectories || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      check_bootstrap_status || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      check_secret_paths || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      check_api_key || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      check_github_app_secrets || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      ;;
    permissions)
      check_kaseki_root || overall_exit=$?
      check_subdirectories || overall_exit=$?
      ;;
    bootstrap)
      check_bootstrap_status || overall_exit=$?
      ;;
    quick|boot)
      check_kaseki_root || overall_exit=$?
      ;;
    worker)
      check_worker_mounts || overall_exit=$?
      check_secret_paths || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      check_api_key || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      check_github_app_secrets || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      ;;
    baseline-validation)
      check_kaseki_root || overall_exit=$?
      check_subdirectories || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      check_bootstrap_status || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      check_secret_paths || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      ;;
    *)
      log_error "Unknown mode: $MODE"
      echo "Usage: $0 [all|permissions|bootstrap|quick|boot|baseline-validation|worker]" >&2
      return 1
      ;;
  esac

  echo ""
  if [ "$overall_exit" -eq 0 ]; then
    log_pass "All checks passed"
  elif [ "$overall_exit" -eq 2 ]; then
    log_error "Error detected; startup blocked"
  else
    log_warn "Some warnings detected; continuing"
  fi
  echo ""

  return "$overall_exit"
}

main "$@"
