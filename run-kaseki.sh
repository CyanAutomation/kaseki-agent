#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${KASEKI_ROOT:-/agents}"
RUNS="$ROOT/kaseki-runs"
RESULTS="$ROOT/kaseki-results"
CACHE="${KASEKI_CACHE_DIR:-$ROOT/kaseki-cache}"
if [ -n "${KASEKI_IMAGE:-}" ]; then
  IMAGE="$KASEKI_IMAGE"
elif [ -r "$SCRIPT_DIR/.kaseki-image" ]; then
  IMAGE="$(cat "$SCRIPT_DIR/.kaseki-image")"
else
  IMAGE="docker.io/cyanautomation/kaseki-agent:latest"
fi
KASEKI_CONTAINER_USER="${KASEKI_CONTAINER_USER:-$(id -u):$(id -g)}"
REPO_URL="${REPO_URL:-https://github.com/CyanAutomation/crudmapper}"
GIT_REF="${GIT_REF:-main}"
KASEKI_PROVIDER="${KASEKI_PROVIDER:-openrouter}"
KASEKI_MODEL="${KASEKI_MODEL:-openrouter/free}"
KASEKI_AGENT_TIMEOUT_SECONDS="${KASEKI_AGENT_TIMEOUT_SECONDS:-1200}"
KASEKI_VALIDATION_COMMANDS="${KASEKI_VALIDATION_COMMANDS-npm run check;npm run test;npm run build}"
KASEKI_PRE_AGENT_VALIDATION="${KASEKI_PRE_AGENT_VALIDATION:-1}"
KASEKI_PRE_AGENT_VALIDATION_COMMANDS="${KASEKI_PRE_AGENT_VALIDATION_COMMANDS-$KASEKI_VALIDATION_COMMANDS}"
KASEKI_DEBUG_RAW_EVENTS="${KASEKI_DEBUG_RAW_EVENTS:-0}"
KASEKI_KEEP_WORKSPACE="${KASEKI_KEEP_WORKSPACE:-0}"
KASEKI_STREAM_PROGRESS="${KASEKI_STREAM_PROGRESS:-1}"
KASEKI_VALIDATE_AFTER_AGENT_FAILURE="${KASEKI_VALIDATE_AFTER_AGENT_FAILURE:-0}"
KASEKI_VALIDATION_FAIL_FAST="${KASEKI_VALIDATION_FAIL_FAST:-1}"
KASEKI_STRICT_SCRIPT_CHECK="${KASEKI_STRICT_SCRIPT_CHECK:-0}"
KASEKI_PUBLISH_MODE="${KASEKI_PUBLISH_MODE:-auto}"
KASEKI_AGENT_GUARDRAILS="${KASEKI_AGENT_GUARDRAILS:-1}"
KASEKI_RESTORE_DISALLOWED_CHANGES="${KASEKI_RESTORE_DISALLOWED_CHANGES:-1}"
KASEKI_TASK_MODE="${KASEKI_TASK_MODE:-patch}"
KASEKI_ALLOW_EMPTY_DIFF="${KASEKI_ALLOW_EMPTY_DIFF:-0}"
KASEKI_VERIFY_OPENROUTER_AUTH="${KASEKI_VERIFY_OPENROUTER_AUTH:-0}"
KASEKI_DOCTOR_REQUIRE_OPENROUTER_KEY="${KASEKI_DOCTOR_REQUIRE_OPENROUTER_KEY:-1}"
KASEKI_DRY_RUN="${KASEKI_DRY_RUN:-0}"
KASEKI_STARTUP_CHECK_MODE="${KASEKI_STARTUP_CHECK_MODE:-boot}"
KASEKI_BASELINE_VALIDATION_DRY_RUN="${KASEKI_BASELINE_VALIDATION_DRY_RUN:-0}"
KASEKI_CHANGED_FILES_ALLOWLIST="${KASEKI_CHANGED_FILES_ALLOWLIST:-src/lib/parser.ts tests/parser.validation.ts}"
KASEKI_VALIDATION_ALLOWLIST="${KASEKI_VALIDATION_ALLOWLIST:-}"
KASEKI_MAX_DIFF_BYTES="${KASEKI_MAX_DIFF_BYTES:-200000}"
KASEKI_NPM_OMIT_DEV="${KASEKI_NPM_OMIT_DEV:-0}"
TASK_PROMPT="${TASK_PROMPT:-Make normalizeRole treat a non-string Name fallback safely when FriendlyName is empty or missing. It should fall back to \"Unnamed Role\" instead of preserving arbitrary truthy non-string values. Add or update exactly one compact table-driven Vitest case in tests/parser.validation.ts, with a neutral static test title and no per-case assertion messages or explanatory comments. Do not add broad repeated test blocks. Do not print, inspect, or expose environment variables, secrets, credentials, or API keys. Keep changes limited to the source and test files needed for this fix.}"
HOST_SECRET_FILE="${OPENROUTER_API_KEY_FILE:-${HOME}/.kaseki/secrets.json}"
KASEKI_LOG_DIR="${KASEKI_LOG_DIR:-/var/log/kaseki}"
KASEKI_STRICT_HOST_LOGGING="${KASEKI_STRICT_HOST_LOGGING:-0}"
KASEKI_APPEND_METRICS_JSONL="${KASEKI_APPEND_METRICS_JSONL:-1}"
KASEKI_METRICS_JSONL_PATH="${KASEKI_METRICS_JSONL_PATH:-/var/log/kaseki/metrics.jsonl}"
INSTANCE="${INSTANCE:-}"
KASEKI_JSON_LOG_COMPONENT="run-kaseki"

json_escape() {
  local value="${1-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

emit_json_log() {
  local stage="$1"
  local status="$2"
  local detail="${3-}"
  local now instance_value
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  instance_value="${INSTANCE:-pending}"
  printf '{"timestamp":"%s","component":"%s","stage":"%s","status":"%s","instance":"%s","detail":"%s"}\n' \
    "$now" \
    "$KASEKI_JSON_LOG_COMPONENT" \
    "$(json_escape "$stage")" \
    "$(json_escape "$status")" \
    "$(json_escape "$instance_value")" \
    "$(json_escape "$detail")"
}

emit_json_log "run" "started" "run-kaseki.sh starting"


run_preflight() {
  local mode="$1"
  local preflight_script
  preflight_script="$SCRIPT_DIR/scripts/kaseki-preflight.sh"
  if [ ! -x "$preflight_script" ]; then
    printf 'Error: preflight script not found or not executable: %s\n' "$preflight_script" >&2
    exit 1
  fi
  "$preflight_script" "$mode"
}

setup_host_logging() {
  local instance_for_log="$1"
  local stamp host_log_file
  if mkdir -p "$KASEKI_LOG_DIR" 2>/dev/null && [ -w "$KASEKI_LOG_DIR" ]; then
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    host_log_file="$KASEKI_LOG_DIR/run-kaseki-${instance_for_log:-session}-${stamp}.log"
    exec > >(tee -a "$host_log_file") 2> >(tee -a "$host_log_file" >&2)
    printf 'Host log mirror: %s\n' "$host_log_file"
    return 0
  fi
  if [ "$KASEKI_STRICT_HOST_LOGGING" = "1" ]; then
    printf 'Error: strict host logging enabled, but KASEKI_LOG_DIR is not writable: %s\n' "$KASEKI_LOG_DIR" >&2
    exit 1
  fi
  printf 'Warning: host logging disabled; KASEKI_LOG_DIR is unavailable: %s\n' "$KASEKI_LOG_DIR" >&2
}

read_secret_value() {
  local inline_value="$1"
  local file_path="$2"
  if [ -n "$inline_value" ]; then
    printf '%s' "$inline_value"
    return 0
  fi
  if [ -n "$file_path" ] && [ -r "$file_path" ]; then
    sed -e '1{s/^\xef\xbb\xbf//}' "$file_path" | sed -e "\${s/[[:space:]]*$//;}"
    return 0
  fi
  return 1
}


private_key_metadata_json() {
  local key_file="$1"
  local byte_count first_pem_header_line pem_footer_present sha256_fingerprint
  byte_count="$(wc -c < "$key_file" | awk '{print $1}')"
  first_pem_header_line="$(grep -aoE -- '-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----' "$key_file" | sed -n '1p')"
  if grep -aoEq -- '-----END [A-Z0-9 ]*PRIVATE KEY-----' "$key_file"; then
    pem_footer_present="true"
  else
    pem_footer_present="false"
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256_fingerprint="$(sha256sum "$key_file" | awk '{print $1}')"
  else
    sha256_fingerprint="$(shasum -a 256 "$key_file" | awk '{print $1}')"
  fi
  cat <<META
{
  "byte_count": $byte_count,
  "first_pem_header_line": $(json_string "$first_pem_header_line"),
  "pem_footer_present": $pem_footer_present,
  "sha256_fingerprint": $(json_string "$sha256_fingerprint")
}
META
}

write_private_key_metadata_diagnostics() {
  local key_file="$1"
  local metadata_file="$RESULT_DIR/github-app-private-key-metadata.json"
  private_key_metadata_json "$key_file" > "$metadata_file"
  printf 'GitHub App private key metadata: %s\n' "$(tr -d '\n' < "$metadata_file")" | tee -a "$RESULT_DIR/progress.log"
}

normalize_private_key_pem() {
  if ! command -v node >/dev/null 2>&1; then
    cat
    return 0
  fi
  # shellcheck disable=SC2016
  node -e 'const fs = require('"'"'node:fs'"'"');
let value = fs.readFileSync(0, '"'"'utf8'"'"').trim();
if (!value) process.exit(0);
value = value.replace(/\\n/g, '"'"'\n'"'"');
const match = value.match(/-----BEGIN ([A-Z ]*PRIVATE KEY)-----([\\s\\S]*?)-----END \\1-----/);
if (!match) {
  process.stdout.write(value);
  if (!value.endsWith('"'"'\n'"'"')) process.stdout.write('"'"'\n'"'"');
  process.exit(0);
}
const body = match[2].replace(/\s+/g, '"'"''"'"');
const lines = body.match(/.{1,64}/g) || [];
process.stdout.write(`-----BEGIN ${match[1]}-----\n${lines.join('"'"'\n'"'"')}\n-----END ${match[1]}-----\n`);'
}

resolve_github_credentials() {
  # Attempt to resolve GitHub App credentials from multiple sources
  # Priority: env vars → secret files → auto-detect locations
  # Returns: 0 if all 3 found, 1 if partial, 2 if none
  local app_id_val app_client_val app_key_val
  local auto_detect_paths=(
    "$HOME/.ssh/github-app-private-key"
    "$PWD/.github-app-secrets/private-key"
    "/etc/kaseki-secrets/github_app_private_key"
  )
  
  # Try environment variables first (highest priority)
  app_id_val="$(read_secret_value "$GITHUB_APP_ID" "$GITHUB_APP_ID_INPUT_FILE" 2>/dev/null || true)"
  app_client_val="$(read_secret_value "$GITHUB_APP_CLIENT_ID" "$GITHUB_APP_CLIENT_ID_INPUT_FILE" 2>/dev/null || true)"
  
  # For private key, check env var first, then auto-detect paths
  app_key_val=""
  if [ -n "$GITHUB_APP_PRIVATE_KEY" ]; then
    app_key_val="$GITHUB_APP_PRIVATE_KEY"
  elif [ -n "$GITHUB_APP_PRIVATE_KEY_FILE" ] && [ -r "$GITHUB_APP_PRIVATE_KEY_FILE" ]; then
    app_key_val="$(cat "$GITHUB_APP_PRIVATE_KEY_FILE" 2>/dev/null || true)"
  else
    # Auto-detect from standard locations
    for path in "${auto_detect_paths[@]}"; do
      if [ -r "$path" ]; then
        app_key_val="$(cat "$path" 2>/dev/null || true)"
        [ -n "$app_key_val" ] && printf 'GitHub App: detected private key at %s\n' "$path" >&2 && break
      fi
    done
  fi
  
  # Count how many credentials we found
  local count=0
  [ -n "$app_id_val" ] && ((count++))
  [ -n "$app_client_val" ] && ((count++))
  [ -n "$app_key_val" ] && ((count++))
  
  # Log warnings for missing credentials (non-fatal)
  [ -z "$app_id_val" ] && printf 'GitHub App: missing GITHUB_APP_ID\n' >&2
  [ -z "$app_client_val" ] && printf 'GitHub App: missing GITHUB_APP_CLIENT_ID\n' >&2
  [ -z "$app_key_val" ] && printf 'GitHub App: missing or unreadable private key\n' >&2
  
  # Return status based on how many credentials found
  [ "$count" -eq 3 ] && return 0
  [ "$count" -gt 0 ] && return 1
  return 2
}

# GitHub App credentials (optional, for auto PR creation)
GITHUB_APP_ID="${GITHUB_APP_ID:-}"
GITHUB_APP_ID_FILE="${GITHUB_APP_ID_FILE:-}"
GITHUB_APP_ID_INPUT_FILE="$GITHUB_APP_ID_FILE"
GITHUB_APP_CLIENT_ID="${GITHUB_APP_CLIENT_ID:-}"
GITHUB_APP_CLIENT_ID_FILE="${GITHUB_APP_CLIENT_ID_FILE:-}"
GITHUB_APP_CLIENT_ID_INPUT_FILE="$GITHUB_APP_CLIENT_ID_FILE"
GITHUB_APP_PRIVATE_KEY_FILE="${GITHUB_APP_PRIVATE_KEY_FILE:-}"
GITHUB_APP_PRIVATE_KEY="${GITHUB_APP_PRIVATE_KEY:-}"

# ============================================================================
# Argument Parsing
# ============================================================================

show_help() {
  cat << 'HELP'
kaseki-agent - Ephemeral coding-agent runner with Docker isolation

USAGE:
  ./run-kaseki.sh [<repo-url> [<git-ref> [<instance-name>]]]
  ./run-kaseki.sh --doctor
  ./run-kaseki.sh --help

ARGUMENTS:
  <repo-url>      Git repository URL (e.g., https://github.com/org/repo)
                  Supports GitHub, GitLab, Bitbucket, and self-hosted servers
                  Default: https://github.com/CyanAutomation/crudmapper
  <git-ref>       Git reference: branch, tag, or commit (default: main)
  <instance-name> Kaseki instance name (must match kaseki-N pattern)
                  Auto-generated if not provided

OPTIONS:
  --doctor        Run health check and exit
  --help, -h      Show this help message

ENVIRONMENT VARIABLES (override defaults, CLI args take precedence):
  REPO_URL                          Repository URL
  GIT_REF                           Git reference
  OPENROUTER_API_KEY                OpenRouter API key (or use OPENROUTER_API_KEY_FILE)
  OPENROUTER_API_KEY_FILE           Path to file containing API key
  KASEKI_MODEL                      AI model (default: openrouter/free)
  KASEKI_AGENT_TIMEOUT_SECONDS      Timeout in seconds (default: 1200)
  KASEKI_PRE_AGENT_VALIDATION       Run baseline validation before Pi (default: 1)
  KASEKI_PRE_AGENT_VALIDATION_COMMANDS
                                    Semicolon-separated pre-agent validation cmds
  KASEKI_VALIDATION_COMMANDS        Semicolon-separated post-agent validation cmds
  KASEKI_STARTUP_CHECK_MODE          boot or baseline-validation for dry-run startup checks
  KASEKI_STREAM_PROGRESS            Stream sanitized progress lines (default: 1)
  KASEKI_KEEP_WORKSPACE             Keep per-run workspace after exit (default: 0)
  KASEKI_VALIDATE_AFTER_AGENT_FAILURE
                                    Run validation even when the agent fails (default: 0)
  KASEKI_AGENT_GUARDRAILS          Prepend safety instructions to the agent prompt (default: 1)
  KASEKI_RESTORE_DISALLOWED_CHANGES
                                    Restore changes outside the allowlist before validation (default: 1)
  KASEKI_TASK_MODE                  patch or inspect (inspect allows empty diffs)
  KASEKI_ALLOW_EMPTY_DIFF           Treat no-change runs as success when 1 (default: 0)
  KASEKI_VERIFY_OPENROUTER_AUTH     In --doctor, verify key with OpenRouter when 1
  KASEKI_CACHE_DIR                  Persistent host cache directory (default: /agents/kaseki-cache)
  KASEKI_CHANGED_FILES_ALLOWLIST    Space-separated file patterns (agent phase)
  KASEKI_VALIDATION_ALLOWLIST       Space-separated file patterns (validation phase; optional)
  KASEKI_MAX_DIFF_BYTES             Max diff size in bytes (default: 200000)
  KASEKI_NPM_OMIT_DEV              Set to 1 to omit dev dependencies during npm ci (default: 0)
  GITHUB_APP_ID                     GitHub App ID (optional, for PR creation)
  GITHUB_APP_ID_FILE                Path to file containing GitHub App ID
  GITHUB_APP_CLIENT_ID              GitHub App Client ID (optional)
  GITHUB_APP_CLIENT_ID_FILE         Path to file containing GitHub App Client ID
  GITHUB_APP_PRIVATE_KEY_FILE       Path to GitHub App private key PEM file (preferred)
  GITHUB_APP_PRIVATE_KEY            GitHub App private key inline (fallback; avoid for production)

EXAMPLES:
  # All defaults
  ./run-kaseki.sh

  # Custom repo, auto instance
  ./run-kaseki.sh https://github.com/org/myrepo

  # Custom repo and ref
  ./run-kaseki.sh https://github.com/org/myrepo feature/branch

  # Explicit instance name
  ./run-kaseki.sh https://github.com/org/myrepo main kaseki-42

  # Via environment variables (legacy)
  REPO_URL=https://... GIT_REF=main ./run-kaseki.sh

  # Boot-only startup check (no repo clone/dependency install/agent execution)
  ./run-kaseki.sh --dry-run
  KASEKI_DRY_RUN=1 ./run-kaseki.sh

  # Baseline validation startup check (clone, install, run pre-agent validation, skip Pi)
  KASEKI_DRY_RUN=1 KASEKI_STARTUP_CHECK_MODE=baseline-validation ./run-kaseki.sh

  # Health check
  ./run-kaseki.sh --doctor
HELP
}

usage_error() {
  printf 'Error: %s\n\n' "$1" >&2
  show_help >&2
  exit 2
}

fail_host() {
  local code="$1"
  local category="$2"
  local detail="${3-}"
  
  # Log the error
  emit_json_log "preflight" "error" "Host-side validation failed: $category - $detail"
  
  # Print human-readable error
  {
    printf '❌ Host Validation Failed\n'
    printf 'Category: %s\n' "$category"
    printf 'Detail: %s\n' "$detail"
    printf '\nRemediation: Check bootstrap status with: scripts/kaseki-activate.sh status\n'
  } >&2
  
  exit "$code"
}

json_encode() {
  local value
  value="$(cat)"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\b'/\\b}"
  value="${value//$'\f'/\\f}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '"%s"' "$value"
}

json_string() {
  printf '%s' "$1" | json_encode
}

file_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    return 1
  fi
}

require_non_negative_int() {
  local name="$1"
  local value="$2"
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    printf 'Error: %s must be a non-negative integer, got: %s\n' "$name" "$value" >&2
    exit 2
  fi
  printf '%s' "$value"
}

is_git_url() {
  local str="$1"
  # URLs must start with http(s):// and contain at least one /
  # Supports GitHub, GitLab, Bitbucket, and self-hosted Git servers
  [[ "$str" =~ ^https?:// ]] && [[ "$str" == */* ]]
}

is_instance_name() {
  local str="$1"
  [[ "$str" =~ ^kaseki-[0-9]+$ ]]
}

# Parse command-line arguments
PARSED_REPO_URL="${REPO_URL:-https://github.com/CyanAutomation/crudmapper}"
PARSED_GIT_REF="${GIT_REF:-main}"
INSTANCE=""

# Argument index tracker
arg_idx=0

for arg in "$@"; do
  if [ $arg_idx -eq 0 ]; then
    # First argument could be: --doctor, --help, --dry-run, repo-url, or help
    if [ "$arg" = "--doctor" ]; then
      if [ "$#" -gt 1 ]; then
        usage_error "--doctor does not accept positional arguments"
      fi
      SHOW_DOCTOR="1"
      arg_idx=$((arg_idx + 1))
      continue
    elif [ "$arg" = "--dry-run" ]; then
      if [ "$#" -gt 1 ]; then
        usage_error "--dry-run does not accept positional arguments"
      fi
      KASEKI_DRY_RUN="1"
      arg_idx=$((arg_idx + 1))
      continue
    elif [ "$arg" = "--help" ] || [ "$arg" = "-h" ]; then
      show_help
      exit 0
    elif is_git_url "$arg"; then
      PARSED_REPO_URL="$arg"
      arg_idx=$((arg_idx + 1))
    elif is_instance_name "$arg"; then
      # Edge case: passed instance name as first arg without repo
      INSTANCE="$arg"
      arg_idx=$((arg_idx + 1))
    elif [[ "$arg" == -* ]]; then
      usage_error "unknown option: $arg"
    else
      # Could be short ref like "main" without repo URL
      PARSED_GIT_REF="$arg"
      arg_idx=$((arg_idx + 1))
    fi
  elif [ $arg_idx -eq 1 ]; then
    # Second argument: git-ref or instance-name
    if is_instance_name "$arg"; then
      INSTANCE="$arg"
    else
      PARSED_GIT_REF="$arg"
    fi
    arg_idx=$((arg_idx + 1))
  elif [ $arg_idx -eq 2 ]; then
    # Third argument: instance-name
    if is_instance_name "$arg"; then
      INSTANCE="$arg"
    else
      usage_error "third argument must be an instance name matching kaseki-N, got: $arg"
    fi
    arg_idx=$((arg_idx + 1))
  else
    usage_error "too many positional arguments"
  fi
done

if [ "${SHOW_DOCTOR:-0}" = "1" ]; then
  INSTANCE=""
fi

case "$KASEKI_STARTUP_CHECK_MODE" in
  boot|baseline-validation)
    ;;
  *)
    usage_error "KASEKI_STARTUP_CHECK_MODE must be boot or baseline-validation, got: $KASEKI_STARTUP_CHECK_MODE"
    ;;
esac

if [ "$KASEKI_STARTUP_CHECK_MODE" = "baseline-validation" ]; then
  KASEKI_BASELINE_VALIDATION_DRY_RUN="1"
fi

if [ "${SHOW_DOCTOR:-0}" != "1" ]; then
  run_preflight run
fi

if [ "${SHOW_DOCTOR:-0}" = "1" ]; then
  INSTANCE=""
fi

setup_host_logging "${INSTANCE:-session}"

doctor() {
  local status=0
  local image_present=0
  local openrouter_key_source=""
  local openrouter_key_value=""
  printf 'Kaseki doctor\n'
  printf 'Root: %s\n' "$ROOT"
  printf 'Image: %s\n' "$IMAGE"
  printf 'Cache: %s\n' "$CACHE"
  printf 'Container user: %s\n' "$KASEKI_CONTAINER_USER"

  if run_preflight doctor; then
    :
  else
    status=1
  fi

  if command -v docker >/dev/null 2>&1; then
    printf 'Docker: %s\n' "$(docker --version)"
  else
    printf 'Docker: missing\n' >&2
    status=1
  fi

  mkdir -p "$RUNS" "$RESULTS" "$CACHE" 2>/dev/null || {
    printf 'Writable Kaseki directories: failed to create %s, %s, and %s\n' "$RUNS" "$RESULTS" "$CACHE" >&2
    status=1
  }
  [ -w "$RUNS" ] && [ -w "$RESULTS" ] && [ -w "$CACHE" ] && printf 'Writable Kaseki directories: ok\n'

  if [ -n "${OPENROUTER_API_KEY:-}" ]; then
    printf 'OpenRouter API key: env\n'
    openrouter_key_source="env"
    openrouter_key_value="$OPENROUTER_API_KEY"
  elif [ -r "$HOST_SECRET_FILE" ] && [ -s "$HOST_SECRET_FILE" ]; then
    printf 'OpenRouter API key: secret file (%s)\n' "$HOST_SECRET_FILE"
    openrouter_key_source="secret file"
    openrouter_key_value="$(cat "$HOST_SECRET_FILE")"
  else
    printf 'OpenRouter API key: missing\n' >&2
    if [ "$KASEKI_DOCTOR_REQUIRE_OPENROUTER_KEY" = "1" ]; then
      status=1
    else
      printf 'OpenRouter API key: warning only for doctor (KASEKI_DOCTOR_REQUIRE_OPENROUTER_KEY=0)\n' >&2
    fi
  fi

  if [ "$KASEKI_VERIFY_OPENROUTER_AUTH" = "1" ]; then
    if [ -z "$openrouter_key_value" ]; then
      printf 'OpenRouter API key auth: skipped (missing key)\n' >&2
    elif command -v curl >/dev/null 2>&1; then
      if curl -fsS -H "Authorization: Bearer $openrouter_key_value" https://openrouter.ai/api/v1/auth/key >/dev/null 2>&1; then
        printf 'OpenRouter API key auth: ok (%s)\n' "$openrouter_key_source"
      else
        printf 'OpenRouter API key auth: failed (%s)\n' "$openrouter_key_source" >&2
        status=1
      fi
    elif command -v wget >/dev/null 2>&1; then
      if wget -qO- --header="Authorization: Bearer $openrouter_key_value" https://openrouter.ai/api/v1/auth/key >/dev/null 2>&1; then
        printf 'OpenRouter API key auth: ok (%s)\n' "$openrouter_key_source"
      else
        printf 'OpenRouter API key auth: failed (%s)\n' "$openrouter_key_source" >&2
        status=1
      fi
    else
      printf 'OpenRouter API key auth: skipped (curl or wget required)\n' >&2
      status=1
    fi
  fi
  unset openrouter_key_value

  local docker_image_error=""
  if docker image inspect "$IMAGE" >/dev/null 2>&1; then
    printf 'Docker image: present\n'
    image_present=1
  else
    docker_image_error="$(docker image inspect "$IMAGE" 2>&1 >/dev/null || true)"
    if printf '%s' "$docker_image_error" | grep -qi 'permission denied'; then
      printf 'Docker image: unavailable because Docker socket permission was denied (%s)\n' "$IMAGE" >&2
    elif printf '%s' "$docker_image_error" | grep -Eqi 'cannot connect|is the docker daemon running'; then
      printf 'Docker image: unavailable because Docker daemon is unreachable (%s)\n' "$IMAGE" >&2
    else
      printf 'Docker image: missing locally (%s)\n' "$IMAGE" >&2
    fi
    status=1
  fi

  if [ "$image_present" -eq 1 ]; then
    local mismatch=0
    local missing_host_template=0
    local pairs
    if docker run --rm --entrypoint test "$IMAGE" -f /app/run-kaseki.sh >/dev/null 2>&1; then
      printf 'Docker image template payload: ok\n'
    else
      printf 'Docker image template payload: missing /app/run-kaseki.sh; deploy will need a local rebuild or a newer image.\n' >&2
      status=1
    fi
    pairs='kaseki-agent.sh:/usr/local/bin/kaseki-agent lib/pi-event-filter.js:/usr/local/bin/kaseki-pi-event-filter lib/pi-progress-stream.js:/usr/local/bin/kaseki-pi-progress-stream lib/kaseki-report.js:/usr/local/bin/kaseki-report lib/github-app-token.js:/usr/local/bin/github-app-token'
    for pair in $pairs; do
      local host_file="${pair%%:*}"
      local image_file="${pair#*:}"
      local host_path="$SCRIPT_DIR/$host_file"
      local host_sum image_sum
      if [ ! -f "$host_path" ]; then
        printf 'Image/template parity: missing host file %s\n' "$host_file" >&2
        mismatch=1
        missing_host_template=1
        continue
      fi
      host_sum="$(file_sha256 "$host_path" || true)"
      image_sum="$(docker run --rm --entrypoint sha256sum "$IMAGE" "$image_file" 2>/dev/null | awk '{print $1}' || true)"
      if [ -z "$host_sum" ] || [ -z "$image_sum" ] || [ "$host_sum" != "$image_sum" ]; then
        printf 'Image/template parity: mismatch for %s vs %s\n' "$host_file" "$image_file" >&2
        mismatch=1
      fi
    done
    if [ "$mismatch" -eq 0 ]; then
      printf 'Image/template parity: ok\n'
    elif [ "$missing_host_template" -eq 1 ]; then
      status=1
      printf 'Image/template parity: missing deployed template files; this looks like a source checkout or incomplete template.\n' >&2
      printf 'Image/template parity: deploy from the source checkout with: sudo KASEKI_IMAGE_PULL_POLICY=missing ./scripts/deploy-pi-template.sh\n' >&2
      printf 'Image/template parity: then run: /agents/kaseki-template/run-kaseki.sh --doctor\n' >&2
    else
      status=1
      printf 'Image/template parity: mismatch; rebuild/pull the image or set KASEKI_IMAGE to the matching local image.\n' >&2
    fi
  fi

  # Check GitHub App credentials (optional)
  github_app_ready=0
  github_app_id_value="$(read_secret_value "$GITHUB_APP_ID" "$GITHUB_APP_ID_INPUT_FILE" 2>/dev/null || true)"
  github_app_client_id_value="$(read_secret_value "$GITHUB_APP_CLIENT_ID" "$GITHUB_APP_CLIENT_ID_INPUT_FILE" 2>/dev/null || true)"
  if [ -n "$github_app_id_value" ] && [ -n "$github_app_client_id_value" ]; then
    if [ -r "$GITHUB_APP_PRIVATE_KEY_FILE" ] || [ -n "$GITHUB_APP_PRIVATE_KEY" ]; then
      printf 'GitHub App credentials: configured\n'
      github_app_ready=1
    fi
  fi
  if [ "$github_app_ready" -eq 0 ] && { [ -n "$GITHUB_APP_ID" ] || [ -n "$GITHUB_APP_ID_FILE" ] || [ -n "$GITHUB_APP_CLIENT_ID" ] || [ -n "$GITHUB_APP_CLIENT_ID_FILE" ] || [ -n "$GITHUB_APP_PRIVATE_KEY_FILE" ] || [ -n "$GITHUB_APP_PRIVATE_KEY" ]; }; then
    printf 'GitHub App credentials: incomplete (need APP_ID or APP_ID_FILE, CLIENT_ID or CLIENT_ID_FILE, and PRIVATE_KEY_FILE or PRIVATE_KEY)\n' >&2
  fi
  unset github_app_id_value github_app_client_id_value

  return "$status"
}

if [ "${SHOW_DOCTOR:-0}" = "1" ]; then
  doctor
  exit "$?"
fi

# Use parsed CLI arguments, falling back to env vars if not provided via CLI
REPO_URL="$PARSED_REPO_URL"
GIT_REF="$PARSED_GIT_REF"

mkdir -p "$RUNS" "$RESULTS" "$CACHE"

INSTANCE_AUTO_RESERVED=0
if [ -z "$INSTANCE" ]; then
  next=1
  while true; do
    candidate="kaseki-$next"
    if [ -d "$RESULTS/$candidate" ]; then
      next=$((next + 1))
      continue
    fi
    if mkdir "$RUNS/$candidate" 2>/dev/null; then
      INSTANCE="$candidate"
      INSTANCE_AUTO_RESERVED=1
      break
    fi
    if [ -d "$RUNS/$candidate" ]; then
      next=$((next + 1))
      continue
    fi
    echo "Failed to reserve instance directory: $RUNS/$candidate" >&2
    exit 1
  done
fi

case "$INSTANCE" in
  kaseki-[0-9]*) ;;
  *) echo "Instance must look like kaseki-N, got: $INSTANCE" >&2; exit 2 ;;
esac

FINAL_RUN_DIR="$RUNS/$INSTANCE"
FINAL_RESULT_DIR="$RESULTS/$INSTANCE"
RUN_STAGE_DIR="$(mktemp -d "$RUNS/.staging-run-${INSTANCE}-XXXXXX")"
RESULT_STAGE_DIR="$(mktemp -d "$RESULTS/.staging-result-${INSTANCE}-XXXXXX")"
RUN_DIR="$RUN_STAGE_DIR"
RESULT_DIR="$RESULT_STAGE_DIR"
WORKSPACE="$RUN_DIR/workspace"
SECRET_FILE="$RUN_DIR/openrouter_api_key"
GITHUB_APP_ID_FILE="$RUN_DIR/github_app_id"
GITHUB_APP_CLIENT_ID_FILE="$RUN_DIR/github_app_client_id"
GITHUB_APP_PRIVATE_KEY_MOUNTED_FILE="$RUN_DIR/github_app_private_key"
PROMOTED_RESULT_DIR=0
PROMOTED_RUN_DIR=0

if [ -d "$FINAL_RESULT_DIR" ]; then
  echo "Result directory already exists for $INSTANCE: $FINAL_RESULT_DIR" >&2
  echo "Choose a new instance name; Kaseki does not overwrite prior results." >&2
  exit 2
fi

if [ "$INSTANCE_AUTO_RESERVED" -eq 0 ] && [ -n "${INSTANCE:-}" ] && [ -d "$FINAL_RUN_DIR" ]; then
  echo "Instance already reserved: $INSTANCE" >&2
  exit 2
fi

# shellcheck disable=SC2317,SC2329
# Invoked via trap in the unified exit handler.
cleanup_secret() {
  rm -f "$SECRET_FILE" "$GITHUB_APP_ID_FILE" "$GITHUB_APP_CLIENT_ID_FILE" "$GITHUB_APP_PRIVATE_KEY_MOUNTED_FILE"
}
# shellcheck disable=SC2317,SC2329
# Invoked via trap in the unified exit handler.
cleanup_staging_dirs() {
  [ "$PROMOTED_RESULT_DIR" -eq 1 ] || rm -rf "$RESULT_STAGE_DIR"
  [ "$PROMOTED_RUN_DIR" -eq 1 ] || rm -rf "$RUN_STAGE_DIR"
}
# shellcheck disable=SC2317,SC2329
# Invoked via trap on process exit/signals.
unified_exit_handler() {
  local code=$?
  if [ "$code" -eq 0 ]; then
    emit_json_log "run" "finished" "run-kaseki.sh completed successfully"
  else
    emit_json_log "run" "error" "run-kaseki.sh exited with code $code"
  fi
  cleanup_secret
  cleanup_staging_dirs
}
trap unified_exit_handler EXIT INT TERM HUP

mkdir -p "$WORKSPACE" "$RESULT_DIR" "$CACHE"
chmod 0755 "$RUN_DIR" "$WORKSPACE" "$RESULT_DIR" "$CACHE"

START_EPOCH="$(date +%s)"
MAX_DIFF_BYTES_VALUE="$(require_non_negative_int "KASEKI_MAX_DIFF_BYTES" "$KASEKI_MAX_DIFF_BYTES")"
AGENT_TIMEOUT_SECONDS_VALUE="$(require_non_negative_int "KASEKI_AGENT_TIMEOUT_SECONDS" "$KASEKI_AGENT_TIMEOUT_SECONDS")"
FAILURE_EXIT_CODE_VALUE="$(require_non_negative_int "exit_code" "2")"
HOST_EXIT_CODE_FILE="$RESULT_DIR/host_exit_code"

initialize_result_artifacts() {
  : > "$RESULT_DIR/stdout.log"
  : > "$RESULT_DIR/stderr.log"
  : > "$RESULT_DIR/pi-events.jsonl"
  : > "$RESULT_DIR/pi-summary.json"
  : > "$RESULT_DIR/git.status"
  : > "$RESULT_DIR/git.diff"
  : > "$RESULT_DIR/changed-files.txt"
  : > "$RESULT_DIR/pre-validation.log"
  : > "$RESULT_DIR/pre-validation-raw.log"
  : > "$RESULT_DIR/pre-validation-env.log"
  : > "$RESULT_DIR/pre-validation-timings.tsv"
  : > "$RESULT_DIR/validation.log"
  : > "$RESULT_DIR/validation-raw.log"
  : > "$RESULT_DIR/validation-env.log"
  : > "$RESULT_DIR/validation-timings.tsv"
  : > "$RESULT_DIR/stage-timings.tsv"
  : > "$RESULT_DIR/dependency-cache.log"
  : > "$RESULT_DIR/quality.log"
  : > "$RESULT_DIR/secret-scan.log"
  : > "$RESULT_DIR/git-push.log"
  : > "$RESULT_DIR/progress.log"
  : > "$RESULT_DIR/progress.jsonl"
  : > "$RESULT_DIR/format-check-command.txt"
  : > "$RESULT_DIR/failure.json"
  : > "$RESULT_DIR/result-summary.md"
  : > "$HOST_EXIT_CODE_FILE"
}

persist_host_status() {
  local exit_code="$1"
  # Keep host-side status deterministic even when container startup fails.
  printf '%s\n' "$exit_code" > "$HOST_EXIT_CODE_FILE"
}

write_failure_json() {
  local exit_code="$1"
  local failed_command="$2"
  local message="$3"
  local stderr_tail
  stderr_tail="$(tail -20 "$RESULT_DIR/stderr.log" 2>/dev/null || true)"
  cat > "$RESULT_DIR/failure.json" <<META
{
  "instance": $(json_string "$INSTANCE"),
  "exit_code": $exit_code,
  "failed_command": $(json_string "$failed_command"),
  "message": $(json_string "$message"),
  "stderr_tail": $(json_string "$stderr_tail"),
  "artifacts_dir": $(json_string "$RESULT_DIR"),
  "metadata": "metadata.json",
  "stderr": "stderr.log",
  "stdout": "stdout.log",
  "progress": "progress.jsonl",
  "summary": "result-summary.md"
}
META
}

write_host_metadata_failure() {
  local exit_code="$1"
  local failed_command="$2"
  local message="$3"
  printf '%s\n' "$exit_code" > "$RESULT_DIR/exit_code"
  printf '%s\n' "$exit_code" > "$RESULT_DIR/host_docker_exit_code"
  persist_host_status "$exit_code"
  printf 'elapsed_seconds=0\n' > "$RESULT_DIR/resource.time"
  cat > "$RESULT_DIR/metadata.json" <<META
{
  "instance": $(json_string "$INSTANCE"),
  "repo_url": $(json_string "$REPO_URL"),
  "git_ref": $(json_string "$GIT_REF"),
  "provider": $(json_string "$KASEKI_PROVIDER"),
  "model": $(json_string "$KASEKI_MODEL"),
  "started_at": $(json_string "$(date -u +%Y-%m-%dT%H:%M:%SZ)"),
  "current_stage": $(json_string "$failed_command"),
  "duration_seconds": 0,
  "total_duration_seconds": 0,
  "pi_duration_seconds": 0,
  "exit_code": $exit_code,
  "failed_command": $(json_string "$failed_command")
}
META
  cat > "$RESULT_DIR/result-summary.md" <<SUMMARY
# Kaseki Result: $INSTANCE

- Status: failed
- Failed command: $failed_command
- Message: $message
- Artifacts: $RESULT_DIR
SUMMARY
  write_failure_json "$exit_code" "$failed_command" "$message"
}

write_worker_failure_artifacts_if_missing() {
  local exit_code="$1"
  local message stderr_tail stdout_tail

  if [ "$exit_code" -eq 0 ]; then
    return 0
  fi
  if [ -s "$RESULT_DIR/failure.json" ] || [ -s "$RESULT_DIR/metadata.json" ]; then
    return 0
  fi

  stderr_tail="$(tail -20 "$RESULT_DIR/stderr.log" 2>/dev/null || true)"
  stdout_tail="$(tail -20 "$RESULT_DIR/stdout.log" 2>/dev/null || true)"
  if [ -n "$stderr_tail" ]; then
    message="Worker container exited with code $exit_code. Stderr tail: $stderr_tail"
  elif [ -n "$stdout_tail" ]; then
    message="Worker container exited with code $exit_code. Stdout tail: $stdout_tail"
  else
    message="Worker container exited with code $exit_code before writing diagnostic artifacts."
  fi

  write_host_metadata_failure "$exit_code" "worker container startup" "$message"
}

record_host_stage_timing() {
  local stage="$1"
  local exit_code="$2"
  local duration_seconds="${3:-0}"
  local detail="${4:-}"
  printf '%s\t%s\t%s\t%s\n' "$stage" "$exit_code" "$duration_seconds" "$detail" >> "$RESULT_DIR/stage-timings.tsv"
}

fail_before_container() {
  local exit_code="$1"
  local failed_command="$2"
  local message="$3"
  printf '%s\n' "$message" > "$RESULT_DIR/stderr.log"
  write_host_metadata_failure "$exit_code" "$failed_command" "$message"
  record_host_stage_timing "$failed_command" "$exit_code" 0 "$message"
  write_cleanup_log
  promote_staging_dirs
  cat "$RESULT_DIR/stderr.log" >&2
  exit "$exit_code"
}

write_cleanup_log() {
  {
    printf 'cleanup_started_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'keep_workspace=%s\n' "$KASEKI_KEEP_WORKSPACE"
    if [ "$KASEKI_KEEP_WORKSPACE" != "1" ]; then
      rm -rf "$WORKSPACE"
      printf 'workspace_removed=true\n'
    else
      printf 'workspace_removed=false\n'
    fi
    if command -v docker >/dev/null 2>&1; then
      printf '%s\n' 'docker_system_df_after_run:'
      docker system df 2>&1 || true
    fi
    printf 'cleanup_finished_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$RESULT_DIR/cleanup.log"

  if [ "$KASEKI_KEEP_WORKSPACE" != "1" ]; then
    rmdir "$RUN_DIR" 2>/dev/null || true
  fi
}

promote_staging_dirs() {
  mkdir -p "$RUNS" "$RESULTS"
  if [ "$PROMOTED_RESULT_DIR" -eq 0 ]; then
    mv "$RESULT_STAGE_DIR" "$FINAL_RESULT_DIR"
    RESULT_DIR="$FINAL_RESULT_DIR"
    HOST_EXIT_CODE_FILE="$RESULT_DIR/host_exit_code"
    PROMOTED_RESULT_DIR=1
  fi
  if [ "$KASEKI_KEEP_WORKSPACE" = "1" ] && [ "$PROMOTED_RUN_DIR" -eq 0 ]; then
    mv "$RUN_STAGE_DIR" "$FINAL_RUN_DIR"
    RUN_DIR="$FINAL_RUN_DIR"
    WORKSPACE="$RUN_DIR/workspace"
    PROMOTED_RUN_DIR=1
  fi
}

initialize_result_artifacts

cat > "$RESULT_DIR/host-start.json" <<META
{
  "instance": $(json_string "$INSTANCE"),
  "repo_url": $(json_string "$REPO_URL"),
  "git_ref": $(json_string "$GIT_REF"),
  "provider": $(json_string "$KASEKI_PROVIDER"),
  "model": $(json_string "$KASEKI_MODEL"),
  "task_mode": $(json_string "$KASEKI_TASK_MODE"),
  "allow_empty_diff": $(json_string "$KASEKI_ALLOW_EMPTY_DIFF"),
  "dry_run": $(json_string "$KASEKI_DRY_RUN"),
  "startup_check_mode": $(json_string "$KASEKI_STARTUP_CHECK_MODE"),
  "container_user": $(json_string "$KASEKI_CONTAINER_USER"),
  "changed_files_allowlist": $(json_string "$KASEKI_CHANGED_FILES_ALLOWLIST"),
  "max_diff_bytes": $MAX_DIFF_BYTES_VALUE,
  "agentTimeoutSeconds": $AGENT_TIMEOUT_SECONDS_VALUE,
  "started_at": $(json_string "$(date -u +%Y-%m-%dT%H:%M:%SZ)"),
  "host": $(json_string "$(hostname)"),
  "image": $(json_string "$IMAGE"),
  "cache_dir": $(json_string "$CACHE")
}
META

if [ -n "${OPENROUTER_API_KEY:-}" ]; then
  key_source="env"
  key_value="$OPENROUTER_API_KEY"
elif [ -r "$HOST_SECRET_FILE" ]; then
  key_source="secret file"
  key_value="$(cat "$HOST_SECRET_FILE")"
else
  fail_before_container "$FAILURE_EXIT_CODE_VALUE" "missing OPENROUTER_API_KEY" "OpenRouter API key is required. Set OPENROUTER_API_KEY or provide a readable secret file at $HOST_SECRET_FILE (override with OPENROUTER_API_KEY_FILE)."
fi

if [ -z "$key_value" ]; then
  fail_before_container "$FAILURE_EXIT_CODE_VALUE" "empty OpenRouter API key from ${key_source}" "OpenRouter API key source \"$key_source\" resolved to an empty value."
fi

printf 'OpenRouter API key source: %s\n' "$key_source"
printf '%s' "$key_value" > "$SECRET_FILE"
chmod 0600 "$SECRET_FILE"
unset key_value key_source

if ! command -v docker >/dev/null 2>&1; then
  fail_before_container "$FAILURE_EXIT_CODE_VALUE" "preflight docker" "Docker is required but was not found on the host."
fi

docker_image_error="$(docker image inspect "$IMAGE" 2>&1 >/dev/null || true)"
if [ -n "$docker_image_error" ]; then
  if printf '%s' "$docker_image_error" | grep -qi 'permission denied'; then
    fail_before_container "$FAILURE_EXIT_CODE_VALUE" "preflight docker socket" "Docker socket permission denied while inspecting $IMAGE. Add the API container user to the host Docker socket group, for example group_add with DOCKER_GID."
  elif printf '%s' "$docker_image_error" | grep -Eqi 'cannot connect|is the docker daemon running'; then
    fail_before_container "$FAILURE_EXIT_CODE_VALUE" "preflight docker daemon" "Docker daemon is unreachable while inspecting $IMAGE. Verify /var/run/docker.sock is mounted and the host daemon is running."
  else
    fail_before_container "$FAILURE_EXIT_CODE_VALUE" "preflight docker image" "Docker image is missing locally: $IMAGE. Pull it or set KASEKI_IMAGE to an available image."
  fi
fi

if command -v git >/dev/null 2>&1; then
  preflight_start="$(date +%s)"
  if ! git ls-remote --exit-code "$REPO_URL" "$GIT_REF" >"$RESULT_DIR/preflight-git.log" 2>&1; then
    message="Git ref preflight failed for $REPO_URL at $GIT_REF. The repository or ref may not exist, may be private, or may be unreachable. See preflight-git.log."
    {
      printf '%s\n' "$message"
      cat "$RESULT_DIR/preflight-git.log"
    } > "$RESULT_DIR/stderr.log"
    write_host_metadata_failure 128 "preflight git ref" "$message"
    record_host_stage_timing "preflight git ref" 128 "$(($(date +%s) - preflight_start))" "$message"
    write_cleanup_log
    promote_staging_dirs
    cat "$RESULT_DIR/stderr.log" >&2
    exit 128
  fi
  record_host_stage_timing "preflight git ref" 0 "$(($(date +%s) - preflight_start))" "ok"
else
  printf 'Git: missing on host; skipping git ref preflight.\n' >> "$RESULT_DIR/progress.log"
fi

# Handle GitHub App credentials (optional) - enabled by default if available
GITHUB_APP_ENABLED="${GITHUB_APP_ENABLED:-1}"
case "$KASEKI_PUBLISH_MODE" in
  auto|none|branch|pr|draft_pr) ;;
  *)
    fail_host 2 "invalid publish mode" "Invalid KASEKI_PUBLISH_MODE: $KASEKI_PUBLISH_MODE (expected auto, none, branch, pr, or draft_pr)"
    ;;
esac

# Attempt to resolve credentials (will auto-detect if not provided)
if resolve_github_credentials; then
  # All 3 credentials found
  github_app_id_value="$(read_secret_value "$GITHUB_APP_ID" "$GITHUB_APP_ID_INPUT_FILE" 2>/dev/null || true)"
  github_app_client_id_value="$(read_secret_value "$GITHUB_APP_CLIENT_ID" "$GITHUB_APP_CLIENT_ID_INPUT_FILE" 2>/dev/null || true)"
  github_private_key_value=""
  if [ -n "$GITHUB_APP_PRIVATE_KEY_FILE" ] && [ -r "$GITHUB_APP_PRIVATE_KEY_FILE" ]; then
    github_private_key_value="$(cat "$GITHUB_APP_PRIVATE_KEY_FILE" 2>/dev/null || true)"
  elif [ -n "$GITHUB_APP_PRIVATE_KEY" ]; then
    github_private_key_value="$GITHUB_APP_PRIVATE_KEY"
  else
    # Auto-detect from standard locations
    for path in "$HOME/.ssh/github-app-private-key" "$PWD/.github-app-secrets/private-key" "/etc/kaseki-secrets/github_app_private_key"; do
      if [ -r "$path" ]; then
        github_private_key_value="$(cat "$path" 2>/dev/null || true)"
        [ -n "$github_private_key_value" ] && break
      fi
    done
  fi
  
  if [ -n "$github_private_key_value" ] && [ "$KASEKI_PUBLISH_MODE" != "none" ]; then
    printf 'GitHub App credentials: configured (auto-detected or provided)\n'
    GITHUB_APP_ENABLED="1"
    printf '%s\n' "$github_app_id_value" > "$GITHUB_APP_ID_FILE"
    chmod 0600 "$GITHUB_APP_ID_FILE"
    printf '%s\n' "$github_app_client_id_value" > "$GITHUB_APP_CLIENT_ID_FILE"
    chmod 0600 "$GITHUB_APP_CLIENT_ID_FILE"
    printf '%s' "$github_private_key_value" | normalize_private_key_pem > "$GITHUB_APP_PRIVATE_KEY_MOUNTED_FILE"
    chmod 0600 "$GITHUB_APP_PRIVATE_KEY_MOUNTED_FILE"
    write_private_key_metadata_diagnostics "$GITHUB_APP_PRIVATE_KEY_MOUNTED_FILE"
    unset github_private_key_value
  else
    # Credentials not complete or publish mode is none
    if [ "$KASEKI_PUBLISH_MODE" = "auto" ] || [ "$KASEKI_PUBLISH_MODE" = "none" ]; then
      printf 'GitHub App credentials: not available, disabling GitHub operations (graceful degrade)\n'
    fi
    GITHUB_APP_ENABLED="0"
  fi
else
  # No credentials found or only partial
  if [ "$KASEKI_PUBLISH_MODE" = "auto" ] || [ "$KASEKI_PUBLISH_MODE" = "none" ]; then
    printf 'GitHub App credentials: not found, disabling GitHub operations (graceful degrade)\n'
  fi
  GITHUB_APP_ENABLED="0"
fi
unset GITHUB_APP_PRIVATE_KEY github_app_id_value github_app_client_id_value

if { [ "$KASEKI_PUBLISH_MODE" = "branch" ] || [ "$KASEKI_PUBLISH_MODE" = "pr" ] || [ "$KASEKI_PUBLISH_MODE" = "draft_pr" ]; } && [ "$GITHUB_APP_ENABLED" != "1" ]; then
  fail_host 7 "github app credentials" "KASEKI_PUBLISH_MODE=$KASEKI_PUBLISH_MODE requires readable GitHub App credentials."
fi

prepare_worker_paths() {
  if [ "$(id -u)" -ne 0 ]; then
    return 0
  fi

  chown -R "$KASEKI_CONTAINER_USER" "$RUN_DIR" "$RESULT_DIR"
  for secret_path in "$SECRET_FILE" "$GITHUB_APP_ID_FILE" "$GITHUB_APP_CLIENT_ID_FILE" "$GITHUB_APP_PRIVATE_KEY_MOUNTED_FILE"; do
    if [ -f "$secret_path" ]; then
      chown "$KASEKI_CONTAINER_USER" "$secret_path"
    fi
  done
}

prepare_worker_paths

docker_args=(
  run --rm
  --name "$INSTANCE"
  --read-only
  --tmpfs "/tmp:rw,nosuid,nodev,size=256m"
  --security-opt no-new-privileges:true
  --cap-drop ALL
  -u "$KASEKI_CONTAINER_USER"
  -e KASEKI_INSTANCE="$INSTANCE"
  -e REPO_URL="$REPO_URL"
  -e GIT_REF="$GIT_REF"
  -e KASEKI_PROVIDER="$KASEKI_PROVIDER"
  -e KASEKI_MODEL="$KASEKI_MODEL"
  -e KASEKI_AGENT_TIMEOUT_SECONDS="$KASEKI_AGENT_TIMEOUT_SECONDS"
  -e KASEKI_PRE_AGENT_VALIDATION="$KASEKI_PRE_AGENT_VALIDATION"
  -e KASEKI_PRE_AGENT_VALIDATION_COMMANDS="$KASEKI_PRE_AGENT_VALIDATION_COMMANDS"
  -e KASEKI_VALIDATION_COMMANDS="$KASEKI_VALIDATION_COMMANDS"
  -e KASEKI_DEBUG_RAW_EVENTS="$KASEKI_DEBUG_RAW_EVENTS"
  -e KASEKI_TASK_MODE="$KASEKI_TASK_MODE"
  -e KASEKI_ALLOW_EMPTY_DIFF="$KASEKI_ALLOW_EMPTY_DIFF"
  -e KASEKI_CHANGED_FILES_ALLOWLIST="$KASEKI_CHANGED_FILES_ALLOWLIST"
  -e KASEKI_VALIDATION_ALLOWLIST="$KASEKI_VALIDATION_ALLOWLIST"
  -e KASEKI_MAX_DIFF_BYTES="$KASEKI_MAX_DIFF_BYTES"
  -e KASEKI_AGENT_GUARDRAILS="$KASEKI_AGENT_GUARDRAILS"
  -e KASEKI_RESTORE_DISALLOWED_CHANGES="$KASEKI_RESTORE_DISALLOWED_CHANGES"
  -e KASEKI_NPM_OMIT_DEV="$KASEKI_NPM_OMIT_DEV"
  -e KASEKI_DRY_RUN="$KASEKI_DRY_RUN"
  -e KASEKI_STARTUP_CHECK_MODE="worker"
  -e KASEKI_REQUESTED_STARTUP_CHECK_MODE="$KASEKI_STARTUP_CHECK_MODE"
  -e KASEKI_BASELINE_VALIDATION_DRY_RUN="$KASEKI_BASELINE_VALIDATION_DRY_RUN"
  -e KASEKI_LOG_DIR="/results"
  -e TASK_PROMPT="$TASK_PROMPT"
  -e GITHUB_APP_ENABLED="$GITHUB_APP_ENABLED"
  -e KASEKI_PUBLISH_MODE="$KASEKI_PUBLISH_MODE"
  -e KASEKI_STREAM_PROGRESS="$KASEKI_STREAM_PROGRESS"
  -e KASEKI_VALIDATE_AFTER_AGENT_FAILURE="$KASEKI_VALIDATE_AFTER_AGENT_FAILURE"
  -e KASEKI_VALIDATION_FAIL_FAST="$KASEKI_VALIDATION_FAIL_FAST"
  -e KASEKI_STRICT_SCRIPT_CHECK="$KASEKI_STRICT_SCRIPT_CHECK"
  -e KASEKI_DEPENDENCY_CACHE_DIR="/cache/dependencies"
  -e TMPDIR="/workspace/tmp"
  -e NPM_CONFIG_CACHE="/cache/npm-cache"
  -e npm_config_cache="/cache/npm-cache"
  -e OPENROUTER_API_KEY_FILE="/agents/secrets/openrouter_api_key"
  -v "$WORKSPACE:/workspace:rw"
  -v "$CACHE:/cache:rw"
  -v "$RESULT_DIR:/results:rw"
  -v "$SECRET_FILE:/agents/secrets/openrouter_api_key:ro"
)
if [ "$GITHUB_APP_ENABLED" = "1" ]; then
  docker_args+=(
    -v "$GITHUB_APP_ID_FILE:/run/secrets/github_app_id:ro"
    -v "$GITHUB_APP_CLIENT_ID_FILE:/run/secrets/github_app_client_id:ro"
    -v "$GITHUB_APP_PRIVATE_KEY_MOUNTED_FILE:/run/secrets/github_app_private_key:ro"
  )
fi
if [ "$KASEKI_DRY_RUN" = "1" ] && [ "$KASEKI_STARTUP_CHECK_MODE" != "baseline-validation" ]; then
  docker_args+=(--entrypoint /bin/bash)
fi
docker_args+=(
  -w /workspace
  "$IMAGE"
)
if [ "$KASEKI_DRY_RUN" = "1" ] && [ "$KASEKI_STARTUP_CHECK_MODE" != "baseline-validation" ]; then
  docker_args+=(
    -lc
    'set -euo pipefail
printf "[progress] startup check: container booted\n"
node --version
git --version
pi_version="$(pi --version 2>&1)" || {
  printf "pi version check failed: %s\n" "$pi_version" >&2
  exit 1
}
test -r /run/secrets/openrouter_api_key
test -w /workspace
test -w /results
test -w /cache
printf "startup_check=ok\n" > /results/startup-check.txt
cat > /results/metadata.json <<META
{
  "startupCheck": true,
  "startup_check": true,
  "dryRun": true,
  "dry_run": "1",
  "exit_code": 0,
  "current_stage": "startup check",
  "node_version": "$(node --version)",
  "git_version": "$(git --version)",
  "pi_version": "$pi_version"
}
META
cat > /results/result-summary.md <<SUMMARY
# Kaseki Startup Check

- Status: passed
- Container booted: yes
- OpenRouter secret mounted: yes
- Workspace writable: yes
- Results writable: yes
- Cache writable: yes
SUMMARY
printf "[progress] startup check: completed\n"'
  )
fi

set +e
docker "${docker_args[@]}" > >(tee -a "$RESULT_DIR/stdout.log") 2> >(tee -a "$RESULT_DIR/stderr.log" >&2)
DOCKER_EXIT="$?"
set -e

END_EPOCH="$(date +%s)"
printf 'elapsed_seconds=%s\n' "$((END_EPOCH - START_EPOCH))" > "$RESULT_DIR/resource.time"
printf '%s\n' "$DOCKER_EXIT" > "$RESULT_DIR/host_docker_exit_code"
persist_host_status "$DOCKER_EXIT"
write_worker_failure_artifacts_if_missing "$DOCKER_EXIT"

write_cleanup_log
promote_staging_dirs

METRICS_SCRIPT="$SCRIPT_DIR/scripts/kaseki-metrics.sh"
if [ -x "$METRICS_SCRIPT" ] && [ -f "$RESULT_DIR/stage-timings.tsv" ] && [ -f "$RESULT_DIR/metadata.json" ]; then
  if "$METRICS_SCRIPT" "$RESULT_DIR/stage-timings.tsv" "$RESULT_DIR/metadata.json" "$RESULT_DIR/metrics.json" >/dev/null 2>&1; then
    if [ "$KASEKI_APPEND_METRICS_JSONL" = "1" ]; then
      mkdir -p "$(dirname "$KASEKI_METRICS_JSONL_PATH")" 2>/dev/null || true
      if [ -w "$(dirname "$KASEKI_METRICS_JSONL_PATH")" ] || [ -w "$KASEKI_METRICS_JSONL_PATH" ]; then
        "$METRICS_SCRIPT" "$RESULT_DIR/stage-timings.tsv" "$RESULT_DIR/metadata.json" >> "$KASEKI_METRICS_JSONL_PATH" 2>/dev/null || true
      fi
    fi
  else
    printf 'Warning: metrics generation failed for %s\n' "$RESULT_DIR" >&2
  fi
fi

printf '%s\n' "$INSTANCE"
if [ "$KASEKI_KEEP_WORKSPACE" = "1" ]; then
  printf 'run_dir=%s\n' "$FINAL_RUN_DIR"
else
  printf 'run_dir=%s\n' "$FINAL_RUN_DIR (removed)"
fi
printf 'result_dir=%s\n' "$FINAL_RESULT_DIR"
exit "$DOCKER_EXIT"
