#!/usr/bin/env bash
# NOTE: This script intentionally avoids global `set -e` so each stage can
# record status/timing artifacts before deciding whether to stop.
set -uo pipefail

INSTANCE_NAME="${KASEKI_INSTANCE:-kaseki-unknown}"
REPO_URL="${REPO_URL:-https://github.com/CyanAutomation/crudmapper}"
GIT_REF="${GIT_REF:-main}"
KASEKI_PROVIDER="${KASEKI_PROVIDER:-openrouter}"
KASEKI_MODEL="${KASEKI_MODEL:-openrouter/free}"
KASEKI_DRY_RUN="${KASEKI_DRY_RUN:-0}"
KASEKI_STARTUP_CHECK_MODE="${KASEKI_STARTUP_CHECK_MODE:-boot}"
KASEKI_BASELINE_VALIDATION_DRY_RUN="${KASEKI_BASELINE_VALIDATION_DRY_RUN:-0}"
KASEKI_AGENT_TIMEOUT_SECONDS="${KASEKI_AGENT_TIMEOUT_SECONDS:-10800}"
KASEKI_VALIDATION_COMMANDS="${KASEKI_VALIDATION_COMMANDS-npm run check;npm run test}"
KASEKI_SKIP_MISSING_NPM_SCRIPTS="${KASEKI_SKIP_MISSING_NPM_SCRIPTS:-1}"
KASEKI_DEBUG_RAW_EVENTS="${KASEKI_DEBUG_RAW_EVENTS:-0}"
KASEKI_STREAM_PROGRESS="${KASEKI_STREAM_PROGRESS:-1}"
KASEKI_RESULTS_DIR="${KASEKI_RESULTS_DIR:-/results}"
KASEKI_VALIDATE_AFTER_AGENT_FAILURE="${KASEKI_VALIDATE_AFTER_AGENT_FAILURE:-0}"
KASEKI_PRE_AGENT_VALIDATION="${KASEKI_PRE_AGENT_VALIDATION:-1}"
KASEKI_PRE_AGENT_VALIDATION_COMMANDS="${KASEKI_PRE_AGENT_VALIDATION_COMMANDS-$KASEKI_VALIDATION_COMMANDS}"
KASEKI_SCOUTING="${KASEKI_SCOUTING:-1}"
KASEKI_SCOUTING_MODEL="${KASEKI_SCOUTING_MODEL:-$KASEKI_MODEL}"
KASEKI_SCOUTING_TIMEOUT_SECONDS="${KASEKI_SCOUTING_TIMEOUT_SECONDS:-$KASEKI_AGENT_TIMEOUT_SECONDS}"
KASEKI_GOAL_CHECK="${KASEKI_GOAL_CHECK:-$KASEKI_SCOUTING}"
KASEKI_GOAL_CHECK_MAX_RETRIES="${KASEKI_GOAL_CHECK_MAX_RETRIES:-1}"
KASEKI_GOAL_CHECK_MODEL="${KASEKI_GOAL_CHECK_MODEL:-$KASEKI_SCOUTING_MODEL}"
KASEKI_GOAL_CHECK_TIMEOUT_SECONDS="${KASEKI_GOAL_CHECK_TIMEOUT_SECONDS:-$KASEKI_SCOUTING_TIMEOUT_SECONDS}"
KASEKI_TASK_MODE="${KASEKI_TASK_MODE:-patch}"
KASEKI_ALLOW_EMPTY_DIFF="${KASEKI_ALLOW_EMPTY_DIFF:-0}"
KASEKI_CHANGED_FILES_ALLOWLIST="${KASEKI_CHANGED_FILES_ALLOWLIST:-src/lib/parser.ts tests/parser.validation.ts}"
KASEKI_VALIDATION_ALLOWLIST="${KASEKI_VALIDATION_ALLOWLIST:-}"
KASEKI_MAX_DIFF_BYTES="${KASEKI_MAX_DIFF_BYTES:-400000}"
KASEKI_REPO_MEMORY_MODE="${KASEKI_REPO_MEMORY_MODE:-off}"
KASEKI_REPO_MEMORY_TTL_DAYS="${KASEKI_REPO_MEMORY_TTL_DAYS:-30}"
KASEKI_REPO_MEMORY_MAX_BYTES="${KASEKI_REPO_MEMORY_MAX_BYTES:-8000}"
KASEKI_REPO_MEMORY_ROOT="${KASEKI_REPO_MEMORY_ROOT:-/cache/repo-memory}"
TASK_PROMPT="${TASK_PROMPT:-Make normalizeRole treat a non-string Name fallback safely when FriendlyName is empty or missing. It should fall back to \"Unnamed Role\" instead of preserving arbitrary truthy non-string values. Add or update exactly one compact table-driven Vitest case in tests/parser.validation.ts, with a neutral static test title and no per-case assertion messages or explanatory comments. Do not add broad repeated test blocks. Do not print, inspect, or expose environment variables, secrets, credentials, or API keys. Keep changes limited to the source and test files needed for this fix.}"
KASEKI_AGENT_GUARDRAILS="${KASEKI_AGENT_GUARDRAILS:-1}"
KASEKI_RESTORE_DISALLOWED_CHANGES="${KASEKI_RESTORE_DISALLOWED_CHANGES:-1}"
KASEKI_VALIDATION_FAIL_FAST="${KASEKI_VALIDATION_FAIL_FAST:-1}"
KASEKI_STRICT_SCRIPT_CHECK="${KASEKI_STRICT_SCRIPT_CHECK:-0}"
GITHUB_APP_ENABLED="${GITHUB_APP_ENABLED:-1}"
KASEKI_ALLOW_LOCAL_DEV_SECRET_FALLBACK="${KASEKI_ALLOW_LOCAL_DEV_SECRET_FALLBACK:-0}"
KASEKI_PUBLISH_MODE="${KASEKI_PUBLISH_MODE:-pr}"
KASEKI_GITHUB_PR_RETRIES="${KASEKI_GITHUB_PR_RETRIES:-3}"
KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK="${KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK:-1}"
START_EPOCH="$(date +%s)"
START_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
CURRENT_STAGE="initializing"
PI_START_EPOCH=0
PI_DURATION_SECONDS=0
PI_VERSION=""
STATUS=0
FAILED_COMMAND=""
PI_EXIT=0
SCOUTING_EXIT=0
SCOUTING_DURATION_SECONDS=0
SCOUTING_ACTUAL_MODEL="unknown"
GOAL_CHECK_EXIT=0
GOAL_CHECK_DURATION_SECONDS=0
GOAL_CHECK_ATTEMPTS=0
GOAL_CHECK_MET=false
GOAL_CHECK_FAILURE_REASON=""
GOAL_CHECK_RETRY_PROMPT=""
GOAL_CHECK_ACTUAL_MODEL="unknown"
VALIDATION_EXIT=0
VALIDATION_FAILED_COMMAND_DETAIL=""
VALIDATION_FAILURE_REASON=""
VALIDATION_STOPPED_EARLY=false
VALIDATION_COMMANDS_ATTEMPTED=0
PRE_VALIDATION_EXIT=0
PRE_VALIDATION_FAILED_COMMAND_DETAIL=""
PRE_VALIDATION_FAILURE_REASON=""
PRE_VALIDATION_STOPPED_EARLY=false
PRE_VALIDATION_COMMANDS_ATTEMPTED=0
FILTER_STDERR_TAIL=""
FILTER_STDERR_FILE="/tmp/kaseki-filter-stderr.log"
VALIDATION_RAW_LOG="/results/validation-raw.log"
PRE_VALIDATION_RAW_LOG="/results/pre-validation-raw.log"
FILTER_DIAGNOSTICS_LOG="/results/filter-diagnostics.log"
VALIDATION_ENV_LOG="/results/validation-env.log"
PRE_VALIDATION_ENV_LOG="/results/pre-validation-env.log"
DIFF_NONEMPTY=false
QUALITY_EXIT=0
QUALITY_FAILURE_REASON=""
SECRET_SCAN_EXIT=0
GITHUB_PUSH_EXIT=0
GITHUB_PR_EXIT=0
GITHUB_API_ERROR_TYPE=""
GITHUB_API_ERROR_MESSAGE=""
GITHUB_API_HTTP_STATUS=""
GITHUB_OPERATION_PHASE=""
ACTUAL_MODEL="unknown"
GITHUB_PR_URL=""
GITHUB_SKIP_REASONS=()
VALIDATION_TIMINGS_FILE="/results/validation-timings.tsv"
PRE_VALIDATION_TIMINGS_FILE="/results/pre-validation-timings.tsv"
STAGE_TIMINGS_FILE="/results/stage-timings.tsv"
DEPENDENCY_CACHE_LOG="/results/dependency-cache.log"
RAW_EVENTS="/tmp/pi-events.raw.jsonl"
SCOUTING_RAW_EVENTS="/tmp/pi-scouting-events.raw.jsonl"
GOAL_CHECK_RAW_EVENTS="/tmp/pi-goal-check-events.raw.jsonl"
SCOUTING_ARTIFACT="/results/scouting.json"
SCOUTING_CANDIDATE_ARTIFACT="/results/scouting-candidate.json"
GOAL_CHECK_CANDIDATE_ARTIFACT="/results/goal-check-candidate.json"
KASEKI_DEPENDENCY_CACHE_DIR="${KASEKI_DEPENDENCY_CACHE_DIR:-/workspace/.kaseki-cache}"
KASEKI_DEPENDENCY_RESTORE_MODE="${KASEKI_DEPENDENCY_RESTORE_MODE:-copy}"
KASEKI_INSTALL_IGNORE_SCRIPTS="${KASEKI_INSTALL_IGNORE_SCRIPTS:-1}"
KASEKI_NPM_OMIT_DEV="${KASEKI_NPM_OMIT_DEV:-0}"
KASEKI_IMAGE_DEPENDENCY_CACHE_DIR="${KASEKI_IMAGE_DEPENDENCY_CACHE_DIR:-/opt/kaseki/workspace-cache}"
KASEKI_LOG_DIR="${KASEKI_LOG_DIR:-/var/log/kaseki}"
KASEKI_STRICT_HOST_LOGGING="${KASEKI_STRICT_HOST_LOGGING:-0}"
KASEKI_GIT_CACHE_MODE="${KASEKI_GIT_CACHE_MODE:-mirror}"
KASEKI_GIT_CACHE_ROOT="${KASEKI_GIT_CACHE_ROOT:-/cache/git}"
KASEKI_GIT_CACHE_FETCH_TIMEOUT_SECONDS="${KASEKI_GIT_CACHE_FETCH_TIMEOUT_SECONDS:-120}"
GIT_CACHE_KEY=""
GIT_CACHE_MIRROR=""
GIT_CACHE_HIT="false"
GIT_CACHE_STATUS="not_started"
GIT_CACHE_MODE_USED="$KASEKI_GIT_CACHE_MODE"
GIT_CLONE_STRATEGY="not_started"
GIT_CLONE_DURATION_SECONDS=0
REPO_MEMORY_KEY=""
REPO_MEMORY_DIR=""
REPO_MEMORY_FILE=""
REPO_MEMORY_STATUS="disabled"
REPO_MEMORY_COMMIT_SHA="unknown"

# Track last executed command for better error reporting
LAST_COMMAND=""
LAST_COMMAND_LOG="/results/last-command.log"

# Signal handler for graceful termination
handle_termination() {
  local signal="$1"
  printf '\nReceived %s; terminating kaseki-agent...\n' "$signal" | tee -a /results/progress.log
  # Exit with standard code for signal (128 + signal_number)
  # SIGINT = 130, SIGTERM = 143
  if [ "$signal" = "SIGINT" ]; then
    exit 130
  else
    exit 143
  fi
}
trap 'handle_termination SIGTERM' SIGTERM
trap 'handle_termination SIGINT' SIGINT

# DEBUG trap: capture last command before execution for better error diagnostics
trap 'LAST_COMMAND="$BASH_COMMAND"' DEBUG

setup_host_logging_mirror() {
  local base_name="$1"
  local stamp host_log_file
  if mkdir -p "$KASEKI_LOG_DIR" 2>/dev/null && [ -w "$KASEKI_LOG_DIR" ]; then
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    host_log_file="$KASEKI_LOG_DIR/${base_name}-${stamp}.log"
    exec > >(tee -a /results/stdout.log | tee -a "$host_log_file") \
      2> >(tee -a /results/stderr.log | tee -a "$host_log_file" >&2)
    printf 'Host log mirror: %s\n' "$host_log_file"
    return 0
  fi
  if [ "$KASEKI_STRICT_HOST_LOGGING" = "1" ]; then
    printf 'Error: strict host logging enabled, but KASEKI_LOG_DIR is not writable: %s\n' "$KASEKI_LOG_DIR" >&2
    exit 1
  fi
  exec > >(tee -a /results/stdout.log) 2> >(tee -a /results/stderr.log >&2)
  printf 'Warning: host log mirror disabled; KASEKI_LOG_DIR is unavailable: %s\n' "$KASEKI_LOG_DIR" >&2
}

mkdir_paths=(/results)
if [ -n "${HOME:-}" ]; then
  mkdir_paths+=("${HOME}")
fi
if [ -n "${NPM_CONFIG_CACHE:-}" ]; then
  mkdir_paths+=("${NPM_CONFIG_CACHE}")
fi
if [ -n "${TMPDIR:-}" ]; then
  mkdir_paths+=("${TMPDIR}")
fi
if [ -n "${PI_CODING_AGENT_DIR:-}" ]; then
  mkdir_paths+=("${PI_CODING_AGENT_DIR}")
fi
mkdir -p "${mkdir_paths[@]}"
: > /results/stdout.log
: > /results/stderr.log
: > /results/pi-events.jsonl
: > /results/pi-summary.json
: > /results/scouting-events.jsonl
: > /results/scouting-summary.json
: > /results/goal-check-events.jsonl
: > /results/goal-check-summary.json
: > /results/goal-check-stderr.log
: > /results/goal-check-attempts.jsonl
: > /results/goal-check.json
: > /results/validation.log
: > /results/pre-validation.log
: > "$PRE_VALIDATION_RAW_LOG"
: > "$PRE_VALIDATION_ENV_LOG"
: > /results/quality.log
: > /results/secret-scan.log
: > /results/git-push.log
: > /results/progress.log
: > /results/progress.jsonl
: > /results/format-check-command.txt
: > /results/failure.json
: > /results/result-summary.md
: > "$VALIDATION_TIMINGS_FILE"
: > "$PRE_VALIDATION_TIMINGS_FILE"
: >> "$STAGE_TIMINGS_FILE"
: > "$DEPENDENCY_CACHE_LOG"
setup_host_logging_mirror "$INSTANCE_NAME"
case "$KASEKI_GIT_CACHE_MODE" in
  off|mirror)
    ;;
  *)
    printf 'Warning: unsupported KASEKI_GIT_CACHE_MODE=%s; falling back to off. Expected off or mirror.\n' "$KASEKI_GIT_CACHE_MODE" >&2
    KASEKI_GIT_CACHE_MODE="off"
    GIT_CACHE_MODE_USED="off"
    ;;
esac
if ! [[ "$KASEKI_GOAL_CHECK_MAX_RETRIES" =~ ^[0-9]+$ ]]; then
  printf 'Warning: unsupported KASEKI_GOAL_CHECK_MAX_RETRIES=%s; falling back to 1.\n' "$KASEKI_GOAL_CHECK_MAX_RETRIES" >&2
  KASEKI_GOAL_CHECK_MAX_RETRIES="1"
elif [ "$KASEKI_GOAL_CHECK_MAX_RETRIES" -gt 5 ]; then
  printf 'Warning: KASEKI_GOAL_CHECK_MAX_RETRIES=%s exceeds the maximum of 5; using 5.\n' "$KASEKI_GOAL_CHECK_MAX_RETRIES" >&2
  KASEKI_GOAL_CHECK_MAX_RETRIES="5"
fi
if [ "$KASEKI_DRY_RUN" = "1" ]; then
  KASEKI_GOAL_CHECK="0"
fi

# Helper function to run Node.js subprocesses with comprehensive error logging
# Usage: run_node_subprocess <output_var_name> "<node_code>" [<input_data>] [<error_log_file>]
# Captures stderr, logs errors, and returns exit code for caller to check
run_node_subprocess() {
  local output_var_name="$1"
  local node_code="$2"
  local input_data="${3:-}"
  local error_log_file="${4:-/tmp/node-error.log}"
  local node_stderr_tmp node_exit_code output_value
  
  node_stderr_tmp="$(mktemp /tmp/node-stderr.XXXXXX)" || {
    printf 'ERROR: Failed to create temp file for Node.js stderr\n' >&2
    eval "$output_var_name=''"
    return 1
  }
  
  # Run Node.js and capture both stdout and stderr
  if [ -n "$input_data" ]; then
    output_value=$(printf '%s' "$input_data" | node -e "$node_code" 2>"$node_stderr_tmp")
  else
    output_value=$(node -e "$node_code" 2>"$node_stderr_tmp")
  fi
  node_exit_code=$?
  
  # Handle errors
  if [ $node_exit_code -ne 0 ]; then
    local stderr_content
    stderr_content="$(cat "$node_stderr_tmp" 2>/dev/null || echo '<unable to read stderr>')"
    {
      printf '[node-subprocess-error] Command failed with exit code %d\n' "$node_exit_code"
      if [ -n "$stderr_content" ]; then
        printf '[node-subprocess-error] stderr: %s\n' "$stderr_content"
      fi
      printf '[node-subprocess-error] code: %.200s\n' "$node_code"
      if [ -n "$input_data" ]; then
        printf '[node-subprocess-error] input (first 150 chars): %.150s\n' "$input_data"
      fi
    } | tee -a "$error_log_file" >&2
    rm -f "$node_stderr_tmp"
    eval "$output_var_name=''"
    return "$node_exit_code"
  fi
  
  # Success: store output in variable and return 0
  eval "$output_var_name='$output_value'"
  rm -f "$node_stderr_tmp"
  return 0
}

# Safely encode value as JSON string; fallback to empty string if node unavailable
json_encode() {
  if ! command -v node &>/dev/null; then
    printf '""' # Return empty JSON string if node is unavailable
    return 1
  fi
  local output
  output=$(node -e 'const chunks=[]; process.stdin.on("data", c => chunks.push(c)); process.stdin.on("end", () => process.stdout.write(JSON.stringify(Buffer.concat(chunks).toString().replace(/\n$/, ""))));' 2>&1)
  local exit_code=$?
  if [ $exit_code -eq 0 ] && [ -n "$output" ]; then
    printf '%s' "$output"
  else
    # Log error and return empty JSON string as fallback
    printf 'warning: json_encode failed (exit %d): %s\n' "$exit_code" "$output" >&2
    printf '""'
    return 1
  fi
}

json_array() {
  if ! command -v node &>/dev/null; then
    printf '[]' # Return empty JSON array if node is unavailable
    return 1
  fi
  node -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)));' -- "$@" 2>&1 || printf '[]'
}

# Validate that a variable contains only numeric digits (for use before arithmetic)
validate_numeric() {
  local var_name="$1"
  local var_value="$2"
  # Empty or missing value is treated as invalid
  if [ -z "$var_value" ]; then
    printf 'error: %s is not numeric (value="%s")\n' "$var_name" "$var_value" >&2
    return 1
  fi
  # Reject any non-digit character, including embedded newlines.
  case "$var_value" in
    *[!0-9]*)
      printf 'error: %s is not a valid integer (value="%s")\n' "$var_name" "$var_value" >&2
      return 1
      ;;
  esac
  return 0
}

emit_progress() {
  local stage="$1"
  local detail="$2"
  local status="${3:-info}"
  local now
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '{"timestamp":%s,"component":%s,"stage":%s,"status":%s,"instance":%s,"detail":%s}\n' \
    "$(printf '%s' "$now" | json_encode)" \
    "$(printf '%s' "kaseki-agent" | json_encode)" \
    "$(printf '%s' "$stage" | json_encode)" \
    "$(printf '%s' "$status" | json_encode)" \
    "$(printf '%s' "$INSTANCE_NAME" | json_encode)" \
    "$(printf '%s' "$detail" | json_encode)" >> /results/progress.jsonl
  printf '[progress] %s %s: %s\n' "$stage" "$status" "$detail" | tee -a /results/progress.log
}

emit_event() {
  local event_type="$1"
  shift
  local detail_json="{}"
  if [ $# -gt 0 ]; then
    # Build detail object from key=value pairs
    local -a pairs=("$@")
    detail_json="{"
    for i in "${!pairs[@]}"; do
      local pair="${pairs[$i]}"
      local key="${pair%%=*}"
      local value="${pair#*=}"
      if [ "$i" -gt 0 ]; then
        detail_json="${detail_json},"
      fi
      detail_json="${detail_json}$(printf '%s' "$key" | json_encode):$(printf '%s' "$value" | json_encode)"
    done
    detail_json="${detail_json}}"
  fi
  local now
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '{"timestamp":%s,"component":%s,"event_type":%s,"instance":%s,%s}\n' \
    "$(printf '%s' "$now" | json_encode)" \
    "$(printf '%s' "kaseki-agent" | json_encode)" \
    "$(printf '%s' "$event_type" | json_encode)" \
    "$(printf '%s' "$INSTANCE_NAME" | json_encode)" \
    "$(printf '%s' "$detail_json" | sed 's/^{\(.*\)}$/\1/')" >> /results/progress.jsonl
}

emit_error_event() {
  local error_type="$1"
  local detail="$2"
  local recovery="${3:-continue}"
  emit_event "error" "error_type=$error_type" "detail=$detail" "recovery_action=$recovery"
  printf '[error] %s: %s (recovery: %s)\n' "$error_type" "$detail" "$recovery" | tee -a /results/progress.log
}

write_metadata() {
  local end_epoch end_iso duration exit_code
  end_epoch="$(date +%s)"
  end_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  duration=$((end_epoch - START_EPOCH))
  exit_code="${1:-$STATUS}"
  cat > /results/metadata.json <<META
{
  "instance": $(printf '%s' "$INSTANCE_NAME" | json_encode),
  "repo_url": $(printf '%s' "$REPO_URL" | json_encode),
  "git_ref": $(printf '%s' "$GIT_REF" | json_encode),
  "provider": $(printf '%s' "$KASEKI_PROVIDER" | json_encode),
  "model": $(printf '%s' "$KASEKI_MODEL" | json_encode),
  "scouting_model": $(printf '%s' "$KASEKI_SCOUTING_MODEL" | json_encode),
  "goal_check_enabled": $([[ "$KASEKI_GOAL_CHECK" == "1" ]] && printf 'true' || printf 'false'),
  "goal_check_model": $(printf '%s' "$KASEKI_GOAL_CHECK_MODEL" | json_encode),
  "goal_check_max_retries": $KASEKI_GOAL_CHECK_MAX_RETRIES,
  "task_mode": $(printf '%s' "$KASEKI_TASK_MODE" | json_encode),
  "allow_empty_diff": $(printf '%s' "$KASEKI_ALLOW_EMPTY_DIFF" | json_encode),
  "started_at": $(printf '%s' "$START_ISO" | json_encode),
  "current_stage": $(printf '%s' "$CURRENT_STAGE" | json_encode),
  "ended_at": $(printf '%s' "$end_iso" | json_encode),
  "duration_seconds": $duration,
  "total_duration_seconds": $duration,
  "pi_duration_seconds": $PI_DURATION_SECONDS,
  "scouting_duration_seconds": $SCOUTING_DURATION_SECONDS,
  "goal_check_duration_seconds": $GOAL_CHECK_DURATION_SECONDS,
  "exit_code": $exit_code,
  "failed_command": $(printf '%s' "$FAILED_COMMAND" | json_encode),
  "validation_failed_command": $(printf '%s' "$VALIDATION_FAILED_COMMAND_DETAIL" | json_encode),
  "validation_failure_reason": $(printf '%s' "$VALIDATION_FAILURE_REASON" | json_encode),
  "pre_validation_failed_command": $(printf '%s' "$PRE_VALIDATION_FAILED_COMMAND_DETAIL" | json_encode),
  "pre_validation_failure_reason": $(printf '%s' "$PRE_VALIDATION_FAILURE_REASON" | json_encode),
  "quality_failure_reason": $(printf '%s' "$QUALITY_FAILURE_REASON" | json_encode),
  "goal_check_failure_reason": $(printf '%s' "$GOAL_CHECK_FAILURE_REASON" | json_encode),
  "pi_exit_code": $PI_EXIT,
  "scouting_exit_code": $SCOUTING_EXIT,
  "goal_check_exit_code": $GOAL_CHECK_EXIT,
  "goal_check_attempts": $GOAL_CHECK_ATTEMPTS,
  "goal_check_met": $GOAL_CHECK_MET,
  "pre_validation_exit_code": $PRE_VALIDATION_EXIT,
  "validation_exit_code": $VALIDATION_EXIT,
  "validation_fail_fast_mode": $([[ "$KASEKI_VALIDATION_FAIL_FAST" == "1" ]] && printf 'true' || printf 'false'),
  "pre_validation_stopped_early": $([[ "$PRE_VALIDATION_STOPPED_EARLY" == "true" ]] && printf 'true' || printf 'false'),
  "validation_stopped_early": $([[ "$VALIDATION_STOPPED_EARLY" == "true" ]] && printf 'true' || printf 'false'),
  "pre_validation_commands_attempted": $PRE_VALIDATION_COMMANDS_ATTEMPTED,
  "validation_commands_attempted": $VALIDATION_COMMANDS_ATTEMPTED,
  "quality_exit_code": $QUALITY_EXIT,
  "secret_scan_exit_code": $SECRET_SCAN_EXIT,
  "github_push_exit_code": $GITHUB_PUSH_EXIT,
  "github_pr_exit_code": $GITHUB_PR_EXIT,
  "github_operation_phase": $(printf '%s' "$GITHUB_OPERATION_PHASE" | json_encode),
  "diff_nonempty": $DIFF_NONEMPTY,
  "actual_model": $(printf '%s' "$ACTUAL_MODEL" | json_encode),
  "scouting_actual_model": $(printf '%s' "$SCOUTING_ACTUAL_MODEL" | json_encode),
  "goal_check_actual_model": $(printf '%s' "$GOAL_CHECK_ACTUAL_MODEL" | json_encode),
  "github_pr_url": $(printf '%s' "$GITHUB_PR_URL" | json_encode),
  "publish_mode": $(printf '%s' "$KASEKI_PUBLISH_MODE" | json_encode),
  "github_skip_reasons": $(json_array "${GITHUB_SKIP_REASONS[@]}"),
  "git_cache_mode": $(printf '%s' "$GIT_CACHE_MODE_USED" | json_encode),
  "git_cache_status": $(printf '%s' "$GIT_CACHE_STATUS" | json_encode),
  "git_cache_hit": $GIT_CACHE_HIT,
  "git_cache_key": $(printf '%s' "$GIT_CACHE_KEY" | json_encode),
  "git_cache_mirror": $(printf '%s' "$GIT_CACHE_MIRROR" | json_encode),
  "git_clone_strategy": $(printf '%s' "$GIT_CLONE_STRATEGY" | json_encode),
  "git_clone_duration_seconds": $GIT_CLONE_DURATION_SECONDS,
  "repo_memory_mode": $(printf '%s' "$KASEKI_REPO_MEMORY_MODE" | json_encode),
  "repo_memory_status": $(printf '%s' "$REPO_MEMORY_STATUS" | json_encode),
  "repo_memory_key": $(printf '%s' "$REPO_MEMORY_KEY" | json_encode),
  "repo_memory_file": $(printf '%s' "$REPO_MEMORY_FILE" | json_encode),
  "repo_memory_ttl_days": $KASEKI_REPO_MEMORY_TTL_DAYS,
  "repo_memory_max_bytes": $KASEKI_REPO_MEMORY_MAX_BYTES,
  "github_api_error_type": $(printf '%s' "$GITHUB_API_ERROR_TYPE" | json_encode),
  "github_api_error_message": $(printf '%s' "$GITHUB_API_ERROR_MESSAGE" | json_encode),
  "github_api_http_status": $(printf '%s' "$GITHUB_API_HTTP_STATUS" | json_encode),
  "validation_filter_stderr_tail": $(printf '%s' "$FILTER_STDERR_TAIL" | json_encode),
  "validation_filter_exit_code": 0,
  "node_version": $(node --version 2>/dev/null | json_encode || printf 'null'),
  "npm_version": $(npm --version 2>/dev/null | json_encode || printf 'null'),
  "pi_version": $(printf '%s' "$PI_VERSION" | json_encode)
}
META
  printf '%s\n' "$exit_code" > /results/exit_code
}

set_current_stage() {
  CURRENT_STAGE="$1"
}

write_result_summary() {
  local changed_files changed_files_markdown validation_status pr_status github_skip_reasons_summary
  changed_files="$(cat /results/changed-files.txt 2>/dev/null || true)"
  if [ -n "$changed_files" ]; then
    changed_files_markdown="$(printf '%s\n' "$changed_files" | sed 's/^/  - /')"
  else
    changed_files_markdown="  - none"
  fi
  validation_status="passed"
  [ "$VALIDATION_EXIT" -ne 0 ] && validation_status="failed"
  if grep -q 'skipped_after_agent_failure' "$STAGE_TIMINGS_FILE" 2>/dev/null; then
    validation_status="skipped"
  fi
  github_skip_reasons_summary="none"
  if [ "${#GITHUB_SKIP_REASONS[@]}" -gt 0 ]; then
    github_skip_reasons_summary="$(IFS=,; printf '%s' "${GITHUB_SKIP_REASONS[*]}")"
  fi

  pr_status="not attempted"
  if [ "${#GITHUB_SKIP_REASONS[@]}" -gt 0 ]; then
    pr_status="not attempted (reasons: $github_skip_reasons_summary)"
  fi
  if [ "$GITHUB_APP_ENABLED" = "1" ] && [ "${#GITHUB_SKIP_REASONS[@]}" -eq 0 ]; then
    if [ "$GITHUB_PUSH_EXIT" -ne 0 ]; then
      if [ "$GITHUB_OPERATION_PHASE" = "token_generation" ]; then
        pr_status="token generation failed"
      else
        pr_status="push failed"
      fi
    elif [ "$GITHUB_PR_EXIT" -eq 0 ] && [ -n "$GITHUB_PR_URL" ]; then
      pr_status="created ($GITHUB_PR_URL)"
    elif [ "$GITHUB_PR_EXIT" -ne 0 ]; then
      pr_status="pr creation failed"
    else
      pr_status="push succeeded, pr not created"
    fi
  fi

  cat > /results/result-summary.md <<SUMMARY
# Kaseki Result: $INSTANCE_NAME

- Status: $(if [ "$STATUS" -eq 0 ]; then printf 'passed'; else printf 'failed'; fi)
- Failed command: ${FAILED_COMMAND:-none}
- Requested model: $KASEKI_MODEL
- Actual model: ${ACTUAL_MODEL:-unknown}
- Pi exit code: $PI_EXIT
- Goal check: $(if [ "$KASEKI_GOAL_CHECK" = "1" ] && [ -s "$SCOUTING_ARTIFACT" ]; then [ "$GOAL_CHECK_MET" = "true" ] && printf 'met' || printf 'unmet'; else printf 'disabled'; fi) ($GOAL_CHECK_EXIT)
- Goal check attempts: $GOAL_CHECK_ATTEMPTS (max retries: $KASEKI_GOAL_CHECK_MAX_RETRIES)
$(if [ -n "$GOAL_CHECK_FAILURE_REASON" ]; then printf '  - Reason: %s\n' "$GOAL_CHECK_FAILURE_REASON"; fi)
- Pre-agent validation: $([ "$PRE_VALIDATION_EXIT" -eq 0 ] && printf 'passed' || printf 'failed') ($PRE_VALIDATION_EXIT)
$(if [ -n "$PRE_VALIDATION_FAILURE_REASON" ]; then printf '  - Reason: %s\n' "$PRE_VALIDATION_FAILURE_REASON"; fi)
- Pre-agent validation failure detail: ${PRE_VALIDATION_FAILED_COMMAND_DETAIL:-none}
$(if [ "$PRE_VALIDATION_STOPPED_EARLY" = "true" ]; then printf -- '- **⚠️ Pre-agent validation stopped early** (fail-fast mode): %s of %s commands ran\n' "$PRE_VALIDATION_COMMANDS_ATTEMPTED" "$(echo "$KASEKI_PRE_AGENT_VALIDATION_COMMANDS" | tr ';' '\n' | grep -c .)"; fi)
- Validation: $validation_status ($VALIDATION_EXIT)
$(if [ -n "$VALIDATION_FAILURE_REASON" ]; then printf '  - Reason: %s\n' "$VALIDATION_FAILURE_REASON"; fi)
- Validation failure detail: ${VALIDATION_FAILED_COMMAND_DETAIL:-none}
$(if [ "$VALIDATION_STOPPED_EARLY" = "true" ]; then printf -- '- **⚠️ Validation stopped early** (fail-fast mode): %s of %s commands ran\n' "$VALIDATION_COMMANDS_ATTEMPTED" "$(echo "$KASEKI_VALIDATION_COMMANDS" | tr ';' '\n' | grep -c .)"; fi)
- Quality checks: $QUALITY_EXIT
- Secret scan: $SECRET_SCAN_EXIT
- GitHub PR: $pr_status
- GitHub skip reasons: $github_skip_reasons_summary
- Diff non-empty: $DIFF_NONEMPTY
- Changed files:
$changed_files_markdown

Artifacts:
- metadata.json
- pi-summary.json
- pi-events.jsonl
- goal-check.json
- goal-check-attempts.jsonl
- pre-validation.log
- pre-validation-timings.tsv
- validation.log
- validation-timings.tsv
- stage-timings.tsv
- dependency-cache.log
- git.diff
- git.status
- git-push.log (if GitHub App enabled)
- progress.log
- progress.jsonl
- cleanup.log (host artifact)
SUMMARY
}

write_failure_json() {
  local exit_code="$1"
  local stderr_tail
  stderr_tail="$(tail -20 /results/stderr.log 2>/dev/null || true)"
  if [ "$exit_code" -eq 0 ]; then
    : > /results/failure.json
    return 0
  fi
  cat > /results/failure.json <<FAILURE
{
  "instance": $(printf '%s' "$INSTANCE_NAME" | json_encode),
  "exit_code": $exit_code,
  "failed_command": $(printf '%s' "$FAILED_COMMAND" | json_encode),
  "pre_validation_exit_code": $PRE_VALIDATION_EXIT,
  "validation_exit_code": $VALIDATION_EXIT,
  "validation_failed_command": $(printf '%s' "$VALIDATION_FAILED_COMMAND_DETAIL" | json_encode),
  "validation_failure_reason": $(printf '%s' "$VALIDATION_FAILURE_REASON" | json_encode),
  "pre_validation_failed_command": $(printf '%s' "$PRE_VALIDATION_FAILED_COMMAND_DETAIL" | json_encode),
  "pre_validation_failure_reason": $(printf '%s' "$PRE_VALIDATION_FAILURE_REASON" | json_encode),
  "quality_failure_reason": $(printf '%s' "$QUALITY_FAILURE_REASON" | json_encode),
  "goal_check_failure_reason": $(printf '%s' "$GOAL_CHECK_FAILURE_REASON" | json_encode),
  "goal_check_attempts": $GOAL_CHECK_ATTEMPTS,
  "goal_check_met": $GOAL_CHECK_MET,
  "stage": $(printf '%s' "$CURRENT_STAGE" | json_encode),
  "stderr_tail": $(printf '%s' "$stderr_tail" | json_encode),
  "artifacts_dir": "/results",
  "metadata": "metadata.json",
  "stderr": "stderr.log",
  "stdout": "stdout.log",
  "progress": "progress.jsonl",
  "summary": "result-summary.md"
}
FAILURE
}

collect_git_artifacts() {
  DIFF_NONEMPTY=false
  if [ -d /workspace/repo/.git ]; then
    while IFS= read -r untracked_file || [ -n "$untracked_file" ]; do
      [ -z "$untracked_file" ] && continue
      git -C /workspace/repo add -N -- "$untracked_file" 2>/dev/null || true
    done < <(git -C /workspace/repo ls-files --others --exclude-standard 2>/dev/null || true)
    git -C /workspace/repo status --short > /results/git.status 2>/dev/null || true
    git -C /workspace/repo diff -- . > /results/git.diff 2>/dev/null || true
    git -C /workspace/repo diff --name-only -- . > /results/changed-files.txt 2>/dev/null || true
    if [ -s /results/git.diff ]; then
      DIFF_NONEMPTY=true
    fi
  else
    : > /results/git.status
    : > /results/git.diff
    : > /results/changed-files.txt
  fi
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ALLOWLIST_HELPER="$SCRIPT_DIR/scripts/allowlist-helper.sh"
if [ ! -r "$ALLOWLIST_HELPER" ] && [ -r /app/scripts/allowlist-helper.sh ]; then
  ALLOWLIST_HELPER="/app/scripts/allowlist-helper.sh"
fi
# shellcheck source=scripts/allowlist-helper.sh
. "$ALLOWLIST_HELPER"

derive_allowlist_from_scouting() {
  local scouting_artifact agent_patterns validation_patterns
  scouting_artifact="${1:?missing scouting artifact path}"
  
  if [ ! -f "$scouting_artifact" ]; then
    printf 'derive_allowlist_from_scouting: scouting artifact not found: %s\n' "$scouting_artifact" >&2
    return 1
  fi
  
  # Extract patterns from scouting.json
  agent_patterns="$(node -e "
    try {
      const fs = require('node:fs');
      const artifact = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
      if (artifact && artifact.suggested_allowlist && Array.isArray(artifact.suggested_allowlist.agent_patterns)) {
        console.log(artifact.suggested_allowlist.agent_patterns.join(' '));
      }
    } catch (e) {
      console.error('Error parsing scouting artifact:', e.message);
    }
  " "$scouting_artifact" 2>/dev/null)"
  
  validation_patterns="$(node -e "
    try {
      const fs = require('node:fs');
      const artifact = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
      if (artifact && artifact.suggested_allowlist && Array.isArray(artifact.suggested_allowlist.validation_patterns)) {
        console.log(artifact.suggested_allowlist.validation_patterns.join(' '));
      }
    } catch (e) {
      console.error('Error parsing scouting artifact:', e.message);
    }
  " "$scouting_artifact" 2>/dev/null)"
  
  printf '%s\n' "$agent_patterns"
  printf '%s\n' "$validation_patterns"
}

validate_allowlist_patterns() {
  local patterns_str test_regex
  patterns_str="${1:?missing patterns string}"
  
  # Try to build a regex from the patterns - if it fails, return error
  test_regex="$(build_allowlist_regex "$patterns_str" 2>&1)"
  if [ -z "$test_regex" ]; then
    # Empty patterns are valid (means no allowlist)
    return 0
  fi
  
  # Test that the regex is valid by using it with grep
  if ! printf 'test' | grep -E "^(${test_regex})$" >/dev/null 2>&1; then
    # grep with empty patterns is valid, so this is fine
    :
  fi
  return 0
}

merge_allowlists() {
  local scouting_patterns user_patterns merged_patterns
  scouting_patterns="${1:?missing scouting patterns}"
  user_patterns="${2:-}"
  
  # Merge patterns: if both provided, union them; otherwise use whichever is non-empty
  if [ -n "$scouting_patterns" ] && [ -n "$user_patterns" ]; then
    merged_patterns="$scouting_patterns $user_patterns"
  elif [ -n "$scouting_patterns" ]; then
    merged_patterns="$scouting_patterns"
  elif [ -n "$user_patterns" ]; then
    merged_patterns="$user_patterns"
  else
    merged_patterns=""
  fi
  
  printf '%s' "$merged_patterns"
}

run_scouting_allowlist_coverage() {
  local scouting_artifact agent_patterns validation_patterns
  scouting_artifact="${1:?missing scouting artifact path}"
  
  if [ ! -f "$scouting_artifact" ] || [ ! -f /results/changed-files.txt ]; then
    return 0
  fi
  
  agent_patterns="$(derive_allowlist_from_scouting "$scouting_artifact" | head -n 1)"
  validation_patterns="$(derive_allowlist_from_scouting "$scouting_artifact" | tail -n 1)"
  
  # Calculate coverage metrics using dry-run script if available
  local agent_coverage validation_coverage agent_warnings validation_warnings
  agent_coverage="0"
  validation_coverage="0"
  agent_warnings=""
  validation_warnings=""
  
  if [ -n "$agent_patterns" ] && command -v dry-run-allowlist.sh >/dev/null 2>&1; then
    agent_coverage="$(dry-run-allowlist.sh --result-dir /results --allowlist "$agent_patterns" 2>/dev/null | grep -oP '(?<=Coverage: )\d+(?=%)' | head -n 1 || true)"
    [ -z "$agent_coverage" ] && agent_coverage="0"
    
    # Check for problematic coverage
    if [ "$agent_coverage" -lt 30 ]; then
      agent_warnings="patterns too narrow"
    elif [ "$agent_coverage" -gt 98 ]; then
      agent_warnings="patterns too broad"
    fi
  fi
  
  if [ -n "$validation_patterns" ] && command -v dry-run-allowlist.sh >/dev/null 2>&1; then
    validation_coverage="$(dry-run-allowlist.sh --result-dir /results --allowlist "$validation_patterns" 2>/dev/null | grep -oP '(?<=Coverage: )\d+(?=%)' | head -n 1 || true)"
    [ -z "$validation_coverage" ] && validation_coverage="0"
    
    if [ "$validation_coverage" -lt 30 ]; then
      validation_warnings="patterns too narrow"
    elif [ "$validation_coverage" -gt 98 ]; then
      validation_warnings="patterns too broad"
    fi
  fi
  
  # Update scouting.json with coverage metrics
  node -e "
    const fs = require('node:fs');
    const artifact = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    artifact.coverage = {
      agent_phase_percent: parseInt(process.argv[2]) || 0,
      validation_phase_percent: parseInt(process.argv[3]) || 0,
      warnings: process.argv[4] ? process.argv[4].split(',').filter(w => w) : []
    };
    fs.writeFileSync(process.argv[1], JSON.stringify(artifact, null, 2) + '\n');
  " "$scouting_artifact" "$agent_coverage" "$validation_coverage" "$agent_warnings,$validation_warnings" 2>/dev/null
  
  # Log coverage metrics
  if [ "$agent_coverage" -ne 0 ] || [ "$validation_coverage" -ne 0 ]; then
    {
      printf '\n[scouting allowlist coverage]\n'
      printf '  agent_phase: %s%% coverage\n' "$agent_coverage"
      printf '  validation_phase: %s%% coverage\n' "$validation_coverage"
      if [ -n "$agent_warnings" ]; then
        printf '  ⚠ agent_phase warning: %s\n' "$agent_warnings"
      fi
      if [ -n "$validation_warnings" ]; then
        printf '  ⚠ validation_phase warning: %s\n' "$validation_warnings"
      fi
    } | tee -a /results/scouting-report.md >> /results/quality.log
  fi
}

restore_disallowed_changes() {
  if [ "$KASEKI_RESTORE_DISALLOWED_CHANGES" != "1" ] || [ ! -d /workspace/repo/.git ]; then
    return 0
  fi

  local allowlist_regex restored_any restored_count kept_count coverage
  allowlist_regex="$(build_allowlist_regex)"
  [ -z "$allowlist_regex" ] && return 0
  restored_any=0
  restored_count=0
  kept_count=0
  coverage=0

  # Initialize restoration tracking file
  : > /results/restoration.jsonl

  while IFS= read -r changed_file || [ -n "$changed_file" ]; do
    [ -z "$changed_file" ] && continue
    if printf '%s\n' "$changed_file" | grep -Eq "^(${allowlist_regex})$"; then
      # File matched allowlist - keep it
      kept_count=$((kept_count + 1))
      {
        printf '{"timestamp":"%s","event":"file_evaluated","file":"%s","status":"kept","reason":"matched_allowlist"}\n' \
          "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(printf '%s' "$changed_file" | sed 's/"/\\"/g')"
      } >> /results/restoration.jsonl
      continue
    fi
    # File did not match allowlist - restore it
    restored_count=$((restored_count + 1))
    printf -- 'Restoring changed file outside allowlist before validation: %s\n' "$changed_file" | tee -a /results/quality.log
    emit_event "quality_gate_rule_evaluated" "rule=allowlist_restore" "passed=true" "file=$changed_file"
    {
      printf '{"timestamp":"%s","event":"file_restored","file":"%s","status":"restored","reason":"not_in_allowlist"}\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(printf '%s' "$changed_file" | sed 's/"/\\"/g')"
    } >> /results/restoration.jsonl
    git -C /workspace/repo restore --staged --worktree -- "$changed_file" 2>/dev/null || true
    git -C /workspace/repo clean -f -- "$changed_file" 2>/dev/null || true
    restored_any=1
  done < /results/changed-files.txt

  # Emit restoration summary to quality.log with actionable guidance
  if [ $((restored_count + kept_count)) -gt 0 ]; then
    coverage=$((kept_count * 100 / (restored_count + kept_count)))
  fi
  if [ "$restored_count" -gt 0 ] || [ "$kept_count" -gt 0 ]; then
    {
      printf '\n[allowlist summary] Restored: %d files; Kept: %d files (coverage: %d%%)\n' "$restored_count" "$kept_count" "$coverage"
      if [ "$restored_count" -gt 0 ] && [ "$coverage" -lt 50 ]; then
        printf '[allowlist note] Low coverage detected. To improve:\n'
        printf '  1. Run: ./scripts/suggest-allowlist.sh /results (or /agents/kaseki-results/<instance>)\n'
        printf '  2. Review suggested patterns in allowlist-suggestions.md\n'
        printf '  3. Update KASEKI_CHANGED_FILES_ALLOWLIST and re-run\n'
        printf 'See docs/QUALITY_GATES.md for more guidance.\n'
      fi
    } | tee -a /results/quality.log
    emit_event "allowlist_restoration_complete" "restored=$restored_count" "kept=$kept_count" "coverage=$coverage"
  fi

  if [ "$restored_any" -eq 1 ]; then
    collect_git_artifacts
  fi
}

generate_restoration_report() {
  if [ ! -f /results/restoration.jsonl ]; then
    printf '[debug] restoration report: skipping - restoration.jsonl not found\n' >&2
    return 0
  fi

  local restored_count kept_count total_count coverage_pct
  
  # Safely extract counts from restoration.jsonl with validation
  printf '[debug] restoration report: extracting counts from restoration.jsonl\n' >&2
  restored_count=$(grep -c '"status":"restored"' /results/restoration.jsonl 2>/dev/null || true)
  restored_count=${restored_count:-0}
  printf '[debug] restoration report: restored_count="%s"\n' "$restored_count" >&2
  if ! validate_numeric "restored_count" "$restored_count"; then
    printf 'warning: restoration report generation failed - restored_count validation failed\n' >&2
    return 1
  fi
  
  kept_count=$(grep -c '"status":"kept"' /results/restoration.jsonl 2>/dev/null || true)
  kept_count=${kept_count:-0}
  printf '[debug] restoration report: kept_count="%s"\n' "$kept_count" >&2
  if ! validate_numeric "kept_count" "$kept_count"; then
    printf 'warning: restoration report generation failed - kept_count validation failed\n' >&2
    return 1
  fi
  
  # Arithmetic operation - now guaranteed to have valid numeric values
  printf '[debug] restoration report: computing total_count from restored=%s and kept=%s\n' "$restored_count" "$kept_count" >&2
  total_count=$((restored_count + kept_count))
  printf '[debug] restoration report: total_count="%s"\n' "$total_count" >&2

  if [ "$total_count" -eq 0 ]; then
    printf '[debug] restoration report: no changes recorded, skipping report\n' >&2
    return 0
  fi

  printf '[debug] restoration report: generating report with %d total changes\n' "$total_count" >&2
  
  {
    printf '# Allowlist Restoration Report\n\n'
    printf 'Generated: %s\n\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '## Summary\n\n'
    # All variables are now validated as numeric by validate_numeric() above
    printf -- '- **Total Files Changed:** %d\n' "$total_count" || { printf 'error: failed to write total count\n' >&2; return 1; }
    printf -- '- **Files Kept (in allowlist):** %d\n' "$kept_count" || { printf 'error: failed to write kept count\n' >&2; return 1; }
    printf -- '- **Files Restored (outside allowlist):** %d\n' "$restored_count" || { printf 'error: failed to write restored count\n' >&2; return 1; }
    if [ "$total_count" -gt 0 ]; then
      # Calculate coverage percentage - safe because total_count is validated as > 0
      coverage_pct=$((kept_count * 100 / total_count))
      printf '[debug] restoration report: coverage_pct=%d (kept=%s / total=%s)\n' "$coverage_pct" "$kept_count" "$total_count" >&2
      printf -- '- **Allowlist Coverage:** %d%%\n\n' "$coverage_pct" || { printf 'error: failed to write coverage pct\n' >&2; return 1; }
    fi

    if [ "$restored_count" -gt 0 ]; then
      printf '## Restored Files\n\n'
      printf 'These files were modified by the agent but restored because they fall outside the allowlist:\n\n'
      grep '"status":"restored"' /results/restoration.jsonl | \
        sed "s/.*\"file\":\"\([^\"]*\)\".*/- \`\1\`/" | \
        sort | uniq >> /results/restoration-report.md.tmp 2>/dev/null || true
      if [ -f /results/restoration-report.md.tmp ]; then
        cat /results/restoration-report.md.tmp
        rm -f /results/restoration-report.md.tmp
      fi
      printf '\n'
    fi

    if [ "$kept_count" -gt 0 ]; then
      printf '## Kept Files (Allowlist Matches)\n\n'
      printf 'These files were in the allowlist and were kept:\n\n'
      grep '"status":"kept"' /results/restoration.jsonl | \
        sed "s/.*\"file\":\"\([^\"]*\)\".*/- \`\1\`/" | \
        sort | uniq >> /results/restoration-report.md.tmp 2>/dev/null || true
      if [ -f /results/restoration-report.md.tmp ]; then
        cat /results/restoration-report.md.tmp
        rm -f /results/restoration-report.md.tmp
      fi
      printf '\n'
    fi

    printf '## Recommendations\n\n'
    if [ "$restored_count" -gt 0 ] && [ -n "$coverage_pct" ] && [ "$coverage_pct" -lt 50 ]; then
      printf '**⚠️ Low Allowlist Coverage** — Only %d%% of changes were kept.\n' "$coverage_pct"
      printf 'Consider:\n'
      printf '1. Reviewing the TASK_PROMPT to be more specific about scope\n'
      printf '2. Widening the allowlist to include related files\n'
      printf "3. Running \`scripts/suggest-allowlist.sh\` to auto-generate a better allowlist\n\n"
    fi
    printf 'Run subsequent operations with an updated allowlist:\n'
    printf '```bash\n'
    printf 'KASEKI_CHANGED_FILES_ALLOWLIST="<your-pattern>" ./run-kaseki.sh\n'
    printf '```\n\n'
    printf "For help on allowlist patterns, see \`docs/QUALITY_GATES.md\`.\n"
  } > /results/restoration-report.md
}

check_validation_allowlist() {
  if [ -z "$KASEKI_VALIDATION_ALLOWLIST" ]; then
    return 0
  fi
  if [ ! -d /workspace/repo/.git ]; then
    return 0
  fi

  local allowlist_regex validation_violation_count
  allowlist_regex="$(build_allowlist_regex "$KASEKI_VALIDATION_ALLOWLIST")"
  [ -z "$allowlist_regex" ] && return 0
  validation_violation_count=0

  while IFS= read -r changed_file || [ -n "$changed_file" ]; do
    [ -z "$changed_file" ] && continue
    if ! printf '%s\n' "$changed_file" | grep -Eq "^(${allowlist_regex})$"; then
      printf 'Validation-phase file outside allowlist: %s\n' "$changed_file" | tee -a /results/quality.log
      validation_violation_count=$((validation_violation_count + 1))
      emit_event "quality_gate_rule_evaluated" "rule=validation_allowlist" "passed=false" "file=$changed_file"
    else
      emit_event "quality_gate_rule_evaluated" "rule=validation_allowlist" "passed=true" "file=$changed_file"
    fi
  done < /results/changed-files.txt

  if [ "$validation_violation_count" -gt 0 ]; then
    QUALITY_EXIT=7
    QUALITY_FAILURE_REASON="validation_allowlist_check: $validation_violation_count file(s) changed during validation outside KASEKI_VALIDATION_ALLOWLIST"
    printf '\n[validation-allowlist] %d file(s) modified during validation outside allowlist\n' "$validation_violation_count" | tee -a /results/quality.log
    return 1
  fi
  return 0
}

check_secret_scan_allowlist() {
  local allowlist_file="/workspace/repo/.kaseki-secret-allowlist"
  
  # If no allowlist file exists, all matches are failures (real leaks)
  if [ ! -f "$allowlist_file" ]; then
    return 0  # Proceed with normal failure handling
  fi
  
  # Read the secret-scan.log and check each match against the allowlist
  local secret_matches=() unallowlisted_count=0 allowlisted_count=0
  local match_line
  
  # Read the log into a temp variable to avoid SC2094 (read-write in same pipeline)
  local temp_log
  temp_log=$(cat /results/secret-scan.log)
  
  while IFS= read -r match_line || [ -n "$match_line" ]; do
    [ -z "$match_line" ] && continue
    
    # Extract file path and the actual matched pattern from grep output
    # Format: /path/to/file:line_num:match_text
    local file_path pattern
    file_path=$(printf '%s\n' "$match_line" | cut -d: -f1)
    # Extract any credential-like pattern (sk-or-* or sk-test-*)
    pattern=$(printf '%s\n' "$match_line" | sed 's/^[^:]*:[^:]*://' | grep -oE 'sk-or-[A-Za-z0-9_-]{20,}|sk-test-[A-Za-z0-9_-]*' | head -n1)
    
    [ -z "$pattern" ] && continue
    
    # Normalize file path: remove leading /workspace/repo/, repo/, and ./ if present
    file_path="${file_path#/workspace/repo/}"
    file_path="${file_path#repo/}"
    file_path="${file_path#./}"
    
    # Check if this file:pattern combination is in the allowlist
    if grep -q "^${file_path}:${pattern}$" "$allowlist_file" 2>/dev/null; then
      printf '[secret-scan] ALLOWLISTED: %s\n' "$match_line"
      allowlisted_count=$((allowlisted_count + 1))
      emit_event "secret_scan_result" "status=allowlisted" "file=$file_path" "pattern=$pattern"
    else
      secret_matches+=("$match_line")
      unallowlisted_count=$((unallowlisted_count + 1))
      emit_event "secret_scan_result" "status=real_leak" "file=$file_path" "pattern=$pattern"
    fi
  done <<< "$temp_log"
  
  # Clear the log and rewrite with only real leaks
  {
    if [ "$allowlisted_count" -gt 0 ]; then
      printf '[secret-scan] Found %d allowlisted pattern(s) and %d real leak(s)\n' "$allowlisted_count" "$unallowlisted_count"
    fi
    
    for match in "${secret_matches[@]}"; do
      printf '%s\n' "$match"
    done
  } > /results/secret-scan.log
  
  # Exit code 6 only if there are unallowlisted matches
  if [ "$unallowlisted_count" -gt 0 ]; then
    return 1
  fi
  return 0
}


finish() {
  local code=$?
  if [ "$code" -ne 0 ] && [ "$STATUS" -eq 0 ]; then
    # Capture diagnostic context for the catch-all error
    STATUS="$code"
    FAILED_COMMAND="unexpected shell failure"
    # Log the last command that was executed
    {
      printf '[unexpected-failure] Exit code: %d\n' "$code"
      printf '[unexpected-failure] Last command: %s\n' "$LAST_COMMAND"
      printf '[unexpected-failure] Current stage: %s\n' "$CURRENT_STAGE"
      if [ -f /results/progress.log ]; then
        printf '[unexpected-failure] Last 5 progress entries:\n'
        tail -5 /results/progress.log | sed 's/^/  /'
      fi
    } | tee -a "$LAST_COMMAND_LOG" >&2
    emit_error_event "unexpected_shell_failure" "Uncaught shell error (exit $code) in stage '$CURRENT_STAGE'. Last command: $LAST_COMMAND. See $LAST_COMMAND_LOG for context." "exit"
  fi
  # Authoritative call site: this runs at EXIT so artifacts reflect final repo state.
  collect_git_artifacts
  
  # Debug output for restoration report generation
  if [ -f /results/restoration.jsonl ]; then
    printf '[debug] restoration.jsonl exists (size=%d bytes)\n' "$(wc -c < /results/restoration.jsonl)" >&2
  else
    printf '[debug] restoration.jsonl does not exist\n' >&2
  fi
  
  if ! generate_restoration_report; then
    printf 'warning: restoration report generation failed, but continuing with cleanup\n' >&2
  fi
  
  # Calculate and record maturity score
  if [ -x /app/scripts/kaseki-maturity-score.sh ]; then
    /app/scripts/kaseki-maturity-score.sh /workspace/repo /results/maturity-score.json 2>/dev/null || true
  fi
  
  # Calculate and record performance metrics
  if [ -x /app/scripts/kaseki-performance-metrics.sh ] && [ -f /results/stage-timings.tsv ]; then
    /app/scripts/kaseki-performance-metrics.sh /results/stage-timings.tsv /results/performance-metrics.json 2>/dev/null || true
  fi
  
  write_result_summary
  write_failure_json "$STATUS"
  write_repo_memory_summary
  write_metadata "$STATUS"
  exit "$STATUS"
}
trap finish EXIT

run_step() {
  local label="$1"
  shift
  local step_start step_end code
  step_start="$(date +%s)"
  set_current_stage "$label"
  printf '\n==> %s\n' "$label"
  emit_progress "$label" "started"
  # Keep this explicit branch (instead of relying on `set -e`) so we can
  # always emit progress/timing and preserve FAILED_COMMAND deterministically.
  if "$@"; then
    code=0
  else
    code=$?
  fi
  step_end="$(date +%s)"
  emit_progress "$label" "finished with exit $code"
  record_stage_timing "$label" "$code" "$((step_end - step_start))" ""
  if [ "$code" -ne 0 ] && [ "$STATUS" -eq 0 ]; then
    STATUS="$code"
    FAILED_COMMAND="$label"
  fi
  return "$code"
}

run_step_dry() {
  local label="$1"
  shift
  local step_start step_end
  step_start="$(date +%s)"
  set_current_stage "$label"
  printf '\n==> %s (DRY-RUN: simulated)\n' "$label"
  emit_progress "$label" "started (dry-run)"
  # Show what commands would be run without executing them
  printf '%s\n' "$@" >> /results/validation.log
  step_end="$(date +%s)"
  emit_progress "$label" "finished (dry-run, simulated exit 0)"
  record_stage_timing "$label" "0" "$((step_end - step_start))" "dry-run"
  return 0
}

record_stage_timing() {
  local stage="$1"
  local exit_code="$2"
  local duration_seconds="$3"
  local detail="${4:-}"
  printf '%s\t%s\t%s\t%s\n' "$stage" "$exit_code" "$duration_seconds" "$detail" >> "$STAGE_TIMINGS_FILE"
}

set_dependency_cache_status() {
  local status="$1"
  local detail="${2:-}"
  printf '%s\t%s\n' "$status" "$detail" >> "$DEPENDENCY_CACHE_LOG"
}

compute_git_cache_key() {
  local hash
  hash="$(printf '%s' "$REPO_URL" | sha256sum | awk '{print $1}')"
  printf 'repo-%s' "$hash"
}

is_valid_git_mirror() {
  local mirror="$1"
  [ -d "$mirror" ] || return 1
  [ "$(git -C "$mirror" rev-parse --is-bare-repository 2>/dev/null || true)" = "true" ] || return 1
  git -C "$mirror" remote get-url origin >/dev/null 2>&1 || return 1
}

run_direct_clone() {
  rm -rf /workspace/repo
  GIT_CLONE_STRATEGY="direct_shallow"
  git clone --depth 1 --branch "$GIT_REF" "$REPO_URL" /workspace/repo
}

clone_with_git_cache() {
  local cache_root="$KASEKI_GIT_CACHE_ROOT"
  local mirror lock_file tmp_mirror lock_rc fetch_rc mirror_rc clone_rc

  if [ "$KASEKI_GIT_CACHE_MODE" != "mirror" ]; then
    GIT_CACHE_STATUS="disabled"
    GIT_CACHE_HIT="false"
    emit_progress "clone repository" "git cache disabled mode=$KASEKI_GIT_CACHE_MODE"
    run_direct_clone
    return $?
  fi

  GIT_CACHE_KEY="$(compute_git_cache_key)"
  mirror="$cache_root/${GIT_CACHE_KEY}.git"
  lock_file="$cache_root/${GIT_CACHE_KEY}.lock"
  GIT_CACHE_MIRROR="$mirror"

  if ! mkdir -p "$cache_root" 2>/dev/null; then
    GIT_CACHE_STATUS="unavailable"
    GIT_CACHE_HIT="false"
    emit_error_event "git_cache_unavailable" "Cannot create git cache directory $cache_root; using direct clone" "fallback_direct_clone"
    run_direct_clone
    return $?
  fi

  exec 9>"$lock_file"
  flock 9
  lock_rc=$?
  if [ "$lock_rc" -ne 0 ]; then
    GIT_CACHE_STATUS="lock_failed"
    GIT_CACHE_HIT="false"
    emit_error_event "git_cache_lock_failed" "Cannot lock $lock_file; using direct clone" "fallback_direct_clone"
    run_direct_clone
    return $?
  fi

  if is_valid_git_mirror "$mirror"; then
    GIT_CACHE_STATUS="hit"
    GIT_CACHE_HIT="true"
    emit_progress "clone repository" "git cache hit key=$GIT_CACHE_KEY mirror=$mirror"
    timeout "$KASEKI_GIT_CACHE_FETCH_TIMEOUT_SECONDS" git -C "$mirror" fetch --prune --tags origin
    fetch_rc=$?
    if [ "$fetch_rc" -ne 0 ]; then
      flock -u 9 || true
      GIT_CACHE_STATUS="fetch_failed"
      GIT_CACHE_HIT="true"
      emit_error_event "git_cache_fetch_failed" "Mirror fetch failed or timed out for key=$GIT_CACHE_KEY exit=$fetch_rc; using direct clone" "fallback_direct_clone"
      run_direct_clone
      return $?
    fi
  else
    GIT_CACHE_STATUS="miss"
    GIT_CACHE_HIT="false"
    emit_progress "clone repository" "git cache miss key=$GIT_CACHE_KEY mirror=$mirror"
    if [ -e "$mirror" ]; then
      rm -rf "$mirror"
    fi
    tmp_mirror="${mirror}.tmp.$$"
    rm -rf "$tmp_mirror"
    timeout "$KASEKI_GIT_CACHE_FETCH_TIMEOUT_SECONDS" git clone --mirror "$REPO_URL" "$tmp_mirror"
    mirror_rc=$?
    if [ "$mirror_rc" -eq 0 ] && is_valid_git_mirror "$tmp_mirror"; then
      mv "$tmp_mirror" "$mirror"
    else
      rm -rf "$tmp_mirror"
      flock -u 9 || true
      GIT_CACHE_STATUS="populate_failed"
      emit_error_event "git_cache_populate_failed" "Mirror populate failed or timed out for key=$GIT_CACHE_KEY exit=$mirror_rc; using direct clone" "fallback_direct_clone"
      run_direct_clone
      return $?
    fi
  fi
  flock -u 9 || true

  rm -rf /workspace/repo
  GIT_CLONE_STRATEGY="reference_shallow"
  git clone --reference-if-able "$mirror" --depth 1 --branch "$GIT_REF" "$REPO_URL" /workspace/repo
  clone_rc=$?
  if [ "$clone_rc" -eq 0 ]; then
    return 0
  fi

  rm -rf /workspace/repo
  GIT_CLONE_STRATEGY="mirror_local"
  emit_error_event "git_cache_reference_clone_failed" "Reference clone failed for key=$GIT_CACHE_KEY exit=$clone_rc; trying local mirror clone" "try_mirror_clone"
  git clone --branch "$GIT_REF" "$mirror" /workspace/repo
  clone_rc=$?
  if [ "$clone_rc" -eq 0 ] && git -C /workspace/repo rev-parse --verify HEAD >/dev/null 2>&1; then
    git -C /workspace/repo remote set-url origin "$REPO_URL" >/dev/null 2>&1 || true
    return 0
  fi

  rm -rf /workspace/repo
  GIT_CACHE_STATUS="mirror_clone_failed"
  emit_error_event "git_cache_mirror_clone_failed" "Mirror clone failed for key=$GIT_CACHE_KEY exit=$clone_rc; using direct clone" "fallback_direct_clone"
  run_direct_clone
}

run_clone_repository() {
  local step_start step_end code detail
  step_start="$(date +%s)"
  set_current_stage "clone repository"
  printf '\n==> clone repository\n'
  emit_progress "clone repository" "started cache_mode=$KASEKI_GIT_CACHE_MODE"
  if clone_with_git_cache; then
    code=0
  else
    code=$?
  fi
  step_end="$(date +%s)"
  GIT_CLONE_DURATION_SECONDS="$((step_end - step_start))"
  detail="cache_mode=$GIT_CACHE_MODE_USED cache_status=$GIT_CACHE_STATUS cache_hit=$GIT_CACHE_HIT cache_key=$GIT_CACHE_KEY strategy=$GIT_CLONE_STRATEGY mirror=$GIT_CACHE_MIRROR"
  emit_progress "clone repository" "finished with exit $code elapsed=${GIT_CLONE_DURATION_SECONDS}s $detail"
  emit_event "git_clone_cache" \
    "mode=$GIT_CACHE_MODE_USED" \
    "status=$GIT_CACHE_STATUS" \
    "cache_hit=$GIT_CACHE_HIT" \
    "cache_key=$GIT_CACHE_KEY" \
    "strategy=$GIT_CLONE_STRATEGY" \
    "mirror=$GIT_CACHE_MIRROR" \
    "duration_seconds=$GIT_CLONE_DURATION_SECONDS" \
    "exit_code=$code"
  record_stage_timing "clone repository" "$code" "$GIT_CLONE_DURATION_SECONDS" "$detail"
  if [ "$code" -ne 0 ] && [ "$STATUS" -eq 0 ]; then
    STATUS="$code"
    FAILED_COMMAND="clone repository"
  fi
  return "$code"
}


same_filesystem() {
  local left="$1"
  local right="$2"
  local left_device right_device
  left_device="$(stat -c %d "$left" 2>/dev/null || true)"
  right_device="$(stat -c %d "$right" 2>/dev/null || true)"
  [ -n "$left_device" ] && [ "$left_device" = "$right_device" ]
}

restore_node_modules_from_cache() {
  local source_dir="$1"
  local target_dir="$2"
  local mode="${3:-copy}"
  DEPENDENCY_RESTORE_METHOD="$mode"
  case "$mode" in
    copy)
      cp -a "$source_dir" "$target_dir"
      ;;
    hardlink)
      if same_filesystem "$source_dir" "$(dirname "$target_dir")"; then
        if cp -al "$source_dir" "$target_dir"; then
          DEPENDENCY_RESTORE_METHOD="hardlink"
          return 0
        fi
        DEPENDENCY_RESTORE_METHOD="hardlink_fallback_copy"
        printf 'Dependency cache status: hardlink restore failed; falling back to copy.\n' | tee -a "$DEPENDENCY_CACHE_LOG"
        cp -a "$source_dir" "$target_dir"
      else
        DEPENDENCY_RESTORE_METHOD="hardlink_cross_fs_copy"
        printf 'Dependency cache status: hardlink restore skipped because cache and workspace are on different filesystems; falling back to copy.\n' | tee -a "$DEPENDENCY_CACHE_LOG"
        cp -a "$source_dir" "$target_dir"
      fi
      ;;
    symlink)
      # Experimental: only keep this restore if downstream validation confirms tooling
      # tolerates a symlinked node_modules tree.
      DEPENDENCY_RESTORE_METHOD="symlink_experimental"
      ln -s "$source_dir" "$target_dir"
      ;;
    *)
      printf 'Unsupported KASEKI_DEPENDENCY_RESTORE_MODE: %s (expected copy, hardlink, or symlink)\n' "$mode" >&2
      return 2
      ;;
  esac
}

publish_node_modules_cache() {
  local source_dir="$1"
  local tmp_cache_dir="$2"
  rm -rf "$tmp_cache_dir"
  mkdir -p "$tmp_cache_dir" && cp -a "$source_dir/." "$tmp_cache_dir/"
}

dependency_cache_flags_identity() {
  printf 'omit_dev=%s\nignore_scripts=%s\n' "${KASEKI_NPM_OMIT_DEV:-0}" "${KASEKI_INSTALL_IGNORE_SCRIPTS:-1}"
}

dependency_cache_flags_hash() {
  dependency_cache_flags_identity | sha256sum | awk '{print $1}'
}

append_npm_install_flags() {
  local -n flags_ref="$1"
  flags_ref=()
  if [ "${KASEKI_NPM_OMIT_DEV:-0}" = "1" ]; then
    flags_ref+=("--omit=dev")
  fi
  if [ "${KASEKI_INSTALL_IGNORE_SCRIPTS:-1}" = "1" ]; then
    flags_ref+=("--ignore-scripts")
  fi
}

render_npm_install_flags() {
  if [ "$#" -eq 0 ]; then
    printf 'none'
    return 0
  fi

  local rendered=""
  local flag
  for flag in "$@"; do
    if [ -n "$rendered" ]; then
      rendered+=" "
    fi
    rendered+="$(printf '%q' "$flag")"
  done
  printf '%s' "$rendered"
}

dependency_cache_key() {
  local lock_hash="$1"
  local node_major="$2"
  local flags_hash="$3"
  printf 'npm/%s/node-%s/flags-%s' "$lock_hash" "$node_major" "$flags_hash"
}

npm_run_script_name() {
  local command="$1"
  local npm_run_regex='^npm[[:space:]]+run[[:space:]]+([^[:space:]-][^[:space:]-]*)($|[[:space:]])'
  if [[ "$command" =~ $npm_run_regex ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

package_json_has_npm_script() {
  local script_name="$1"
  [ -f package.json ] || return 1
  node - "$script_name" <<'NODE'
const fs = require('fs');
const scriptName = process.argv[2];
try {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const scripts = pkg && typeof pkg.scripts === 'object' && pkg.scripts ? pkg.scripts : {};
  process.exit(Object.prototype.hasOwnProperty.call(scripts, scriptName) ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

missing_npm_script_for_validation_command() {
  local command="$1"
  local script_name
  script_name="$(npm_run_script_name "$command")" || return 1
  package_json_has_npm_script "$script_name" && return 1
  printf '%s' "$script_name"
  return 0
}

record_skipped_validation_command() {
  local command="$1"
  local script_name="$2"
  local duration_seconds="$3"
  local log_file="${4:-/results/validation.log}"
  local timings_file="${5:-$VALIDATION_TIMINGS_FILE}"
  {
    printf '\n==> %s\n' "$command"
    printf 'skipped: package.json does not define npm script "%s"\n' "$script_name"
  } 2>&1 | tee -a "$log_file"
  printf '%s\tskipped\t%s\tmissing_npm_script=%s\n' "$command" "$duration_seconds" "$script_name" >> "$timings_file"
}

append_validation_failure_tail() {
  local raw_log="$1"
  local visible_log="$2"
  local quality_log="${3:-/results/quality.log}"

  if ! [ -s "$raw_log" ]; then
    return 0
  fi

  {
    printf '\n[DIAGNOSTICS] Raw validation output tail (last 80 lines):\n'
    tail -80 "$raw_log" 2>/dev/null || printf '<failed to read raw validation log>\n'
  } | tee -a "$visible_log" "$quality_log" >/dev/null
}

run_validation_commands() {
  local stage_label="$1"
  local commands="$2"
  local log_file="$3"
  local raw_log="$4"
  local timings_file="$5"
  local env_log="$6"
  local failure_reason_prefix="${7:-validation_command_failed}"
  local exit_var="${8:-VALIDATION_EXIT}"
  local detail_var="${9:-VALIDATION_FAILED_COMMAND_DETAIL}"
  local reason_var="${10:-VALIDATION_FAILURE_REASON}"
  local stopped_var="${11:-VALIDATION_STOPPED_EARLY}"
  local attempted_var="${12:-VALIDATION_COMMANDS_ATTEMPTED}"
  local -n validation_exit_ref="$exit_var"
  local -n validation_detail_ref="$detail_var"
  # shellcheck disable=SC2034 # These are reference variables assigned indirectly via function parameters
  local -n validation_reason_ref="$reason_var"
  local -n validation_stopped_ref="$stopped_var"
  local -n validation_attempted_ref="$attempted_var"
  local stage_start validation_start validation_end duration command trimmed missing_npm_script
  local command_exit tee_exit filter_exit pipe_statuses execute_during_dry_run pipefail_was_enabled
  local -a validation_commands

  execute_during_dry_run=false
  if [ "$KASEKI_BASELINE_VALIDATION_DRY_RUN" = "1" ] && [ "$stage_label" = "pre-agent validation" ]; then
    execute_during_dry_run=true
  fi

  printf '\n==> %s\n' "$stage_label"
  set_current_stage "$stage_label"
  emit_progress "$stage_label" "started"
  stage_start="$(date +%s)"

  if [ "$KASEKI_DRY_RUN" = "1" ] && [ "$execute_during_dry_run" != "true" ]; then
    printf '🔄 DRY-RUN MODE: Validation commands would be executed (not running in dry-run mode):\n' | tee -a "$log_file"
    IFS=';' read -r -a validation_commands <<< "$commands"
    for command in "${validation_commands[@]}"; do
      trimmed="$(printf '%s' "$command" | sed 's/^ *//; s/ *$//')"
      [ -z "$trimmed" ] && continue
      printf '  - %s\n' "$trimmed" | tee -a "$log_file"
    done
    validation_exit_ref=0
    record_stage_timing "$stage_label" "0" "$(($(date +%s) - stage_start))" "dry_run=true"
  elif [ -z "$commands" ] || [ "$commands" = "none" ]; then
    printf 'Validation skipped because commands=%s.\n' "${commands:-<empty>}" | tee -a "$log_file"
    record_stage_timing "$stage_label" 0 0 "skipped_by_config"
  else
    # Checkpoint: Verify working directory exists before validation.
    if ! [ -d /workspace/repo ]; then
      printf 'ERROR: Working directory /workspace/repo does not exist before %s\n' "$stage_label" | tee -a "$log_file"
      printf 'Current pwd: %s\n' "$(pwd 2>&1 || echo '<pwd failed>')" | tee -a "$log_file"
      printf 'Filesystem state:\n' | tee -a "$log_file"
      find /workspace -maxdepth 3 -type f 2>&1 | head -100 | tee -a "$log_file"
      validation_exit_ref=1
      validation_detail_ref="Working directory /workspace/repo missing before $stage_label"
      validation_reason_ref="$failure_reason_prefix: workspace_missing"
      record_stage_timing "$stage_label" "$validation_exit_ref" "$(($(date +%s) - stage_start))" "directory_missing"
    else
      set +e
      IFS=';' read -r -a validation_commands <<< "$commands"
      for command in "${validation_commands[@]}"; do
        trimmed="$(printf '%s' "$command" | sed 's/^ *//; s/ *$//')"
        [ -z "$trimmed" ] && continue
        validation_start="$(date +%s)"
        if missing_npm_script="$(missing_npm_script_for_validation_command "$trimmed")"; then
          validation_end="$(date +%s)"
          duration=$((validation_end - validation_start))
          record_skipped_validation_command "$trimmed" "$missing_npm_script" "$duration" "$log_file" "$timings_file"
          emit_event "validation_command_skipped" "stage=$stage_label" "command=$trimmed" "reason=missing_npm_script" "script=$missing_npm_script" "duration_seconds=$duration"
          continue
        fi
        ((validation_attempted_ref++))
        emit_event "validation_command_started" "stage=$stage_label" "command=$trimmed"
        # Log command environment state before execution.
        {
          printf '[validation command] stage=%s\n' "$stage_label"
          printf '[validation command] command=%s\n' "$trimmed"
          printf '[validation command] working_directory=%s\n' "$(pwd 2>&1 || echo '<pwd failed>')"
          printf '[validation command] node_version=%s\n' "$(node --version 2>&1 || echo '<node not found>')"
          printf '[validation command] npm_version=%s\n' "$(npm --version 2>&1 || echo '<npm not found>')"
          printf '[validation command] disk_available=%s\n' "$(df -h /results 2>/dev/null | tail -1 | awk '{print $4}' || echo '<df failed>')"
        } | tee -a "$env_log"
        # Use pipefail to catch errors in any stage of the pipe.
        pipefail_was_enabled=0
        if set -o | grep -q '^pipefail[[:space:]]*on'; then
          pipefail_was_enabled=1
        fi
        set -o pipefail
        {
          printf '\n==> %s\n' "$trimmed"
          unset OPENROUTER_API_KEY
          # Use non-login shell (bash -c) to avoid initialization issues in --read-only containers.
          # Login shell (bash -l) sources /etc/profile and ~/.bashrc, which can fail with getcwd()
          # errors when running in constrained filesystem environments (read-only root, etc.).
          bash -c "$trimmed"
          command_exit=$?
          printf 'exit_code=%s\n' "$command_exit"
          exit "$command_exit"
        } 2>&1 \
          | tee --output-error=warn \
              >(cat >> "$log_file") \
              >(cat >> "$raw_log") \
              2> >(sed 's/^/[validation-tee] /' >> "$FILTER_STDERR_FILE") \
          | FILTER_DIAGNOSTICS_LOG="$FILTER_DIAGNOSTICS_LOG" validation-output-filter 2>>"$FILTER_STDERR_FILE"
        pipe_statuses=("${PIPESTATUS[@]}")
        if [ "$pipefail_was_enabled" -eq 1 ]; then
          set -o pipefail
        else
          set +o pipefail
        fi
        # pipe_statuses[0] = bash command exit code
        # pipe_statuses[1] = tee exit code
        # pipe_statuses[2] = validation-output-filter exit code
        command_exit="${pipe_statuses[0]:-1}"
        tee_exit="${pipe_statuses[1]:-1}"
        filter_exit="${pipe_statuses[2]:-1}"
        validation_end="$(date +%s)"
        duration=$((validation_end - validation_start))
        printf '%s\t%s\t%s\ttee_exit=%s\tfilter_exit=%s\n' "$trimmed" "$command_exit" "$duration" "$tee_exit" "$filter_exit" >> "$timings_file"
        emit_event "validation_command_finished" "stage=$stage_label" "command=$trimmed" "exit_code=$command_exit" "tee_exit_code=$tee_exit" "filter_exit_code=$filter_exit" "duration_seconds=$duration"

        FILTER_STDERR_TAIL=""
        {
          printf '\n[validation pipeline] command=%s\n' "$trimmed"
          printf '[validation pipeline] statuses: command=%s tee=%s filter=%s\n' "$command_exit" "$tee_exit" "$filter_exit"
          printf '[validation pipeline] logs: visible=%s raw=%s diagnostics=%s\n' "$log_file" "$raw_log" "$FILTER_DIAGNOSTICS_LOG"
        } >> "$log_file"
        {
          printf '\n[validation pipeline] command=%s\n' "$trimmed"
          printf '[validation pipeline] statuses: command=%s tee=%s filter=%s\n' "$command_exit" "$tee_exit" "$filter_exit"
        } >> "$FILTER_DIAGNOSTICS_LOG"

        # Capture and process filter/tee stderr for diagnostics.
        if [ -f "$FILTER_STDERR_FILE" ] && [ -s "$FILTER_STDERR_FILE" ]; then
          FILTER_STDERR_TAIL="$(tail -50 "$FILTER_STDERR_FILE" 2>/dev/null || echo '<failed to read filter/tee stderr>')"
          {
            printf '\n[DIAGNOSTICS] Validation pipeline stderr from filter/tee (last 50 lines):\n'
            printf '%s\n' "$FILTER_STDERR_TAIL"
          } | tee -a "$log_file" /results/quality.log
          {
            printf '\n[validation pipeline stderr tail]\n'
            printf '%s\n' "$FILTER_STDERR_TAIL"
          } >> "$FILTER_DIAGNOSTICS_LOG"
          rm -f "$FILTER_STDERR_FILE"
        fi

        # Detect and handle SIGPIPE errors (exit code 141 = 128 + 13).
        # When tee or the filter also reports a broken pipe/early close, classify
        # the result as validation infrastructure failure instead of a normal
        # npm/check failure.
        validation_infra_failure=false
        if [ "$command_exit" -eq 141 ] && { [ "$tee_exit" -ne 0 ] || [ "$filter_exit" -ne 0 ]; }; then
          validation_infra_failure=true
          {
            printf '\n[DIAGNOSTICS] Validation infrastructure failure: upstream command received SIGPIPE while output pipeline was unhealthy.\n'
            printf '  Command exit code: 141 (SIGPIPE)\n'
            printf '  Tee exit code: %s\n' "$tee_exit"
            printf '  Filter exit code: %s\n' "$filter_exit"
            printf '  Classification: validation_infrastructure_failure (not a normal validation command failure)\n'
            printf '  Full raw command output: %s\n' "$raw_log"
            printf '  Filter diagnostics: %s\n' "$FILTER_DIAGNOSTICS_LOG"
            if [ -n "$FILTER_STDERR_TAIL" ]; then
              printf '  Filter/tee stderr was captured above.\n'
            else
              printf '  (No stderr captured from filter/tee)\n'
            fi
          } | tee -a "$log_file" /results/quality.log "$FILTER_DIAGNOSTICS_LOG"
        fi

        if [ "$validation_infra_failure" = "true" ] && [ "$validation_exit_ref" -eq 0 ]; then
          validation_exit_ref=1
          validation_detail_ref="validation infrastructure failure while running \"$trimmed\": command SIGPIPE with tee exit $tee_exit and filter exit $filter_exit"
          validation_reason_ref="validation_infrastructure_failure: $trimmed (command exit $command_exit, tee exit $tee_exit, filter exit $filter_exit)"
          if [ "$KASEKI_VALIDATION_FAIL_FAST" -eq 1 ]; then
            validation_stopped_ref=true
            printf 'Validation stopped because the validation output pipeline failed (fail-fast mode enabled).\n' | tee -a "$log_file"
            break
          fi
        elif [ "$command_exit" -ne 0 ] && [ "$validation_exit_ref" -eq 0 ]; then
          validation_exit_ref="$command_exit"
          validation_detail_ref="first failing command was \"$trimmed\" with exit $command_exit"
          # shellcheck disable=SC2034 # Reference variable assigned for external use via nameref
          validation_reason_ref="$failure_reason_prefix: $trimmed (exit $command_exit)"
          append_validation_failure_tail "$raw_log" "$log_file"
          # Enhanced diagnostics for getcwd-type errors.
          if grep -q 'getcwd\|No such file or directory\|cannot access parent directories' "$log_file"; then
            {
              printf '\n[DIAGNOSTICS] Validation command failed with directory access error:\n'
              printf 'Working directory status:\n'
              printf '  Current pwd: %s\n' "$(pwd 2>&1 || echo '<pwd failed>')"
              printf '  /workspace/repo exists: %s\n' "$([ -d /workspace/repo ] && echo 'yes' || echo 'no')"
              if [ -L /workspace/repo/node_modules ]; then
                printf '  node_modules is symlink → %s\n' "$(readlink /workspace/repo/node_modules 2>&1 || echo '<readlink failed>')"
              fi
              printf 'Last 20 lines of validation log:\n'
              tail -20 "$log_file"
            } | tee -a /results/quality.log
          fi
          # Fail-fast: if enabled, stop validation loop at first failure.
          if [ "$KASEKI_VALIDATION_FAIL_FAST" -eq 1 ]; then
            # shellcheck disable=SC2034 # Reference variable assigned for external use via nameref
            validation_stopped_ref=true
            printf 'Validation stopped at first failure (fail-fast mode enabled).\n' | tee -a "$log_file"
            break
          fi
        fi
      done
      if [ -n "$validation_detail_ref" ]; then
        printf 'Validation failed: %s\n' "$validation_detail_ref" | tee -a "$log_file"
      fi
      set +e
    fi
    record_stage_timing "$stage_label" "$validation_exit_ref" "$(($(date +%s) - stage_start))" ""
  fi
  emit_progress "$stage_label" "finished with exit $validation_exit_ref"
  return "$validation_exit_ref"
}

compute_repo_memory_key() {
  printf '%s\n%s' "$REPO_URL" "$GIT_REF" | sha256sum | awk '{print $1}'
}

init_repo_memory_paths() {
  if [ "$KASEKI_REPO_MEMORY_MODE" != "summary" ]; then
    REPO_MEMORY_STATUS="disabled"
    return 0
  fi
  REPO_MEMORY_KEY="$(compute_repo_memory_key)"
  REPO_MEMORY_DIR="$KASEKI_REPO_MEMORY_ROOT/$REPO_MEMORY_KEY"
  REPO_MEMORY_FILE="$REPO_MEMORY_DIR/summary.md"
  REPO_MEMORY_STATUS="enabled"
}

repo_memory_is_fresh() {
  local memory_file="$1"
  local now modified ttl_seconds age_seconds size_bytes
  [ -f "$memory_file" ] || return 1
  size_bytes="$(wc -c < "$memory_file" 2>/dev/null | tr -d ' ' || printf '0')"
  [ "$size_bytes" -gt 0 ] || return 1
  [ "$size_bytes" -le "$KASEKI_REPO_MEMORY_MAX_BYTES" ] || return 1
  now="$(date +%s)"
  modified="$(stat -c %Y "$memory_file" 2>/dev/null || printf '0')"
  ttl_seconds=$((KASEKI_REPO_MEMORY_TTL_DAYS * 86400))
  age_seconds=$((now - modified))
  [ "$age_seconds" -ge 0 ] && [ "$age_seconds" -le "$ttl_seconds" ]
}

read_repo_memory_section() {
  init_repo_memory_paths
  [ "$KASEKI_REPO_MEMORY_MODE" = "summary" ] || return 0
  if ! repo_memory_is_fresh "$REPO_MEMORY_FILE"; then
    REPO_MEMORY_STATUS="miss_or_expired"
    return 0
  fi
  REPO_MEMORY_STATUS="hit"
  {
    printf '\n\n---\nPrior repository context (opt-in cache; use only as efficiency hints, not authoritative source of truth):\n'
    head -c "$KASEKI_REPO_MEMORY_MAX_BYTES" "$REPO_MEMORY_FILE"
    printf '\n---\n'
  }
}

write_repo_memory_summary() {
  [ "$KASEKI_REPO_MEMORY_MODE" = "summary" ] || return 0
  [ "$KASEKI_DRY_RUN" != "1" ] || return 0
  init_repo_memory_paths
  [ -n "$REPO_MEMORY_FILE" ] || return 0
  [ "$PI_EXIT" -eq 0 ] || return 0
  [ "$SECRET_SCAN_EXIT" -eq 0 ] || return 0
  if [ "$STATUS" -ne 0 ] && [ "$KASEKI_TASK_MODE" != "inspect" ]; then
    return 0
  fi
  if ! mkdir -p "$REPO_MEMORY_DIR" 2>/dev/null; then
    emit_error_event "repo_memory_unavailable" "Cannot create repository memory directory $REPO_MEMORY_DIR" "continue"
    return 0
  fi
  local updated_at
  REPO_MEMORY_COMMIT_SHA="$(git -C /workspace/repo rev-parse HEAD 2>/dev/null || printf 'unknown')"
  updated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  node - "$KASEKI_REPO_MEMORY_MAX_BYTES" "$REPO_MEMORY_FILE" "$KASEKI_RESULTS_DIR" "$REPO_URL" "$GIT_REF" "$REPO_MEMORY_COMMIT_SHA" "$updated_at" "$KASEKI_TASK_MODE" "$STATUS" "$PI_EXIT" "$VALIDATION_EXIT" "$QUALITY_EXIT" "$SECRET_SCAN_EXIT" <<'NODE' || {
const fs = require('fs');
const path = require('path');
const [maxBytesArg, outputFile, resultsDir, repoUrl, gitRef, commitSha, timestamp, taskMode, status, piExit, validationExit, qualityExit, secretScanExit] = process.argv.slice(2);
const maxBytes = Math.max(1024, Number(maxBytesArg) || 8000);

function readFile(file, maxChars = 12000) {
  try {
    return fs.readFileSync(file, 'utf8').slice(0, maxChars);
  } catch {
    return '';
  }
}

function sanitize(text) {
  return String(text || '')
    .split(/\r?\n/)
    .filter((line) => !/(secret|credential|password|api[_ -]?key|token|bearer|authorization|private[_ -]?key|openrouter|task prompt|user prompt|^Task:)/i.test(line))
    .map((line) => line.replace(/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED_SECRET]').replace(/gh[pousr]_[A-Za-z0-9_]{12,}/g, '[REDACTED_SECRET]'))
    .join('\n')
    .trim();
}

function compactLines(text, limit = 16) {
  const lines = sanitize(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^Artifacts:?$/i.test(line) && !/^[-*] .*\.log( |$)/i.test(line));
  return lines.slice(0, limit);
}

function changedFiles() {
  return sanitize(readFile(path.join(resultsDir, 'changed-files.txt'), 4000))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 40);
}

function validationOutcomes() {
  const rows = sanitize(readFile(path.join(resultsDir, 'validation-timings.tsv'), 8000))
    .split(/\r?\n/)
    .map((line) => line.split('\t'))
    .filter((parts) => parts.length >= 2 && parts[0]);
  if (!rows.length) return ['No per-command validation timings recorded.'];
  return rows.slice(0, 20).map(([command, exitCode, duration]) => `${command}: exit ${exitCode}${duration ? `, ${duration}s` : ''}`);
}

const resultLines = compactLines(readFile(path.join(resultsDir, 'result-summary.md')));
const analysisLines = compactLines(readFile(path.join(resultsDir, 'analysis.md')), 10);
const files = changedFiles();
const validations = validationOutcomes();

let output = `# Repository Memory Summary\n\n` +
  `> Opt-in efficiency cache only. Treat this as prior context hints, not authoritative source of truth; inspect the repository before relying on it.\n\n` +
  `- Repo URL: ${repoUrl}\n` +
  `- Default ref: ${gitRef}\n` +
  `- Commit SHA: ${commitSha}\n` +
  `- Updated at: ${timestamp}\n` +
  `- Last run mode: ${taskMode}\n` +
  `- Exit status: overall ${status}, agent ${piExit}, validation ${validationExit}, quality ${qualityExit}, secret scan ${secretScanExit}\n` +
  `\n## Last run summary\n` +
  (resultLines.length ? resultLines.map((line) => `- ${line.replace(/^[-*]\s*/, '')}`).join('\n') : '- No result summary available.') +
  `\n\n## Changed files\n` +
  (files.length ? files.map((file) => `- ${file}`).join('\n') : '- none') +
  `\n\n## Validation outcomes\n` +
  validations.map((line) => `- ${line}`).join('\n');

if (analysisLines.length) {
  output += `\n\n## Sanitized analysis notes\n` + analysisLines.map((line) => `- ${line.replace(/^[-*]\s*/, '')}`).join('\n');
}

const marker = '\n\n<!-- repo-memory-truncated -->\n';
let buffer = Buffer.from(output + '\n', 'utf8');
if (buffer.length > maxBytes) {
  buffer = Buffer.from(output.slice(0, Math.max(0, maxBytes - Buffer.byteLength(marker))) + marker, 'utf8');
}
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, buffer);
NODE
    emit_error_event "repo_memory_write_failed" "Failed to update repository memory summary" "continue"
    return 0
  }
  REPO_MEMORY_STATUS="updated"
  emit_event "repo_memory_updated" "mode=$KASEKI_REPO_MEMORY_MODE" "repo_key=$REPO_MEMORY_KEY" "summary=$REPO_MEMORY_FILE" "max_bytes=$KASEKI_REPO_MEMORY_MAX_BYTES"
}

build_agent_prompt() {
  local memory_section scouting_section retry_section
  memory_section="$(read_repo_memory_section)"
  scouting_section=""
  retry_section=""
  if [ -s "$SCOUTING_ARTIFACT" ]; then
    scouting_section="
Scouting artifact:
- A preceding read-only Pi scouting run researched this task and wrote its JSON findings to $SCOUTING_ARTIFACT.
- Read that artifact before coding. Treat it as planning input, then verify important details against the current repository."
  fi
  if [ -n "$GOAL_CHECK_RETRY_PROMPT" ]; then
    retry_section="
Goal-check retry guidance:
- A post-validation goal-check Pi evaluator found the previous coding attempt did not fully realize the scouting objective.
- Address this feedback while preserving valid existing work:
$GOAL_CHECK_RETRY_PROMPT"
  fi
  if [ "$KASEKI_AGENT_GUARDRAILS" != "1" ]; then
    printf '%s' "$TASK_PROMPT"
    printf '%s' "$memory_section"
    printf '%s' "$scouting_section"
    printf '%s' "$retry_section"
    return 0
  fi

  cat <<EOF
You are editing inside a Kaseki-managed ephemeral workspace.

Operational guardrails:
- Do not run git add, git commit, git push, gh, hub, or create pull requests. Kaseki owns commit, push, and PR creation after validation passes.
- Do not run npm install, npm ci, yarn install, pnpm install, or package-manager commands that modify lockfiles. Kaseki owns dependency setup and validation.
- Keep edits limited to the requested source and test files. If a tool or command changes unrelated files, restore those unrelated files before finishing.
- Do not print, inspect, or expose environment variables, secrets, credentials, API keys, or mounted secret files.

Task:
$TASK_PROMPT
$memory_section
$scouting_section
$retry_section
EOF
}

build_scouting_prompt() {
  cat <<EOF
You are a read-only scouting Pi agent inside a Kaseki-managed ephemeral workspace.

Research the task before a separate coding agent starts:
- Inspect the repository and relevant files needed to understand the task.
- Do not edit source files, tests, lockfiles, or git state.
- Do not run git add, git commit, git push, gh, hub, package installation, or validation commands that modify files.
- Do not print, inspect, or expose environment variables, secrets, credentials, API keys, or mounted secret files.
- The repository tree is read-only during scouting. Write exactly one JSON object to $SCOUTING_CANDIDATE_ARTIFACT.

The JSON object must be concise and useful to the coding agent. Use this shape:
{
  "task": "brief task interpretation",
  "requirements": ["important requirements and constraints"],
  "relevant_files": [{"path": "repo-relative path", "reason": "why it matters"}],
  "observations": ["facts learned from repository inspection"],
  "plan": ["ordered coding steps"],
  "validation": ["focused commands or checks to run"],
  "risks": ["uncertainties, edge cases, or assumptions"],
  "suggested_allowlist": {
    "agent_patterns": ["glob patterns for files the coding agent should modify"],
    "validation_patterns": ["glob patterns for files validation commands may touch"]
  }
}

Guidelines for suggested_allowlist:
- agent_patterns: Glob patterns narrowing which files the coding agent can modify. Use specific files (e.g., "src/parser.ts") or directories (e.g., "src/**", "tests/**"). If many related files, use broad patterns like "src/**.ts".
- validation_patterns: Glob patterns for files that validation commands (npm test, npm run lint, etc.) may legitimately modify. Often identical to agent_patterns, but may differ (e.g., allow ".coverage" or "node_modules/" if generated during validation).
- Both arrays can be empty if the task scope is unclear; the coding agent will work without allowlist constraints.
- Prefer accurate scope over convenience: too-broad patterns defeat the purpose; too-narrow patterns will require restoration.

Raw task prompt:
$TASK_PROMPT
EOF
}

run_scouting_agent() {
  local scouting_prompt scouting_start scout_dirty_before scout_dirty_after

  printf '\n==> pi scouting agent\n'
  set_current_stage "pi scouting agent"
  if [ "$KASEKI_SCOUTING" = "0" ]; then
    printf 'Pi scouting agent skipped because KASEKI_SCOUTING=0.\n' | tee -a /results/scouting-stderr.log
    record_stage_timing "pi scouting agent" 0 0 "skipped_by_config"
    return 0
  fi
  if [ "$KASEKI_DRY_RUN" = "1" ]; then
    printf 'DRY-RUN: Pi scouting agent would inspect the task before coding.\n' | tee -a /results/scouting-stderr.log
    record_stage_timing "pi scouting agent" 0 0 "dry_run=true"
    return 0
  fi

  scouting_prompt="$(build_scouting_prompt)"
  scouting_start="$(date +%s)"
  scout_dirty_before="$(git status --porcelain 2>> /results/scouting-stderr.log || true)"
  chmod -R a-w /workspace/repo 2>> /results/scouting-stderr.log || true
  set +e
  OPENROUTER_API_KEY="$openrouter_api_key" \
    timeout --signal=SIGTERM "$KASEKI_SCOUTING_TIMEOUT_SECONDS" \
    pi --mode json --no-session --provider "$KASEKI_PROVIDER" --model "$KASEKI_SCOUTING_MODEL" "$scouting_prompt" \
    2> >(tee -a /results/scouting-stderr.log >&2) \
    | tee "$SCOUTING_RAW_EVENTS" \
    | kaseki-pi-progress-stream /results/progress.jsonl /results/progress.log
  SCOUTING_EXIT="${PIPESTATUS[0]}"
  SCOUTING_DURATION_SECONDS=$(($(date +%s) - scouting_start))
  unset scouting_prompt
  set +e
  chmod -R u+w /workspace/repo 2>> /results/scouting-stderr.log || true

  if [ "$SCOUTING_EXIT" -eq 0 ] && ! node -e '
const fs=require("node:fs");
const input=process.argv[1];
const output=process.argv[2];
const artifact=JSON.parse(fs.readFileSync(input,"utf8"));
const arrayKeys=["requirements","relevant_files","observations","plan","validation","risks"];
const invalid=[];

if (!artifact || Array.isArray(artifact) || typeof artifact !== "object") invalid.push("root");
if (typeof artifact.task !== "string" || !artifact.task.trim()) invalid.push("task");
for (const key of arrayKeys) if (!Array.isArray(artifact[key])) invalid.push(key);
if (Array.isArray(artifact.relevant_files) && artifact.relevant_files.some((item) => !item || typeof item.path !== "string" || typeof item.reason !== "string")) invalid.push("relevant_files entries");

// Validate suggested_allowlist (optional but if present, must be valid)
if (artifact.suggested_allowlist) {
  if (typeof artifact.suggested_allowlist !== "object" || Array.isArray(artifact.suggested_allowlist)) {
    invalid.push("suggested_allowlist");
  } else {
    if (!Array.isArray(artifact.suggested_allowlist.agent_patterns)) invalid.push("suggested_allowlist.agent_patterns");
    if (!Array.isArray(artifact.suggested_allowlist.validation_patterns)) invalid.push("suggested_allowlist.validation_patterns");
    if (Array.isArray(artifact.suggested_allowlist.agent_patterns) && !artifact.suggested_allowlist.agent_patterns.every((p) => typeof p === "string")) invalid.push("suggested_allowlist.agent_patterns values");
    if (Array.isArray(artifact.suggested_allowlist.validation_patterns) && !artifact.suggested_allowlist.validation_patterns.every((p) => typeof p === "string")) invalid.push("suggested_allowlist.validation_patterns values");
  }
} else {
  // Initialize empty suggested_allowlist if not provided
  artifact.suggested_allowlist = { agent_patterns: [], validation_patterns: [] };
}

if (invalid.length) throw new Error("invalid scouting fields: " + invalid.join(", "));
fs.writeFileSync(output, JSON.stringify(artifact, null, 2) + "\n");
' "$SCOUTING_CANDIDATE_ARTIFACT" "$SCOUTING_ARTIFACT" 2>> /results/scouting-stderr.log; then
    SCOUTING_EXIT=86
    emit_error_event "pi_scouting_artifact_invalid" "Pi scouting did not write a schema-valid JSON handoff to $SCOUTING_CANDIDATE_ARTIFACT" "exit"
  fi
  scout_dirty_after="$(git status --porcelain 2>> /results/scouting-stderr.log || true)"
  if [ "$SCOUTING_EXIT" -eq 0 ] && [ "$scout_dirty_before" != "$scout_dirty_after" ]; then
    SCOUTING_EXIT=86
    emit_error_event "pi_scouting_workspace_modified" "Read-only scouting changed repository state before coding" "exit"
  fi
  rm -f "$SCOUTING_CANDIDATE_ARTIFACT"
  git reset --hard -q HEAD 2>> /results/scouting-stderr.log || true
  git clean -fd -q 2>> /results/scouting-stderr.log || true
  kaseki-pi-event-filter "$SCOUTING_RAW_EVENTS" /results/scouting-events.jsonl /results/scouting-summary.json 2>> /results/scouting-stderr.log || cp "$SCOUTING_RAW_EVENTS" /results/scouting-events.raw.jsonl 2>/dev/null || true
  SCOUTING_ACTUAL_MODEL="$(node -e 'try { const s=require("/results/scouting-summary.json"); const v=String(s.selected_model || s.model || "").trim(); console.log(v && v !== "unknown" && v !== "null" ? v : "unknown"); } catch { console.log("unknown"); }' 2>/dev/null)"
  record_stage_timing "pi scouting agent" "$SCOUTING_EXIT" "$SCOUTING_DURATION_SECONDS" "artifact=$SCOUTING_ARTIFACT timeout_seconds=$KASEKI_SCOUTING_TIMEOUT_SECONDS"
  if [ "$SCOUTING_EXIT" -ne 0 ]; then
    STATUS="$SCOUTING_EXIT"
    FAILED_COMMAND="pi scouting agent"
    emit_error_event "pi_scouting_failed" "Scouting agent exited before the coding agent: $SCOUTING_EXIT" "exit"
    return 1
  fi
  emit_progress "pi scouting agent" "wrote scouting artifact"
  return 0
}

snapshot_attempt_artifacts() {
  local attempt_dir
  attempt_dir="/results/attempt-$1"
  mkdir -p "$attempt_dir" 2>/dev/null || return 0
  for artifact in \
    pi-events.jsonl pi-summary.json pi-stderr.log git.diff git.status changed-files.txt \
    quality.log validation.log validation-raw.log validation-timings.tsv goal-check.json; do
    if [ -e "/results/$artifact" ]; then
      cp "/results/$artifact" "$attempt_dir/$artifact" 2>/dev/null || true
    fi
  done
}

build_goal_check_prompt() {
  local validation_tail progress_tail
  validation_tail="$(tail -80 /results/validation.log 2>/dev/null || true)"
  progress_tail="$(tail -80 /results/progress.log 2>/dev/null || true)"
  cat <<EOF
You are a read-only goal-check Pi agent inside a Kaseki-managed ephemeral workspace.

Evaluate whether the coding agent's current repository changes realized the objective from the scouting report.

Inputs you must inspect:
- Original task prompt below.
- Scouting report JSON: $SCOUTING_ARTIFACT
- Current changed files: /results/changed-files.txt
- Current diff: /results/git.diff
- Current validation outcomes: /results/validation-timings.tsv and /results/validation.log
- Current coding-agent events summary: /results/pi-summary.json and /results/pi-events.jsonl

Rules:
- Do not edit files, git state, dependencies, or generated artifacts except writing exactly one JSON object to $GOAL_CHECK_CANDIDATE_ARTIFACT.
- Do not run git add, git commit, git push, gh, hub, package installation, or commands that modify files.
- Do not print, inspect, or expose environment variables, secrets, credentials, API keys, or mounted secret files.
- Decide whether the scouting requirements were realized, not whether the implementation is stylistically perfect.
- If the goal is not met, write a concrete retry_prompt for the next coding attempt.

Required JSON shape:
{
  "met": true,
  "confidence": "high",
  "summary": "brief verdict",
  "evidence": ["specific evidence that supports the verdict"],
  "missing": ["specific unmet requirements; empty when met"],
  "retry_prompt": "specific repair instructions for the coding agent; empty when met",
  "validation_notes": ["validation commands/results considered"]
}

Original task prompt:
$TASK_PROMPT

Validation log tail:
$validation_tail

Progress log tail:
$progress_tail
EOF
}

run_goal_check() {
  local attempt goal_prompt goal_start verdict_met retry_prompt verdict_summary confidence
  attempt="$1"
  GOAL_CHECK_ATTEMPTS="$attempt"
  GOAL_CHECK_EXIT=0
  GOAL_CHECK_MET=false
  GOAL_CHECK_FAILURE_REASON=""

  printf '\n==> goal check\n'
  set_current_stage "goal check"
  if [ "$KASEKI_GOAL_CHECK" != "1" ]; then
    printf 'Goal check skipped because KASEKI_GOAL_CHECK=%s.\n' "$KASEKI_GOAL_CHECK" | tee -a /results/goal-check-stderr.log
    record_stage_timing "goal check" 0 0 "skipped_by_config attempt=$attempt"
    return 0
  fi
  if [ ! -s "$SCOUTING_ARTIFACT" ]; then
    printf 'Goal check skipped because scouting artifact is unavailable.\n' | tee -a /results/goal-check-stderr.log
    record_stage_timing "goal check" 0 0 "skipped_no_scouting attempt=$attempt"
    return 0
  fi

  goal_prompt="$(build_goal_check_prompt)"
  goal_start="$(date +%s)"
  set +e
  OPENROUTER_API_KEY="$openrouter_api_key" \
    timeout --signal=SIGTERM "$KASEKI_GOAL_CHECK_TIMEOUT_SECONDS" \
    pi --mode json --no-session --provider "$KASEKI_PROVIDER" --model "$KASEKI_GOAL_CHECK_MODEL" "$goal_prompt" \
    2> >(tee -a /results/goal-check-stderr.log >&2) \
    | tee "$GOAL_CHECK_RAW_EVENTS" \
    | kaseki-pi-progress-stream /results/progress.jsonl /results/progress.log
  GOAL_CHECK_EXIT="${PIPESTATUS[0]}"
  unset goal_prompt
  GOAL_CHECK_DURATION_SECONDS=$((GOAL_CHECK_DURATION_SECONDS + $(date +%s) - goal_start))
  set +e

  if [ "$GOAL_CHECK_EXIT" -eq 0 ] && ! node -e '
const fs = require("node:fs");
const input = process.argv[1];
const output = process.argv[2];
const attempt = Number(process.argv[3]);
const invalid = [];
const artifact = JSON.parse(fs.readFileSync(input, "utf8"));
if (!artifact || Array.isArray(artifact) || typeof artifact !== "object") invalid.push("root");
if (typeof artifact.met !== "boolean") invalid.push("met");
if (!["low", "medium", "high"].includes(artifact.confidence)) invalid.push("confidence");
for (const key of ["summary", "retry_prompt"]) {
  if (typeof artifact[key] !== "string") invalid.push(key);
}
for (const key of ["evidence", "missing", "validation_notes"]) {
  if (!Array.isArray(artifact[key]) || !artifact[key].every((v) => typeof v === "string")) invalid.push(key);
}
if (!artifact.met && !artifact.retry_prompt.trim()) invalid.push("retry_prompt non-empty when unmet");
if (invalid.length) throw new Error("invalid goal-check fields: " + invalid.join(", "));
artifact.attempt = attempt;
artifact.timestamp = new Date().toISOString();
fs.writeFileSync(output, JSON.stringify(artifact, null, 2) + "\n");
fs.appendFileSync("/results/goal-check-attempts.jsonl", JSON.stringify(artifact) + "\n");
' "$GOAL_CHECK_CANDIDATE_ARTIFACT" /results/goal-check.json "$attempt" 2>> /results/goal-check-stderr.log; then
    GOAL_CHECK_EXIT=86
    GOAL_CHECK_FAILURE_REASON="goal_check_artifact_invalid"
    emit_error_event "goal_check_artifact_invalid" "Goal-check Pi did not write a schema-valid JSON verdict" "continue"
  fi
  rm -f "$GOAL_CHECK_CANDIDATE_ARTIFACT"
  kaseki-pi-event-filter "$GOAL_CHECK_RAW_EVENTS" /results/goal-check-events.jsonl /results/goal-check-summary.json 2>> /results/goal-check-stderr.log || true
  GOAL_CHECK_ACTUAL_MODEL="$(node -e 'try { const s=require("/results/goal-check-summary.json"); const v=String(s.selected_model || s.model || "").trim(); console.log(v && v !== "unknown" && v !== "null" ? v : "unknown"); } catch { console.log("unknown"); }' 2>/dev/null)"

  if [ "$GOAL_CHECK_EXIT" -eq 0 ]; then
    verdict_met="$(node -e 'const v=require("/results/goal-check.json"); console.log(v.met ? "true" : "false")' 2>/dev/null || printf 'false')"
    retry_prompt="$(node -e 'const v=require("/results/goal-check.json"); console.log(v.retry_prompt || "")' 2>/dev/null || true)"
    verdict_summary="$(node -e 'const v=require("/results/goal-check.json"); console.log(v.summary || "")' 2>/dev/null || true)"
    confidence="$(node -e 'const v=require("/results/goal-check.json"); console.log(v.confidence || "unknown")' 2>/dev/null || true)"
    if [ "$verdict_met" = "true" ]; then
      GOAL_CHECK_MET=true
      GOAL_CHECK_RETRY_PROMPT=""
      GOAL_CHECK_FAILURE_REASON=""
      emit_progress "goal check" "met on attempt $attempt (confidence=$confidence)"
    else
      GOAL_CHECK_MET=false
      GOAL_CHECK_RETRY_PROMPT="$retry_prompt"
      GOAL_CHECK_FAILURE_REASON="${verdict_summary:-goal unmet}"
      emit_progress "goal check" "unmet on attempt $attempt (confidence=$confidence)"
    fi
  else
    GOAL_CHECK_MET=false
    [ -z "$GOAL_CHECK_FAILURE_REASON" ] && GOAL_CHECK_FAILURE_REASON="goal_check_failed_exit_$GOAL_CHECK_EXIT"
    GOAL_CHECK_RETRY_PROMPT="The goal-check evaluator failed to produce a valid passing verdict. Re-read $SCOUTING_ARTIFACT, inspect the current diff and validation logs, and repair any missing requirement before finishing."
  fi
  record_stage_timing "goal check" "$GOAL_CHECK_EXIT" "$(($(date +%s) - goal_start))" "attempt=$attempt met=$GOAL_CHECK_MET timeout_seconds=$KASEKI_GOAL_CHECK_TIMEOUT_SECONDS"
  return 0
}


parse_github_repo_url() {
  local repo_url repo_name
  repo_url="$1"
  GITHUB_REPO_OWNER=""
  GITHUB_REPO_NAME=""

  if [[ "$repo_url" =~ ^https?://github\.com/([^/]+)/([^/]+)(/|\.git)?$ ]]; then
    repo_name="${BASH_REMATCH[2]}"
    GITHUB_REPO_OWNER="${BASH_REMATCH[1]}"
    GITHUB_REPO_NAME="${repo_name%.git}"
    return 0
  fi

  return 1
}

parse_github_app_token_helper_failure() {
  local helper_stdout helper_stderr helper_exit_code
  helper_stdout="$1"
  helper_stderr="$2"
  helper_exit_code="$3"

  # shellcheck disable=SC2016,SC1078,SC1079,SC2026
  printf '%s' "$helper_stdout" | TOKEN_HELPER_STDERR="$helper_stderr" TOKEN_HELPER_EXIT_CODE="$helper_exit_code" node -e '
    const fs = require(\"fs\");
    const stdout = fs.readFileSync(0, 'utf8');
    const stderr = process.env.TOKEN_HELPER_STDERR || '';
    const exitCode = process.env.TOKEN_HELPER_EXIT_CODE || 'unknown';
    const sanitize = (value) => String(value || "")
      .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g, "[redacted private key]")
      .replace(/\b(?:gh[opsru]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[redacted token]")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted jwt]")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/ {2,}/g, " ")
      .trim();
    let error = "";
    let status = "";
    try {
      const parsed = JSON.parse(stdout || "{}");
      error = parsed.error || parsed.message || "";
      const candidateStatus = parsed.status || parsed.statusCode || parsed.http_status || parsed.httpStatus || "";
      if (/^[1-5][0-9]{2}$/.test(String(candidateStatus))) status = String(candidateStatus);
    } catch (_) {}
    error = sanitize(error);
    if (!error) error = sanitize(stderr);
    if (!error) error = `github-app-token helper exited with code ${exitCode}`;
    if (!status) {
      const match = error.match(/(?:HTTP(?: status)?|status(?: code)?)[^0-9]{0,12}([1-5][0-9]{2})/i);
      if (match) status = match[1];
    }
    process.stdout.write(`${error}\t${status}`);
  ' 2>/dev/null || printf 'github-app-token helper exited with code %s\t' "$helper_exit_code"
}


github_private_key_metadata_json() {
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
  "first_pem_header_line": $(printf '%s' "$first_pem_header_line" | json_encode),
  "pem_footer_present": $pem_footer_present,
  "sha256_fingerprint": $(printf '%s' "$sha256_fingerprint" | json_encode)
}
META
}

log_github_private_key_metadata() {
  local key_file="$1"
  local health_log="$2"
  local metadata_file="/results/github-app-private-key-metadata.json"
  github_private_key_metadata_json "$key_file" > "$metadata_file"
  printf '[health-check] GitHub App private key metadata: %s\n' "$(tr -d '\n' < "$metadata_file")" | tee -a "$health_log"
}


github_askpass_runtime_dir() {
  printf '%s\n' "${KASEKI_GITHUB_ASKPASS_DIR:-/results}"
}

create_github_askpass_helper() {
  local log_file log_prefix askpass_dir askpass_file username_smoke_output password_smoke_output
  log_file="${1:-/results/git-push.log}"
  log_prefix="${2:-[github-askpass]}"
  GITHUB_ASKPASS_FILE=""

  askpass_dir="$(github_askpass_runtime_dir)"
  if [ -z "$askpass_dir" ]; then
    printf '%s ERROR: GitHub credential helper directory is empty\n' "$log_prefix" | tee -a "$log_file" >&2
    GITHUB_PUSH_EXIT=8
    return 8
  fi

  if ! mkdir -p "$askpass_dir"; then
    printf '%s ERROR: Failed to create GitHub credential helper directory: %s\n' "$log_prefix" "$askpass_dir" | tee -a "$log_file" >&2
    GITHUB_PUSH_EXIT=8
    return 8
  fi

  askpass_file="$(mktemp "$askpass_dir/kaseki-github-askpass.XXXXXX")" || {
    printf '%s ERROR: Failed to create GitHub credential helper in executable runtime directory: %s\n' "$log_prefix" "$askpass_dir" | tee -a "$log_file" >&2
    GITHUB_PUSH_EXIT=8
    return 8
  }

  if ! cat > "$askpass_file" <<'EOF_ASKPASS'
#!/usr/bin/env bash
case "$1" in
  *Username*) printf '%s\n' x-access-token ;;
  *) printf '%s\n' "$KASEKI_GITHUB_TOKEN" ;;
esac
EOF_ASKPASS
  then
    rm -f "$askpass_file"
    printf '%s ERROR: Failed to write GitHub credential helper: %s\n' "$log_prefix" "$askpass_file" | tee -a "$log_file" >&2
    GITHUB_PUSH_EXIT=8
    return 8
  fi

  if ! chmod 0700 "$askpass_file"; then
    rm -f "$askpass_file"
    printf '%s ERROR: Failed to make GitHub credential helper executable: %s\n' "$log_prefix" "$askpass_file" | tee -a "$log_file" >&2
    GITHUB_PUSH_EXIT=8
    return 8
  fi

  username_smoke_output="$(KASEKI_GITHUB_TOKEN='__kaseki_askpass_smoke_token__' "$askpass_file" 'Username for https://github.com' 2>/dev/null)" || {
    rm -f "$askpass_file"
    printf '%s ERROR: GitHub askpass helper is not executable from %s\n' "$log_prefix" "$askpass_dir" | tee -a "$log_file" >&2
    GITHUB_PUSH_EXIT=8
    return 8
  }
  if [ "$username_smoke_output" != "x-access-token" ]; then
    rm -f "$askpass_file"
    printf '%s ERROR: GitHub credential helper smoke check returned unexpected username response\n' "$log_prefix" | tee -a "$log_file" >&2
    GITHUB_PUSH_EXIT=8
    return 8
  fi

  password_smoke_output="$(KASEKI_GITHUB_TOKEN='__kaseki_askpass_smoke_token__' "$askpass_file" 'Password for https://github.com' 2>/dev/null)" || {
    rm -f "$askpass_file"
    printf '%s ERROR: GitHub askpass helper is not executable from %s\n' "$log_prefix" "$askpass_dir" | tee -a "$log_file" >&2
    GITHUB_PUSH_EXIT=8
    return 8
  }
  if [ -z "$password_smoke_output" ]; then
    rm -f "$askpass_file"
    printf '%s ERROR: GitHub credential helper smoke check returned empty password response\n' "$log_prefix" | tee -a "$log_file" >&2
    GITHUB_PUSH_EXIT=8
    return 8
  fi

  GITHUB_ASKPASS_FILE="$askpass_file"
  return 0
}

check_github_operations_health() {
  # Preflight health check for github operations before pi agent runs
  # Tests: GitHub App secrets, git config, Node.js token generation capability
  local health_log="/results/github-health-check.log"
  : > "$health_log"
  
  printf '[preflight] github operations health check started\n' | tee -a "$health_log"
  
  # must match host preflight/API secret resolution contract.
  local github_app_id_file github_app_client_id_file github_app_private_key_file
  github_app_id_file="$(resolve_github_secret_file "GITHUB_APP_ID_FILE" "github_app_id")"
  github_app_client_id_file="$(resolve_github_secret_file "GITHUB_APP_CLIENT_ID_FILE" "github_app_client_id")"
  github_app_private_key_file="$(resolve_github_secret_file "GITHUB_APP_PRIVATE_KEY_FILE" "github_app_private_key")"
  
  if ! [ -r "$github_app_id_file" ]; then
    printf '[health-check] ERROR: Cannot read GitHub App ID from %s\n' "$github_app_id_file" | tee -a "$health_log" >&2
    return 1
  fi
  if ! [ -r "$github_app_client_id_file" ]; then
    printf '[health-check] ERROR: Cannot read GitHub App client ID from %s\n' "$github_app_client_id_file" | tee -a "$health_log" >&2
    return 1
  fi
  if ! [ -r "$github_app_private_key_file" ]; then
    printf '[health-check] ERROR: Cannot read GitHub App private key from %s\n' "$github_app_private_key_file" | tee -a "$health_log" >&2
    return 1
  fi
  log_github_private_key_metadata "$github_app_private_key_file" "$health_log"
  printf '[health-check] ✓ GitHub App secrets are readable\n' | tee -a "$health_log"
  
  # Check 2: Verify git is available
  if ! git --version >/dev/null 2>&1; then
    printf '[health-check] ERROR: git command is not available\n' | tee -a "$health_log" >&2
    return 1
  fi
  printf '[health-check] ✓ git is available\n' | tee -a "$health_log"
  
  # Check 3: Test Node.js github-app-token helper file exists and is executable
  if ! [ -x /usr/local/bin/github-app-token ]; then
    printf '[health-check] ERROR: github-app-token helper not found at /usr/local/bin/github-app-token\n' | tee -a "$health_log" >&2
    return 1
  fi
  printf '[health-check] ✓ github-app-token helper file exists and is executable\n' | tee -a "$health_log"
  
  # Check 4: Test Node.js is available
  if ! command -v node >/dev/null 2>&1; then
    printf '[health-check] ERROR: Node.js is not available\n' | tee -a "$health_log" >&2
    return 1
  fi
  printf '[health-check] ✓ Node.js is available\n' | tee -a "$health_log"
  
  # Check 5: Test Node.js JSON parsing
  local test_output
  test_output=$(printf '{"test":"value"}' | node -e "const d = JSON.parse(require('fs').readFileSync(0, 'utf8')); process.stdout.write(d.test);" 2>&1) || {
    printf '[health-check] ERROR: Node.js JSON parsing failed: %s\n' "$test_output" | tee -a "$health_log" >&2
    return 1
  }
  if [ "$test_output" != "value" ]; then
    printf '[health-check] ERROR: Node.js JSON parsing returned unexpected output: %s\n' "$test_output" | tee -a "$health_log" >&2
    return 1
  fi
  printf '[health-check] ✓ Node.js JSON parsing works\n' | tee -a "$health_log"
  
  # Check 6: Test github-app-token helper can start and resolve runtime imports
  local helper_probe_stdout_tmp helper_probe_stderr_tmp helper_probe_exit_code helper_probe_stdout helper_probe_stderr helper_probe_parse_result helper_probe_error
  helper_probe_stdout_tmp="$(mktemp /tmp/github-health-helper-probe-stdout.XXXXXX)" || {
    printf '[health-check] ERROR: Failed to create helper load probe stdout temp file\n' | tee -a "$health_log" >&2
    return 1
  }
  helper_probe_stderr_tmp="$(mktemp /tmp/github-health-helper-probe-stderr.XXXXXX)" || {
    printf '[health-check] ERROR: Failed to create helper load probe stderr temp file\n' | tee -a "$health_log" >&2
    rm -f "$helper_probe_stdout_tmp"
    return 1
  }

  /usr/local/bin/github-app-token >"$helper_probe_stdout_tmp" 2>"$helper_probe_stderr_tmp"
  helper_probe_exit_code=$?
  helper_probe_stdout="$(cat "$helper_probe_stdout_tmp" 2>/dev/null || true)"
  helper_probe_stderr="$(cat "$helper_probe_stderr_tmp" 2>/dev/null || true)"
  rm -f "$helper_probe_stdout_tmp" "$helper_probe_stderr_tmp"

  if [ "$helper_probe_exit_code" -eq 0 ] || ! printf '%s\n%s' "$helper_probe_stdout" "$helper_probe_stderr" | grep -qi 'usage:.*github-app-token'; then
    helper_probe_parse_result="$(parse_github_app_token_helper_failure "$helper_probe_stdout" "$helper_probe_stderr" "$helper_probe_exit_code")"
    helper_probe_error="${helper_probe_parse_result%%$'\t'*}"
    if printf '%s\n%s' "$helper_probe_stdout" "$helper_probe_stderr" | grep -Eq 'github-app-private-key(\.js)?'; then
      helper_probe_error='missing dependency github-app-private-key.js'
    fi
    printf '[health-check] ERROR: github-app-token helper failed to load: %s\n' "$helper_probe_error" | tee -a "$health_log" >&2
    return 1
  fi
  printf '[health-check] ✓ github-app-token helper can start and resolve imports\n' | tee -a "$health_log"

  # Check 7: Test curl is available
  if ! command -v curl >/dev/null 2>&1; then
    printf '[health-check] ERROR: curl is not available\n' | tee -a "$health_log" >&2
    return 1
  fi
  printf '[health-check] ✓ curl is available\n' | tee -a "$health_log"

  # Check 8: Optional live GitHub App auth smoke test. Enabled by default
  # (KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK=1) so startup does not report a full
  # GitHub preflight pass when credentials are readable but cannot mint an
  # installation token for REPO_URL. Set KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK=0
  # to skip this networked auth check; the later GitHub operations stage will
  # still attempt token generation and report any failure.
  if [ "${KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK:-1}" = "1" ]; then
    local owner repo app_id token_stdout_tmp token_stderr_tmp token_exit_code token_data token_stderr token_parse_result token_error
    if parse_github_repo_url "$REPO_URL"; then
      owner="$GITHUB_REPO_OWNER"
      repo="$GITHUB_REPO_NAME"
      app_id="$(cat "$github_app_id_file" 2>/dev/null)" || app_id=""
      if [ -z "$app_id" ]; then
        printf '[health-check] ERROR: Cannot read GitHub App ID for auth smoke test\n' | tee -a "$health_log" >&2
        return 1
      fi

      token_stdout_tmp="$(mktemp /tmp/github-health-token-stdout.XXXXXX)" || {
        printf '[health-check] ERROR: Failed to create token stdout temp file\n' | tee -a "$health_log" >&2
        return 1
      }
      token_stderr_tmp="$(mktemp /tmp/github-health-token-stderr.XXXXXX)" || {
        printf '[health-check] ERROR: Failed to create token stderr temp file\n' | tee -a "$health_log" >&2
        rm -f "$token_stdout_tmp"
        return 1
      }

      /usr/local/bin/github-app-token "$app_id" "$github_app_private_key_file" "$owner" "$repo" >"$token_stdout_tmp" 2>"$token_stderr_tmp"
      token_exit_code=$?
      token_data="$(cat "$token_stdout_tmp" 2>/dev/null || true)"
      token_stderr="$(cat "$token_stderr_tmp" 2>/dev/null || true)"
      rm -f "$token_stdout_tmp" "$token_stderr_tmp"

      if [ "$token_exit_code" -ne 0 ]; then
        token_parse_result="$(parse_github_app_token_helper_failure "$token_data" "$token_stderr" "$token_exit_code")"
        token_error="${token_parse_result%%$'\t'*}"
        printf '[health-check] ERROR: GitHub App token generation failed for owner/repo: %s\n' "$token_error" | tee -a "$health_log" >&2
        return 1
      fi

      printf '[health-check] ✓ GitHub App token generation works for owner/repo\n' | tee -a "$health_log"

      # After token generation succeeds, exercise the same askpass helper path used by git push.
      local askpass_file
      if ! create_github_askpass_helper "$health_log" '[health-check]'; then
        return 1
      fi
      askpass_file="$GITHUB_ASKPASS_FILE"
      rm -f "$askpass_file"
      printf '[health-check] ✓ GitHub askpass helper returned expected username and non-empty password responses from: %s\n' "$(github_askpass_runtime_dir)" | tee -a "$health_log"
    else
      printf '[health-check] SKIP: Cannot parse GitHub repo URL for auth smoke test: %s\n' "$REPO_URL" | tee -a "$health_log"
    fi
  else
    printf '[health-check] SKIP: GitHub App auth smoke test disabled (KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK=%s)\n' "${KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK:-}" | tee -a "$health_log"
  fi
  
  printf '[preflight] github operations health check PASSED\n' | tee -a "$health_log"
  return 0
}

# must match host preflight/API secret resolution contract.
# Resolves GitHub App secret paths with debug logging (when KASEKI_DEBUG_SECRETS=1)
resolve_github_secret_file() {
  local env_name="$1"
  local default_name="$2"
  local explicit_value="" canonical_path local_dev_path debug_mode
  
  debug_mode="${KASEKI_DEBUG_SECRETS:-0}"
  
  # Check if explicit path is set via environment variable
  explicit_value="${!env_name:-}"
  if [ -n "$explicit_value" ]; then
    if [ "$debug_mode" = "1" ]; then
      printf '[debug-secrets] %s: Using explicit env var path: %s\n' "$env_name" "$explicit_value" >&2
    fi
    printf '%s' "$explicit_value"
    return 0
  fi
  
  # Try canonical path (root level for GitHub secrets due to Phase 2 fix)
  canonical_path="${KASEKI_SECRETS_DIR:-/run/secrets/kaseki}/$default_name"
  if [ "$debug_mode" = "1" ]; then
    printf '[debug-secrets] %s: No explicit env var, checking canonical path: %s\n' "$env_name" "$canonical_path" >&2
  fi
  
  if [ -r "$canonical_path" ]; then
    if [ "$debug_mode" = "1" ]; then
      printf '[debug-secrets] %s: ✓ Found at canonical path: %s\n' "$env_name" "$canonical_path" >&2
    fi
    printf '%s' "$canonical_path"
    return 0
  fi
  
  if [ "$debug_mode" = "1" ]; then
    printf '[debug-secrets] %s: ✗ Canonical path not found or not readable: %s\n' "$env_name" "$canonical_path" >&2
  fi
  
  # Try legacy path (backward compatibility with run-kaseki.sh mounts)
  local_legacy_path="/run/secrets/$default_name"
  if [ "$debug_mode" = "1" ]; then
    printf '[debug-secrets] %s: Checking legacy root path: %s\n' "$env_name" "$local_legacy_path" >&2
  fi
  if [ -r "$local_legacy_path" ]; then
    if [ "$debug_mode" = "1" ]; then
      printf '[debug-secrets] %s: ✓ Found at legacy path: %s\n' "$env_name" "$local_legacy_path" >&2
    fi
    printf '%s' "$local_legacy_path"
    return 0
  fi
  
  if [ "$debug_mode" = "1" ]; then
    printf '[debug-secrets] %s: ✗ Legacy path not found or not readable: %s\n' "$env_name" "$local_legacy_path" >&2
  fi
  
  # Try local dev fallback if allowed
  if [ "$KASEKI_ALLOW_LOCAL_DEV_SECRET_FALLBACK" = "1" ]; then
    local_dev_path="$HOME/.kaseki/secrets/$default_name"
    if [ "$debug_mode" = "1" ]; then
      printf '[debug-secrets] %s: Checking local dev fallback: %s\n' "$env_name" "$local_dev_path" >&2
    fi
    if [ -r "$local_dev_path" ]; then
      if [ "$debug_mode" = "1" ]; then
        printf '[debug-secrets] %s: ✓ Found at local dev fallback: %s\n' "$env_name" "$local_dev_path" >&2
      fi
      printf '%s' "$local_dev_path"
      return 0
    fi
    if [ "$debug_mode" = "1" ]; then
      printf '[debug-secrets] %s: ✗ Local dev fallback not found or not readable: %s\n' "$env_name" "$local_dev_path" >&2
    fi
  fi
  
  # Return canonical path even if not found (for error reporting in health check)
  if [ "$debug_mode" = "1" ]; then
    printf '[debug-secrets] %s: Returning canonical path (file may not exist): %s\n' "$env_name" "$canonical_path" >&2
  fi
  printf '%s' "$canonical_path"
}

validate_github_api_response() {
  local http_status response log_file error_type error_message
  http_status="$1"
  response="$2"
  log_file="${3:-/results/git-push.log}"
  
  # Try to parse error info from response
  error_type="unknown"
  error_message=""
  
  if [ "$http_status" = "201" ]; then
    # Success - but still need to verify html_url exists
    return 0
  fi
  
  # Attempt to extract error info using Node.js
  {
    error_message=$(printf '%s' "$response" | node -e "
      try {
        const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
        if (d.message) process.stdout.write(d.message);
      } catch (e) {}
    " 2>/dev/null || true)
  }
  
  # Map HTTP status to error type
  case "$http_status" in
    400)
      error_type="validation_error"
      [ -z "$error_message" ] && error_message="Bad request"
      ;;
    401)
      error_type="authentication_error"
      [ -z "$error_message" ] && error_message="Unauthorized (check GitHub App token)"
      ;;
    403)
      error_type="permission_error"
      [ -z "$error_message" ] && error_message="Permission denied (insufficient scope or rate limited)"
      ;;
    404)
      error_type="not_found_error"
      [ -z "$error_message" ] && error_message="Repository or branch not found"
      ;;
    422)
      error_type="validation_error"
      [ -z "$error_message" ] && error_message="Unprocessable entity (e.g., branch protection, duplicate PR)"
      ;;
    429)
      error_type="rate_limit_error"
      [ -z "$error_message" ] && error_message="Rate limited by GitHub API"
      ;;
    500|502|503|504)
      error_type="server_error"
      [ -z "$error_message" ] && error_message="GitHub API server error (HTTP $http_status)"
      ;;
    *)
      error_type="http_error"
      [ -z "$error_message" ] && error_message="HTTP $http_status"
      ;;
  esac
  
  printf 'GitHub API error (HTTP %s): %s - %s\n' "$http_status" "$error_type" "$error_message" | tee -a "$log_file" >&2
  
  # Store error info for logging
  GITHUB_API_ERROR_TYPE="$error_type"
  GITHUB_API_ERROR_MESSAGE="$error_message"
  GITHUB_API_HTTP_STATUS="$http_status"
  
  return 1
}


apply_github_pr_labels() {
  local owner repo issue_number token log_file label_payload label_status_file curl_exit response_with_status label_http_status label_response
  owner="$1"
  repo="$2"
  issue_number="$3"
  token="$4"
  log_file="${5:-/results/git-push.log}"

  if [ -z "$owner" ] || [ -z "$repo" ] || [ -z "$issue_number" ] || [ -z "$token" ]; then
    printf 'Warning: skipping PR label application because owner, repo, issue number, or token is missing\n' | tee -a "$log_file" >&2
    return 1
  fi

  if ! run_node_subprocess label_payload "const payload = { labels: ['kaseki-agent'] }; process.stdout.write(JSON.stringify(payload));" "" "$log_file"; then
    printf 'Warning: failed to JSON encode PR label payload; leaving PR unlabeled\n' | tee -a "$log_file" >&2
    return 1
  fi

  label_status_file="$(mktemp /tmp/kaseki-label-status.XXXXXX)" || {
    printf 'Warning: failed to create temp file for PR label status; leaving PR unlabeled\n' | tee -a "$log_file" >&2
    return 1
  }

  curl -s -w '%{http_code}' -X POST \
    -H "Authorization: token $token" \
    -H "Accept: application/vnd.github.v3+json" \
    -H "Content-Type: application/json" \
    "https://api.github.com/repos/$owner/$repo/issues/$issue_number/labels" \
    -d "$label_payload" > "$label_status_file" 2>&1
  curl_exit=$?

  response_with_status="$(cat "$label_status_file" 2>/dev/null || true)"
  label_http_status="${response_with_status: -3}"
  label_response="${response_with_status%???}"
  rm -f "$label_status_file"

  if [ "$curl_exit" -ne 0 ]; then
    printf 'Warning: failed to apply kaseki-agent label to PR #%s: curl exited with code %d\n' "$issue_number" "$curl_exit" | tee -a "$log_file" >&2
    return 1
  fi

  case "$label_http_status" in
    200|201)
      printf 'Applied kaseki-agent label to PR #%s\n' "$issue_number" | tee -a "$log_file"
      return 0
      ;;
    *)
      printf 'Warning: failed to apply kaseki-agent label to PR #%s (HTTP %s); preserving created PR\n' "$issue_number" "$label_http_status" | tee -a "$log_file" >&2
      if [ "${KASEKI_DEBUG:-0}" = "1" ]; then
        printf 'Debug: Label API response:\n%s\n' "$label_response" | tee -a "$log_file"
      fi
      return 1
      ;;
  esac
}

request_owner_review() {
  local pr_response token log_file owner_login owner_type pr_number repo owner
  pr_response="$1"
  token="$2"
  log_file="${3:-/results/git-push.log}"
  
  if [ -z "$pr_response" ] || [ -z "$token" ]; then
    printf 'Warning: skipping owner review request because PR response or token is missing\n' | tee -a "$log_file" >&2
    return 1
  fi

  # Extract repo owner login, owner type, PR number, and repo name from PR response
  owner_login=$(printf '%s' "$pr_response" | node -e "
    const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    if (data.base && data.base.repo && data.base.repo.owner) {
      process.stdout.write(data.base.repo.owner.login || '');
    }
  " 2>/dev/null || true)
  
  owner_type=$(printf '%s' "$pr_response" | node -e "
    const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    if (data.base && data.base.repo && data.base.repo.owner) {
      process.stdout.write(data.base.repo.owner.type || '');
    }
  " 2>/dev/null || true)
  
  pr_number=$(printf '%s' "$pr_response" | node -e "
    const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    process.stdout.write(String(data.number || ''));
  " 2>/dev/null || true)
  
  owner=$(printf '%s' "$pr_response" | node -e "
    const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    if (data.base && data.base.repo) {
      process.stdout.write(data.base.repo.owner.login || '');
    }
  " 2>/dev/null || true)
  
  repo=$(printf '%s' "$pr_response" | node -e "
    const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    if (data.base && data.base.repo) {
      process.stdout.write(data.base.repo.name || '');
    }
  " 2>/dev/null || true)
  
  # Validate extracted data
  if [ -z "$owner_login" ] || [ -z "$owner_type" ] || [ -z "$pr_number" ] || [ -z "$owner" ] || [ -z "$repo" ]; then
    printf 'Warning: failed to extract owner/PR data from PR response; skipping owner review request\n' | tee -a "$log_file" >&2
    if [ "${KASEKI_DEBUG:-0}" = "1" ]; then
      printf 'Debug: owner_login=%s owner_type=%s pr_number=%s owner=%s repo=%s\n' "$owner_login" "$owner_type" "$pr_number" "$owner" "$repo" | tee -a "$log_file"
    fi
    return 1
  fi
  
  # Skip if repo is owned by an organization (only request review on personal repos)
  if [ "$owner_type" != "User" ]; then
    printf 'Skipped owner review request: PR is on organization repo (owner_type=%s)\n' "$owner_type" | tee -a "$log_file"
    return 0
  fi
  
  # Build reviewer request payload
  local reviewer_payload
  if ! run_node_subprocess reviewer_payload "const payload = { reviewers: ['$owner_login'] }; process.stdout.write(JSON.stringify(payload));" "" "$log_file"; then
    printf 'Warning: failed to JSON encode reviewer payload; skipping owner review request\n' | tee -a "$log_file" >&2
    return 1
  fi
  
  # Request owner review with retry logic
  local retry_count=0 max_retries=2 request_success=0 backoff_delay=2
  local review_request_log="/results/owner-review-request.log"
  : > "$review_request_log"
  
  while [ $retry_count -le "$max_retries" ]; do
    if [ $retry_count -gt 0 ]; then
      printf 'Retrying owner review request (attempt %d of %d) after %ds delay...\n' $((retry_count + 1)) "$max_retries" "$backoff_delay" | tee -a "$log_file" >&2
      sleep "$backoff_delay"
      # Exponential backoff: 2s → 4s
      backoff_delay=$((backoff_delay * 2))
      if [ $backoff_delay -gt 4 ]; then backoff_delay=4; fi
    fi
    
    local review_status_file temp_response
    review_status_file="$(mktemp /tmp/kaseki-review-status.XXXXXX)" || {
      printf 'Warning: failed to create temp file for review request status\n' | tee -a "$log_file" >&2
      return 1
    }
    
    # Make the API request
    local curl_exit review_http_status review_response
    curl -s -w '%{http_code}' -X POST \
      -H "Authorization: token $token" \
      -H "Accept: application/vnd.github.v3+json" \
      -H "Content-Type: application/json" \
      "https://api.github.com/repos/$owner/$repo/pulls/$pr_number/requested_reviewers" \
      -d "$reviewer_payload" > "$review_status_file" 2>&1
    curl_exit=$?
    
    temp_response="$(cat "$review_status_file" 2>/dev/null || true)"
    review_http_status="${temp_response: -3}"
    review_response="${temp_response%???}"
    rm -f "$review_status_file"
    
    if [ "$curl_exit" -ne 0 ]; then
      printf 'Curl error requesting owner review (attempt %d): exit code %d\n' $((retry_count + 1)) "$curl_exit" | tee -a "$log_file" >&2
      retry_count=$((retry_count + 1))
      continue
    fi
    
    case "$review_http_status" in
      201)
        # Success: review request created
        printf '✓ Requested review from %s on PR #%s\n' "$owner_login" "$pr_number" | tee -a "$log_file" "$review_request_log"
        request_success=1
        break
        ;;
      422)
        # Unprocessable Entity: usually means reviewer already requested or invalid data
        printf 'ℹ Owner %s already has review request pending or user cannot be requested (HTTP 422)\n' "$owner_login" | tee -a "$log_file" "$review_request_log"
        request_success=1
        break
        ;;
      403)
        # Forbidden: insufficient permissions
        printf '✗ GitHub App lacks permission to request reviewers (HTTP 403)\n' | tee -a "$log_file" "$review_request_log" >&2
        printf '  Hint: Verify GitHub App has "Pull requests: write" permission\n' | tee -a "$log_file" "$review_request_log" >&2
        if [ "${KASEKI_DEBUG:-0}" = "1" ]; then
          printf 'Debug: Review API response:\n%s\n' "$review_response" | tee -a "$log_file"
        fi
        request_success=1  # Non-fatal; PR still created successfully
        break
        ;;
      404)
        # Not Found: user doesn't exist or repo not accessible
        printf '✗ Could not find user %s or PR %d is not accessible (HTTP 404)\n' "$owner_login" "$pr_number" | tee -a "$log_file" "$review_request_log" >&2
        request_success=1  # Non-fatal
        break
        ;;
      429)
        # Rate limited: retryable
        printf 'Rate limited requesting owner review (attempt %d); retrying...\n' $((retry_count + 1)) | tee -a "$log_file" >&2
        retry_count=$((retry_count + 1))
        continue
        ;;
      500|502|503|504)
        # Server errors: retryable
        printf 'GitHub API server error %s requesting owner review (attempt %d); retrying...\n' "$review_http_status" $((retry_count + 1)) | tee -a "$log_file" >&2
        retry_count=$((retry_count + 1))
        continue
        ;;
      *)
        # Unexpected status
        printf '✗ Unexpected HTTP status %s requesting owner review\n' "$review_http_status" | tee -a "$log_file" "$review_request_log" >&2
        if [ "${KASEKI_DEBUG:-0}" = "1" ]; then
          printf 'Debug: Review API response:\n%s\n' "$review_response" | tee -a "$log_file"
        fi
        request_success=1  # Non-fatal
        break
        ;;
    esac
  done
  
  if [ $request_success -eq 0 ]; then
    printf '✗ Failed to request owner review after %d retries\n' "$max_retries" | tee -a "$log_file" "$review_request_log" >&2
  fi
  
  # Always return 0: do not block PR creation if review request fails
  return 0
}

is_github_pr_error_retryable() {
  local http_status error_type
  http_status="$1"
  error_type="$2"
  
  # Retryable: transient errors
  case "$http_status" in
    429)
      # Rate limit (retryable)
      return 0
      ;;
    500|502|503|504)
      # Server errors (retryable)
      return 0
      ;;
    0)
      # curl failed (usually transient)
      return 0
      ;;
  esac
  
  # Non-retryable: permanent errors
  return 1
}

is_pr_draft_mode() {
  [ "${KASEKI_PUBLISH_MODE:-pr}" = "draft_pr" ]
}

is_pr_creation_mode() {
  case "${KASEKI_PUBLISH_MODE:-pr}" in
    auto|pr|draft_pr) return 0 ;;
    *) return 1 ;;
  esac
}


# Sanitize user/model-generated text before it is copied into GitHub PR metadata.
# The PR payload should be useful for reviewers without echoing raw environment
# values, credentials, or common token forms back to GitHub.
sanitize_pr_metadata_text() {
  tr '\r\n\t' '   ' \
    | tr -cd '\11\12\15\40-\176' \
    | sed -E 's/(gh[pousr]_[A-Za-z0-9_]+)/[redacted]/g; s/(sk-[A-Za-z0-9_-]+)/[redacted]/g; s/([A-Za-z0-9._%+-]+:x-oauth-basic)/[redacted]/Ig; s/((api|access|auth|bearer|github|openai|secret|token|password|credential)[_-]?(key|token|secret|password)?[[:space:]]*[=:][^[:space:]]+)/[redacted]/Ig' \
    | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//'
}

sanitize_pr_body_text() {
  tr '\r' '\n' \
    | tr -cd '\11\12\40-\176' \
    | sed -E 's/(gh[pousr]_[A-Za-z0-9_]+)/[redacted]/g; s/(sk-[A-Za-z0-9_-]+)/[redacted]/g; s/([A-Za-z0-9._%+-]+:x-oauth-basic)/[redacted]/Ig; s/((api|access|auth|bearer|github|openai|secret|token|password|credential)[_-]?(key|token|secret|password)?[[:space:]]*[=:][^[:space:]]+)/[redacted]/Ig' \
    | awk '
        {
          sub(/[[:blank:]]+$/, "")
          if ($0 ~ /^[[:blank:]]*$/) {
            blank++
            if (seen && blank == 1) print ""
          } else {
            seen=1
            blank=0
            print
          }
        }
      '
}

truncate_pr_metadata_text() {
  local max_length="$1"
  local text="$2"
  if [ "${#text}" -le "$max_length" ]; then
    printf '%s' "$text"
    return 0
  fi
  if [ "$max_length" -le 3 ]; then
    printf '%.*s' "$max_length" "$text"
    return 0
  fi
  printf '%.*s...' "$((max_length - 3))" "$text"
}

derive_pr_title() {
  local candidate summary_candidate stripped fallback prefix title suffix safe_instance max_title_length=72
  local available_summary_length changed_files prompt_for_prefix

  safe_instance="$(printf '%s' "${INSTANCE_NAME:-kaseki}" | sanitize_pr_metadata_text)"
  if [ -z "$safe_instance" ]; then
    safe_instance="kaseki"
  fi
  suffix=" ($safe_instance)"
  summary_candidate=""

  candidate="$(printf '%s' "${TASK_PROMPT:-}" | sanitize_pr_metadata_text)"
  prompt_for_prefix="$candidate"
  if [ -s /results/result-summary.md ]; then
    summary_candidate="$(
      awk '
        /^##[[:space:]]+Summary[[:space:]]*$/ { in_summary=1; next }
        in_summary && /^##[[:space:]]+/ { exit }
        in_summary {
          line=$0
          sub(/^[[:space:]]*[-*][[:space:]]+/, "", line)
          sub(/^[[:space:]]*[0-9]+[.)][[:space:]]+/, "", line)
          if (line !~ /^[[:space:]]*$/) { print line; exit }
        }
      ' /results/result-summary.md 2>/dev/null | sanitize_pr_metadata_text
    )"
  fi
  if [ -n "$summary_candidate" ]; then
    candidate="$summary_candidate"
  elif [ -z "$candidate" ] && [ -s /results/result-summary.md ]; then
    candidate="$(sed -n '/^- Status:/p; /^- Changed files:/p; /^- Validation:/p' /results/result-summary.md 2>/dev/null | head -n 3 | sanitize_pr_metadata_text)"
  fi

  candidate="$(printf '%s' "$candidate" | sed -E 's/^[[:space:]]*([0-9]+[.)]|[-*])[[:space:]]+//' | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g; s/(^|[[:space:]])[0-9]+[.)][[:space:]]+/\1/g; s/(^|[[:space:]])[-*][[:space:]]+/\1/g; s/userfacing/user-facing/Ig; s/customerfacing/customer-facing/Ig; s/front[ -]?end/frontend/Ig; s/back[ -]?end/backend/Ig; s/full[ -]?stack/full-stack/Ig; s/^[[:space:]]+//; s/[[:space:]]+$//')"

  stripped="$(printf '%s' "$candidate" | sed -E 's/^(task|request|please|implement|update|fix|add)[[:space:]:-]+//I')"
  if [ -n "$stripped" ] && [ "$stripped" != "$candidate" ]; then
    candidate="$stripped"
  fi

  changed_files="$(sanitize_pr_metadata_text < /results/changed-files.txt || true)"
  prefix="chore:"
  case "$(printf '%s %s' "$prompt_for_prefix" "$changed_files" | tr '[:upper:]' '[:lower:]')" in
    *doc*|*readme*|*.md*|*markdown*) prefix="docs:" ;;
    *fix*|*bug*|*error*|*fail*|*regression*|*broken*) prefix="fix:" ;;
    *test*|*spec*) prefix="test:" ;;
    *chore*|*config*|*ci*|*dependenc*|*build*) prefix="chore:" ;;
  esac

  fallback="chore: Kaseki agent changes$suffix"
  if [ -n "$candidate" ]; then
    available_summary_length=$((max_title_length - ${#prefix} - 1 - ${#suffix}))
    if [ "$available_summary_length" -gt 0 ]; then
      candidate="$(truncate_pr_metadata_text "$available_summary_length" "$candidate")"
      title="$prefix $candidate$suffix"
    else
      title="$prefix$suffix"
    fi
  else
    title="$fallback"
  fi

  if [ -z "$(printf '%s' "$title" | sanitize_pr_metadata_text)" ]; then
    title="$fallback"
  fi
  printf '%s' "$title"
}

format_pr_command_results() {
  local timings_file="$1"
  local include_failed_summary="${2:-0}"
  if [ ! -s "$timings_file" ]; then
    printf -- '- Not recorded\n'
    return 0
  fi

  local command exit_code duration detail safe_command safe_detail row rows=0 all_rows="" failed_rows=""
  while IFS=$'\t' read -r command exit_code duration detail || [ -n "$command" ]; do
    [ -n "$command" ] || continue
    safe_command="$(printf '%s' "$command" | sanitize_pr_metadata_text)"
    safe_detail="$(printf '%s' "${detail:-}" | sanitize_pr_metadata_text)"
    if [ -n "$safe_detail" ]; then
      row="- ${safe_command} — exit ${exit_code:-unknown}, ${duration:-0}s (${safe_detail})"
    else
      row="- ${safe_command} — exit ${exit_code:-unknown}, ${duration:-0}s"
    fi
    all_rows="${all_rows}${row}
"
    if [ "${exit_code:-0}" != "0" ]; then
      failed_rows="${failed_rows}${row}
"
    fi
    rows=$((rows + 1))
  done < "$timings_file"

  if [ "$rows" -eq 0 ]; then
    printf -- '- Not recorded\n'
    return 0
  fi

  if [ "$include_failed_summary" = "1" ] && [ -n "$failed_rows" ]; then
    printf '%b' "$failed_rows"
  else
    printf '%b' "$all_rows"
  fi
}

format_pr_changed_files() {
  local changed_files_file="/results/changed-files.txt"
  local details_threshold=8
  if [ ! -s "$changed_files_file" ]; then
    printf '0 files changed.\n'
    return 0
  fi

  local path safe_path rows=0 total=0 omitted=0 list_output=""
  while IFS= read -r path || [ -n "$path" ]; do
    [ -n "$path" ] || continue
    safe_path="$(printf '%s' "$path" | sanitize_pr_metadata_text)"
    safe_path="$(truncate_pr_metadata_text 300 "$safe_path")"
    [ -n "$safe_path" ] || continue
    total=$((total + 1))
    if [ "$rows" -lt 100 ]; then
      list_output="${list_output}- ${safe_path}
"
      rows=$((rows + 1))
    else
      omitted=1
    fi
  done < "$changed_files_file"

  if [ "$total" -eq 1 ]; then
    printf '1 file changed.\n'
  else
    printf '%s files changed.\n' "$total"
  fi

  if [ "$total" -eq 0 ]; then
    return 0
  fi

  if [ "$rows" -eq 100 ]; then
    omitted=1
  fi

  if [ "$total" -gt "$details_threshold" ]; then
    printf '\n<details><summary>View files</summary>\n\n'
    printf '%b' "$list_output"
    if [ "$omitted" -eq 1 ]; then
      printf -- '- ...additional changed files omitted\n'
    fi
    printf '\n</details>\n'
  else
    printf '%b' "$list_output"
  fi
}

build_pr_improvements_summary() {
  local changed_files_file="/results/changed-files.txt"
  local diff_file="/results/git.diff"
  local total=0 source_count=0 test_count=0 docs_count=0 config_count=0 other_count=0
  local path lower additions deletions summary_rows=0 summary_source=""
  local artifact raw_line line safe_line summary_capture=0 content json_text

  if [ -s "$changed_files_file" ]; then
    while IFS= read -r path || [ -n "$path" ]; do
      [ -n "$path" ] || continue
      lower="$(printf '%s' "$path" | tr '[:upper:]' '[:lower:]')"
      total=$((total + 1))
      case "$lower" in
        tests/*|test/*|*.test.*|*.spec.*|*test*|*spec*) test_count=$((test_count + 1)) ;;
        docs/*|doc/*|*.md|*.markdown|*.rst|*.txt) docs_count=$((docs_count + 1)) ;;
        package.json|package-lock.json|pnpm-lock.yaml|yarn.lock|*.yml|*.yaml|*.json|*.toml|*.ini|*.cfg|*.conf|dockerfile|*.dockerfile|.github/*) config_count=$((config_count + 1)) ;;
        *.sh|*.bash|*.js|*.jsx|*.ts|*.tsx|*.py|*.rb|*.go|*.rs|*.java|*.kt|*.kts|*.c|*.cc|*.cpp|*.h|*.hpp|*.cs|*.php|*.swift|*.m|*.mm|*.scala|*.lua|*.pl|*.r) source_count=$((source_count + 1)) ;;
        *) other_count=$((other_count + 1)) ;;
      esac
    done < "$changed_files_file"
  fi

  if [ -s /results/result-summary.md ]; then
    summary_source="/results/result-summary.md"
  else
    for artifact in /results/analysis.md /results/pi-summary.json; do
      if [ -s "$artifact" ]; then
        summary_source="$artifact"
        break
      fi
    done
  fi

  if [ -n "$summary_source" ]; then
    if [ "${summary_source##*.}" = "json" ]; then
      json_text="$(node - "$summary_source" <<'NODE' 2>/dev/null || true
const fs = require('fs');
const file = process.argv[2];
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const keys = new Set(['summary', 'changes', 'changed', 'improvements', 'notes', 'title', 'description']);
const out = [];
function visit(value, key = '') {
  if (out.length >= 8 || value == null) return;
  if (typeof value === 'string') {
    if (!key || keys.has(key.toLowerCase()) || value.length <= 240) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visit(item, key);
    return;
  }
  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) visit(childValue, childKey);
  }
}
visit(data);
console.log(out.join('\n'));
NODE
)"
      while IFS= read -r raw_line || [ -n "$raw_line" ]; do
        line="$(printf '%s' "$raw_line" | sanitize_pr_metadata_text)"
        [ -n "$line" ] || continue
        line="$(printf '%s' "$line" | sed -E 's/^[-*][[:space:]]+//; s/^[0-9]+[.)][[:space:]]+//')"
        safe_line="$(truncate_pr_metadata_text 180 "$line")"
        [ -n "$safe_line" ] || continue
        printf -- '- %s\n' "$safe_line"
        summary_rows=$((summary_rows + 1))
        [ "$summary_rows" -lt 4 ] || break
      done <<EOF_JSON_SUMMARY
$json_text
EOF_JSON_SUMMARY
    else
      # shellcheck disable=SC2094 # File is only read, not written; output goes to stdout
      summary_file_content="$(cat "$summary_source" 2>/dev/null || echo '')"
      while IFS= read -r raw_line || [ -n "$raw_line" ]; do
        case "$raw_line" in
          \#*)
            if printf '%s' "$raw_line" | grep -Eiq '^#{1,3}[[:space:]]+summary[[:space:]]*$'; then
              summary_capture=1
              continue
            fi
            [ "$summary_capture" -eq 1 ] && break
            continue
            ;;
        esac
        if [ "$summary_capture" -eq 0 ] && [ "$summary_source" = "/results/result-summary.md" ]; then
          continue
        fi
        line="$(printf '%s' "$raw_line" | sanitize_pr_metadata_text)"
        [ -n "$line" ] || continue
        case "$line" in
          '```'*|'<'*'>'*) continue ;;
        esac
        content="$(printf '%s' "$line" | sed -E 's/^[-*][[:space:]]+//; s/^[0-9]+[.)][[:space:]]+//')"
        [ -n "$content" ] || continue
        safe_line="$(truncate_pr_metadata_text 180 "$content")"
        [ -n "$safe_line" ] || continue
        printf -- '- %s\n' "$safe_line"
        summary_rows=$((summary_rows + 1))
        [ "$summary_rows" -lt 4 ] || break
      done <<EOF_SUMMARY_FILE
$summary_file_content
EOF_SUMMARY_FILE
    fi
  fi

  if [ "$summary_rows" -eq 0 ]; then
    if [ "$total" -eq 0 ]; then
      printf -- '- No file changes detected in local artifacts.\n'
    else
      local categories=""
      [ "$source_count" -eq 0 ] || categories="${categories}source, "
      [ "$test_count" -eq 0 ] || categories="${categories}tests, "
      [ "$docs_count" -eq 0 ] || categories="${categories}documentation, "
      [ "$config_count" -eq 0 ] || categories="${categories}configuration or metadata, "
      [ "$other_count" -eq 0 ] || categories="${categories}other files, "
      categories="${categories%, }"
      [ -n "$categories" ] || categories="local files"
      printf -- '- Updated %s across %s changed file(s).\n' "$categories" "$total"
    fi
  fi

  printf '\n### Change metadata\n'
  if [ "$total" -eq 0 ]; then
    printf -- '- No file changes detected in local artifacts.\n'
  else
    printf -- '- Changed files: %s total.\n' "$total"
    [ "$source_count" -eq 0 ] || printf -- '- Source files updated: %s.\n' "$source_count"
    [ "$test_count" -eq 0 ] || printf -- '- Tests updated: %s.\n' "$test_count"
    [ "$docs_count" -eq 0 ] || printf -- '- Documentation updated: %s.\n' "$docs_count"
    [ "$config_count" -eq 0 ] || printf -- '- Configuration or metadata updated: %s.\n' "$config_count"
    [ "$other_count" -eq 0 ] || printf -- '- Other files updated: %s.\n' "$other_count"
  fi

  if [ -s "$diff_file" ]; then
    additions="$(awk '/^\+/ && !/^\+\+\+/ { count++ } END { print count + 0 }' "$diff_file" 2>/dev/null || printf '0')"
    deletions="$(awk '/^-/ && !/^---/ { count++ } END { print count + 0 }' "$diff_file" 2>/dev/null || printf '0')"
    printf -- '- Diff stats: +%s/-%s lines from sanitized local diff metadata.\n' "$additions" "$deletions"
  fi
}
build_pr_body() {
  local duration_seconds pre_validation_status validation_status quality_status secret_scan_status task_summary model_summary generated_at changed_files_summary
  local pre_validation_commands pre_validation_full_commands post_validation_commands post_validation_full_commands validation_command_sections all_validation_statuses_pass
  duration_seconds="$(($(date +%s) - START_EPOCH))"
  pre_validation_status="$([ "${PRE_VALIDATION_EXIT:-0}" -eq 0 ] && printf 'passed' || printf 'failed (exit %s)' "$PRE_VALIDATION_EXIT")"
  validation_status="$([ "$VALIDATION_EXIT" -eq 0 ] && printf 'passed' || printf 'failed (exit %s)' "$VALIDATION_EXIT")"
  quality_status="$([ "$QUALITY_EXIT" -eq 0 ] && printf 'passed' || printf 'failed (exit %s)' "$QUALITY_EXIT")"
  secret_scan_status="$([ "$SECRET_SCAN_EXIT" -eq 0 ] && printf 'passed' || printf 'failed (exit %s)' "$SECRET_SCAN_EXIT")"
  task_summary="$(printf '%s' "${TASK_PROMPT:-Not provided}" | sanitize_pr_body_text)"
  task_summary="$(truncate_pr_metadata_text 1000 "$task_summary")"
  model_summary="requested $(printf '%s' "$KASEKI_MODEL" | sanitize_pr_metadata_text); actual $(printf '%s' "${ACTUAL_MODEL:-unknown}" | sanitize_pr_metadata_text)"
  generated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  changed_files_summary="$(format_pr_changed_files)"

  if [ "${PRE_VALIDATION_EXIT:-0}" -eq 0 ] && [ "$VALIDATION_EXIT" -eq 0 ] && [ "$QUALITY_EXIT" -eq 0 ] && [ "$SECRET_SCAN_EXIT" -eq 0 ]; then
    all_validation_statuses_pass=1
  else
    all_validation_statuses_pass=0
  fi

  if [ "$all_validation_statuses_pass" -eq 1 ]; then
    validation_command_sections="<details><summary>Pre-agent validation commands</summary>

### Pre-agent validation commands
$(format_pr_command_results "$PRE_VALIDATION_TIMINGS_FILE")

</details>

<details><summary>Post-agent validation commands</summary>

### Post-agent validation commands
$(format_pr_command_results "$VALIDATION_TIMINGS_FILE")

</details>"
  else
    pre_validation_full_commands="$(format_pr_command_results "$PRE_VALIDATION_TIMINGS_FILE")"
    pre_validation_commands="$(format_pr_command_results "$PRE_VALIDATION_TIMINGS_FILE" 1)"
    if [ "$pre_validation_full_commands" != "$pre_validation_commands" ]; then
      pre_validation_commands="${pre_validation_commands}
<details><summary>Full pre-agent validation command list</summary>

$pre_validation_full_commands

</details>"
    fi

    post_validation_full_commands="$(format_pr_command_results "$VALIDATION_TIMINGS_FILE")"
    post_validation_commands="$(format_pr_command_results "$VALIDATION_TIMINGS_FILE" 1)"
    if [ "$post_validation_full_commands" != "$post_validation_commands" ]; then
      post_validation_commands="${post_validation_commands}
<details><summary>Full post-agent validation command list</summary>

$post_validation_full_commands

</details>"
    fi

    validation_command_sections="### Pre-agent validation commands
$pre_validation_commands

### Post-agent validation commands
$post_validation_commands"
  fi

  cat <<EOF
## Summary
$(build_pr_improvements_summary)

## Validation
### Validation statuses
- Pre-agent validation: $pre_validation_status
- Post-agent validation: $validation_status
- Quality gate: $quality_status
- Secret scan: $secret_scan_status

$validation_command_sections

## Files changed
$changed_files_summary

## Original task prompt
<details><summary>Original task prompt</summary>

$task_summary

</details>

## Run metadata
- Model: $model_summary
- Duration: ${duration_seconds}s
- Generated by: Kaseki agent
- Generated at: $generated_at
EOF

  if is_pr_draft_mode; then
    printf '\nThis PR is in draft status. Please review before merging.\n'
  fi
}

run_github_operations() {
  local app_id private_key_file owner repo feature_branch token token_data git_push_exit
  
  # Load GitHub App credentials
  local github_app_id_file github_app_client_id_file github_app_private_key_file
  github_app_id_file="$(resolve_github_secret_file "GITHUB_APP_ID_FILE" "github_app_id")"
  github_app_client_id_file="$(resolve_github_secret_file "GITHUB_APP_CLIENT_ID_FILE" "github_app_client_id")"
  github_app_private_key_file="$(resolve_github_secret_file "GITHUB_APP_PRIVATE_KEY_FILE" "github_app_private_key")"
  app_id="$(cat "$github_app_id_file")" || { printf 'Failed to read app ID\n' >&2; return 7; }
  cat "$github_app_client_id_file" >/dev/null || { printf 'Failed to read client ID\n' >&2; return 7; }
  private_key_file="$github_app_private_key_file"
  
  # Parse repo URL to extract owner and repo
  if parse_github_repo_url "$REPO_URL"; then
    owner="$GITHUB_REPO_OWNER"
    repo="$GITHUB_REPO_NAME"
  else
    printf -- 'Cannot parse GitHub repo URL: %s\n' "$REPO_URL" | tee -a /results/git-push.log >&2
    return 7
  fi
  
  printf -- 'GitHub operations: owner=%s, repo=%s\n' "$owner" "$repo" | tee -a /results/git-push.log
  GITHUB_OPERATION_PHASE="setup"
  
  # Set git user for commits
  git config user.name "GitHub App [$app_id]" || { printf 'Failed to set git user name\n' >&2; return 7; }
  git config user.email "${app_id}+kaseki@users.noreply.github.com" || { printf 'Failed to set git email\n' >&2; return 7; }
  
  # Generate GitHub App installation token
  GITHUB_OPERATION_PHASE="token_generation"
  printf 'Generating GitHub App installation token...\n' | tee -a /results/git-push.log
  local token_stdout_tmp token_stderr_tmp token_exit_code token_stderr token_parse_result token_error token_http_status
  token_stdout_tmp="$(mktemp /tmp/github-app-token-stdout.XXXXXX)" || { printf 'Failed to create token stdout temp file\n' >&2; return 7; }
  token_stderr_tmp="$(mktemp /tmp/github-app-token-stderr.XXXXXX)" || {
    printf 'Failed to create token stderr temp file\n' >&2
    rm -f "$token_stdout_tmp"
    return 7
  }
  node /usr/local/bin/github-app-token "$app_id" "$private_key_file" "$owner" "$repo" >"$token_stdout_tmp" 2>"$token_stderr_tmp"
  token_exit_code=$?
  token_data="$(cat "$token_stdout_tmp" 2>/dev/null || true)"
  token_stderr="$(cat "$token_stderr_tmp" 2>/dev/null || true)"
  rm -f "$token_stdout_tmp" "$token_stderr_tmp"
  if [ "$token_exit_code" -ne 0 ]; then
    token_parse_result="$(parse_github_app_token_helper_failure "$token_data" "$token_stderr" "$token_exit_code")"
    token_error="${token_parse_result%%$'\t'*}"
    token_http_status=""
    if [ "$token_parse_result" != "$token_error" ]; then
      token_http_status="${token_parse_result#*$'\t'}"
    fi
    printf 'Failed to generate token: %s\n' "$token_error" | tee -a /results/git-push.log >&2
    GITHUB_API_ERROR_TYPE="github_app_token_error"
    GITHUB_API_ERROR_MESSAGE="$token_error"
    GITHUB_API_HTTP_STATUS="$token_http_status"
    emit_error_event "github_app_token_failed" "Failed to generate GitHub App installation token: $GITHUB_API_ERROR_MESSAGE" "exit"
    GITHUB_PUSH_EXIT=7
    return 7
  fi
  
  # Use helper to extract token from JSON response
  if ! run_node_subprocess token "const d = JSON.parse(require('fs').readFileSync(0, 'utf8')); process.stdout.write(d.token || '')" "$token_data" /results/git-push.log; then
    printf -- 'Failed to extract token from response: %s\n' "$token_data" | tee -a /results/git-push.log >&2
    GITHUB_PUSH_EXIT=7
    return 7
  fi
  
  if [ -z "$token" ]; then
    printf -- 'Failed to extract token from response (empty result)\n' | tee -a /results/git-push.log >&2
    GITHUB_PUSH_EXIT=7
    return 7
  fi
  
  printf 'Token generated successfully\n' | tee -a /results/git-push.log
  
  # Create and push feature branch
  GITHUB_OPERATION_PHASE="branch_creation"
  feature_branch="kaseki/$INSTANCE_NAME"
  printf -- 'Creating feature branch: %s\n' "$feature_branch" | tee -a /results/git-push.log
  git checkout -b "$feature_branch" || {
    printf 'Failed to create branch\n' | tee -a /results/git-push.log >&2
    GITHUB_PUSH_EXIT=7
    return 7
  }
  
  # Commit changes (git should already have changes from pi agent)
  GITHUB_OPERATION_PHASE="commit"
  printf 'Committing changes...\n' | tee -a /results/git-push.log
  if [ ! -s /results/changed-files.txt ]; then
    printf 'No changed files to stage\n' | tee -a /results/git-push.log >&2
    GITHUB_PUSH_EXIT=7
    return 7
  fi
  while IFS= read -r changed_file || [ -n "$changed_file" ]; do
    [ -z "$changed_file" ] && continue
    git add -- "$changed_file" || {
      printf -- 'Failed to stage changed file: %s\n' "$changed_file" | tee -a /results/git-push.log >&2
      GITHUB_PUSH_EXIT=7
      return 7
    }
  done < /results/changed-files.txt
  if ! git commit -m "Kaseki: $INSTANCE_NAME"; then
    printf 'No changes to commit or commit failed\n' | tee -a /results/git-push.log >&2
    GITHUB_PUSH_EXIT=7
    return 7
  fi
  
  # Push branch
  GITHUB_OPERATION_PHASE="push"
  printf 'Pushing branch to GitHub...\n' | tee -a /results/git-push.log
  local askpass_file
  if ! create_github_askpass_helper /results/git-push.log 'GitHub credential helper'; then
    return 8
  fi
  askpass_file="$GITHUB_ASKPASS_FILE"

  KASEKI_GITHUB_TOKEN="$token" GIT_ASKPASS="$askpass_file" GIT_TERMINAL_PROMPT=0 \
    git push "https://github.com/$owner/$repo.git" "$feature_branch" --force-with-lease 2>&1 | tee -a /results/git-push.log
  git_push_exit="${PIPESTATUS[0]:-1}"
  if [ "$git_push_exit" -eq 0 ]; then
    printf 'Branch pushed successfully\n' | tee -a /results/git-push.log
  else
    rm -f "$askpass_file"
    printf 'Failed to push branch (exit %s)\n' "$git_push_exit" | tee -a /results/git-push.log >&2
    GITHUB_PUSH_EXIT="$git_push_exit"
    return "$git_push_exit"
  fi
  rm -f "$askpass_file"

  if [ "$KASEKI_PUBLISH_MODE" = "branch" ]; then
    printf 'Publish mode branch: skipping pull request creation.\n' | tee -a /results/git-push.log
    GITHUB_PR_EXIT=0
    GITHUB_OPERATION_PHASE="completed"
    unset token
    return 0
  fi
  if ! is_pr_creation_mode; then
    printf 'Publish mode %s: skipping pull request creation.\n' "$KASEKI_PUBLISH_MODE" | tee -a /results/git-push.log
    GITHUB_PR_EXIT=0
    GITHUB_OPERATION_PHASE="completed"
    unset token
    return 0
  fi
  
  # Create pull request. Both pr and draft_pr push a branch and create a PR;
  # only draft_pr marks the GitHub Pulls API request as draft.
  GITHUB_OPERATION_PHASE="pr_creation"
  printf 'Creating pull request...\n' | tee -a /results/git-push.log
  emit_progress "github operations" "pr_creation_starting"
  local pr_title pr_body pr_response pr_url pr_number pr_http_status pr_draft_json
  pr_title="$(derive_pr_title)"
  pr_body="$(build_pr_body)"
  if is_pr_draft_mode; then
    pr_draft_json=true
  else
    pr_draft_json=false
  fi
  
  # Retry loop for transient errors
  local retry_count=0 max_retries="$KASEKI_GITHUB_PR_RETRIES" pr_created=0
  local backoff_delay=2
  
  while [ $retry_count -le "$max_retries" ]; do
    if [ $retry_count -gt 0 ]; then
      printf 'Retrying PR creation (attempt %d of %d) after %ds delay...\n' $((retry_count + 1)) "$max_retries" "$backoff_delay" | tee -a /results/git-push.log
      emit_progress "github operations" "pr_creation_attempt $((retry_count + 1))/$max_retries"
      sleep "$backoff_delay"
      # Exponential backoff: 2s, 4s, 8s
      backoff_delay=$((backoff_delay * 2))
      if [ $backoff_delay -gt 8 ]; then backoff_delay=8; fi
    fi
    
    # Capture both response and HTTP status code
    local pr_response_file temp_status_file
    pr_response_file="$(mktemp /tmp/kaseki-pr-response.XXXXXX)" || { printf 'Failed to create temp file for PR response\n' | tee -a /results/git-push.log >&2; GITHUB_PR_EXIT=8; return 8; }
    temp_status_file="$(mktemp /tmp/kaseki-pr-status.XXXXXX)" || { printf 'Failed to create temp file for PR status\n' | tee -a /results/git-push.log >&2; GITHUB_PR_EXIT=8; return 8; }
    
    if [ $retry_count -eq 0 ] && [ "${KASEKI_DEBUG:-0}" = "1" ]; then
      printf 'Debug: Creating PR with head=%s, base=%s, draft=%s\n' "$feature_branch" "$GIT_REF" "$pr_draft_json" | tee -a /results/git-push.log
    fi
    
    # Encode PR title and body as JSON strings
    local pr_title_json pr_body_json
    if ! run_node_subprocess pr_title_json "console.log(JSON.stringify(require('fs').readFileSync(0, 'utf8')))" "$pr_title" /results/git-push.log; then
      printf 'ERROR: Failed to JSON encode PR title\n' | tee -a /results/git-push.log >&2
      GITHUB_PR_EXIT=8
      return 8
    fi
    if ! run_node_subprocess pr_body_json "console.log(JSON.stringify(require('fs').readFileSync(0, 'utf8')))" "$pr_body" /results/git-push.log; then
      printf 'ERROR: Failed to JSON encode PR body\n' | tee -a /results/git-push.log >&2
      GITHUB_PR_EXIT=8
      return 8
    fi
    
    # Use curl with -w to capture HTTP status separately
    # curl exit code: 0=success, non-0=failure
    local curl_exit
    curl -s -w '%{http_code}' -X POST \
      -H "Authorization: token $token" \
      -H "Accept: application/vnd.github.v3+json" \
      "https://api.github.com/repos/$owner/$repo/pulls" \
      -d "{\"title\": $pr_title_json, \"body\": $pr_body_json, \"head\": \"$feature_branch\", \"base\": \"$GIT_REF\", \"draft\": $pr_draft_json}" > "$temp_status_file" 2>&1
    curl_exit=$?
    
    # Split response and status code
    local response_with_status
    response_with_status="$(cat "$temp_status_file")"
    pr_http_status="${response_with_status: -3}"
    pr_response="${response_with_status%???}"
    
    rm -f "$temp_status_file"
    
    if [ $curl_exit -ne 0 ]; then
      # curl command itself failed (network error, timeout, etc.)
      printf 'GitHub PR API curl command failed with exit code %d (attempt %d)\n' "$curl_exit" $((retry_count + 1)) | tee -a /results/git-push.log >&2
      GITHUB_API_HTTP_STATUS="0"
      if is_github_pr_error_retryable "0" "curl_error"; then
        retry_count=$((retry_count + 1))
        rm -f "$pr_response_file"
        continue
      else
        emit_error_event "github_pr_curl_failed" "curl command failed (exit $curl_exit) when creating PR" "exit"
        GITHUB_API_ERROR_TYPE="curl_error"
        GITHUB_API_ERROR_MESSAGE="curl exited with code $curl_exit"
        GITHUB_PR_EXIT=8
        rm -f "$pr_response_file"
        return 8
      fi
    fi
    
    if [ "${KASEKI_DEBUG:-0}" = "1" ]; then
      printf 'Debug: PR API response HTTP status: %s (attempt %d)\n' "$pr_http_status" $((retry_count + 1)) | tee -a /results/git-push.log
    fi
    
    # Validate the API response
    if validate_github_api_response "$pr_http_status" "$pr_response" /results/git-push.log; then
      # API returned success (201); now extract the URL and issue number using helper
      if ! run_node_subprocess pr_url "const d = JSON.parse(require('fs').readFileSync(0, 'utf8')); process.stdout.write(d.html_url || '')" "$pr_response" /results/git-push.log; then
        printf 'ERROR: Failed to extract PR URL from API response\n' | tee -a /results/git-push.log >&2
        emit_error_event "github_pr_response_malformed" "Failed to parse PR API response to extract html_url" "exit"
        GITHUB_PR_EXIT=9
        pr_url=""
      fi
      if ! run_node_subprocess pr_number "const d = JSON.parse(require('fs').readFileSync(0, 'utf8')); if (Number.isInteger(d.number)) process.stdout.write(String(d.number));" "$pr_response" /results/git-push.log; then
        printf 'Warning: failed to extract PR number from API response; leaving PR unlabeled\n' | tee -a /results/git-push.log >&2
        pr_number=""
      fi
      
      if [ -n "$pr_url" ]; then
        GITHUB_PR_URL="$pr_url"
        GITHUB_PR_EXIT=0
        printf 'Pull request created: %s\n' "$pr_url" | tee -a /results/git-push.log
        if [ -n "$pr_number" ]; then
          apply_github_pr_labels "$owner" "$repo" "$pr_number" "$token" /results/git-push.log || true
          # Request repository owner as reviewer for personal repos
          request_owner_review "$pr_response" "$token" /results/git-push.log || true
        else
          printf 'Warning: PR API response missing number field; leaving PR unlabeled\n' | tee -a /results/git-push.log >&2
        fi
        pr_created=1
        rm -f "$pr_response_file"
        break
      else
        # HTTP 201 but no html_url in response - malformed response
        printf 'Pull request API returned success (201) but response missing html_url field\n' | tee -a /results/git-push.log >&2
        emit_error_event "github_pr_response_malformed" "GitHub PR API returned 201 but response missing html_url field" "exit"
        if [ "${KASEKI_DEBUG:-0}" = "1" ]; then
          printf 'Debug: Full API response:\n%s\n' "$pr_response" | tee -a /results/git-push.log
        fi
        GITHUB_PR_EXIT=9
        pr_created=0
        rm -f "$pr_response_file"
        break
      fi
    else
      # API returned an error
      if is_github_pr_error_retryable "$pr_http_status" "$GITHUB_API_ERROR_TYPE"; then
        printf 'GitHub API returned retryable error (attempt %d): %s (HTTP %s)\n' $((retry_count + 1)) "$GITHUB_API_ERROR_TYPE" "$pr_http_status" | tee -a /results/git-push.log
        retry_count=$((retry_count + 1))
        rm -f "$pr_response_file"
        continue
      else
        # Permanent error, give up
        printf 'Failed to create PR. API error: %s\n' "$GITHUB_API_ERROR_MESSAGE" | tee -a /results/git-push.log >&2
        emit_error_event "github_pr_api_failed" "GitHub API error ($GITHUB_API_ERROR_TYPE): $GITHUB_API_ERROR_MESSAGE (HTTP $GITHUB_API_HTTP_STATUS)" "exit"
        if [ "${KASEKI_DEBUG:-0}" = "1" ]; then
          printf 'Debug: API error type: %s, HTTP status: %s\n' "$GITHUB_API_ERROR_TYPE" "$GITHUB_API_HTTP_STATUS" | tee -a /results/git-push.log
          printf 'Debug: Full response:\n%s\n' "$pr_response" | tee -a /results/git-push.log
        fi
        GITHUB_PR_EXIT=9
        pr_created=0
        rm -f "$pr_response_file"
        break
      fi
    fi
  done
  
  if [ $pr_created -eq 0 ] && [ $GITHUB_PR_EXIT -ne 0 ]; then
    return "$GITHUB_PR_EXIT"
  fi
  
  # Clean up token
  GITHUB_OPERATION_PHASE="completed"
  unset token
}

printf 'Kaseki instance: %s\n' "$INSTANCE_NAME"
printf 'Repository: %s\n' "$REPO_URL"
printf 'Git ref: %s\n' "$GIT_REF"
printf 'Provider: %s\n' "$KASEKI_PROVIDER"
printf 'Model: %s\n' "$KASEKI_MODEL"
printf 'Pi version: %s\n' "${PI_VERSION:-not checked before pre-agent validation}"

# Run preflight health check for GitHub operations if enabled
if [ "$GITHUB_APP_ENABLED" = "1" ]; then
  printf '\n==> github operations preflight health check\n'
  if ! check_github_operations_health; then
    printf 'ERROR: GitHub operations preflight health check failed\n' >&2
    printf 'GitHub App is enabled but configuration or dependencies are missing.\n' >&2
    printf 'Proceeding with kaseki run, but GitHub operations will be skipped or fail.\n' >&2
    emit_error_event "github_preflight_failed" "GitHub operations health check failed; check /results/github-health-check.log for details" "continue"
  fi
fi

openrouter_api_key=""
openrouter_api_key_source=""
if [ -n "${OPENROUTER_API_KEY:-}" ]; then
  openrouter_api_key="$OPENROUTER_API_KEY"
  openrouter_api_key_source="env"
else
  openrouter_api_key_file="${OPENROUTER_API_KEY_FILE:-/agents/secrets/openrouter_api_key}"
  if [ -r "$openrouter_api_key_file" ]; then
    secret_content="$(cat "$openrouter_api_key_file")"
    if [ -n "$secret_content" ]; then
      openrouter_api_key="$secret_content"
      openrouter_api_key_source="secret file"
    fi
  fi
fi
unset OPENROUTER_API_KEY secret_content

if [ -z "$openrouter_api_key" ]; then
  set_current_stage "agent setup"
  openrouter_api_key_file="${OPENROUTER_API_KEY_FILE:-/agents/secrets/openrouter_api_key}"
  printf 'Missing OpenRouter API key. Set OPENROUTER_API_KEY or provide %s.\n' "$openrouter_api_key_file" | tee -a /results/pi-stderr.log >&2
  : > "$RAW_EVENTS"
  PI_EXIT=2
  STATUS=2
  FAILED_COMMAND="missing OPENROUTER_API_KEY"
  exit 0
fi

if ! run_clone_repository; then
  exit 0
fi
cd /workspace/repo || { STATUS=1; FAILED_COMMAND="enter repository"; exit "$STATUS"; }

prepare_dependencies() {
  if [ ! -f package.json ]; then
    printf 'No package.json found; skipping dependency installation.\n'
    return 0
  fi

  local lock_source=""
  if [ -f package-lock.json ]; then
    lock_source="package-lock.json"
  elif [ -f npm-shrinkwrap.json ]; then
    lock_source="npm-shrinkwrap.json"
  else
    printf 'Dependency install requires package-lock.json or npm-shrinkwrap.json; lockfile missing.\n' >&2
    set_dependency_cache_status "lockfile-missing" "cache_key=none repo_url=$REPO_URL git_ref=$GIT_REF"
    emit_progress "dependency install" "failed lockfile missing; refusing non-deterministic install" "error"
    return 1
  fi

  local repo_ref_key lock_hash flags_hash cache_key workspace_cache_root workspace_cache_dir image_cache_dir stamp_file metadata_file
  local cache_lock_file cache_lock_fd tmp_cache_dir old_cache_dir install_start install_elapsed install_flags_display cache_detail
  local node_major cache_reused cache_source install_mode restore_mode restore_method
  local -a install_flags
  repo_ref_key="$(printf '%s@%s' "$REPO_URL" "$GIT_REF" | sha256sum | awk '{print $1}')"
  lock_hash="$(sha256sum "$lock_source" | awk '{print $1}')"
  node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo "unknown")"
  flags_hash="$(dependency_cache_flags_hash)"
  cache_key="$(dependency_cache_key "$lock_hash" "$node_major" "$flags_hash")"
  workspace_cache_root="${KASEKI_DEPENDENCY_CACHE_DIR}/${cache_key}"
  workspace_cache_dir="${workspace_cache_root}/node_modules"
  image_cache_dir="${KASEKI_IMAGE_DEPENDENCY_CACHE_DIR}/${cache_key}/node_modules"
  stamp_file="${workspace_cache_root}/stamp.txt"
  metadata_file="${workspace_cache_root}/repo-ref-metadata.tsv"
  cache_lock_file="${workspace_cache_root}.lock"
  cache_reused="false"
  cache_source="none"
  install_mode="skipped"
  restore_mode="$KASEKI_DEPENDENCY_RESTORE_MODE"
  restore_method="$restore_mode"
  case "$restore_mode" in
    copy|hardlink|symlink) ;;
    *)
      printf 'Unsupported KASEKI_DEPENDENCY_RESTORE_MODE: %s (expected copy, hardlink, or symlink)\n' "$restore_mode" >&2
      set_dependency_cache_status "restore-mode-invalid" "restore_mode=$restore_mode repo_url=$REPO_URL git_ref=$GIT_REF"
      emit_progress "dependency install" "failed invalid restore_mode=$restore_mode" "error"
      return 1
      ;;
  esac
  append_npm_install_flags install_flags
  install_flags_display="$(render_npm_install_flags "${install_flags[@]}")"
  cache_detail="lock_hash=$lock_hash cache_key=$cache_key repo_ref_key=$repo_ref_key repo_url=$REPO_URL git_ref=$GIT_REF lockfile=$lock_source node_major=$node_major flags_hash=$flags_hash flags=$install_flags_display restore_mode=$restore_mode"

  if ! mkdir -p "$(dirname "$workspace_cache_root")"; then
    return 1
  fi
  if ! exec {cache_lock_fd}>"$cache_lock_file"; then
    return 1
  fi
  if ! flock "$cache_lock_fd"; then
    exec {cache_lock_fd}>&-
    return 1
  fi

  if ! mkdir -p "$workspace_cache_root"; then
    exec {cache_lock_fd}>&-
    return 1
  fi

  if [ -d node_modules ] && [ -f "$stamp_file" ]; then
    if grep -qx "$lock_hash" "$stamp_file"; then
      printf 'Dependency cache status: using existing repo node_modules for lock hash %s (repo_ref_key=%s).\n' "$lock_hash" "$repo_ref_key"
      set_dependency_cache_status "existing-node-modules" "$cache_detail restore_method=none"
      emit_event "dependency_cache_decision" "strategy=existing_node_modules" "restore_mode=$restore_mode" "restore_method=none" "reason=lock_hash_match" "location=repo" "lock_hash=$lock_hash" "cache_key=$cache_key" "repo_ref_key=$repo_ref_key" "repo_url=$REPO_URL" "git_ref=$GIT_REF" "node_major=$node_major" "flags_hash=$flags_hash"
      emit_progress "dependency install" "cache hit source=repo restore_mode=$restore_mode restore_method=none lockfile=$lock_source lock_hash=$lock_hash repo_ref_key=$repo_ref_key node_major=$node_major flags_hash=$flags_hash flags=$install_flags_display"
      record_stage_timing "dependency install" "0" "0" "cache_hit=true cache_source=repo install_mode=skipped restore_mode=$restore_mode restore_method=none lockfile=$lock_source lock_hash=$lock_hash repo_ref_key=$repo_ref_key node_major=$node_major flags_hash=$flags_hash flags=$install_flags_display"
      exec {cache_lock_fd}>&-
      return 0
    fi
  fi

  if [ ! -d node_modules ] && [ -d "$workspace_cache_dir" ]; then
    printf 'Dependency cache status: restoring node_modules from workspace cache (%s; lock_hash=%s; repo_ref_key=%s).\n' "$workspace_cache_dir" "$lock_hash" "$repo_ref_key"
    set_dependency_cache_status "workspace-cache-hit" "$cache_detail"
    emit_event "dependency_cache_decision" "strategy=workspace_cache_hit" "restore_mode=$restore_mode" "location=$workspace_cache_dir" "lock_hash=$lock_hash" "cache_key=$cache_key" "repo_ref_key=$repo_ref_key" "repo_url=$REPO_URL" "git_ref=$GIT_REF" "node_major=$node_major" "flags_hash=$flags_hash"
    if ! restore_node_modules_from_cache "$workspace_cache_dir" ./node_modules "$restore_mode"; then
      exec {cache_lock_fd}>&-
      return 1
    fi
    restore_method="$DEPENDENCY_RESTORE_METHOD"
    set_dependency_cache_status "workspace-cache-restored" "$cache_detail restore_method=$restore_method"
    emit_event "dependency_cache_decision" "strategy=workspace_cache_restored" "restore_mode=$restore_mode" "restore_method=$restore_method" "reason=restore_completed" "location=$workspace_cache_dir" "lock_hash=$lock_hash" "cache_key=$cache_key" "repo_ref_key=$repo_ref_key" "repo_url=$REPO_URL" "git_ref=$GIT_REF" "node_major=$node_major" "flags_hash=$flags_hash"
    cache_reused="true"
    cache_source="workspace"
    if ! npm ls --depth=0 >/dev/null 2>&1; then
      printf 'Dependency cache status: workspace cache failed npm ls validation; reinstalling.\n'
      set_dependency_cache_status "workspace-cache-invalid" "$cache_detail restore_method=$restore_method reason=npm_ls_failed"
      emit_event "dependency_cache_decision" "strategy=invalidate_workspace_cache" "restore_mode=$restore_mode" "restore_method=$restore_method" "reason=npm_ls_failed" "location=$workspace_cache_dir" "lock_hash=$lock_hash" "cache_key=$cache_key" "repo_ref_key=$repo_ref_key" "repo_url=$REPO_URL" "git_ref=$GIT_REF" "node_major=$node_major" "flags_hash=$flags_hash"
      rm -rf node_modules
      cache_reused="false"
      cache_source="none"
    fi
  elif [ ! -d node_modules ] && [ -d "$image_cache_dir" ]; then
    printf 'Dependency cache status: restoring node_modules from image cache (%s; lock_hash=%s; repo_ref_key=%s).\n' "$image_cache_dir" "$lock_hash" "$repo_ref_key"
    set_dependency_cache_status "image-cache-hit" "$cache_detail"
    emit_event "dependency_cache_decision" "strategy=image_cache_hit" "restore_mode=$restore_mode" "location=$image_cache_dir" "lock_hash=$lock_hash" "cache_key=$cache_key" "repo_ref_key=$repo_ref_key" "repo_url=$REPO_URL" "git_ref=$GIT_REF" "node_major=$node_major" "flags_hash=$flags_hash"
    if ! restore_node_modules_from_cache "$image_cache_dir" ./node_modules "$restore_mode"; then
      exec {cache_lock_fd}>&-
      return 1
    fi
    restore_method="$DEPENDENCY_RESTORE_METHOD"
    set_dependency_cache_status "image-cache-restored" "$cache_detail restore_method=$restore_method"
    emit_event "dependency_cache_decision" "strategy=image_cache_restored" "restore_mode=$restore_mode" "restore_method=$restore_method" "reason=restore_completed" "location=$image_cache_dir" "lock_hash=$lock_hash" "cache_key=$cache_key" "repo_ref_key=$repo_ref_key" "repo_url=$REPO_URL" "git_ref=$GIT_REF" "node_major=$node_major" "flags_hash=$flags_hash"
    cache_reused="true"
    cache_source="image"
    if ! npm ls --depth=0 >/dev/null 2>&1; then
      printf 'Dependency cache status: image cache failed npm ls validation; reinstalling.\n'
      set_dependency_cache_status "image-cache-invalid" "$cache_detail restore_method=$restore_method reason=npm_ls_failed"
      emit_event "dependency_cache_decision" "strategy=invalidate_image_cache" "restore_mode=$restore_mode" "restore_method=$restore_method" "reason=npm_ls_failed" "location=$image_cache_dir" "lock_hash=$lock_hash" "cache_key=$cache_key" "repo_ref_key=$repo_ref_key" "repo_url=$REPO_URL" "git_ref=$GIT_REF" "node_major=$node_major" "flags_hash=$flags_hash"
      rm -rf node_modules
      cache_reused="false"
      cache_source="none"
    fi
  fi

  if [ ! -d node_modules ]; then
    printf 'Dependency cache status: cache miss for lock hash %s (repo_ref_key=%s), running install.\n' "$lock_hash" "$repo_ref_key"
    set_dependency_cache_status "cache-miss" "$cache_detail"
    emit_event "dependency_cache_decision" "strategy=fresh_install" "restore_mode=$restore_mode" "restore_method=none" "reason=no_cache_available" "location=none" "lock_hash=$lock_hash" "cache_key=$cache_key" "repo_ref_key=$repo_ref_key" "repo_url=$REPO_URL" "git_ref=$GIT_REF" "node_major=$node_major" "flags_hash=$flags_hash"
    emit_progress "dependency install" "started cache_hit=false restore_mode=$restore_mode restore_method=none lockfile=$lock_source lock_hash=$lock_hash repo_ref_key=$repo_ref_key node_major=$node_major flags_hash=$flags_hash flags=$install_flags_display"
    install_start="$(date +%s)"
    if ! npm ci --prefer-offline "${install_flags[@]}"; then
      exec {cache_lock_fd}>&-
      return 1
    fi
    install_elapsed="$(($(date +%s) - install_start))"
    install_mode="npm_ci_lockfile"
    emit_progress "dependency install" "finished elapsed=${install_elapsed}s cache_hit=false restore_mode=$restore_mode restore_method=none lockfile=$lock_source lock_hash=$lock_hash repo_ref_key=$repo_ref_key node_major=$node_major flags_hash=$flags_hash flags=$install_flags_display"
    record_stage_timing "dependency install" "0" "$install_elapsed" "cache_hit=false cache_source=none install_mode=$install_mode restore_mode=$restore_mode restore_method=none lockfile=$lock_source lock_hash=$lock_hash repo_ref_key=$repo_ref_key node_major=$node_major flags_hash=$flags_hash flags=$install_flags_display"
  else
    printf 'Dependency cache status: install skipped due to cache hit.\n'
    set_dependency_cache_status "install-skipped" "$cache_detail restore_method=$restore_method"
    emit_event "dependency_cache_decision" "strategy=skip_install" "restore_mode=$restore_mode" "restore_method=$restore_method" "reason=cache_hit" "location=local" "lock_hash=$lock_hash" "cache_key=$cache_key" "repo_ref_key=$repo_ref_key" "repo_url=$REPO_URL" "git_ref=$GIT_REF" "node_major=$node_major" "flags_hash=$flags_hash"
    if [ "$cache_reused" = "true" ]; then
      emit_progress "dependency install" "cache hit source=$cache_source restore_mode=$restore_mode restore_method=$restore_method lockfile=$lock_source lock_hash=$lock_hash repo_ref_key=$repo_ref_key node_major=$node_major flags_hash=$flags_hash flags=$install_flags_display"
      record_stage_timing "dependency install" "0" "0" "cache_hit=true cache_source=$cache_source install_mode=skipped restore_mode=$restore_mode restore_method=$restore_method lockfile=$lock_source lock_hash=$lock_hash repo_ref_key=$repo_ref_key node_major=$node_major flags_hash=$flags_hash flags=$install_flags_display"
    fi
  fi

  if ! mkdir -p "$workspace_cache_root"; then
    exec {cache_lock_fd}>&-
    return 1
  fi
  tmp_cache_dir="${workspace_cache_dir}.tmp.$$"
  old_cache_dir="${workspace_cache_dir}.old.$$"
  rm -rf "$tmp_cache_dir" "$old_cache_dir"
  if ! publish_node_modules_cache node_modules "$tmp_cache_dir"; then
    exec {cache_lock_fd}>&-
    return 1
  fi
  # Keep this publish path single-pass and atomic to avoid cache corruption.
  if [ -d "$workspace_cache_dir" ] && ! mv "$workspace_cache_dir" "$old_cache_dir"; then
    exec {cache_lock_fd}>&-
    return 1
  fi
  if ! mv "$tmp_cache_dir" "$workspace_cache_dir"; then
    exec {cache_lock_fd}>&-
    return 1
  fi
  if ! rm -rf "$old_cache_dir"; then
    exec {cache_lock_fd}>&-
    return 1
  fi
  if ! printf '%s\n' "$lock_hash" > "$stamp_file"; then
    exec {cache_lock_fd}>&-
    return 1
  fi
  if ! printf 'repo_ref_key=%s	repo_url=%s	git_ref=%s	lock_hash=%s	cache_key=%s	flags_hash=%s	restore_mode=%s	restore_method=%s\n' \
    "$repo_ref_key" "$REPO_URL" "$GIT_REF" "$lock_hash" "$cache_key" "$flags_hash" "$restore_mode" "$restore_method" > "$metadata_file"; then
    exec {cache_lock_fd}>&-
    return 1
  fi

  exec {cache_lock_fd}>&-
  return 0
}

if ! run_step "prepare node dependencies" prepare_dependencies; then
  exit 0
fi

if [ "$KASEKI_PRE_AGENT_VALIDATION" = "0" ]; then
  printf '\n==> pre-agent validation\n'
  set_current_stage "pre-agent validation"
  emit_progress "pre-agent validation" "skipped by KASEKI_PRE_AGENT_VALIDATION=0"
  printf 'Pre-agent validation skipped because KASEKI_PRE_AGENT_VALIDATION=0.\n' | tee -a /results/pre-validation.log
  record_stage_timing "pre-agent validation" 0 0 "skipped_by_config"
else
  run_validation_commands \
    "pre-agent validation" \
    "$KASEKI_PRE_AGENT_VALIDATION_COMMANDS" \
    /results/pre-validation.log \
    "$PRE_VALIDATION_RAW_LOG" \
    "$PRE_VALIDATION_TIMINGS_FILE" \
    "$PRE_VALIDATION_ENV_LOG" \
    "pre_agent_validation_failed" \
    PRE_VALIDATION_EXIT \
    PRE_VALIDATION_FAILED_COMMAND_DETAIL \
    PRE_VALIDATION_FAILURE_REASON \
    PRE_VALIDATION_STOPPED_EARLY \
    PRE_VALIDATION_COMMANDS_ATTEMPTED
  if [ "$PRE_VALIDATION_EXIT" -ne 0 ]; then
    STATUS="$PRE_VALIDATION_EXIT"
    FAILED_COMMAND="pre-agent validation"
    if [ -z "$PRE_VALIDATION_FAILURE_REASON" ]; then
      PRE_VALIDATION_FAILURE_REASON="pre_agent_validation_failed"
    fi
    emit_error_event "pre_agent_validation_failed" "Pre-agent validation failed before Pi was invoked: ${PRE_VALIDATION_FAILED_COMMAND_DETAIL:-exit $PRE_VALIDATION_EXIT}" "exit"
    exit 0
  fi
fi

PI_VERSION="$(pi --version 2>&1 | head -n 1 || true)"
printf 'Pi version: %s\n' "$PI_VERSION"
if ! run_scouting_agent; then
  exit 0
fi

# After scouting succeeds, derive and merge allowlists before main agent runs
if [ "$KASEKI_SCOUTING" = "1" ] && [ -f "$SCOUTING_ARTIFACT" ]; then
  printf '\n==> derive allowlist from scouting\n'
  set_current_stage "derive allowlist from scouting"
  emit_progress "derive allowlist from scouting" "started"
  
  scouting_agent_patterns=""
  scouting_validation_patterns=""
  allowlist_merge_status="skipped"
  
  if scouting_output="$(derive_allowlist_from_scouting "$SCOUTING_ARTIFACT" 2>&1)"; then
    scouting_agent_patterns="$(printf '%s' "$scouting_output" | head -n 1)"
    scouting_validation_patterns="$(printf '%s' "$scouting_output" | tail -n 1)"
    
    # Validate patterns parse correctly
    if validate_allowlist_patterns "$scouting_agent_patterns" && validate_allowlist_patterns "$scouting_validation_patterns"; then
      # Merge with user-provided allowlist
      user_agent_patterns="${KASEKI_CHANGED_FILES_ALLOWLIST:-}"
      user_validation_patterns="${KASEKI_VALIDATION_ALLOWLIST:-}"
      
      merged_agent_allowlist="$(merge_allowlists "$scouting_agent_patterns" "$user_agent_patterns")"
      merged_validation_allowlist="$(merge_allowlists "$scouting_validation_patterns" "$user_validation_patterns")"
      
      # Export merged allowlists to environment
      export KASEKI_CHANGED_FILES_ALLOWLIST="$merged_agent_allowlist"
      export KASEKI_VALIDATION_ALLOWLIST="$merged_validation_allowlist"
      
      # Log merge decisions
      {
        printf '{\n'
        printf '  "timestamp": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        printf '  "event": "allowlist_merge",\n'
        printf '  "scouting_agent_patterns": "%s",\n' "$(printf '%s' "$scouting_agent_patterns" | sed 's/"/\\"/g')"
        printf '  "user_agent_patterns": "%s",\n' "$(printf '%s' "$user_agent_patterns" | sed 's/"/\\"/g')"
        printf '  "merged_agent_allowlist": "%s",\n' "$(printf '%s' "$merged_agent_allowlist" | sed 's/"/\\"/g')"
        printf '  "scouting_validation_patterns": "%s",\n' "$(printf '%s' "$scouting_validation_patterns" | sed 's/"/\\"/g')"
        printf '  "user_validation_patterns": "%s",\n' "$(printf '%s' "$user_validation_patterns" | sed 's/"/\\"/g')"
        printf '  "merged_validation_allowlist": "%s"\n' "$(printf '%s' "$merged_validation_allowlist" | sed 's/"/\\"/g')"
        printf '}\n'
      } | tee -a /results/metadata.jsonl
      
      allowlist_merge_status="merged"
      
      # Run coverage validation with dry-run
      if [ -s /results/changed-files.txt ]; then
        run_scouting_allowlist_coverage "$SCOUTING_ARTIFACT" 2>&1 | tee -a /results/quality.log
      fi
      
      emit_progress "derive allowlist from scouting" "finished (status=$allowlist_merge_status)"
    else
      # Pattern validation failed - fail fast
      printf 'ERROR: Derived allowlist patterns failed validation. Cannot proceed.\n' | tee -a /results/quality.log >&2
      STATUS=86
      FAILED_COMMAND="allowlist pattern validation"
      emit_error_event "scouting_allowlist_invalid" "Derived allowlist patterns failed validation" "exit"
      exit 0
    fi
  else
    # Derivation failed - log and fail fast
    printf 'ERROR: Failed to derive allowlist from scouting artifact: %s\n' "$scouting_output" | tee -a /results/quality.log >&2
    STATUS=86
    FAILED_COMMAND="allowlist derivation from scouting"
    emit_error_event "scouting_allowlist_derivation_failed" "Failed to derive allowlist from scouting artifact" "exit"
    exit 0
  fi
fi

coding_attempt=1
max_coding_attempts=$((KASEKI_GOAL_CHECK_MAX_RETRIES + 1))
while [ "$coding_attempt" -le "$max_coding_attempts" ]; do
PI_EXIT=0
PI_DURATION_SECONDS=0
VALIDATION_EXIT=0
VALIDATION_FAILED_COMMAND_DETAIL=""
VALIDATION_FAILURE_REASON=""
VALIDATION_STOPPED_EARLY=false
VALIDATION_COMMANDS_ATTEMPTED=0
QUALITY_EXIT=0
QUALITY_FAILURE_REASON=""
FILTER_EXIT=0
FILTER_STDERR_TAIL=""

printf '\n==> pi coding agent\n'
set_current_stage "pi coding agent"
emit_event "coding_attempt_started" "attempt=$coding_attempt" "max_attempts=$max_coding_attempts"
if [ "$KASEKI_DRY_RUN" = "1" ]; then
  printf '🔄 DRY-RUN MODE: Skipping Pi coding agent execution\n'
  PI_START_EPOCH="$(date +%s)"
  PI_EXIT=0
  PI_DURATION_SECONDS=$(($(date +%s) - PI_START_EPOCH))
  {
    printf 'DRY-RUN: Pi agent would have been invoked with the following configuration:\n'
    printf '  Provider: %s\n' "$KASEKI_PROVIDER"
    printf '  Model: %s\n' "$KASEKI_MODEL"
    printf '  Timeout: %s seconds\n' "$KASEKI_AGENT_TIMEOUT_SECONDS"
    printf '  Task: %s\n' "$TASK_PROMPT"
  } | tee -a /results/pi-stderr.log
  emit_progress "pi coding agent" "skipped (dry-run)"
  record_stage_timing "pi coding agent" "0" "$PI_DURATION_SECONDS" "dry_run=true"
else
  set +e
  printf 'OpenRouter API key source: %s\n' "$openrouter_api_key_source"
  export KASEKI_STREAM_PROGRESS
  agent_prompt="$(build_agent_prompt)"
  PI_START_EPOCH="$(date +%s)"
  OPENROUTER_API_KEY="$openrouter_api_key" \
    timeout --signal=SIGTERM "$KASEKI_AGENT_TIMEOUT_SECONDS" \
    pi --mode json --no-session --provider "$KASEKI_PROVIDER" --model "$KASEKI_MODEL" "$agent_prompt" \
    2> >(tee -a /results/pi-stderr.log >&2) \
    | tee "$RAW_EVENTS" \
    | kaseki-pi-progress-stream /results/progress.jsonl /results/progress.log
  PI_EXIT="${PIPESTATUS[0]}"
  unset agent_prompt
  PI_DURATION_SECONDS=$(($(date +%s) - PI_START_EPOCH))
  unset OPENROUTER_API_KEY
  set +e
  record_stage_timing "pi coding agent" "$PI_EXIT" "$PI_DURATION_SECONDS" "timeout_seconds=$KASEKI_AGENT_TIMEOUT_SECONDS"

  if [ "$KASEKI_DEBUG_RAW_EVENTS" = "1" ]; then
    cp "$RAW_EVENTS" /results/pi-events.raw.jsonl
  fi

  PI_EXTRACTION_DEPS_OK=1
  missing_executables=()
  missing_helpers=()
  for required_exec in kaseki-pi-event-filter kaseki-pi-progress-stream validation-output-filter; do
    if ! command -v "$required_exec" >/dev/null 2>&1; then
      missing_executables+=("$required_exec")
    fi
  done
  for helper_file in /app/lib/event-aggregator.js /app/lib/timestamp-tracker.js /app/lib/progress-stream-utils.js; do
    if [ ! -f "$helper_file" ]; then
      missing_helpers+=("$helper_file")
    fi
  done
  if [ ${#missing_executables[@]} -gt 0 ] || [ ${#missing_helpers[@]} -gt 0 ]; then
    PI_EXTRACTION_DEPS_OK=0
    missing_execs_joined="${missing_executables[*]}"
    missing_helpers_joined="${missing_helpers[*]}"
    [ -z "$missing_execs_joined" ] && missing_execs_joined="none"
    [ -z "$missing_helpers_joined" ] && missing_helpers_joined="none"
    extraction_error=$(node -e "console.log(JSON.stringify({error:'pi_extraction_dependency_missing',missing_executables:process.argv[1],missing_helpers:process.argv[2],action:'Ensure required Pi binaries are on PATH and helper files exist in the image before running extraction'}))" "$missing_execs_joined" "$missing_helpers_joined")
    printf '%s
' "$extraction_error" | tee -a /results/pi-stderr.log /results/quality.log >&2
    emit_error_event "pi_extraction_dependency_missing" "missing executables: $missing_execs_joined; missing helpers: $missing_helpers_joined; ensure Pi binaries are in PATH and /app/lib helpers are present" "abort_extraction"
    if [ "$STATUS" -eq 0 ]; then
      STATUS=87
      FAILED_COMMAND="pi artifact extraction dependency validation"
    fi
    cp "$RAW_EVENTS" /results/pi-events.raw.jsonl 2>/dev/null || true
  fi

  FILTER_EXIT=0
  if [ "$PI_EXTRACTION_DEPS_OK" -eq 1 ]; then
    set +e
    kaseki-pi-event-filter "$RAW_EVENTS" /results/pi-events.jsonl /results/pi-summary.json
    FILTER_EXIT=$?
    set +e
  fi
  if [ "$FILTER_EXIT" -ne 0 ]; then
    printf 'pi-event-filter failed with exit %s; raw events preserved as fallback artifact\n' "$FILTER_EXIT" | tee -a /results/quality.log
    printf 'ERROR: kaseki-pi-event-filter failed with exit %s while exporting Pi events\n' "$FILTER_EXIT" | tee -a /results/pi-stderr.log >&2
    emit_error_event "pi_event_filter_failed" "kaseki-pi-event-filter exited with code $FILTER_EXIT" "continue"
    if [ "$STATUS" -eq 0 ]; then
      STATUS="$FILTER_EXIT"
      FAILED_COMMAND="kaseki-pi-event-filter"
    fi
    cp "$RAW_EVENTS" /results/pi-events.raw.jsonl 2>/dev/null || true
  fi
  if [ -s "$RAW_EVENTS" ] && { [ ! -s /results/pi-events.jsonl ] || [ ! -s /results/pi-summary.json ]; }; then
    printf 'ERROR: pi event export incomplete; raw events are non-empty but event artifacts are missing/empty\n' | tee -a /results/pi-stderr.log >&2
    emit_error_event "pi_event_export_incomplete" "RAW_EVENTS has data but exported artifacts are empty or missing" "continue"
    if [ "$STATUS" -eq 0 ]; then
      STATUS=86
      FAILED_COMMAND="pi event export incomplete"
    fi
  fi
  ACTUAL_MODEL="$(node -e "
    var fs=require('fs');
    function clean(v){
      if(v===undefined||v===null) return '';
      v=String(v).trim();
      if(!v) return '';
      var low=v.toLowerCase();
      if(low==='unknown'||low==='null') return '';
      return v;
    }
    function fromSummaryModels(summary){
      var counters=summary&&summary.counters&&summary.counters.models;
      if(!counters||typeof counters!=='object'||Array.isArray(counters)) return '';
      var entries=Object.entries(counters).filter(function(ent){
        return clean(ent[0]) && Number(ent[1]) > 0;
      });
      if(entries.length!==1) return '';
      return clean(entries[0][0]);
    }
    var m='';
    try{
      var summary=require('/results/pi-summary.json');
      m=clean(summary.selected_model)||clean(summary.model)||fromSummaryModels(summary);
    }catch{}
    if(!m){
      try{
        var lines=fs.readFileSync('$RAW_EVENTS','utf8').split('\n');
        for(var i=0;i<lines.length;i++){
          try{
            var e=JSON.parse(lines[i]);
            m=clean(e&&e.model);
            if(m) break;
          }catch{}
        }
      }catch{}
    }
    console.log(m||'unknown');
  " 2>/dev/null)"
  if [ "$ACTUAL_MODEL" = "unknown" ]; then
    emit_event "warning" "warning_type=model_attribution_missing" "detail=Unable to resolve model from pi-summary.json or raw events"
  fi
fi



if [ "$KASEKI_DRY_RUN" != "1" ]; then
  if [ "$PI_EXIT" -eq 124 ]; then
    printf 'pi timeout after %ss (exit 124)\n' "$KASEKI_AGENT_TIMEOUT_SECONDS" | tee -a /results/pi-stderr.log >&2
    if [ "$STATUS" -eq 0 ]; then
      STATUS=124
      FAILED_COMMAND="pi coding agent timeout"
      emit_error_event "pi_timeout" "Coding agent exceeded timeout of $KASEKI_AGENT_TIMEOUT_SECONDS seconds" "exit"
    fi
  elif [ "$PI_EXIT" -ne 0 ] && [ "$STATUS" -eq 0 ]; then
    STATUS="$PI_EXIT"
    FAILED_COMMAND="pi coding agent"
    emit_error_event "pi_agent_failed" "Coding agent exited with non-zero code: $PI_EXIT" "exit"
  fi
fi

printf '\n==> collect agent diff\n'
set_current_stage "collect agent diff"
emit_progress "collect agent diff" "started"
stage_start="$(date +%s)"
collect_git_artifacts
restore_disallowed_changes
# Restoration can turn a previously non-empty diff into a no-op. Refresh the
# artifacts before quality checks and publishing decisions use them.
collect_git_artifacts
record_stage_timing "collect agent diff" 0 "$(($(date +%s) - stage_start))" "diff_nonempty=$DIFF_NONEMPTY"
emit_progress "collect agent diff" "finished"

printf '\n==> quality checks\n'
set_current_stage "quality checks"
emit_progress "quality checks" "started"
stage_start="$(date +%s)"
diff_size="$(wc -c < /results/git.diff | tr -d ' ')"
if [ "$diff_size" -gt "$KASEKI_MAX_DIFF_BYTES" ]; then
  QUALITY_EXIT=4
  QUALITY_FAILURE_REASON="max_diff_bytes: $diff_size bytes exceeds limit of $KASEKI_MAX_DIFF_BYTES bytes"
  printf 'git.diff is too large: %s bytes > %s bytes\n' "$diff_size" "$KASEKI_MAX_DIFF_BYTES" | tee -a /results/quality.log
  emit_event "quality_gate_rule_evaluated" "rule=max_diff_bytes" "passed=false" "actual=$diff_size" "limit=$KASEKI_MAX_DIFF_BYTES"
else
  emit_event "quality_gate_rule_evaluated" "rule=max_diff_bytes" "passed=true" "actual=$diff_size" "limit=$KASEKI_MAX_DIFF_BYTES"
fi
emit_progress "quality checks" "finished with exit $QUALITY_EXIT"

# Build a safe regex from glob-style repo-relative allowlist patterns.
allowlist_regex="$(build_allowlist_regex)"
if [ -n "$allowlist_regex" ]; then
  while IFS= read -r changed_file || [ -n "$changed_file" ]; do
    [ -z "$changed_file" ] && continue
    if ! printf '%s\n' "$changed_file" | grep -Eq "^(${allowlist_regex})$"; then
      QUALITY_EXIT=5
      QUALITY_FAILURE_REASON="allowlist_check: file '$changed_file' not in allowlist"
      printf 'changed file outside allowlist: %s\n' "$changed_file" | tee -a /results/quality.log
      emit_event "quality_gate_rule_evaluated" "rule=allowlist_check" "passed=false" "file=$changed_file"
    else
      emit_event "quality_gate_rule_evaluated" "rule=allowlist_check" "passed=true" "file=$changed_file"
    fi
  done < /results/changed-files.txt
fi

if [ -f package.json ] && node -e "const p=require('./package.json'); process.exit(p.scripts && (p.scripts.format || p.scripts['format:check']) ? 0 : 1)" 2>/dev/null; then
  format_command="$(node -e "const p=require('./package.json'); console.log(p.scripts['format:check'] ? 'npm run format:check' : 'npm run format -- --check')" 2>/dev/null)"
  printf '%s\n' "$format_command" >> /results/format-check-command.txt
fi
record_stage_timing "quality checks" "$QUALITY_EXIT" "$(($(date +%s) - stage_start))" "diff_size_bytes=$diff_size"

printf '\n==> validation environment\n'
log_validation_environment() {
  {
    printf '[validation environment] timestamp=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '[validation environment] working_directory=%s\n' "$(pwd 2>&1 || echo '<pwd failed>')"
    printf '[validation environment] node_version=%s\n' "$(node --version 2>&1 || echo '<node not found>')"
    printf '[validation environment] npm_version=%s\n' "$(npm --version 2>&1 || echo '<npm not found>')"
    printf '[validation environment] npm_config_registry=%s\n' "$(npm config get registry 2>/dev/null || echo '<not set>')"
    printf '[validation environment] npm_config_cache=%s\n' "$(npm config get cache 2>/dev/null || echo '<not set>')"
    printf '[validation environment] PATH=%s\n' "$PATH"
    printf '[validation environment] NODE_OPTIONS=%s\n' "${NODE_OPTIONS:-<not set>}"
    printf '[validation environment] NODE_PATH=%s\n' "${NODE_PATH:-<not set>}"
    printf '[validation environment] disk_space_available=%s\n' "$(df -h /results 2>/dev/null | tail -1 | awk '{print $4}' || echo '<df failed>')"
    printf '[validation environment] disk_space_used=%s\n' "$(du -sh /results 2>/dev/null | cut -f1 || echo '<du failed>')"
  } | tee -a /results/validation.log "$VALIDATION_ENV_LOG"
}
log_validation_environment

if [ "$KASEKI_DRY_RUN" = "1" ] || [ -z "$KASEKI_VALIDATION_COMMANDS" ] || [ "$KASEKI_VALIDATION_COMMANDS" = "none" ]; then
  run_validation_commands \
    "validation" \
    "$KASEKI_VALIDATION_COMMANDS" \
    /results/validation.log \
    "$VALIDATION_RAW_LOG" \
    "$VALIDATION_TIMINGS_FILE" \
    "$VALIDATION_ENV_LOG" \
    "validation_command_failed"
elif [ "$QUALITY_EXIT" -ne 0 ]; then
  printf '\n==> validation\n'
  set_current_stage "validation"
  emit_progress "validation" "started"
  printf 'Validation skipped because quality gates failed with exit %s.\n' "$QUALITY_EXIT" | tee -a /results/validation.log
  VALIDATION_EXIT="$QUALITY_EXIT"
  if [ -z "$VALIDATION_FAILURE_REASON" ]; then
    VALIDATION_FAILURE_REASON="quality_gate_failed: $QUALITY_FAILURE_REASON"
  fi
  record_stage_timing "validation" "$QUALITY_EXIT" 0 "skipped_after_quality_failure"
  emit_progress "validation" "finished with exit $VALIDATION_EXIT"
elif [ "$PI_EXIT" -ne 0 ] && [ "$KASEKI_VALIDATE_AFTER_AGENT_FAILURE" != "1" ]; then
  printf '\n==> validation\n'
  set_current_stage "validation"
  emit_progress "validation" "started"
  printf 'Validation skipped because pi coding agent failed with exit %s. Set KASEKI_VALIDATE_AFTER_AGENT_FAILURE=1 to run validation anyway.\n' "$PI_EXIT" | tee -a /results/validation.log
  record_stage_timing "validation" "$PI_EXIT" 0 "skipped_after_agent_failure"
  emit_progress "validation" "finished with exit $VALIDATION_EXIT"
else
  run_validation_commands \
    "validation" \
    "$KASEKI_VALIDATION_COMMANDS" \
    /results/validation.log \
    "$VALIDATION_RAW_LOG" \
    "$VALIDATION_TIMINGS_FILE" \
    "$VALIDATION_ENV_LOG" \
    "validation_command_failed"
fi

# Check validation-phase allowlist (if configured)
if [ "$VALIDATION_EXIT" -eq 0 ]; then
  collect_git_artifacts
  if ! check_validation_allowlist; then
    : # Exit code already set in check_validation_allowlist
  fi
fi

snapshot_attempt_artifacts "$coding_attempt"

if [ "$STATUS" -ne 0 ] || [ "$PI_EXIT" -ne 0 ] || [ "$QUALITY_EXIT" -ne 0 ] || [ "$VALIDATION_EXIT" -ne 0 ]; then
  break
fi

run_goal_check "$coding_attempt"
snapshot_attempt_artifacts "$coding_attempt"

if [ "$KASEKI_GOAL_CHECK" != "1" ] || [ ! -s "$SCOUTING_ARTIFACT" ] || [ "$GOAL_CHECK_MET" = "true" ]; then
  break
fi

if [ "$coding_attempt" -lt "$max_coding_attempts" ]; then
  emit_progress "goal check" "retrying coding agent after unmet verdict (attempt $coding_attempt of $max_coding_attempts)"
  coding_attempt=$((coding_attempt + 1))
  continue
fi

STATUS=8
FAILED_COMMAND="goal check"
[ -z "$GOAL_CHECK_FAILURE_REASON" ] && GOAL_CHECK_FAILURE_REASON="goal_unmet_after_retries"
emit_error_event "goal_unmet" "Goal check did not pass after $GOAL_CHECK_ATTEMPTS attempt(s): $GOAL_CHECK_FAILURE_REASON" "exit"
break
done

printf '\n==> secret scan\n'
set_current_stage "secret scan"
emit_progress "secret scan" "started"
stage_start="$(date +%s)"
: > /results/secret-scan.log
if [ "$KASEKI_DRY_RUN" = "1" ]; then
  printf '🔄 DRY-RUN MODE: Skipping secret scan (no artifacts to scan)\n' | tee -a /results/secret-scan.log
  SECRET_SCAN_EXIT=0
  record_stage_timing "secret scan" "0" "$(($(date +%s) - stage_start))" "dry_run=true"
else
  # Run the initial scan
  if grep -R -n -E 'sk-or-[A-Za-z0-9_-]{20,}' /results /workspace/repo/.git /workspace/repo/src /workspace/repo/tests 2>/dev/null | grep -v '/secret-scan.log:' > /results/secret-scan.log; then
    # Matches found - check against allowlist
    if check_secret_scan_allowlist; then
      # All matches are allowlisted
      SECRET_SCAN_EXIT=0
    else
      # Real leaks detected
      SECRET_SCAN_EXIT=6
    fi
  else
    # No matches found
    SECRET_SCAN_EXIT=0
  fi
  record_stage_timing "secret scan" "$SECRET_SCAN_EXIT" "$(($(date +%s) - stage_start))" ""
fi
emit_progress "secret scan" "finished with exit $SECRET_SCAN_EXIT"

build_github_skip_reasons() {
  GITHUB_SKIP_REASONS=()
  if [ "$GITHUB_APP_ENABLED" != "1" ]; then
    GITHUB_SKIP_REASONS+=("github_app_disabled")
  fi
  if [ "$PI_EXIT" -ne 0 ]; then
    GITHUB_SKIP_REASONS+=("agent_failed")
  fi
  if [ "$VALIDATION_EXIT" -ne 0 ]; then
    GITHUB_SKIP_REASONS+=("validation_failed")
  fi
  if [ "$QUALITY_EXIT" -ne 0 ]; then
    GITHUB_SKIP_REASONS+=("quality_failed")
  fi
  if [ "$SECRET_SCAN_EXIT" -ne 0 ]; then
    GITHUB_SKIP_REASONS+=("secret_scan_failed")
  fi
  if [ "$GOAL_CHECK_EXIT" -ne 0 ] || { [ "$KASEKI_GOAL_CHECK" = "1" ] && [ -s "$SCOUTING_ARTIFACT" ] && [ "$GOAL_CHECK_MET" != "true" ]; }; then
    GITHUB_SKIP_REASONS+=("goal_check_failed")
  fi
  if [ "$STATUS" -ne 0 ]; then
    GITHUB_SKIP_REASONS+=("run_failed")
  fi
  if [ "$DIFF_NONEMPTY" != "true" ]; then
    GITHUB_SKIP_REASONS+=("empty_diff")
  fi
  return 0
}

printf '\n==> github operations\n'
set_current_stage "github operations"
emit_progress "github operations" "started"
stage_start="$(date +%s)"
: > /results/git-push.log
build_github_skip_reasons
if [ "${#GITHUB_SKIP_REASONS[@]}" -eq 0 ]; then
  github_app_id_file="$(resolve_github_secret_file "GITHUB_APP_ID_FILE" "github_app_id")"
  github_app_client_id_file="$(resolve_github_secret_file "GITHUB_APP_CLIENT_ID_FILE" "github_app_client_id")"
  github_app_private_key_file="$(resolve_github_secret_file "GITHUB_APP_PRIVATE_KEY_FILE" "github_app_private_key")"
  if [ -r "$github_app_id_file" ] && [ -r "$github_app_client_id_file" ] && [ -r "$github_app_private_key_file" ]; then
    run_github_operations
  else
    GITHUB_SKIP_REASONS+=("github_app_secrets_missing")
    GITHUB_OPERATION_PHASE="secrets"
    printf -- 'GitHub operations: skipped (reasons: %s)\n' "$(IFS=,; printf '%s' "${GITHUB_SKIP_REASONS[*]}")" | tee -a /results/git-push.log >&2
    emit_progress "github operations" "skipped: $(IFS=,; printf '%s' "${GITHUB_SKIP_REASONS[*]}")"
    GITHUB_PUSH_EXIT=7
  fi
else
  printf -- 'GitHub operations: skipped (reasons: %s; agent %s, validation %s, quality %s, secret_scan %s, diff %s, github_enabled %s)\n' \
    "$(IFS=,; printf '%s' "${GITHUB_SKIP_REASONS[*]}")" \
    "$([ "$PI_EXIT" -eq 0 ] && printf 'passed' || printf 'failed')" \
    "$([ "$VALIDATION_EXIT" -eq 0 ] && printf 'passed' || printf 'failed')" \
    "$([ "$QUALITY_EXIT" -eq 0 ] && printf 'passed' || printf 'failed')" \
    "$([ "$SECRET_SCAN_EXIT" -eq 0 ] && printf 'passed' || printf 'failed')" \
    "$DIFF_NONEMPTY" \
    "$GITHUB_APP_ENABLED" | tee -a /results/git-push.log
  emit_progress "github operations" "skipped: $(IFS=,; printf '%s' "${GITHUB_SKIP_REASONS[*]}")"
fi
if [ "$GITHUB_APP_ENABLED" = "1" ]; then
  emit_progress "github operations" "finished with push exit $GITHUB_PUSH_EXIT and pr exit $GITHUB_PR_EXIT"
fi
record_stage_timing "github operations" "$GITHUB_PUSH_EXIT" "$(($(date +%s) - stage_start))" "pr_exit=$GITHUB_PR_EXIT enabled=$GITHUB_APP_ENABLED"

if [ "$VALIDATION_EXIT" -ne 0 ] && [ "$STATUS" -eq 0 ]; then
  STATUS="$VALIDATION_EXIT"
  FAILED_COMMAND="validation"
  if [ -n "$VALIDATION_FAILED_COMMAND_DETAIL" ]; then
    emit_error_event "validation_failed" "Validation failed: $VALIDATION_FAILED_COMMAND_DETAIL" "exit"
  else
    emit_error_event "validation_failed" "Validation command exited with code $VALIDATION_EXIT" "exit"
  fi
fi

if [ "$QUALITY_EXIT" -ne 0 ] && [ "$STATUS" -eq 0 ]; then
  STATUS="$QUALITY_EXIT"
  FAILED_COMMAND="quality checks"
  emit_error_event "quality_gate_failed" "Quality gate rule failed (exit code $QUALITY_EXIT)" "exit"
fi

if [ "$SECRET_SCAN_EXIT" -ne 0 ] && [ "$STATUS" -eq 0 ]; then
  STATUS="$SECRET_SCAN_EXIT"
  FAILED_COMMAND="secret scan"
  emit_error_event "secret_scan_failed" "Secret scan detected potential credential leak" "exit"
fi

if [ "$GITHUB_PUSH_EXIT" -ne 0 ] && [ "$STATUS" -eq 0 ]; then
  STATUS="$GITHUB_PUSH_EXIT"
  if [ "$GITHUB_OPERATION_PHASE" = "token_generation" ]; then
    FAILED_COMMAND="github token generation"
    emit_error_event "github_app_token_failed" "GitHub App token generation failed (exit code $GITHUB_PUSH_EXIT)" "exit"
  else
    FAILED_COMMAND="github push"
    emit_error_event "github_operation_failed" "GitHub push or PR creation failed (exit code $GITHUB_PUSH_EXIT)" "exit"
  fi
fi

if [ "$DIFF_NONEMPTY" != "true" ] &&
  [ "$STATUS" -eq 0 ] &&
  [ "$KASEKI_ALLOW_EMPTY_DIFF" != "1" ] &&
  [ "$KASEKI_TASK_MODE" != "inspect" ]; then
  STATUS=3
  FAILED_COMMAND="empty git diff"
  emit_error_event "empty_diff" "Agent produced no changes to the repository" "exit"
fi

set_current_stage "complete"
