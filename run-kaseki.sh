#!/usr/bin/env bash
set -euo pipefail

ROOT="${KASEKI_ROOT:-/agents}"
RUNS="$ROOT/kaseki-runs"
RESULTS="$ROOT/kaseki-results"
IMAGE="${KASEKI_IMAGE:-docker.io/cyanautomation/kaseki-agent:0.1.0}"
KASEKI_CONTAINER_USER="${KASEKI_CONTAINER_USER:-$(id -u):$(id -g)}"
REPO_URL="${REPO_URL:-https://github.com/CyanAutomation/crudmapper}"
GIT_REF="${GIT_REF:-main}"
KASEKI_PROVIDER="${KASEKI_PROVIDER:-openrouter}"
KASEKI_MODEL="${KASEKI_MODEL:-openrouter/free}"
KASEKI_AGENT_TIMEOUT_SECONDS="${KASEKI_AGENT_TIMEOUT_SECONDS:-1200}"
KASEKI_VALIDATION_COMMANDS="${KASEKI_VALIDATION_COMMANDS:-npm run check;npm run test;npm run build}"
KASEKI_DEBUG_RAW_EVENTS="${KASEKI_DEBUG_RAW_EVENTS:-0}"
KASEKI_KEEP_WORKSPACE="${KASEKI_KEEP_WORKSPACE:-1}"
KASEKI_CHANGED_FILES_ALLOWLIST="${KASEKI_CHANGED_FILES_ALLOWLIST:-src/lib/parser.ts tests/parser.validation.ts}"
KASEKI_MAX_DIFF_BYTES="${KASEKI_MAX_DIFF_BYTES:-200000}"
TASK_PROMPT="${TASK_PROMPT:-Make normalizeRole treat a non-string Name fallback safely when FriendlyName is empty or missing. It should fall back to \"Unnamed Role\" instead of preserving arbitrary truthy non-string values. Add or update exactly one focused Vitest case, preferably a compact table-driven case, in tests/parser.validation.ts. Avoid repeated assertion blocks, assertion-message prose, and explanatory test comments. Do not print, inspect, or expose environment variables, secrets, credentials, or API keys. Keep changes limited to the source and test files needed for this fix.}"
HOST_SECRET_FILE="${OPENROUTER_API_KEY_FILE:-/run/secrets/openrouter_api_key}"

# GitHub App credentials (optional, for auto PR creation)
GITHUB_APP_ID="${GITHUB_APP_ID:-}"
GITHUB_APP_CLIENT_ID="${GITHUB_APP_CLIENT_ID:-}"
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
  KASEKI_VALIDATION_COMMANDS        Semicolon-separated validation cmds
  KASEKI_CHANGED_FILES_ALLOWLIST    Space-separated file patterns
  KASEKI_MAX_DIFF_BYTES             Max diff size in bytes (default: 200000)
  GITHUB_APP_ID                     GitHub App ID (optional, for PR creation)
  GITHUB_APP_CLIENT_ID              GitHub App Client ID (optional)
  GITHUB_APP_PRIVATE_KEY_FILE       Path to GitHub App private key PEM file (optional)
  GITHUB_APP_PRIVATE_KEY            GitHub App private key inline (optional, fallback)

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

  # Health check
  ./run-kaseki.sh --doctor
HELP
}

usage_error() {
  printf 'Error: %s\n\n' "$1" >&2
  show_help >&2
  exit 2
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
    # First argument could be: --doctor, --help, repo-url, or help
    if [ "$arg" = "--doctor" ]; then
      if [ "$#" -gt 1 ]; then
        usage_error "--doctor does not accept positional arguments"
      fi
      SHOW_DOCTOR="1"
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

doctor() {
  local status=0
  printf 'Kaseki doctor\n'
  printf 'Root: %s\n' "$ROOT"
  printf 'Image: %s\n' "$IMAGE"
  printf 'Container user: %s\n' "$KASEKI_CONTAINER_USER"

  if command -v docker >/dev/null 2>&1; then
    printf 'Docker: %s\n' "$(docker --version)"
  else
    printf 'Docker: missing\n' >&2
    status=1
  fi

  mkdir -p "$RUNS" "$RESULTS" 2>/dev/null || {
    printf 'Writable Kaseki directories: failed to create %s and %s\n' "$RUNS" "$RESULTS" >&2
    status=1
  }
  [ -w "$RUNS" ] && [ -w "$RESULTS" ] && printf 'Writable Kaseki directories: ok\n'

  if [ -n "${OPENROUTER_API_KEY:-}" ]; then
    printf 'OpenRouter API key: env\n'
  elif [ -r "$HOST_SECRET_FILE" ] && [ -s "$HOST_SECRET_FILE" ]; then
    printf 'OpenRouter API key: secret file (%s)\n' "$HOST_SECRET_FILE"
  else
    printf 'OpenRouter API key: missing\n' >&2
    status=1
  fi

  if docker image inspect "$IMAGE" >/dev/null 2>&1; then
    printf 'Docker image: present\n'
  else
    printf 'Docker image: missing locally (%s)\n' "$IMAGE" >&2
    status=1
  fi

  # Check GitHub App credentials (optional)
  github_app_ready=0
  if [ -n "$GITHUB_APP_ID" ] && [ -n "$GITHUB_APP_CLIENT_ID" ]; then
    if [ -r "$GITHUB_APP_PRIVATE_KEY_FILE" ] || [ -n "$GITHUB_APP_PRIVATE_KEY" ]; then
      printf 'GitHub App credentials: configured\n'
      github_app_ready=1
    fi
  fi
  if [ "$github_app_ready" -eq 0 ] && { [ -n "$GITHUB_APP_ID" ] || [ -n "$GITHUB_APP_CLIENT_ID" ] || [ -n "$GITHUB_APP_PRIVATE_KEY_FILE" ] || [ -n "$GITHUB_APP_PRIVATE_KEY" ]; }; then
    printf 'GitHub App credentials: incomplete (need APP_ID, CLIENT_ID, and PRIVATE_KEY or PRIVATE_KEY_FILE)\n' >&2
  fi

  return "$status"
}

if [ "${SHOW_DOCTOR:-0}" = "1" ]; then
  doctor
  exit "$?"
fi

# Use parsed CLI arguments, falling back to env vars if not provided via CLI
REPO_URL="$PARSED_REPO_URL"
GIT_REF="$PARSED_GIT_REF"

mkdir -p "$RUNS" "$RESULTS"

if [ -z "$INSTANCE" ]; then
  next=1
  while true; do
    candidate="kaseki-$next"
    if mkdir "$RUNS/$candidate" 2>/dev/null; then
      INSTANCE="$candidate"
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

RUN_DIR="$RUNS/$INSTANCE"
RESULT_DIR="$RESULTS/$INSTANCE"
WORKSPACE="$RUN_DIR/workspace"
SECRET_FILE="$RUN_DIR/openrouter_api_key"
GITHUB_APP_ID_FILE="$RUN_DIR/github_app_id"
GITHUB_APP_CLIENT_ID_FILE="$RUN_DIR/github_app_client_id"
GITHUB_APP_PRIVATE_KEY_MOUNTED_FILE="$RUN_DIR/github_app_private_key"

if [ -n "${INSTANCE:-}" ] && [ ! -d "$RUN_DIR" ]; then
  if ! mkdir "$RUN_DIR" 2>/dev/null; then
    if [ -d "$RUN_DIR" ]; then
      echo "Instance already reserved: $INSTANCE" >&2
      exit 2
    fi
    echo "Failed to reserve instance directory: $RUN_DIR" >&2
    exit 1
  fi
fi

cleanup_secret() {
  rm -f "$SECRET_FILE" "$GITHUB_APP_ID_FILE" "$GITHUB_APP_CLIENT_ID_FILE" "$GITHUB_APP_PRIVATE_KEY_MOUNTED_FILE"
}
trap cleanup_secret EXIT

mkdir -p "$WORKSPACE" "$RESULT_DIR"
chmod 0755 "$RUN_DIR" "$WORKSPACE" "$RESULT_DIR"

START_EPOCH="$(date +%s)"
MAX_DIFF_BYTES_VALUE="$(require_non_negative_int "KASEKI_MAX_DIFF_BYTES" "$KASEKI_MAX_DIFF_BYTES")"
AGENT_TIMEOUT_SECONDS_VALUE="$(require_non_negative_int "KASEKI_AGENT_TIMEOUT_SECONDS" "$KASEKI_AGENT_TIMEOUT_SECONDS")"
FAILURE_EXIT_CODE_VALUE="$(require_non_negative_int "exit_code" "2")"

cat > "$RESULT_DIR/host-start.json" <<META
{
  "instance": $(json_string "$INSTANCE"),
  "repo_url": $(json_string "$REPO_URL"),
  "git_ref": $(json_string "$GIT_REF"),
  "provider": $(json_string "$KASEKI_PROVIDER"),
  "model": $(json_string "$KASEKI_MODEL"),
  "container_user": $(json_string "$KASEKI_CONTAINER_USER"),
  "changed_files_allowlist": $(json_string "$KASEKI_CHANGED_FILES_ALLOWLIST"),
  "max_diff_bytes": $MAX_DIFF_BYTES_VALUE,
  "agentTimeoutSeconds": $AGENT_TIMEOUT_SECONDS_VALUE,
  "started_at": $(json_string "$(date -u +%Y-%m-%dT%H:%M:%SZ)"),
  "host": $(json_string "$(hostname)"),
  "image": $(json_string "$IMAGE")
}
META

if [ -n "${OPENROUTER_API_KEY:-}" ]; then
  key_source="env"
  key_value="$OPENROUTER_API_KEY"
elif [ -r "$HOST_SECRET_FILE" ]; then
  key_source="secret file"
  key_value="$(cat "$HOST_SECRET_FILE")"
else
  {
    printf 'OpenRouter API key is required. '
    printf 'Set OPENROUTER_API_KEY or provide a readable secret file at %s (override with OPENROUTER_API_KEY_FILE).\n' "$HOST_SECRET_FILE"
  } > "$RESULT_DIR/stderr.log"
  : > "$RESULT_DIR/stdout.log"
  : > "$RESULT_DIR/pi-events.jsonl"
  : > "$RESULT_DIR/git.status"
  : > "$RESULT_DIR/git.diff"
  : > "$RESULT_DIR/changed-files.txt"
  : > "$RESULT_DIR/validation.log"
  : > "$RESULT_DIR/validation-timings.tsv"
  : > "$RESULT_DIR/quality.log"
  : > "$RESULT_DIR/secret-scan.log"
  : > "$RESULT_DIR/git-push.log"
  printf '2\n' > "$RESULT_DIR/exit_code"
  printf '2\n' > "$RESULT_DIR/host_docker_exit_code"
  printf 'elapsed_seconds=0\n' > "$RESULT_DIR/resource.time"
  cat > "$RESULT_DIR/metadata.json" <<META
{
  "instance": $(json_string "$INSTANCE"),
  "repo_url": $(json_string "$REPO_URL"),
  "git_ref": $(json_string "$GIT_REF"),
  "provider": $(json_string "$KASEKI_PROVIDER"),
  "model": $(json_string "$KASEKI_MODEL"),
  "exit_code": $FAILURE_EXIT_CODE_VALUE,
  "failed_command": $(json_string "missing OPENROUTER_API_KEY")
}
META
  cat "$RESULT_DIR/stderr.log" >&2
  exit 2
fi

if [ -z "$key_value" ]; then
  printf 'OpenRouter API key source "%s" resolved to an empty value.\n' "$key_source" > "$RESULT_DIR/stderr.log"
  : > "$RESULT_DIR/stdout.log"
  : > "$RESULT_DIR/pi-events.jsonl"
  : > "$RESULT_DIR/git.status"
  : > "$RESULT_DIR/git.diff"
  : > "$RESULT_DIR/changed-files.txt"
  : > "$RESULT_DIR/validation.log"
  : > "$RESULT_DIR/validation-timings.tsv"
  : > "$RESULT_DIR/quality.log"
  : > "$RESULT_DIR/secret-scan.log"
  : > "$RESULT_DIR/git-push.log"
  printf '2\n' > "$RESULT_DIR/exit_code"
  printf '2\n' > "$RESULT_DIR/host_docker_exit_code"
  printf 'elapsed_seconds=0\n' > "$RESULT_DIR/resource.time"
  cat > "$RESULT_DIR/metadata.json" <<META
{
  "instance": $(json_string "$INSTANCE"),
  "repo_url": $(json_string "$REPO_URL"),
  "git_ref": $(json_string "$GIT_REF"),
  "provider": $(json_string "$KASEKI_PROVIDER"),
  "model": $(json_string "$KASEKI_MODEL"),
  "exit_code": $FAILURE_EXIT_CODE_VALUE,
  "failed_command": $(json_string "empty OpenRouter API key from ${key_source}")
}
META
  cat "$RESULT_DIR/stderr.log" >&2
  exit 2
fi

printf 'OpenRouter API key source: %s\n' "$key_source"
printf '%s' "$key_value" > "$SECRET_FILE"
chmod 0600 "$SECRET_FILE"
unset key_value key_source

# Handle GitHub App credentials (optional)
GITHUB_APP_ENABLED="0"
if [ -n "$GITHUB_APP_ID" ] && [ -n "$GITHUB_APP_CLIENT_ID" ]; then
  github_private_key_value=""
  if [ -n "$GITHUB_APP_PRIVATE_KEY_FILE" ] && [ -r "$GITHUB_APP_PRIVATE_KEY_FILE" ]; then
    github_private_key_value="$(cat "$GITHUB_APP_PRIVATE_KEY_FILE")"
  elif [ -n "$GITHUB_APP_PRIVATE_KEY" ]; then
    github_private_key_value="$GITHUB_APP_PRIVATE_KEY"
  fi

  if [ -n "$github_private_key_value" ]; then
    printf 'GitHub App credentials: configured\n'
    GITHUB_APP_ENABLED="1"
    printf '%s' "$GITHUB_APP_ID" > "$GITHUB_APP_ID_FILE"
    chmod 0600 "$GITHUB_APP_ID_FILE"
    printf '%s' "$GITHUB_APP_CLIENT_ID" > "$GITHUB_APP_CLIENT_ID_FILE"
    chmod 0600 "$GITHUB_APP_CLIENT_ID_FILE"
    printf '%s' "$github_private_key_value" > "$GITHUB_APP_PRIVATE_KEY_MOUNTED_FILE"
    chmod 0600 "$GITHUB_APP_PRIVATE_KEY_MOUNTED_FILE"
    unset github_private_key_value
  fi
fi
unset GITHUB_APP_PRIVATE_KEY

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
  -e KASEKI_VALIDATION_COMMANDS="$KASEKI_VALIDATION_COMMANDS"
  -e KASEKI_DEBUG_RAW_EVENTS="$KASEKI_DEBUG_RAW_EVENTS"
  -e KASEKI_CHANGED_FILES_ALLOWLIST="$KASEKI_CHANGED_FILES_ALLOWLIST"
  -e KASEKI_MAX_DIFF_BYTES="$KASEKI_MAX_DIFF_BYTES"
  -e TASK_PROMPT="$TASK_PROMPT"
  -e GITHUB_APP_ENABLED="$GITHUB_APP_ENABLED"
  -e TMPDIR="/workspace/tmp"
  -e NPM_CONFIG_CACHE="/workspace/npm-cache"
  -e npm_config_cache="/workspace/npm-cache"
  -v "$WORKSPACE:/workspace:rw"
  -v "$RESULT_DIR:/results:rw"
  -v "$SECRET_FILE:/run/secrets/openrouter_api_key:ro"
)
if [ "$GITHUB_APP_ENABLED" = "1" ]; then
  docker_args+=(
    -v "$GITHUB_APP_ID_FILE:/run/secrets/github_app_id:ro"
    -v "$GITHUB_APP_CLIENT_ID_FILE:/run/secrets/github_app_client_id:ro"
    -v "$GITHUB_APP_PRIVATE_KEY_MOUNTED_FILE:/run/secrets/github_app_private_key:ro"
  )
fi
docker_args+=(
  -w /workspace
  "$IMAGE"
)

set +e
docker "${docker_args[@]}"
DOCKER_EXIT="$?"
set -e
cleanup_secret

END_EPOCH="$(date +%s)"
printf 'elapsed_seconds=%s\n' "$((END_EPOCH - START_EPOCH))" > "$RESULT_DIR/resource.time"
printf '%s\n' "$DOCKER_EXIT" > "$RESULT_DIR/host_docker_exit_code"

if [ "$DOCKER_EXIT" -eq 0 ] && [ "$KASEKI_KEEP_WORKSPACE" != "1" ]; then
  rm -rf "$WORKSPACE"
fi

printf '%s\n' "$INSTANCE"
printf 'run_dir=%s\n' "$RUN_DIR"
printf 'result_dir=%s\n' "$RESULT_DIR"
exit "$DOCKER_EXIT"
