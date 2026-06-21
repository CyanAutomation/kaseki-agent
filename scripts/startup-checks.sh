#!/usr/bin/env bash
#
# startup-checks.sh — Validate Docker environment before startup
#
# Checks that required directories and secret files are accessible.
# Reports issues with clear fix instructions. Supports auto-remediation
# for fixable issues like git safe.directory configuration.
#
# Usage:
#   startup-checks.sh [MODE]
#   startup-checks.sh [MODE] [--no-remediate]
#
# Modes:
#   all              - Full startup validation + git checks (default)
#   permissions      - Just /agents directory permissions
#   bootstrap        - Bootstrap file availability
#   quick/boot       - Fast minimal check
#   worker           - Worker container mounts
#   baseline-validation - Setup + bootstrap + secrets
#
# Auto-remediation:
#   Enabled by default (KASEKI_STARTUP_CHECK_AUTO_REMEDIATE=1)
#   Controlled via environment variable or --no-remediate flag
#
# Exit codes:
#   0 = all checks passed
#   2 = error (missing required resource or unreadable secret, blocking startup)
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

# Parse optional flags (e.g., --no-remediate)
KASEKI_STARTUP_CHECK_AUTO_REMEDIATE="${KASEKI_STARTUP_CHECK_AUTO_REMEDIATE:-1}"
if [ "${2:-}" = "--no-remediate" ]; then
  KASEKI_STARTUP_CHECK_AUTO_REMEDIATE=0
fi

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

merge_startup_status() {
  local current="$1"
  local next="$2"

  if [ "$current" -eq 2 ] || [ "$next" -eq 2 ]; then
    printf '2'
  elif [ "$current" -eq 3 ] || [ "$next" -eq 3 ]; then
    printf '3'
  elif [ "$next" -ne 0 ]; then
    printf '%s' "$next"
  else
    printf '%s' "$current"
  fi
}

check_path_components_traversable() {
  local target_path="$1"
  local current=""
  local component
  local -a components

  if [ -z "$target_path" ]; then
    return 0
  fi

  case "$target_path" in
    /*) current="/" ;;
    *) current="." ;;
  esac

  IFS='/' read -r -a components <<< "$target_path"
  for component in "${components[@]}"; do
    [ -z "$component" ] && continue

    if [ "$current" = "/" ]; then
      current="/$component"
    elif [ "$current" = "." ]; then
      current="$component"
    else
      current="$current/$component"
    fi

    if [ -d "$current" ]; then
      if [ ! -x "$current" ]; then
        log_error "Parent directory is not traversable: $current (needed for $target_path)"
        log_info "  Fix host permissions so UID/GID $CONTAINER_UID:$CONTAINER_GID can traverse it, or set KASEKI_SECRETS_DIR to an accessible mounted path"
        return 2
      fi
    elif [ -e "$current" ]; then
      return 0
    else
      return 0
    fi
  done

  return 0
}

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
    log_error "$KASEKI_ROOT is not writable by UID $CONTAINER_UID (read-only mount or ownership/permission issue)"
    log_error "  Fix: sudo chown $CONTAINER_UID:$CONTAINER_GID $KASEKI_ROOT && sudo chmod 755 $KASEKI_ROOT"
    log_info "  If this is a read-only mount, remount it read-write or set KASEKI_ROOT to a writable path"
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

  # Only check traversability if the target directory actually exists or is reachable.
  # If the directory doesn't exist (common in smoke tests with read-only containers),
  # don't treat it as a blocking error—we'll fall through to the fallback/warning logic below.
  # If the directory exists but is not traversable, that IS a blocking error (permission issue).
  if [ -d "$primary_secrets_dir" ] || [ -e "$primary_secrets_dir" ]; then
    if ! check_path_components_traversable "$primary_secrets_dir"; then
      # Directory exists but path components aren't traversable (permission issue)
      log_error "Secrets directory path is not traversable: $primary_secrets_dir"
      log_info "  Fix host permissions so UID/GID $CONTAINER_UID:$CONTAINER_GID can traverse it, or set KASEKI_SECRETS_DIR to an accessible mounted path"
      return 2
    fi
  fi

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
    if [ -r "${OPENROUTER_API_KEY_FILE:-}" ] ||
      [ -r "${GITHUB_APP_ID_FILE:-}" ] ||
      [ -r "${GITHUB_APP_CLIENT_ID_FILE:-}" ] ||
      [ -r "${GITHUB_APP_PRIVATE_KEY_FILE:-}" ] ||
      [ -r /run/secrets/github_app_id ] ||
      [ -r /run/secrets/github_app_client_id ] ||
      [ -r /run/secrets/github_app_private_key ]; then
      log_info "Secrets directory not mounted at $primary_secrets_dir or $fallback_secrets_dir; using readable configured or legacy secret files."
      return 0
    fi
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

    if ! check_path_components_traversable "$secret_file"; then
      return 2
    fi

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

  local exit_code
  if check_secret_file_sources \
    "OpenRouter API key" \
    "${OPENROUTER_API_KEY_FILE:-}" \
    "$KASEKI_SECRETS_DIR/openrouter_api_key" \
    "$HOME/.kaseki/secrets/openrouter_api_key"; then
    return 0
  else
    exit_code=$?
  fi

  if [ "$exit_code" -eq 2 ]; then
    return 2
  fi

  log_warn "No OpenRouter API key configured"
  if [ -n "${OPENROUTER_API_KEY_FILE:-}" ]; then
    log_info "  Checked configured OPENROUTER_API_KEY_FILE: $OPENROUTER_API_KEY_FILE"
  fi
  log_info "  Create: $KASEKI_SECRETS_DIR/openrouter_api_key or run: kaseki-agent init"
  return 3
}

check_github_app_secrets() {
  log_info "Checking GitHub App credentials..."

  if [ "${GITHUB_APP_ENABLED:-1}" != "1" ]; then
    log_info "GitHub App credential check skipped because GITHUB_APP_ENABLED=${GITHUB_APP_ENABLED:-0}."
    return 0
  fi

  local exit_code=0
  local github_app_id_file github_app_client_id_file github_app_private_key_file
  github_app_id_file="$(resolve_github_secret_file "GITHUB_APP_ID_FILE" "github_app_id")"
  github_app_client_id_file="$(resolve_github_secret_file "GITHUB_APP_CLIENT_ID_FILE" "github_app_client_id")"
  github_app_private_key_file="$(resolve_github_secret_file "GITHUB_APP_PRIVATE_KEY_FILE" "github_app_private_key")"

  check_secret_file_sources \
    "GitHub App ID" \
    "$github_app_id_file" || exit_code=$(merge_startup_status "$exit_code" "$?")

  check_secret_file_sources \
    "GitHub App Client ID" \
    "$github_app_client_id_file" || exit_code=$(merge_startup_status "$exit_code" "$?")

  check_secret_file_sources \
    "GitHub App private key" \
    "$github_app_private_key_file" || exit_code=$(merge_startup_status "$exit_code" "$?")

  if [ "$exit_code" -eq 0 ]; then
    return 0
  fi
  if [ "$exit_code" -eq 2 ]; then
    return 2
  fi

  log_warn "GitHub App credentials are incomplete; default PR creation will not work"
  log_info "  Create: github_app_id, github_app_client_id, and github_app_private_key in $KASEKI_SECRETS_DIR or run: kaseki-agent init"
  return 3
}

check_github_app_secret_paths() {
  log_info "Checking GitHub App secret mount paths..."

  if [ "${GITHUB_APP_ENABLED:-1}" != "1" ]; then
    log_info "GitHub App secret mount path check skipped because GITHUB_APP_ENABLED=${GITHUB_APP_ENABLED:-0}."
    return 0
  fi

  local exit_code=0
  local root_level_id root_level_client_id root_level_key primary_id primary_client_id primary_key

  root_level_id="/run/secrets/github_app_id"
  root_level_client_id="/run/secrets/github_app_client_id"
  root_level_key="/run/secrets/github_app_private_key"
  primary_id="$KASEKI_SECRETS_DIR/github_app_id"
  primary_client_id="$KASEKI_SECRETS_DIR/github_app_client_id"
  primary_key="$KASEKI_SECRETS_DIR/github_app_private_key"

  if [ -r "$primary_id" ]; then
    log_pass "GitHub App ID mounted in primary secrets directory: $primary_id"
  elif [ -r "$root_level_id" ]; then
    log_info "GitHub App ID found at legacy root path: $root_level_id"
    log_info "  Prefer one directory mount at $KASEKI_SECRETS_DIR"
  fi

  if [ -r "$primary_client_id" ]; then
    log_pass "GitHub App Client ID mounted in primary secrets directory: $primary_client_id"
  elif [ -r "$root_level_client_id" ]; then
    log_info "GitHub App Client ID found at legacy root path: $root_level_client_id"
    log_info "  Prefer one directory mount at $KASEKI_SECRETS_DIR"
  fi

  if [ -r "$primary_key" ]; then
    log_pass "GitHub App Private Key mounted in primary secrets directory: $primary_key"
  elif [ -r "$root_level_key" ]; then
    log_info "GitHub App Private Key found at legacy root path: $root_level_key"
    log_info "  Prefer one directory mount at $KASEKI_SECRETS_DIR"
  fi

  return "$exit_code"
}

# must match host preflight/API secret resolution contract.
resolve_github_secret_file() {
  local env_name="$1"
  local default_name="$2"
  local explicit_value canonical_path legacy_root_path local_dev_path
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
  legacy_root_path="/run/secrets/$default_name"
  if [ -r "$legacy_root_path" ]; then
    printf '%s' "$legacy_root_path"
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

check_results_writable() {
  local results_dir="${KASEKI_RESULTS_DIR:-/results}"
  log_info "Checking $results_dir writability for scouting/validation artifacts..."

  if [ ! -d "$results_dir" ]; then
    log_error "$results_dir is not mounted (critical for kaseki operations)"
    log_error "  Fix: Mount $results_dir as a writable volume on the host"
    return 2
  fi

  if [ ! -w "$results_dir" ]; then
    log_error "$results_dir exists but is NOT WRITABLE by UID $CONTAINER_UID (READ-ONLY filesystem detected)"
    log_error "  This will cause scouting and validation to fail silently:"
    log_error "  - Scouting agent will exit 0 but /results/scouting-candidate.json will be missing"
    log_error "  - Validation logs and artifacts cannot be written"
    log_error "  "
    log_error "  Fix 1 (Preferred): Mount /results as read-write"
    log_error "    docker run -v /path/to/results:/results:rw ..."
    log_error "  "
    log_error "  Fix 2: Run container without --read-only flag"
    log_error "    docker run --read-only=false ..."
    log_error "  "
    log_error "  Fix 3: Use a tmpfs overlay for /results"
    log_error "    docker run --tmpfs /results:rw ..."
    return 2
  fi

  # Test actual write capability with a temporary file
  local test_file="$results_dir/.kaseki-writable-test-$$"
  if ! touch "$test_file" 2>/dev/null; then
    log_error "$results_dir appears writable but touch failed (unexpected filesystem error)"
    return 2
  fi
  if ! rm -f "$test_file" 2>/dev/null; then
    log_warn "$results_dir: write succeeded but delete failed (unusual permissions state)"
    return 0  # Write succeeded, so treat as ok despite delete failure
  fi

  log_pass "$results_dir is writable (can create and delete test files)"
  return 0
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

check_gateway_worker_secret() {
  if [ "${KASEKI_PROVIDER:-gateway}" != "gateway" ]; then
    return 0
  fi

  log_info "Checking LLM Gateway worker credentials..."

  if [ -z "${LLM_GATEWAY_URL:-}" ]; then
    log_error "LLM_GATEWAY_URL is required for KASEKI_PROVIDER=gateway"
    return 2
  fi

  if [ -n "${LLM_GATEWAY_API_KEY:-}" ]; then
    log_warn "LLM_GATEWAY_API_KEY is set inline; prefer LLM_GATEWAY_API_KEY_FILE with a mounted secret file"
    return 0
  fi

  local gateway_key_file="${LLM_GATEWAY_API_KEY_FILE:-${KASEKI_SECRETS_DIR:-/run/secrets/kaseki}/llm_gateway_api_key}"
  if [ ! -r "$gateway_key_file" ]; then
    log_error "LLM Gateway API key file is not readable: $gateway_key_file"
    log_error "  Mount ~/secrets/llm_gateway_api_key into the worker and set LLM_GATEWAY_API_KEY_FILE=$gateway_key_file"
    return 2
  fi

  if [ ! -s "$gateway_key_file" ]; then
    log_error "LLM Gateway API key file is empty: $gateway_key_file"
    return 2
  fi

  log_pass "LLM Gateway API key file is readable: $gateway_key_file"
  return 0
}

write_gateway_provider_capability_skip_artifact() {
  local reason="$1"
  local artifact="${KASEKI_RESULTS_DIR:-/results}/provider-capability.json"
  local pi_version
  pi_version="$(pi --version 2>&1 || true)"
  local extensions_dir="${PI_EXTENSIONS_DIR:-}"
  local home_extensions="${HOME:-}/.pi/extensions"

  mkdir -p "$(dirname "$artifact")" 2>/dev/null || true
  node - "$artifact" "$pi_version" "$extensions_dir" "$home_extensions" "$reason" <<'NODE' 2>/dev/null || true
const fs = require('node:fs');
const [artifact, piVersion, extensionsDir, homeExtensions, reason] = process.argv.slice(2);
fs.writeFileSync(artifact, JSON.stringify({
  check: 'gateway-provider-capability',
  provider: 'gateway',
  ok: false,
  skipped: true,
  reason,
  pi_version: piVersion || 'unavailable',
  command: 'pi --list-models',
  exit_code: null,
  extension_paths_checked: {
    PI_EXTENSIONS_DIR: extensionsDir || null,
    HOME_PI_EXTENSIONS: homeExtensions || null,
  },
  output_tail: '',
  remediation: 'Fix the missing LLM Gateway configuration, then rerun startup checks before validating Pi provider registration.',
}, null, 2) + '\n');
NODE

  log_info "Skipping Pi provider registration check because gateway configuration is incomplete: $reason"
  log_info "  Diagnostic artifact: $artifact"
  return 2
}

check_gateway_provider_capability() {
  if [ "${KASEKI_PROVIDER:-gateway}" != "gateway" ]; then
    return 0
  fi

  if [ -z "${LLM_GATEWAY_URL:-}" ]; then
    write_gateway_provider_capability_skip_artifact "missing_llm_gateway_url"
    return $?
  fi

  local gateway_key_file="${LLM_GATEWAY_API_KEY_FILE:-${KASEKI_SECRETS_DIR:-/run/secrets/kaseki}/llm_gateway_api_key}"
  if [ -z "${LLM_GATEWAY_API_KEY:-}" ] && [ ! -r "$gateway_key_file" ]; then
    write_gateway_provider_capability_skip_artifact "missing_llm_gateway_api_key"
    return $?
  fi

  log_info "Checking Pi provider registration for gateway..."

  local artifact="${KASEKI_RESULTS_DIR:-/results}/provider-capability.json"
  local output_file
  local tmp_parent="${TMPDIR:-/tmp}"
  if [ ! -d "$tmp_parent" ]; then
    tmp_parent="/tmp"
  fi
  if ! mkdir -p "$tmp_parent" 2>/dev/null && [ ! -d "$tmp_parent" ]; then
    tmp_parent="/tmp"
  fi
  output_file="$(TMPDIR="$tmp_parent" mktemp)"
  local pi_version
  pi_version="$(pi --version 2>&1 || true)"
  local extensions_dir="${PI_EXTENSIONS_DIR:-}"
  local home_extensions="${HOME:-}/.pi/extensions"
  local list_exit=127

  if command -v pi >/dev/null 2>&1; then
    set +e
    if [ -n "${LLM_GATEWAY_API_KEY:-}" ]; then
      LLM_GATEWAY_URL="${LLM_GATEWAY_URL:-}" LLM_GATEWAY_API_KEY="$LLM_GATEWAY_API_KEY" pi --list-models >"$output_file" 2>&1
    else
      LLM_GATEWAY_URL="${LLM_GATEWAY_URL:-}" LLM_GATEWAY_API_KEY_FILE="${LLM_GATEWAY_API_KEY_FILE:-${KASEKI_SECRETS_DIR:-/run/secrets/kaseki}/llm_gateway_api_key}" pi --list-models >"$output_file" 2>&1
    fi
    list_exit=$?
    set -e
  else
    printf 'pi executable not found in PATH\n' >"$output_file"
  fi

  local gateway_registered=0
  if [ "$list_exit" -eq 0 ] && grep -Eiq '(^|[^[:alnum:]_-])gateway([^[:alnum:]_-]|$)' "$output_file"; then
    gateway_registered=1
  fi

  mkdir -p "$(dirname "$artifact")" 2>/dev/null || true
  node - "$artifact" "$pi_version" "$extensions_dir" "$home_extensions" "$list_exit" "$gateway_registered" "$output_file" <<'NODE' 2>/dev/null || true
const fs = require('node:fs');
const [artifact, piVersion, extensionsDir, homeExtensions, listExit, gatewayRegistered, outputFile] = process.argv.slice(2);
const output = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : '';
fs.writeFileSync(artifact, JSON.stringify({
  check: 'gateway-provider-capability',
  provider: 'gateway',
  ok: gatewayRegistered === '1',
  pi_version: piVersion || 'unavailable',
  command: 'pi --list-models',
  exit_code: Number(listExit),
  extension_paths_checked: {
    PI_EXTENSIONS_DIR: extensionsDir || null,
    HOME_PI_EXTENSIONS: homeExtensions || null,
  },
  output_tail: output.slice(-4000),
  remediation: gatewayRegistered === '1' ? null : 'The worker image/Pi extension did not register provider gateway. Rebuild the worker image with the gateway Pi extension installed or set PI_EXTENSIONS_DIR/$HOME/.pi/extensions so pi --list-models includes gateway before running Kaseki.',
}, null, 2) + '\n');
NODE

  if [ "$gateway_registered" -eq 1 ]; then
    log_pass "Pi provider gateway is registered"
    rm -f "$output_file"
    return 0
  fi

  if [ "$list_exit" -eq 0 ]; then
    log_error "Pi provider gateway is not registered in the worker environment"
    log_error "  The worker image/Pi extension did not register gateway; rebuild the image or install the gateway extension before running scouting/coding."
  elif grep -Eiq 'extension|provider|plugin|registration|register|load' "$output_file"; then
    log_error "Pi provider gateway could not be verified because pi --list-models reported an extension/provider loading problem"
    log_error "  The worker image/Pi extension may not have loaded gateway; rebuild the image or fix extension registration before running scouting/coding."
  else
    log_error "Pi provider gateway could not be verified because pi --list-models failed"
    log_error "  Fix the pi --list-models error shown in the diagnostic artifact, then rerun startup checks."
  fi
  log_error "  Pi version: ${pi_version:-unavailable}"
  log_error "  Extension paths checked: PI_EXTENSIONS_DIR=${extensions_dir:-<unset>}, ${home_extensions:-<unknown>}"
  log_error "  Diagnostic artifact: $artifact"
  rm -f "$output_file"
  return 2
}

check_git_safe_directory() {
  log_info "Checking git safe.directory configuration..."

  local checkout_dir="${KASEKI_CHECKOUT_DIR:-/agents/kaseki-agent}"
  local auto_remediate="${KASEKI_STARTUP_CHECK_AUTO_REMEDIATE:-1}"
  
  if [ ! -d "$checkout_dir/.git" ]; then
    log_info "Git directory not found; cannot verify safe.directory configuration (normal on first startup)"
    return 0
  fi

  # Read current git config to check if safe.directory is set
  local configured_dirs
  configured_dirs=$(git config --global --get-all safe.directory 2>/dev/null || echo "")
  
  # Check if checkout_dir is in the configured dirs
  local is_configured=false
  if [ -n "$configured_dirs" ]; then
    while IFS= read -r dir; do
      if [ "$dir" = "$checkout_dir" ]; then
        is_configured=true
        break
      fi
    done <<< "$configured_dirs"
  fi

  if [ "$is_configured" = true ]; then
    log_pass "Git safe.directory is configured for $checkout_dir"
    return 0
  fi

  # Git safe.directory is not configured
  local remediation_cmd="git config --global --add safe.directory $checkout_dir"
  
  if [ "$auto_remediate" = "1" ]; then
    # Auto-remediate: apply the fix
    if git config --global --add safe.directory "$checkout_dir" 2>/dev/null; then
      log_pass "Git safe.directory auto-configured for $checkout_dir"
      return 0
    else
      log_warn "Could not auto-configure git safe.directory (permission issue)"
      log_info "  To fix manually: $remediation_cmd"
      return 3
    fi
  else
    # Just warn; don't fix
    log_warn "Git safe.directory not configured for $checkout_dir"
    log_info "  To fix: $remediation_cmd"
    return 3
  fi
}

# --- Provider awareness functions ---

log_provider_info() {
  local active_provider="${KASEKI_PROVIDER:-gateway}"
  local fallback_status="OpenRouter"
  
  echo ""
  log_info "Kaseki startup checks (mode: $MODE)"
  echo ""
  log_info "Active LLM provider: $active_provider (with $fallback_status fallback)"
  echo ""
}

check_unused_secrets() {
  local active_provider="${KASEKI_PROVIDER:-gateway}"
  local gateway_key_file="${LLM_GATEWAY_API_KEY_FILE:-${KASEKI_SECRETS_DIR:-/run/secrets/kaseki}/llm_gateway_api_key}"
  local openrouter_key_present=0
  local gateway_key_present=0
  
  # Check if OpenRouter key is configured
  if [ -n "${OPENROUTER_API_KEY:-}" ] || [ -f "${OPENROUTER_API_KEY_FILE:-}" ] || [ -f "$KASEKI_SECRETS_DIR/openrouter_api_key" ] 2>/dev/null || [ -f "$HOME/.kaseki/secrets/openrouter_api_key" ] 2>/dev/null; then
    openrouter_key_present=1
  fi
  
  # Check if Gateway secrets are configured
  if [ -n "${LLM_GATEWAY_URL:-}" ] || [ -n "${LLM_GATEWAY_API_KEY:-}" ] || [ -f "$gateway_key_file" ] 2>/dev/null; then
    gateway_key_present=1
  fi
  
  # Warn about unused secrets (non-blocking)
  if [ "$active_provider" = "gateway" ] && [ "$openrouter_key_present" -eq 1 ]; then
    log_warn "Unused secret detected: OpenRouter API key configured but gateway is primary provider"
  fi
  
  if [ "$active_provider" = "openrouter" ] && [ "$gateway_key_present" -eq 1 ]; then
    log_warn "Unused secret detected: LLM Gateway URL/key configured but OpenRouter is primary provider"
  fi
  
  return 0
}

check_packaged_agent_helpers() {
  local agent_bin="${KASEKI_AGENT_BIN:-/usr/local/bin/kaseki-agent}"
  local helper_root="${KASEKI_AGENT_HELPER_ROOT:-/usr/local/bin/scripts}"
  local missing=()
  local helper
  local required_helpers=(
    "agent-prompt.sh"
    "allowlist-helper.sh"
    "dependency-cache-helpers.sh"
    "lib/json.sh"
  )

  if [ ! -x "$agent_bin" ]; then
    log_error "Packaged agent command is missing or not executable: $agent_bin"
    log_info "  Rebuild the worker image so kaseki-agent.sh is installed at $agent_bin."
    return 2
  fi

  for helper in "${required_helpers[@]}"; do
    if [ ! -r "$helper_root/$helper" ]; then
      missing+=("$helper_root/$helper")
    fi
  done

  if [ "${#missing[@]}" -gt 0 ]; then
    log_error "Packaged agent helper files are missing or unreadable:"
    printf '  - %s\n' "${missing[@]}" >&2
    log_info "  Rebuild the worker image so sourced scripts are installed beside $agent_bin."
    return 2
  fi

  log_pass "Packaged agent helpers are readable under $helper_root"
  return 0
}

# --- Main execution ---

main() {
  local overall_exit=0

  log_provider_info

  case "$MODE" in
    all)
      # Platform infrastructure checks
      log_info "Checking platform infrastructure..."
      check_kaseki_root || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      check_subdirectories || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      check_bootstrap_status || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      check_secret_paths || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      echo ""
      
      # LLM provider checks
      log_info "Checking primary LLM provider..."
      if [ "${KASEKI_PROVIDER:-gateway}" = "gateway" ]; then
        if check_gateway_worker_secret; then
          check_gateway_provider_capability || overall_exit=$(merge_startup_status "$overall_exit" "$?")
        else
          overall_exit=$(merge_startup_status "$overall_exit" "$?")
        fi
      else
        check_api_key || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      fi
      echo ""
      
      # Fallback provider validation
      log_info "Checking fallback LLM provider (OpenRouter)..."
      check_api_key || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      check_unused_secrets || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      echo ""
      
      # GitHub integration checks
      log_info "Checking GitHub integration..."
      check_github_app_secrets || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      check_github_app_secret_paths || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      echo ""
      
      # Platform-specific setup
      log_info "Checking git configuration..."
      check_git_safe_directory || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      ;;
    permissions)
      check_kaseki_root || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      check_subdirectories || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      ;;
    bootstrap)
      check_bootstrap_status || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      ;;
    quick|boot)
      check_kaseki_root || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      ;;
    worker)
      # Worker container setup checks
      log_info "Checking worker container mounts..."
      check_packaged_agent_helpers || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      check_worker_mounts || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      check_results_writable || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      check_secret_paths || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      echo ""
      
      # LLM provider checks
      log_info "Checking primary LLM provider..."
      if [ "${KASEKI_PROVIDER:-gateway}" = "gateway" ]; then
        if check_gateway_worker_secret; then
          check_gateway_provider_capability || overall_exit=$(merge_startup_status "$overall_exit" "$?")
        else
          overall_exit=$(merge_startup_status "$overall_exit" "$?")
        fi
      else
        check_api_key || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      fi
      echo ""
      
      # Fallback provider validation
      log_info "Checking fallback LLM provider (OpenRouter)..."
      check_api_key || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      check_unused_secrets || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      echo ""
      
      # GitHub integration checks
      log_info "Checking GitHub integration..."
      check_github_app_secrets || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      check_github_app_secret_paths || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      ;;
    baseline-validation)
      check_kaseki_root || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      check_subdirectories || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      check_bootstrap_status || overall_exit=$(merge_startup_status "$overall_exit" "$?")
      check_secret_paths || overall_exit=$(merge_startup_status "$overall_exit" "$?")
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
