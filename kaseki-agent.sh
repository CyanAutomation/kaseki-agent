#!/bin/bash
# shellcheck disable=SC1090,SC2016,SC2027
# NOTE: This file uses dynamic helper sourcing and embedded JavaScript/shell snippets.
# The file passes bash syntax validation and functional tests.
# NOTE: This script intentionally avoids global `set -e` so each stage can
# record status/timing artifacts before deciding whether to stop.
set -uo pipefail

# Early exit for helper resolution check - must happen before variable initialization
if [ "${KASEKI_AGENT_HELPER_RESOLUTION_CHECK:-0}" = "1" ]; then
  # Define helper resolution function locally
  resolve_allowlist_helper() {
    local script_dir="$1"
    local script_relative_helper="$script_dir/scripts/allowlist-helper.sh"
    local fallback_helper="${KASEKI_ALLOWLIST_HELPER_FALLBACK:-/app/scripts/allowlist-helper.sh}"

    if [ -r "$script_relative_helper" ]; then
      printf '%s\n' "$script_relative_helper"
      return 0
    fi

    if [ -r "$fallback_helper" ]; then
      printf '%s\n' "$fallback_helper"
      return 0
    fi

    printf 'ERROR: Allowlist helper is not readable. Expected packaged helper at %s or fallback helper at %s. This worker image or mounted template is incomplete; rebuild the image or restore scripts/allowlist-helper.sh.\n' \
      "$script_relative_helper" \
      "$fallback_helper" >&2
    return 66
  }

  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ALLOWLIST_HELPER="$(resolve_allowlist_helper "$SCRIPT_DIR")"
  allowlist_helper_status=$?
  if [ "$allowlist_helper_status" -ne 0 ]; then
    exit "$allowlist_helper_status"
  fi

  # Source the helper
  # shellcheck source=/dev/null
  . "$ALLOWLIST_HELPER" || {
    printf 'ERROR: Failed to source %s (exit code: %d)\n' "$ALLOWLIST_HELPER" $? >&2
    exit 1
  }

  # Verify the helper was sourced successfully
  if ! declare -f build_allowlist_regex >/dev/null 2>&1; then
    printf 'ERROR: build_allowlist_regex function not found after sourcing %s\n' "$ALLOWLIST_HELPER" >&2
    exit 1
  fi

  # Call the function to verify it works
  build_allowlist_regex "${KASEKI_CHANGED_FILES_ALLOWLIST:-}" >/dev/null 2>&1 || {
    printf 'ERROR: build_allowlist_regex exited with status %d\n' $? >&2
    exit 1
  }

  # Output and exit
  printf 'allowlist_helper=%s\n' "$ALLOWLIST_HELPER"
  exit 0
fi


KASEKI_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KASEKI_JSON_HELPER="${KASEKI_JSON_HELPER:-${KASEKI_SCRIPT_DIR}/scripts/lib/json.sh}"
if [ ! -r "$KASEKI_JSON_HELPER" ] && [ -r /app/scripts/lib/json.sh ]; then
  KASEKI_JSON_HELPER="/app/scripts/lib/json.sh"
fi
if [ ! -r "$KASEKI_JSON_HELPER" ]; then
  printf 'ERROR: JSON helper is not readable. Expected %s or /app/scripts/lib/json.sh. This worker image or mounted template is incomplete; rebuild the image or restore scripts/lib/json.sh.\n' "$KASEKI_JSON_HELPER" >&2
  exit 66
fi
# shellcheck source=/dev/null
. "$KASEKI_JSON_HELPER" || {
  printf 'ERROR: Failed to source %s (exit code: %d)\n' "$KASEKI_JSON_HELPER" $? >&2
  exit 1
}

KASEKI_JSON_EVENTS_HELPER="${KASEKI_JSON_EVENTS_HELPER:-${KASEKI_SCRIPT_DIR}/scripts/lib/json-events.sh}"
if [ ! -r "$KASEKI_JSON_EVENTS_HELPER" ] && [ -r /app/scripts/lib/json-events.sh ]; then
  KASEKI_JSON_EVENTS_HELPER="/app/scripts/lib/json-events.sh"
fi
if [ ! -r "$KASEKI_JSON_EVENTS_HELPER" ]; then
  printf 'ERROR: JSON events helper is not readable. Expected %s or /app/scripts/lib/json-events.sh. This worker image or mounted template is incomplete; rebuild the image or restore scripts/lib/json-events.sh.\n' "$KASEKI_JSON_EVENTS_HELPER" >&2
  exit 66
fi
# shellcheck source=/dev/null
. "$KASEKI_JSON_EVENTS_HELPER" || {
  printf 'ERROR: Failed to source %s (exit code: %d)\n' "$KASEKI_JSON_EVENTS_HELPER" $? >&2
  exit 1
}

KASEKI_DEPENDENCY_CACHE_HELPER="${KASEKI_DEPENDENCY_CACHE_HELPER:-${KASEKI_SCRIPT_DIR}/scripts/dependency-cache-helpers.sh}"
if [ ! -r "$KASEKI_DEPENDENCY_CACHE_HELPER" ] && [ -r /app/scripts/dependency-cache-helpers.sh ]; then
  KASEKI_DEPENDENCY_CACHE_HELPER="/app/scripts/dependency-cache-helpers.sh"
fi
if [ ! -r "$KASEKI_DEPENDENCY_CACHE_HELPER" ]; then
  printf 'ERROR: Dependency cache helper is not readable. Expected %s or /app/scripts/dependency-cache-helpers.sh. This worker image or mounted template is incomplete; rebuild the image or restore scripts/dependency-cache-helpers.sh.\n' "$KASEKI_DEPENDENCY_CACHE_HELPER" >&2
  exit 66
fi
# shellcheck source=/dev/null
. "$KASEKI_DEPENDENCY_CACHE_HELPER" || {
  printf 'ERROR: Failed to source %s (exit code: %d)\n' "$KASEKI_DEPENDENCY_CACHE_HELPER" $? >&2
  exit 1
}

KASEKI_NPM_INSTALL_HELPER="${KASEKI_NPM_INSTALL_HELPER:-${KASEKI_SCRIPT_DIR}/scripts/npm-install-helpers.sh}"
if [ ! -r "$KASEKI_NPM_INSTALL_HELPER" ] && [ -r /app/scripts/npm-install-helpers.sh ]; then
  KASEKI_NPM_INSTALL_HELPER="/app/scripts/npm-install-helpers.sh"
fi
if [ ! -r "$KASEKI_NPM_INSTALL_HELPER" ]; then
  printf 'ERROR: npm install helper is not readable. Expected %s or /app/scripts/npm-install-helpers.sh. This worker image or mounted template is incomplete; rebuild the image or restore scripts/npm-install-helpers.sh.\n' "$KASEKI_NPM_INSTALL_HELPER" >&2
  exit 66
fi
# shellcheck source=/dev/null
. "$KASEKI_NPM_INSTALL_HELPER" || {
  printf 'ERROR: Failed to source %s (exit code: %d)\n' "$KASEKI_NPM_INSTALL_HELPER" $? >&2
  exit 1
}

KASEKI_AGENT_PROMPT_HELPER="${KASEKI_AGENT_PROMPT_HELPER:-${KASEKI_SCRIPT_DIR}/scripts/agent-prompt.sh}"
if [ ! -r "$KASEKI_AGENT_PROMPT_HELPER" ] && [ -r /app/scripts/agent-prompt.sh ]; then
  KASEKI_AGENT_PROMPT_HELPER="/app/scripts/agent-prompt.sh"
fi
if [ ! -r "$KASEKI_AGENT_PROMPT_HELPER" ]; then
  printf 'ERROR: Agent prompt helper is not readable. Expected %s or /app/scripts/agent-prompt.sh. This worker image or mounted template is incomplete; rebuild the image or restore scripts/agent-prompt.sh.\n' "$KASEKI_AGENT_PROMPT_HELPER" >&2
  exit 66
fi

# Source Sentry shell client for error event reporting
KASEKI_SENTRY_SHELL_CLIENT="${KASEKI_SENTRY_SHELL_CLIENT:-${KASEKI_SCRIPT_DIR}/scripts/sentry-shell-client.sh}"
if [ ! -r "$KASEKI_SENTRY_SHELL_CLIENT" ] && [ -r /app/scripts/sentry-shell-client.sh ]; then
  KASEKI_SENTRY_SHELL_CLIENT="/app/scripts/sentry-shell-client.sh"
fi
if [ -r "$KASEKI_SENTRY_SHELL_CLIENT" ]; then
  # shellcheck source=/dev/null
  . "$KASEKI_SENTRY_SHELL_CLIENT" || {
    printf 'Warning: Failed to source Sentry shell client %s (exit code: %d); continuing without Sentry integration\n' "$KASEKI_SENTRY_SHELL_CLIENT" $? >&2
  }
else
  # Sentry integration is optional; warn but continue
  printf 'Warning: Sentry shell client not found at %s; Sentry error reporting will be unavailable\n' "$KASEKI_SENTRY_SHELL_CLIENT" >&2
fi

REPO_URL="${REPO_URL:-https://github.com/CyanAutomation/crudmapper}"
GIT_REF="${GIT_REF:-main}"

# Determine LLM provider: infer 'gateway' if gateway URL is set
if [ -z "${KASEKI_PROVIDER+x}" ]; then
  if [ -n "${LLM_GATEWAY_URL:-}" ]; then
    KASEKI_PROVIDER="gateway"
  else
    KASEKI_PROVIDER="${KASEKI_PROVIDER:-gateway}"
  fi
fi

# Select model based on provider. Gateway cannot consume the generic "auto"
# model sentinel, so normalize unset or explicit auto to the gateway default
# before phase-specific model defaults inherit it below.
if [ "$KASEKI_PROVIDER" = "gateway" ]; then
  if [ -z "${KASEKI_MODEL+x}" ] || [ "$KASEKI_MODEL" = "auto" ]; then
    KASEKI_MODEL="${LLM_GATEWAY_MODEL:-dynamic/kaseki-agent}"
  fi
elif [ -z "${KASEKI_MODEL+x}" ]; then
  KASEKI_MODEL="auto"
fi
KASEKI_DRY_RUN="${KASEKI_DRY_RUN:-0}"
KASEKI_STARTUP_CHECK_MODE="${KASEKI_STARTUP_CHECK_MODE:-boot}"
KASEKI_BASELINE_VALIDATION_DRY_RUN="${KASEKI_BASELINE_VALIDATION_DRY_RUN:-0}"
KASEKI_AGENT_TIMEOUT_SECONDS="${KASEKI_AGENT_TIMEOUT_SECONDS:-10800}"
KASEKI_VALIDATION_COMMANDS_EXPLICIT="${KASEKI_VALIDATION_COMMANDS+x}"
KASEKI_VALIDATION_COMMANDS="${KASEKI_VALIDATION_COMMANDS-npm run build;npm run type-check;npm run test}"
KASEKI_AUTO_LINT_CLEANUP_EXPLICIT="${KASEKI_AUTO_LINT_CLEANUP+x}"
KASEKI_AUTO_LINT_CLEANUP="${KASEKI_AUTO_LINT_CLEANUP:-1}"
KASEKI_AUTO_LINT_CLEANUP_COMMANDS="${KASEKI_AUTO_LINT_CLEANUP_COMMANDS-npm run lint:fix;__kaseki_trailing_whitespace_cleanup__}"
KASEKI_SKIP_MISSING_NPM_SCRIPTS="${KASEKI_SKIP_MISSING_NPM_SCRIPTS:-1}"
KASEKI_DEBUG_RAW_EVENTS="${KASEKI_DEBUG_RAW_EVENTS:-0}"
KASEKI_STREAM_PROGRESS="${KASEKI_STREAM_PROGRESS:-1}"
# Test-only hook: when set, remap container-default absolute paths under this
# root without requiring tests to rewrite this script. Production deployments
# should leave KASEKI_TEST_DEFAULT_PATH_ROOT unset and use the explicit
# KASEKI_*_DIR overrides below for non-default locations.
if [ -n "${KASEKI_TEST_DEFAULT_PATH_ROOT:-}" ]; then
  KASEKI_DEFAULT_RESULTS_DIR="${KASEKI_TEST_DEFAULT_PATH_ROOT%/}/results"
  KASEKI_DEFAULT_WORKSPACE_DIR="${KASEKI_TEST_DEFAULT_PATH_ROOT%/}/workspace"
  KASEKI_DEFAULT_APP_LIB_DIR="${KASEKI_TEST_DEFAULT_PATH_ROOT%/}/app/lib"
  KASEKI_DEFAULT_CACHE_DIR="${KASEKI_TEST_DEFAULT_PATH_ROOT%/}/cache"
else
  KASEKI_DEFAULT_RESULTS_DIR="/results"
  KASEKI_DEFAULT_WORKSPACE_DIR="/workspace"
  KASEKI_DEFAULT_APP_LIB_DIR="/app/lib"
  KASEKI_DEFAULT_CACHE_DIR="/cache"
fi
KASEKI_RESULTS_DIR="${KASEKI_RESULTS_DIR:-$KASEKI_DEFAULT_RESULTS_DIR}"
export KASEKI_RESULTS_DIR
KASEKI_WORKSPACE_DIR="${KASEKI_WORKSPACE_DIR:-$KASEKI_DEFAULT_WORKSPACE_DIR}"
export KASEKI_WORKSPACE_DIR
KASEKI_WORKSPACE_BASELINE_DIR="${KASEKI_WORKSPACE_BASELINE_DIR:-${KASEKI_WORKSPACE_DIR}/baseline}"
export KASEKI_WORKSPACE_BASELINE_DIR
KASEKI_APP_LIB_DIR="${KASEKI_APP_LIB_DIR:-$KASEKI_DEFAULT_APP_LIB_DIR}"
export KASEKI_APP_LIB_DIR
KASEKI_CACHE_DIR="${KASEKI_CACHE_DIR:-$KASEKI_DEFAULT_CACHE_DIR}"
export KASEKI_CACHE_DIR
KASEKI_VALIDATE_AFTER_AGENT_FAILURE="${KASEKI_VALIDATE_AFTER_AGENT_FAILURE:-0}"
KASEKI_PRE_AGENT_VALIDATION="${KASEKI_PRE_AGENT_VALIDATION:-1}"
KASEKI_PRE_AGENT_VALIDATION_COMMANDS_EXPLICIT="${KASEKI_PRE_AGENT_VALIDATION_COMMANDS+x}"
KASEKI_PRE_AGENT_VALIDATION_COMMANDS="${KASEKI_PRE_AGENT_VALIDATION_COMMANDS-$KASEKI_VALIDATION_COMMANDS}"
KASEKI_BASELINE_VALIDATION_ENABLED="${KASEKI_BASELINE_VALIDATION_ENABLED:-1}"
KASEKI_BASELINE_CACHE_ROOT="${KASEKI_BASELINE_CACHE_ROOT:-${KASEKI_CACHE_DIR}/kaseki-baseline}"
KASEKI_BASELINE_CACHE_MAX_AGE_HOURS="${KASEKI_BASELINE_CACHE_MAX_AGE_HOURS:-24}"
KASEKI_BASELINE_CACHE_DISABLED="${KASEKI_BASELINE_CACHE_DISABLED:-0}"
KASEKI_TS_PRE_CHECK="${KASEKI_TS_PRE_CHECK:-1}"
KASEKI_TS_CHECK_COMMAND="${KASEKI_TS_CHECK_COMMAND:-npm run build}"
KASEKI_SCOUTING_EXPLICIT="${KASEKI_SCOUTING+x}"
KASEKI_GOAL_SETTING_EXPLICIT="${KASEKI_GOAL_SETTING+x}"
KASEKI_GOAL_CHECK_EXPLICIT="${KASEKI_GOAL_CHECK+x}"
KASEKI_SCOUTING="${KASEKI_SCOUTING:-1}"
KASEKI_SCOUTING_MODEL="${KASEKI_SCOUTING_MODEL:-$KASEKI_MODEL}"
KASEKI_SCOUTING_TIMEOUT_SECONDS="${KASEKI_SCOUTING_TIMEOUT_SECONDS:-$KASEKI_AGENT_TIMEOUT_SECONDS}"
KASEKI_SCOUTING_MAX_OUTPUT_TOKENS="${KASEKI_SCOUTING_MAX_OUTPUT_TOKENS:-3072}"
KASEKI_SCOUTING_PROMPT_DETAIL="${KASEKI_SCOUTING_PROMPT_DETAIL:-compact}"
KASEKI_HASHLINE_EDITS="${KASEKI_HASHLINE_EDITS:-1}"
KASEKI_GOAL_SETTING="${KASEKI_GOAL_SETTING:-1}"
KASEKI_GOAL_SETTING_MODEL="${KASEKI_GOAL_SETTING_MODEL:-$KASEKI_SCOUTING_MODEL}"
KASEKI_GOAL_SETTING_TIMEOUT_SECONDS="${KASEKI_GOAL_SETTING_TIMEOUT_SECONDS:-300}"
KASEKI_GOAL_CHECK="${KASEKI_GOAL_CHECK:-$KASEKI_SCOUTING}"
KASEKI_GOAL_CHECK_MAX_RETRIES="${KASEKI_GOAL_CHECK_MAX_RETRIES:-1}"
KASEKI_GOAL_CHECK_MODEL="${KASEKI_GOAL_CHECK_MODEL:-$KASEKI_SCOUTING_MODEL}"
KASEKI_GOAL_CHECK_TIMEOUT_SECONDS="${KASEKI_GOAL_CHECK_TIMEOUT_SECONDS:-$KASEKI_SCOUTING_TIMEOUT_SECONDS}"
KASEKI_TASK_MODE="${KASEKI_TASK_MODE:-patch}"
if [ "$KASEKI_TASK_MODE" = "inspect" ]; then
  [ -z "$KASEKI_GOAL_SETTING_EXPLICIT" ] && KASEKI_GOAL_SETTING="0"
  [ -z "$KASEKI_SCOUTING_EXPLICIT" ] && KASEKI_SCOUTING="0"
  [ -z "$KASEKI_GOAL_CHECK_EXPLICIT" ] && KASEKI_GOAL_CHECK="0"
fi
KASEKI_PUBLISH_MODE="${KASEKI_PUBLISH_MODE:-pr}"
GITHUB_APP_ENABLED="${GITHUB_APP_ENABLED:-1}"
# Auto-disable when no GitHub App credentials are mounted to avoid redundant preflight noise.
# startup-checks.sh already warned about missing credentials; this prevents a second round of errors.
if [ "$GITHUB_APP_ENABLED" = "1" ]; then
  _gid="${GITHUB_APP_ID_FILE:-${KASEKI_SECRETS_DIR:-/run/secrets/kaseki}/github_app_id}"
  _gcid="${GITHUB_APP_CLIENT_ID_FILE:-${KASEKI_SECRETS_DIR:-/run/secrets/kaseki}/github_app_client_id}"
  _gkey="${GITHUB_APP_PRIVATE_KEY_FILE:-${KASEKI_SECRETS_DIR:-/run/secrets/kaseki}/github_app_private_key}"
  if ! { [ -r "$_gid" ] && [ -r "$_gcid" ] && [ -r "$_gkey" ]; }; then
    GITHUB_APP_ENABLED="0"
  fi
  unset _gid _gcid _gkey
fi
if [ -z "${KASEKI_RUN_EVALUATION+x}" ]; then
  case "$KASEKI_PUBLISH_MODE:$KASEKI_TASK_MODE:$KASEKI_DRY_RUN:$GITHUB_APP_ENABLED" in
    pr:patch:0:1|draft_pr:patch:0:1) KASEKI_RUN_EVALUATION="1" ;;
    *) KASEKI_RUN_EVALUATION="0" ;;
  esac
fi
KASEKI_RUN_EVALUATION_MODEL="${KASEKI_RUN_EVALUATION_MODEL:-$KASEKI_GOAL_CHECK_MODEL}"
KASEKI_RUN_EVALUATION_TIMEOUT_SECONDS="${KASEKI_RUN_EVALUATION_TIMEOUT_SECONDS:-300}"
KASEKI_PROVIDER_FALLBACK="${KASEKI_PROVIDER_FALLBACK-openrouter}"
KASEKI_PROVIDER_FALLBACK_MODEL="${KASEKI_PROVIDER_FALLBACK_MODEL:-auto}"
INSTANCE_NAME="${KASEKI_INSTANCE:-kaseki}"
if [ "$KASEKI_TASK_MODE" = "inspect" ]; then
  KASEKI_ALLOW_EMPTY_DIFF="${KASEKI_ALLOW_EMPTY_DIFF:-1}"
else
  KASEKI_ALLOW_EMPTY_DIFF="${KASEKI_ALLOW_EMPTY_DIFF:-0}"
fi
KASEKI_CHANGED_FILES_ALLOWLIST="${KASEKI_CHANGED_FILES_ALLOWLIST:-src/lib/parser.ts tests/parser.validation.ts}"
KASEKI_VALIDATION_ALLOWLIST="${KASEKI_VALIDATION_ALLOWLIST:-}"
KASEKI_MAX_DIFF_BYTES="${KASEKI_MAX_DIFF_BYTES:-400000}"
KASEKI_REPO_MEMORY_MODE="${KASEKI_REPO_MEMORY_MODE:-off}"
KASEKI_REPO_MEMORY_TTL_DAYS="${KASEKI_REPO_MEMORY_TTL_DAYS:-30}"
KASEKI_REPO_MEMORY_MAX_BYTES="${KASEKI_REPO_MEMORY_MAX_BYTES:-8000}"
KASEKI_REPO_MEMORY_ROOT="${KASEKI_REPO_MEMORY_ROOT:-${KASEKI_CACHE_DIR}/repo-memory}"
TASK_PROMPT="${TASK_PROMPT:-Make normalizeRole treat a non-string Name fallback safely when FriendlyName is empty or missing. It should fall back to \"Unnamed Role\" instead of preserving arbitrary truthy non-string values. Add or update exactly one compact table-driven Vitest case in tests/parser.validation.ts, with a neutral static test title and no per-case assertion messages or explanatory comments. Do not add broad repeated test blocks. Do not print, inspect, or expose environment variables, secrets, credentials, or API keys. Keep changes limited to the source and test files needed for this fix.}"
KASEKI_AGENT_GUARDRAILS="${KASEKI_AGENT_GUARDRAILS:-1}"
KASEKI_RESTORE_DISALLOWED_CHANGES="${KASEKI_RESTORE_DISALLOWED_CHANGES:-1}"
KASEKI_VALIDATION_FAIL_FAST="${KASEKI_VALIDATION_FAIL_FAST:-1}"
KASEKI_VALIDATION_RUN_ALL_COMMANDS="${KASEKI_VALIDATION_RUN_ALL_COMMANDS:-0}"
# If KASEKI_VALIDATION_RUN_ALL_COMMANDS=1, override fail-fast to ensure all commands run
if [ "${KASEKI_VALIDATION_RUN_ALL_COMMANDS:-0}" -eq 1 ]; then
  KASEKI_VALIDATION_FAIL_FAST=0
fi
KASEKI_STRICT_SCRIPT_CHECK="${KASEKI_STRICT_SCRIPT_CHECK:-0}"
KASEKI_ALLOW_LOCAL_DEV_SECRET_FALLBACK="${KASEKI_ALLOW_LOCAL_DEV_SECRET_FALLBACK:-0}"
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
KASEKI_SCOUTING_ATTEMPTS=1
KASEKI_SCOUTING_SUCCEEDED_ON_ATTEMPT=""
GOAL_SETTING_EXIT=0
GOAL_SETTING_DURATION_SECONDS=0
GOAL_SETTING_ACTUAL_MODEL="unknown"
GOAL_SETTING_FALLBACK_USED=0
GOAL_SETTING_FALLBACK_MODE=""
KASEKI_GOAL_SETTING_ATTEMPTS=1
KASEKI_GOAL_SETTING_SUCCEEDED_ON_ATTEMPT=""
ORIGINAL_TASK_PROMPT="$TASK_PROMPT"
GOAL_CHECK_EXIT=0
GOAL_CHECK_DURATION_SECONDS=0
GOAL_CHECK_ATTEMPTS=0
GOAL_CHECK_MET=false
GOAL_CHECK_FAILURE_REASON=""
GOAL_CHECK_RETRY_PROMPT=""
GOAL_CHECK_ACTUAL_MODEL="unknown"
RUN_EVALUATION_EXIT=0
RUN_EVALUATION_DURATION_SECONDS=0
RUN_EVALUATION_ACTUAL_MODEL="unknown"
RUN_EVALUATION_WARNING=""
PROVIDER_ERROR_TYPE=""
PROVIDER_ERROR_PHASE=""
PROVIDER_ERROR_PROVIDER=""
PROVIDER_ERROR_API=""
PROVIDER_ERROR_MODEL=""
PROVIDER_ERROR_MESSAGE=""
PROVIDER_ERROR_RETRYABLE=""
PROVIDER_ERROR_RETRY_ATTEMPT_COUNT=0
PROVIDER_ERROR_RETRY_RESULT="none"
PROVIDER_ERROR_FALLBACK_PROVIDER=""
PROVIDER_ERROR_FALLBACK_MODEL=""
PROVIDER_ERROR_FALLBACK_RESULT="none"
VALIDATION_EXIT=0
VALIDATION_FAILED_COMMAND_DETAIL=""
VALIDATION_FAILURE_REASON=""
VALIDATION_ALLOWLIST_FAILURE_REASON=""
VALIDATION_STOPPED_EARLY=false
VALIDATION_COMMANDS_ATTEMPTED=0
PRE_VALIDATION_EXIT=0
PRE_VALIDATION_FAILED_COMMAND_DETAIL=""
PRE_VALIDATION_FAILURE_REASON=""
PRE_VALIDATION_STOPPED_EARLY=false
PRE_VALIDATION_COMMANDS_ATTEMPTED=0
BASELINE_VALIDATION_EXIT=0
BASELINE_VALIDATION_FAILED_COMMAND_DETAIL=""
export BASELINE_VALIDATION_FAILURE_REASON=""
export BASELINE_VALIDATION_STOPPED_EARLY=false
export BASELINE_VALIDATION_COMMANDS_ATTEMPTED=0
BASELINE_CACHE_STATUS="not_started"
TEST_FAILURE_CLASSIFICATION_STATUS="not_started"
NEWLY_INTRODUCED_FAILURES_COUNT=0
AUTO_LINT_CLEANUP_EXIT=0
AUTO_LINT_CLEANUP_COMMANDS_ATTEMPTED=0
AUTO_LINT_CLEANUP_COMMANDS_SKIPPED=0
AUTO_LINT_CLEANUP_RESULT="not_run"
AUTO_LINT_CLEANUP_CLASSIFICATION="not_run"
AUTO_LINT_CLEANUP_FAILURE_CLASSIFICATION=""
TS_PRE_CHECK_EXIT=0
TS_PRE_CHECK_DURATION_SECONDS=0
TS_PRE_CHECK_TIMESTAMP=""
FILTER_STDERR_TAIL=""
FILTER_STDERR_FILE="/tmp/kaseki-filter-stderr.log"
AUTO_LINT_CLEANUP_LOG="${KASEKI_RESULTS_DIR}/auto-lint-cleanup.log"
AUTO_LINT_CLEANUP_TIMINGS_FILE="${KASEKI_RESULTS_DIR}/auto-lint-cleanup-timings.tsv"
FILTER_DIAGNOSTICS_LOG="${KASEKI_RESULTS_DIR}/filter-diagnostics.log"
VALIDATION_STARTUP_DIAGNOSTICS_LOG="${KASEKI_RESULTS_DIR}/validation-startup-diagnostics.log"
DIFF_NONEMPTY=false
FILESYSTEM_CHECK_STATUS="not_tested"
FILESYSTEM_READONLY_REASON=""
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
VALIDATION_TIMINGS_FILE="${KASEKI_RESULTS_DIR}/validation-timings.tsv"
PRE_VALIDATION_TIMINGS_FILE="${KASEKI_RESULTS_DIR}/pre-validation-timings.tsv"
STAGE_TIMINGS_FILE="${KASEKI_RESULTS_DIR}/stage-timings.tsv"
DEPENDENCY_CACHE_LOG="${KASEKI_RESULTS_DIR}/dependency-cache.log"
# Raw Pi streams can grow well beyond the deliberately small worker /tmp tmpfs.
# Keep the coding stream on the persistent results mount, consistent with the
# scouting, goal-setting, goal-check, and run-evaluation streams below.
RAW_EVENTS="${KASEKI_RESULTS_DIR}/pi-events.raw.jsonl"
SCOUTING_ARTIFACT="${KASEKI_RESULTS_DIR}/scouting.json"
SCOUTING_CANDIDATE_ARTIFACT="${KASEKI_RESULTS_DIR}/scouting-candidate.json"
SCOUTING_RAW_EVENTS="${KASEKI_RESULTS_DIR}/scouting-events.raw.jsonl"
GOAL_SETTING_ARTIFACT="${KASEKI_RESULTS_DIR}/goal-setting.json"
GOAL_SETTING_CANDIDATE_ARTIFACT="${KASEKI_RESULTS_DIR}/goal-setting-candidate.json"
GOAL_SETTING_RAW_EVENTS="${KASEKI_RESULTS_DIR}/goal-setting-events.raw.jsonl"
GOAL_CHECK_CANDIDATE_ARTIFACT="${KASEKI_RESULTS_DIR}/goal-check-candidate.json"
GOAL_CHECK_RAW_EVENTS="${KASEKI_RESULTS_DIR}/goal-check-events.raw.jsonl"
RUN_EVALUATION_ARTIFACT="${KASEKI_RESULTS_DIR}/run-evaluation.json"
RUN_EVALUATION_CANDIDATE_ARTIFACT="${KASEKI_RESULTS_DIR}/run-evaluation-candidate.json"
RUN_EVALUATION_RAW_EVENTS="${KASEKI_RESULTS_DIR}/run-evaluation-events.raw.jsonl"
TEST_IMPACT_WARNINGS_ARTIFACT="${KASEKI_RESULTS_DIR}/test-impact-warnings.log"
EXPECTATION_MISMATCH_WARNINGS_ARTIFACT="${KASEKI_RESULTS_DIR}/expectation-mismatch-warnings.jsonl"
CRITICAL_CHANGE_EXPECTATIONS_ARTIFACT="${KASEKI_RESULTS_DIR}/critical-change-expectations.json"
KASEKI_DEPENDENCY_CACHE_DIR="${KASEKI_DEPENDENCY_CACHE_DIR:-${KASEKI_WORKSPACE_DIR}/.kaseki-cache}"
KASEKI_DEPENDENCY_RESTORE_MODE="${KASEKI_DEPENDENCY_RESTORE_MODE:-auto}"
KASEKI_DEPENDENCY_CACHE_MAX_BYTES="${KASEKI_DEPENDENCY_CACHE_MAX_BYTES:-5368709120}"
KASEKI_DEPENDENCY_CACHE_MAX_AGE_DAYS="${KASEKI_DEPENDENCY_CACHE_MAX_AGE_DAYS:-30}"
KASEKI_DEPENDENCY_CACHE_PRUNE="${KASEKI_DEPENDENCY_CACHE_PRUNE:-1}"
KASEKI_DEPENDENCY_CACHE_METRICS_FILE="${KASEKI_DEPENDENCY_CACHE_METRICS_FILE:-${KASEKI_DEPENDENCY_CACHE_DIR}/.kaseki-cache-metrics}"
KASEKI_INSTALL_IGNORE_SCRIPTS="${KASEKI_INSTALL_IGNORE_SCRIPTS:-1}"
KASEKI_NPM_OMIT_DEV="${KASEKI_NPM_OMIT_DEV:-0}"
KASEKI_IMAGE_DEPENDENCY_CACHE_DIR="${KASEKI_IMAGE_DEPENDENCY_CACHE_DIR:-/opt/kaseki/workspace-cache}"
KASEKI_LOG_DIR="${KASEKI_LOG_DIR:-/var/log/kaseki}"
KASEKI_STRICT_HOST_LOGGING="${KASEKI_STRICT_HOST_LOGGING:-0}"
KASEKI_GIT_CACHE_MODE="${KASEKI_GIT_CACHE_MODE:-mirror}"
KASEKI_GIT_CACHE_ROOT="${KASEKI_GIT_CACHE_ROOT:-${KASEKI_CACHE_DIR}/git}"
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

# Caveman communication mode (enabled by default)
KASEKI_CAVEMAN="${KASEKI_CAVEMAN:-1}"

# Track last executed command for better error reporting
LAST_COMMAND=""
LAST_COMMAND_LOG="${KASEKI_RESULTS_DIR}/last-command.log"

# Signal handler for graceful termination
handle_termination() {
  local signal="$1"
  printf '\nReceived %s; terminating kaseki-agent...\n' "$signal"
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

# ========================================
# Caveman Communication Mode Helper
# ========================================
# Get terse communication instruction from TypeScript library
# Returns: Caveman lite instruction string for prompt injection
get_caveman_instruction() {
  if [ "$KASEKI_CAVEMAN" != "1" ]; then
    return 0
  fi
  # Call TypeScript library via Node.js to retrieve the instruction
  node -e "const m = require('./src/caveman/caveman-instructions.ts'); console.log(m.getCavemanInstruction());" 2>/dev/null || {
    # Fallback inline instruction if TypeScript library is unavailable
    cat <<'CAVEMAN'
Terse, professional communication. Drop articles, filler, pleasantries. Keep full sentences. Short synonyms (big not extensive, fix not implement). No tool narration, tables, emoji. Standard acronyms only (DB/API/HTTP). Technical terms exact, code blocks unchanged. Pattern: [thing] [action] [reason]. [next step]. Example: "Bug in auth middleware. Expiry check uses < not <=. Fix:" Substance stays. Fluff dies.
CAVEMAN
  }
}


require_or_warn_binary() {
  local binary="$1"
  local mode="${2:-required}"
  local install_hint="${3:-Install it and retry.}"
  if command -v "$binary" >/dev/null 2>&1; then
    return 0
  fi
  if [ "$mode" = "required" ]; then
    printf 'Error: required dependency "%s" is missing. %s\n' "$binary" "$install_hint" >&2
    exit 1
  fi
  printf 'Warning: optional dependency "%s" is missing. %s\n' "$binary" "$install_hint" >&2
  return 1
}

setup_host_logging_mirror() {
  local base_name="$1"
  local stamp host_log_file
  if mkdir -p "$KASEKI_LOG_DIR" 2>/dev/null && [ -w "$KASEKI_LOG_DIR" ]; then
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    host_log_file="$KASEKI_LOG_DIR/${base_name}-${stamp}.log"
    exec > >(tee -a "$host_log_file") 2> >(tee -a "$host_log_file" >&2)
    printf 'Host log mirror: %s\n' "$host_log_file"
    return 0
  fi
  if [ "$KASEKI_STRICT_HOST_LOGGING" = "1" ]; then
    printf 'Error: strict host logging enabled, but KASEKI_LOG_DIR is not writable: %s\n' "$KASEKI_LOG_DIR" >&2
    exit 1
  fi
  # No host log available; output goes to console only
  printf 'Warning: host log mirror disabled; KASEKI_LOG_DIR is unavailable: %s (set writable KASEKI_LOG_DIR to enable mirror, or set KASEKI_STRICT_HOST_LOGGING=1 to fail fast)\n' "$KASEKI_LOG_DIR" >&2
}

mkdir_paths=("${KASEKI_RESULTS_DIR}")
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
if ! mkdir -p "${mkdir_paths[@]}"; then
  printf 'Error: Failed to create required runtime directories.\n' >&2
  exit 1
fi
: > "${KASEKI_RESULTS_DIR}"/pi-events.jsonl
: > "${KASEKI_RESULTS_DIR}"/pi-summary.json
: > "${KASEKI_RESULTS_DIR}"/scouting-events.jsonl
: > "${KASEKI_RESULTS_DIR}"/scouting-summary.json
: > "${KASEKI_RESULTS_DIR}"/scouting-validation-errors.jsonl
: > "${KASEKI_RESULTS_DIR}"/goal-check-events.jsonl
: > "${KASEKI_RESULTS_DIR}"/goal-check-summary.json

: > "${KASEKI_RESULTS_DIR}"/goal-check-validation-errors.jsonl
: > "${KASEKI_RESULTS_DIR}"/goal-check-validation-summary.txt
: > "${KASEKI_RESULTS_DIR}"/goal-check-attempts.jsonl
: > "${KASEKI_RESULTS_DIR}"/goal-check.json
: > "${KASEKI_RESULTS_DIR}"/run-evaluation-events.jsonl

check_gateway_provider_capability() {
  if [ "$KASEKI_PROVIDER" != "gateway" ]; then
    return 0
  fi

  local artifact="${KASEKI_RESULTS_DIR}/provider-capability.json"
  local output_file pi_version extensions_dir home_extensions list_exit gateway_registered
  local tmp_parent="${TMPDIR:-/tmp}"
  if [ ! -d "$tmp_parent" ] && ! mkdir -p "$tmp_parent" 2>/dev/null; then
    tmp_parent="/tmp"
  fi
  output_file="$(TMPDIR="$tmp_parent" mktemp)"
  pi_version="$(pi --version 2>&1 || true)"
  extensions_dir="${PI_EXTENSIONS_DIR:-}"
  home_extensions="${HOME:-}/.pi/extensions"
  list_exit=127
  gateway_registered=0

  if command -v pi >/dev/null 2>&1; then
    set +e
    LLM_GATEWAY_URL="$llm_gateway_url" LLM_GATEWAY_API_KEY="$llm_gateway_api_key" pi --list-models >"$output_file" 2>&1
    list_exit=$?
    set -e
  else
    printf 'pi executable not found in PATH\n' >"$output_file"
  fi

  if [ "$list_exit" -eq 0 ] && grep -Eiq '(^|[^[:alnum:]_-])gateway([^[:alnum:]_-]|$)' "$output_file"; then
    gateway_registered=1
  fi

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
  rm -f "$output_file"

  if [ "$gateway_registered" -eq 1 ]; then
    printf 'Pi provider capability check passed: gateway is registered.\n'
    return 0
  fi

  set_current_stage "agent setup"
  printf 'Provider capability check failed for KASEKI_PROVIDER=gateway.\n' | tee -a "${KASEKI_RESULTS_DIR}"/pi-stderr.log >&2
  printf 'The worker image/Pi extension did not register gateway; failing during agent setup before goal-setting/scouting/coding.\n' | tee -a "${KASEKI_RESULTS_DIR}"/pi-stderr.log >&2
  printf 'Pi version: %s\n' "${pi_version:-unavailable}" | tee -a "${KASEKI_RESULTS_DIR}"/pi-stderr.log >&2
  printf 'Extension paths checked: PI_EXTENSIONS_DIR=%s, HOME_PI_EXTENSIONS=%s\n' "${extensions_dir:-<unset>}" "${home_extensions:-<unknown>}" | tee -a "${KASEKI_RESULTS_DIR}"/pi-stderr.log >&2
  printf 'Diagnostic artifact: %s\n' "$artifact" | tee -a "${KASEKI_RESULTS_DIR}"/pi-stderr.log >&2
  PI_EXIT=2
  STATUS=2
  FAILED_COMMAND="agent setup provider capability check"
  emit_error_event "gateway_provider_not_registered" "The worker image/Pi extension did not register gateway; see provider-capability.json for Pi version and extension paths checked." "exit"
  printf 'Skipped: Pi provider gateway is not registered; agent setup phase did not run\n' > "${KASEKI_RESULTS_DIR}"/quality.log
  printf 'Skipped: Pi provider gateway is not registered; agent did not run\n' > "${KASEKI_RESULTS_DIR}"/secret-scan.log
  return 2
}

json_array() {
  if [ "$#" -eq 0 ]; then
    printf '[]\n'
    return 0
  fi
  jq -cn --args '$ARGS.positional' "$@"
}

github_skip_reasons_json() {
  if [ "${#GITHUB_SKIP_REASONS[@]}" -eq 0 ]; then
    printf '[]\n'
    return 0
  fi
  json_array "${GITHUB_SKIP_REASONS[@]}"
}

# Phase 2: JSON Artifact Output Helpers

# Initialize a JSON array file (starts empty array, to be populated with append_* functions)
init_json_array() {
  local output_file="$1"
  printf '[]' > "$output_file"
}

# Append a validation result object to validation-results.json (merged into metadata.json.phases at finalization)
append_validation_result() {
  local output_file="$1"
  local command="$2"
  local exit_code="$3"
  local duration_seconds="$4"
  local status="${5:-unknown}"  # passed, failed, skipped
  
  # Write to temporary phase file for consolidation at finalization
  local temp_validation_file="${KASEKI_RESULTS_DIR}/.validation-results-temp.jsonl"
  printf '{"command": %s, "exit_code": %d, "duration_seconds": %d, "status": %s}\n' \
    "$(printf '%s' "$command" | jq -Rs .)" \
    "$exit_code" \
    "$duration_seconds" \
    "$(printf '%s' "$status" | jq -Rs .)" >> "$temp_validation_file"
}

# Append a quality gate violation to quality-gates.json (merged into metadata.json.phases at finalization)
append_quality_violation() {
  local output_file="$1"
  local violation_type="$2"  # changed_file_outside_allowlist, validation_allowlist_violation, infrastructure_error, etc.
  local detail="$3"
  local severity="${4:-warning}"  # error, warning, info
  
  # Write to temporary phase file for consolidation at finalization
  local temp_quality_file="${KASEKI_RESULTS_DIR}/.quality-gates-temp.jsonl"
  printf '{"type": %s, "detail": %s, "severity": %s, "timestamp": %s}\n' \
    "$(printf '%s' "$violation_type" | jq -Rs .)" \
    "$(printf '%s' "$detail" | jq -Rs .)" \
    "$(printf '%s' "$severity" | jq -Rs .)" \
    "$(printf '%s' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" | jq -Rs .)" >> "$temp_quality_file"
}

# Append a cache metrics entry to cache-metrics.json
append_cache_metric() {
  local output_file="$1"
  local metric_name="$2"
  local value="$3"
  local unit="${4:-bytes}"
  local elapsed_seconds="${5:-0}"
  local reason="${6:-}"
  
  jq \
    --arg name "$metric_name" \
    --arg val "$value" \
    --arg unit "$unit" \
    --arg elapsed "$elapsed_seconds" \
    --arg reason "$reason" \
    '. += [{
      "name": $name,
      "value": (if $val == "true" then 1 elif $val == "false" then 0 else ($val | tonumber) end),
      "unit": $unit,
      "elapsed_seconds": (if $elapsed == "" then 0 else ($elapsed | tonumber) end),
      "reason": $reason,
      "timestamp": (now | todate)
    }]' \
    "$output_file" > "${output_file}.tmp" && mv "${output_file}.tmp" "$output_file"
}

# Append a secret scan result to secret-scan.json (merged into metadata.json.phases at finalization)
append_secret_scan_result() {
  local output_file="$1"
  local file_path="$2"
  local pattern="$3"
  local status="${4:-real_leak}"  # allowlisted or real_leak
  
  # Write to temporary phase file for consolidation at finalization
  local temp_secret_scan_file="${KASEKI_RESULTS_DIR}/.secret-scan-temp.jsonl"
  printf '{"file": %s, "pattern": %s, "status": %s, "timestamp": %s}\n' \
    "$(printf '%s' "$file_path" | jq -Rs .)" \
    "$(printf '%s' "$pattern" | jq -Rs .)" \
    "$(printf '%s' "$status" | jq -Rs .)" \
    "$(printf '%s' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" | jq -Rs .)" >> "$temp_secret_scan_file"
}

run_quality_checks() {
  local stage_start diff_size allowlist_regex changed_file

  printf '\n==> quality checks\n'
  set_current_stage "quality checks"
  emit_progress "quality checks" "started"
  stage_start="$(date +%s)"
  diff_size="$(wc -c < "${KASEKI_RESULTS_DIR}"/git.diff | tr -d ' ')"
  if [ "$diff_size" -gt "$KASEKI_MAX_DIFF_BYTES" ]; then
    QUALITY_EXIT=4
    QUALITY_FAILURE_REASON="max_diff_bytes: $diff_size bytes exceeds limit of $KASEKI_MAX_DIFF_BYTES bytes"
    printf 'git.diff is too large: %s bytes > %s bytes\n' "$diff_size" "$KASEKI_MAX_DIFF_BYTES" | tee -a "${KASEKI_RESULTS_DIR}"/quality.log
    emit_event "quality_gate_rule_evaluated" "rule=max_diff_bytes" "passed=false" "actual=$diff_size" "limit=$KASEKI_MAX_DIFF_BYTES"
    # Phase 2C: Emit quality violation to JSON
    append_quality_violation "${KASEKI_RESULTS_DIR}"/quality-gates.json "max_diff_bytes_exceeded" "Diff size $diff_size bytes exceeds limit of $KASEKI_MAX_DIFF_BYTES bytes" "error"
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
        printf 'changed file outside allowlist: %s\n' "$changed_file" | tee -a "${KASEKI_RESULTS_DIR}"/quality.log
        emit_event "quality_gate_rule_evaluated" "rule=allowlist_check" "passed=false" "file=$changed_file"
      else
        emit_event "quality_gate_rule_evaluated" "rule=allowlist_check" "passed=true" "file=$changed_file"
      fi
    done < "${KASEKI_RESULTS_DIR}"/changed-files.txt
  fi

  if [ -f package.json ] && node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['format:check'] ? 0 : 1)" 2>/dev/null; then
    : # format-check-command.txt artifact removed (Phase 1: low-value artifacts deletion)
  fi
  record_stage_timing "quality checks" "$QUALITY_EXIT" "$(($(date +%s) - stage_start))" "diff_size_bytes=$diff_size"
}

run_secret_scan() {
  local stage_start allowlist_file unallowlisted_count allowlisted_count match_line file_path pattern

  printf '\n==> secret scan\n'
  set_current_stage "secret scan"
  emit_progress "secret scan" "started"
  stage_start="$(date +%s)"
  # secret-scan.json consolidated into metadata.json.phases.secret_scan
  if [ "$KASEKI_DRY_RUN" = "1" ]; then
    emit_progress "secret scan" "skipped_dry_run"
    SECRET_SCAN_EXIT=0
    record_stage_timing "secret scan" "0" "$(($(date +%s) - stage_start))" "dry_run=true"
  else
    # Run secret scan inline with JSON-only output (no .log file)
    allowlist_file="${KASEKI_WORKSPACE_DIR}/repo/.kaseki-secret-allowlist"
    unallowlisted_count=0
    allowlisted_count=0

    if grep -R -n -E 'sk-or-[A-Za-z0-9_-]{20,}' "${KASEKI_RESULTS_DIR}" "${KASEKI_WORKSPACE_DIR}"/repo/.git "${KASEKI_WORKSPACE_DIR}"/repo/src "${KASEKI_WORKSPACE_DIR}"/repo/tests 2>/dev/null | grep -v '/secret-scan.json:' > /tmp/secret-scan-matches.tmp 2>&1; then
      # Matches found - process against allowlist
      while IFS= read -r match_line || [ -n "$match_line" ]; do
        [ -z "$match_line" ] && continue
        file_path=""
        pattern=""
        file_path=$(printf '%s\n' "$match_line" | cut -d: -f1)
        pattern=$(printf '%s\n' "$match_line" | sed 's/^[^:]*:[^:]*://' | grep -oE 'sk-or-[A-Za-z0-9_-]{20,}|sk-test-[A-Za-z0-9_-]*' | head -n1)
        [ -z "$pattern" ] && continue
        file_path="${file_path#"${KASEKI_WORKSPACE_DIR}"/repo/}"
        file_path="${file_path#repo/}"
        file_path="${file_path#./}"

        if [ -f "$allowlist_file" ] && grep -q "^${file_path}:${pattern}$" "$allowlist_file" 2>/dev/null; then
          allowlisted_count=$((allowlisted_count + 1))
          append_secret_scan_result "${KASEKI_RESULTS_DIR}"/secret-scan.json "$file_path" "$pattern" "allowlisted"
          emit_event "secret_scan_result" "status=allowlisted" "file=$file_path" "pattern=$pattern"
        else
          unallowlisted_count=$((unallowlisted_count + 1))
          append_secret_scan_result "${KASEKI_RESULTS_DIR}"/secret-scan.json "$file_path" "$pattern" "real_leak"
          emit_event "secret_scan_result" "status=real_leak" "file=$file_path" "pattern=$pattern"
        fi
      done < /tmp/secret-scan-matches.tmp
      rm -f /tmp/secret-scan-matches.tmp

      if [ "$unallowlisted_count" -gt 0 ]; then
        SECRET_SCAN_EXIT=6
      else
        SECRET_SCAN_EXIT=0
      fi
    else
      # No matches found
      SECRET_SCAN_EXIT=0
    fi

    record_stage_timing "secret scan" "$SECRET_SCAN_EXIT" "$(($(date +%s) - stage_start))" ""
  fi
  emit_progress "secret scan" "finished with exit $SECRET_SCAN_EXIT"
}

# Append a phase summary to all-phase-summaries.json consolidation artifact
append_phase_summary() {
  local output_file="$1"
  local phase_name="$2"
  local summary_file="$3"
  
  if [ ! -f "$summary_file" ]; then
    return 0
  fi
  
  jq \
    --slurpfile phase_data "$summary_file" \
    --arg phase "$phase_name" \
    '.phases += [($phase_data[0] + {"phase": $phase})]' \
    "$output_file" > "${output_file}.tmp" && mv "${output_file}.tmp" "$output_file"
}

: > "${KASEKI_RESULTS_DIR}"/run-evaluation-summary.json

: > "${KASEKI_RESULTS_DIR}"/run-evaluation.json
: > "$TEST_IMPACT_WARNINGS_ARTIFACT"
: > "$EXPECTATION_MISMATCH_WARNINGS_ARTIFACT"
: > "${KASEKI_RESULTS_DIR}"/validation.log
: > "${KASEKI_RESULTS_DIR}/pre-validation.log"
: > "$AUTO_LINT_CLEANUP_TIMINGS_FILE"
: > "${KASEKI_RESULTS_DIR}"/progress.jsonl
: > "${KASEKI_RESULTS_DIR}"/failure.json
: > "$VALIDATION_TIMINGS_FILE"

# Phase 2: Initialize JSON array artifacts
# (validation-results.json and quality-gates.json are now consolidated into metadata.json.phases)
init_json_array "${KASEKI_RESULTS_DIR}"/cache-metrics.json

# Initialize temporary phase files for later consolidation
: > "${KASEKI_RESULTS_DIR}"/.validation-results-temp.jsonl
: > "${KASEKI_RESULTS_DIR}"/.quality-gates-temp.jsonl
: > "${KASEKI_RESULTS_DIR}"/.secret-scan-temp.jsonl

# Phase 3: Initialize consolidation artifacts
printf '{"phases": []}\n' > "${KASEKI_RESULTS_DIR}"/all-phase-summaries.json
printf '{"validation_timings": [], "pre_validation_timings": [], "stage_timings": []}\n' > "${KASEKI_RESULTS_DIR}"/timings-manifest.json

setup_host_logging_mirror "$INSTANCE_NAME"
require_or_warn_binary jq required 'Install jq (for Debian/Ubuntu: apt-get install -y jq). Metadata/report generation depends on it.'
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

  if ! [[ "$output_var_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    {
      printf '[node-subprocess-error] Invalid output variable name: %s\n' "$output_var_name"
      printf '[node-subprocess-error] code: %.200s\n' "$node_code"
    } | tee -a "$error_log_file" >&2
    return 1
  fi

  node_stderr_tmp="$(mktemp /tmp/node-stderr.XXXXXX)" || {
    printf '[node-subprocess-error] Failed to create temp file for Node.js stderr\n' | tee -a "$error_log_file" >&2
    if ! printf -v "$output_var_name" '%s' ''; then
      printf '[node-subprocess-error] Failed to clear output variable: %s\n' "$output_var_name" | tee -a "$error_log_file" >&2
    fi
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
    if ! printf -v "$output_var_name" '%s' ''; then
      printf '[node-subprocess-error] Failed to clear output variable: %s\n' "$output_var_name" | tee -a "$error_log_file" >&2
      return 1
    fi
    return "$node_exit_code"
  fi

  # Success: store output in variable and return 0
  local output_preview output_var_decl output_var_attrs
  output_preview="$(printf '%s' "$output_value" \
    | tr '\n' ' ' \
    | sed -E 's/-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY-----[^[:cntrl:]]*-----END ([A-Z0-9]+ )*PRIVATE KEY-----/[redacted private key]/g; s/\b(gh[opsru]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/[redacted token]/g; s/\bsk-[A-Za-z0-9_-]{10,}\b/[redacted token]/g; s/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/[redacted jwt]/g; s/((api|access|auth|bearer|github|openai|secret|token|password|credential)[_-]?(key|token|secret|password)?[[:space:]]*[=:][^[:space:]]+)/[redacted]/Ig' \
    | cut -c 1-150)"

  # Avoid Bash's fatal readonly-assignment error so callers can handle the
  # helper's non-zero status through their existing `if ! ...; then` checks.
  if output_var_decl="$(declare -p "$output_var_name" 2>/dev/null)"; then
    output_var_attrs="${output_var_decl#declare -}"
    output_var_attrs="${output_var_attrs%% *}"
    if [[ "$output_var_attrs" == *r* ]]; then
      {
        printf '[node-subprocess-error] Failed to assign Node.js output to variable: %s\n' "$output_var_name"
        printf '[node-subprocess-error] output variable is readonly\n'
        printf '[node-subprocess-error] output preview (redacted, first 150 chars): %s\n' "$output_preview"
      } | tee -a "$error_log_file" >&2
      rm -f "$node_stderr_tmp"
      return 1
    fi
  fi

  if ! printf -v "$output_var_name" '%s' "$output_value"; then
    {
      printf '[node-subprocess-error] Failed to assign Node.js output to variable: %s\n' "$output_var_name"
      printf '[node-subprocess-error] output preview (redacted, first 150 chars): %s\n' "$output_preview"
    } | tee -a "$error_log_file" >&2
    rm -f "$node_stderr_tmp"
    return 1
  fi
  rm -f "$node_stderr_tmp"
  return 0
}

# Phase 3B: Consolidate timing TSV files into timings-manifest.json
consolidate_timings_to_json() {
  local output_file="$1"
  local validation_timings="${2:-${KASEKI_RESULTS_DIR}/validation-timings.tsv}"
  local pre_validation_timings="${3:-${KASEKI_RESULTS_DIR}/pre-validation-timings.tsv}"
  local stage_timings="${4:-${KASEKI_RESULTS_DIR}/stage-timings.tsv}"
  
  if [ ! -f "$output_file" ]; then
    printf '{"validation_timings": [], "pre_validation_timings": [], "stage_timings": []}\n' > "$output_file"
  fi
  
  # Convert TSV files to JSON arrays and merge into manifest
  local validation_json pre_validation_json stage_json
  if [ -f "$validation_timings" ] && [ -s "$validation_timings" ]; then
    validation_json=$(tail -n +2 "$validation_timings" | jq -R 'split("\t") | {command: .[0], elapsed_seconds: (.[1] | tonumber)}' | jq -s '.' 2>/dev/null)
    [ -n "$validation_json" ] && jq --argjson data "$validation_json" '.validation_timings = $data' "$output_file" > "${output_file}.tmp" && mv "${output_file}.tmp" "$output_file"
  fi

  if [ -f "$pre_validation_timings" ] && [ -s "$pre_validation_timings" ]; then
    pre_validation_json=$(tail -n +2 "$pre_validation_timings" | jq -R 'split("\t") | {command: .[0], elapsed_seconds: (.[1] | tonumber)}' | jq -s '.' 2>/dev/null)
    [ -n "$pre_validation_json" ] && jq --argjson data "$pre_validation_json" '.pre_validation_timings = $data' "$output_file" > "${output_file}.tmp" && mv "${output_file}.tmp" "$output_file"
  fi
  
  if [ -f "$stage_timings" ] && [ -s "$stage_timings" ]; then
    stage_json=$(tail -n +2 "$stage_timings" | jq -R 'split("\t") | {stage: .[0], elapsed_seconds: (.[1] | tonumber)}' | jq -s '.' 2>/dev/null)
    [ -n "$stage_json" ] && jq --argjson data "$stage_json" '.stage_timings = $data' "$output_file" > "${output_file}.tmp" && mv "${output_file}.tmp" "$output_file"
  fi
}

# Phase 3C: Consolidate stderr files into phase-errors.jsonl
consolidate_phase_errors() {
  local output_file="$1"
  shift
  local -a stderr_files=("$@")
  
  : > "$output_file"  # Initialize empty JSONL
  
  local stderr_file phase_name
  for stderr_file in "${stderr_files[@]}"; do
    if [ -f "$stderr_file" ] && [ -s "$stderr_file" ]; then
      phase_name=$(basename "$stderr_file" -stderr.log)
      while IFS= read -r line || [ -n "$line" ]; do
        jq -n --arg phase "$phase_name" --arg msg "$line" '{phase: $phase, message: $msg, timestamp: (now | todate)}' >> "$output_file"
      done < "$stderr_file"
    fi
  done
}

# Phase 3D: Consolidate validation error files into artifact-validation-errors.jsonl
consolidate_validation_errors() {
  local output_file="$1"
  shift
  local -a error_files=("$@")
  
  : > "$output_file"  # Initialize empty JSONL
  
  local error_file phase_name
  for error_file in "${error_files[@]}"; do
    if [ -f "$error_file" ] && [ -s "$error_file" ]; then
      phase_name=$(basename "$error_file" -validation-errors.jsonl)
      while IFS= read -r line || [ -n "$line" ]; do
        [ -z "$line" ] && continue
        jq --arg phase "$phase_name" '. + {phase: $phase}' <<< "$line" >> "$output_file" 2>/dev/null || true
      done < "$error_file"
    fi
  done
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

validate_scouting_artifact_with_node() {
  local candidate_artifact="$1"
  local final_artifact="$2"
  local validation_error_file="$3"

  node "$SCOUTING_ALLOWLIST_HELPER" validate \
    "$candidate_artifact" \
    "$final_artifact" \
    "$validation_error_file" \
    "${KASEKI_RESULTS_DIR}/scouting-validation-errors.jsonl" \
    >/dev/null \
    2>/dev/null
}

# Validate scouting artifact and emit structured reason code
validate_scouting_artifact() {
  local candidate_artifact="$1"
  local final_artifact="$2"
  local reason_file="$3"
  local validation_error_file="/tmp/scouting-validation-errors.json"
  local reason_code="valid"
  local reason_details="artifact validation passed"

  : > "$validation_error_file"
  if [ ! -f "$candidate_artifact" ]; then
    local provider_diagnostic=""
    local provider_suggestion=""
    if [ "$KASEKI_PROVIDER" = "gateway" ] && [ "$KASEKI_SCOUTING_MODEL" = "auto" ]; then
      provider_diagnostic="Gateway scouting was requested with model=auto, but no scouting candidate artifact was produced. Gateway deployments cannot rely on the generic auto model sentinel for scouting artifact generation."
      provider_suggestion="set KASEKI_MODEL or LLM_GATEWAY_MODEL to dynamic/kaseki-agent or another supported gateway model before running scouting"
    fi

    if [ -f "${KASEKI_RESULTS_DIR}"/filesystem-readonly-reason.txt ]; then
      reason_code="readonly_filesystem"
      reason_details="1 critical scouting validation error: scouting-candidate.json missing due to read-only filesystem"
    else
      reason_code="missing_file"
      reason_details="1 critical scouting validation error: scouting-candidate.json"
      if [ -n "$provider_diagnostic" ]; then
        reason_details="$reason_details; $provider_diagnostic"
      fi
    fi
    # shellcheck disable=SC2016
    node -e 'const fs=require("node:fs"); const candidate=process.argv[1]; const reason=process.argv[2]; const details=process.argv[3]||""; const providerDiagnostic=process.argv[4]||""; const providerSuggestion=process.argv[5]||""; const defaultSuggestion=reason==="readonly_filesystem" ? "remount " + process.env.KASEKI_RESULTS_DIR + " as read-write (docker run -v /path:" + process.env.KASEKI_RESULTS_DIR + ":rw)" : "ensure the scouting Pi writes exactly one valid JSON object to " + process.env.KASEKI_RESULTS_DIR + "/scouting-candidate.json"; const error={timestamp:new Date().toISOString(),reason_code:reason,field:"scouting-candidate.json",expected:"file at " + process.env.KASEKI_RESULTS_DIR + "/scouting-candidate.json",actual:`missing: ${candidate}`,severity:"critical",details:details||undefined,suggestion:providerSuggestion||defaultSuggestion,provider:process.env.KASEKI_PROVIDER||"",model:process.env.KASEKI_SCOUTING_MODEL||""}; if(providerDiagnostic){error.diagnostic=providerDiagnostic; error.gateway_model_hint=providerSuggestion;} fs.appendFileSync(process.env.KASEKI_RESULTS_DIR + "/scouting-validation-errors.jsonl", JSON.stringify(error)+"\n");' "$candidate_artifact" "$reason_code" "$reason_details" "$provider_diagnostic" "$provider_suggestion" 2>/dev/null || true
  elif ! validate_scouting_artifact_with_node "$candidate_artifact" "$final_artifact" "$validation_error_file"; then
    reason_code="$(node -e 'try{const v=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(String(v.reason_code||"schema_mismatch"));}catch{process.stdout.write("schema_mismatch");}' "$validation_error_file" 2>/dev/null || printf 'schema_mismatch')"
    reason_details="$(node -e 'try{const v=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(String(v.details||"scouting artifact validation failed"));}catch{process.stdout.write("scouting artifact validation failed");}' "$validation_error_file" 2>/dev/null || printf 'scouting artifact validation failed')"
  fi

  printf '%s\n' "$reason_code" > "$reason_file"
  # scouting-validation-summary.txt artifact removed (Phase 1: low-value artifacts deletion)
  # [scouting-validation removed - errors go to scouting-validation-errors.jsonl]
  rm -f "$validation_error_file" 2>/dev/null || true
  [ "$reason_code" = "valid" ]
}

write_scouting_fallback_artifact() {
  local candidate_artifact="$1"

  if [ -s "$candidate_artifact" ]; then
    return 0
  fi

  node - "$candidate_artifact" <<'NODE' 2>/dev/null || return 0
const fs = require('node:fs');
const output = process.argv[2];
const taskPrompt = process.env.TASK_PROMPT || '';
const taskMode = process.env.KASEKI_TASK_MODE || 'patch';
const isInspect = taskMode === 'inspect';
const allowEmptyDiff = process.env.KASEKI_ALLOW_EMPTY_DIFF === '1';
function extractPromptFiles(prompt) {
  const matches = new Set();
  const pattern = /(?:^|[\s`'":(])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+)(?=$|[\s`'",:).;!?])/g;
  let match;
  while ((match = pattern.exec(prompt)) !== null) {
    const candidate = match[1].replace(/^\/+/, '');
    if (
      candidate &&
      !candidate.includes('..') &&
      !candidate.endsWith('/') &&
      !candidate.startsWith('http://') &&
      !candidate.startsWith('https://')
    ) {
      matches.add(candidate);
    }
  }
  return [...matches].slice(0, 10);
}
const promptFiles = extractPromptFiles(taskPrompt);
const fallback = {
  task: isInspect
    ? 'Read-only inspect task; scouting agent did not produce a candidate artifact.'
    : 'Patch task; scouting agent did not produce a usable candidate artifact.',
  requirements: isInspect
    ? [
      'Do not modify repository files.',
      'Do not commit, push, or open a pull request.',
      taskPrompt ? `Original task prompt: ${taskPrompt}` : 'Use the original task prompt from the run environment.',
    ]
    : [
      taskPrompt ? `Implement the original task prompt: ${taskPrompt}` : 'Implement the original task prompt from the run environment.',
      'Keep changes tightly scoped to files directly needed for the task.',
      'Do not expose secrets, credentials, or mounted secret file contents.',
    ],
  relevant_files: promptFiles.map((file) => ({
    path: file,
    reason: 'Explicitly mentioned in the original task prompt',
  })),
  observations: [
    isInspect
      ? 'Kaseki generated this fallback because inspect-mode scouting completed without writing scouting-candidate.json.'
      : 'Kaseki generated this fallback because patch-mode scouting completed without a valid scouting-candidate.json.',
  ],
  plan: isInspect
    ? [
      'Run the inspect agent using the original task prompt.',
      'Report findings without requiring a repository diff.',
    ]
    : [
      'Use the original task prompt as the authoritative task source.',
      'Inspect relevant files before editing.',
      'Make the smallest useful change and run lightweight validation appropriate for the files changed.',
    ],
  validation: isInspect
    ? [
      'Inspect mode is read-only; no validation commands are required by the scouting fallback.',
    ]
    : [
      'Run the narrowest available validation for changed files; for documentation-only work, formatting or link checks are sufficient when present.',
    ],
  risks: [
    isInspect
      ? 'The inspect agent has less pre-analysis context because scouting did not produce structured findings.'
      : 'The coding agent has less pre-analysis context because scouting did not produce structured findings.',
  ],
  test_impact: [],
  critical_change_expectations: {
    required_files: !isInspect ? promptFiles : [],
    required_search_strings: [],
    forbidden_empty_diff: !isInspect && !allowEmptyDiff,
  },
  suggested_allowlist: {
    agent_patterns: !isInspect ? promptFiles : [],
    validation_patterns: [],
  },
  fallback: true,
  fallback_reason: isInspect ? 'missing_scouting_candidate_for_inspect_mode' : 'missing_scouting_candidate_for_patch_mode',
};
fs.writeFileSync(output, JSON.stringify(fallback, null, 2) + '\n');
NODE

  if [ -s "$candidate_artifact" ]; then
    emit_event "scouting_fallback_created" "candidate=$candidate_artifact" "task_mode=$KASEKI_TASK_MODE"
    printf '%s\n' '{"timestamp":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","reason_code":"'"${KASEKI_TASK_MODE}"'_fallback","field":"scouting-candidate.json","expected":"file at '"${KASEKI_RESULTS_DIR}"'/scouting-candidate.json","actual":"generated fallback for '"${KASEKI_TASK_MODE}"' mode; validation pending","severity":"warning","suggestion":"validate the generated fallback before reporting that the run continued"}' >> "${KASEKI_RESULTS_DIR}/scouting-validation-errors.jsonl" 2>/dev/null || true
  fi
}

mark_scouting_fallback_recovered() {
  local reason_code="${1:-patch_fallback_recovered}"
  local error_file="${KASEKI_RESULTS_DIR}/scouting-validation-errors.jsonl"

  node - "$error_file" "$reason_code" <<'NODE' 2>/dev/null || true
const fs = require('node:fs');
const [file, reasonCode] = process.argv.slice(2);
let lines = [];
try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean); } catch {}
const fallbackCodes = new Set(['patch_fallback', 'inspect_fallback', 'provider_empty_assistant_turn']);
let alreadyMarked = false;
const updated = lines.map((line) => {
  try {
    const entry = JSON.parse(line);
    if (entry && entry.reason_code === reasonCode) alreadyMarked = true;
    if (
      entry &&
      (entry.severity === 'critical' && entry.reason_code === 'missing_file' && entry.field === 'scouting-candidate.json' ||
        fallbackCodes.has(entry.reason_code))
    ) {
      return JSON.stringify({ ...entry, recovered: true, recovery_reason_code: reasonCode });
    }
  } catch {}
  return line;
});
if (!alreadyMarked) {
  updated.push(JSON.stringify({
    timestamp: new Date().toISOString(),
    reason_code: reasonCode,
    field: 'scouting-candidate.json',
    expected: 'valid fallback scouting artifact',
    actual: 'fallback artifact validated successfully',
    severity: 'info',
    recovered: true,
    suggestion: 'ignore earlier missing_file or fallback diagnostics for the recovered scouting phase',
  }));
}
fs.writeFileSync(file, updated.join('\n') + '\n');
NODE
}


validate_goal_check_artifact_with_node() {
  local candidate_artifact="$1"
  local final_artifact="$2"
  local attempt="$3"
  local validation_error_file="$4"

  # shellcheck disable=SC2016
  node -e '
const fs = require("node:fs");
const path = require("node:path");
const input = process.argv[1];
const output = process.argv[2];
const attempt = Number(process.argv[3]);
const errorLog = process.argv[4];
const resultsDir = process.env.KASEKI_RESULTS_DIR || "/results";
const jsonlLog = path.join(resultsDir, "goal-check-validation-errors.jsonl");
const attemptsLog = path.join(resultsDir, "goal-check-attempts.jsonl");

function actualType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function appendValidationFailure(error) {
  try {
    fs.mkdirSync(path.dirname(jsonlLog), { recursive: true });
    fs.appendFileSync(jsonlLog, JSON.stringify({
      timestamp: new Date().toISOString(),
      attempt,
      ...error,
    }) + "\n");
  } catch (e) {
    // Non-blocking log failure
  }
}

function summarize(errors) {
  const critical = errors.filter((error) => error.severity === "critical").length;
  const warning = errors.filter((error) => error.severity === "warning").length;
  const counts = [];
  if (critical) counts.push(`${critical} critical`);
  if (warning) counts.push(`${warning} warning`);
  const fields = errors.slice(0, 2).map((error) => error.field).join(", ");
  const suffix = errors.length > 2 ? `, +${errors.length - 2} more` : "";
  return `${counts.join(", ")} goal-check validation ${errors.length === 1 ? "error" : "errors"}: ${fields}${suffix}`;
}

function fail(reasonHint, errors) {
  for (const error of errors) appendValidationFailure(error);
  fs.mkdirSync(path.dirname(errorLog), { recursive: true });
  fs.writeFileSync(errorLog, JSON.stringify({
    reason_hint: reasonHint,
    details: summarize(errors),
    errors,
  }) + "\n");
  process.exit(1);
}

let artifact;
try {
  artifact = JSON.parse(fs.readFileSync(input, "utf8"));
} catch (error) {
  fail("malformed_json", [{
    field: "root",
    expected: "valid JSON object",
    actual: error && error.message ? String(error.message) : String(error),
    severity: "critical",
    suggestion: `ensure exactly one valid JSON object is written to ${resultsDir}/goal-check-candidate.json`,
  }]);
}

const errors = [];
const addError = (field, expected, actual, severity, suggestion) => {
  errors.push({ field, expected, actual, severity, suggestion });
};

if (!artifact || Array.isArray(artifact) || typeof artifact !== "object") {
  addError("root", "object", actualType(artifact), "critical", "Goal check must return a JSON object (not array/null/primitive)");
} else {
  if (typeof artifact.met !== "boolean") {
    addError("met", "boolean", actualType(artifact.met), "critical", "met must be true or false");
  }

  if (!["low", "medium", "high"].includes(artifact.confidence)) {
    addError("confidence", "low|medium|high", artifact.confidence === undefined ? "missing" : actualType(artifact.confidence) === "string" ? artifact.confidence : actualType(artifact.confidence), "critical", "confidence must be one of: low, medium, high (case-sensitive)");
  }

  if (typeof artifact.summary !== "string") {
    addError("summary", "non-empty string", actualType(artifact.summary), "critical", "summary must be a string describing the goal check result");
  } else if (artifact.summary.trim().length === 0) {
    addError("summary", "non-empty string", "empty string", "critical", "summary cannot be empty; provide at least a brief verdict description");
  }

  if (artifact.met === false) {
    if (typeof artifact.retry_prompt !== "string") {
      addError("retry_prompt", "non-empty string (when met=false)", actualType(artifact.retry_prompt), "critical", "When met=false, retry_prompt must be a string with guidance for the next attempt");
    } else if (artifact.retry_prompt.trim().length === 0) {
      addError("retry_prompt", "non-empty string (when met=false)", "empty string", "critical", "retry_prompt cannot be empty when met=false; provide clear guidance for the next attempt");
    }
  } else if (artifact.retry_prompt !== undefined && typeof artifact.retry_prompt !== "string") {
    addError("retry_prompt", "string", actualType(artifact.retry_prompt), "critical", "retry_prompt must be a string; use an empty string when met=true");
  }

  for (const key of ["evidence", "missing", "validation_notes"]) {
    if (!Array.isArray(artifact[key])) {
      addError(key, "array of strings", actualType(artifact[key]), "warning", `${key} should be an array of strings`);
    } else if (!artifact[key].every((value) => typeof value === "string")) {
      addError(key, "array of strings", "array with non-strings", "warning", `All elements in ${key} must be strings`);
    }
  }
}

if (errors.length) {
  const hasCritical = errors.some((error) => error.severity === "critical");
  fail(hasCritical ? "schema_mismatch" : "schema_warning", errors);
}

artifact.attempt = attempt;
artifact.timestamp = new Date().toISOString();
fs.writeFileSync(output, JSON.stringify(artifact, null, 2) + "\n");
try {
  fs.mkdirSync(path.dirname(attemptsLog), { recursive: true });
  fs.appendFileSync(attemptsLog, JSON.stringify(artifact) + "\n");
} catch (e) {
  // Non-blocking log failure
}
' "$candidate_artifact" "$final_artifact" "$attempt" "$validation_error_file" 2>/dev/null
}

validate_goal_check_artifact() {
  local candidate_artifact="$1"
  local final_artifact="$2"
  local attempt="$3"
  local reason_file="$4"
  local summary_file="${5:-${KASEKI_RESULTS_DIR}/goal-check-validation-summary.txt}"
  local validation_error_file="/tmp/goal-check-validation-errors.json"
  local reason_code="valid"
  local reason_details="artifact validation passed"

  : > "$validation_error_file"
  if [ ! -f "$candidate_artifact" ]; then
    reason_code="missing_file"
    reason_details="1 critical goal-check validation error: goal-check-candidate.json"
    # shellcheck disable=SC2016
    node -e 'const fs=require("node:fs"); const path=require("node:path"); const candidate=process.argv[1]; const attempt=Number(process.argv[2]); const resultsDir=process.env.KASEKI_RESULTS_DIR || "/results"; const error={timestamp:new Date().toISOString(),attempt,field:"goal-check-candidate.json",expected:`file at ${path.join(resultsDir, "goal-check-candidate.json")}`,actual:`missing: ${candidate}`,severity:"critical",suggestion:`ensure the goal-check Pi writes exactly one valid JSON object to ${path.join(resultsDir, "goal-check-candidate.json")} before exiting successfully`}; fs.appendFileSync(path.join(resultsDir, "goal-check-validation-errors.jsonl"), JSON.stringify(error)+"\n");' "$candidate_artifact" "$attempt" 2>/dev/null || true
  elif ! validate_goal_check_artifact_with_node "$candidate_artifact" "$final_artifact" "$attempt" "$validation_error_file"; then
    reason_code="$(node -e 'try{const v=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); const hint=String(v.reason_hint||""); process.stdout.write(hint === "malformed_json" ? "malformed_json" : "schema_mismatch");}catch{process.stdout.write("schema_mismatch");}' "$validation_error_file" 2>/dev/null || printf 'schema_mismatch')"
    reason_details="$(node -e 'try{const v=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(String(v.details||"goal-check artifact validation failed"));}catch{process.stdout.write("goal-check artifact validation failed");}' "$validation_error_file" 2>/dev/null || printf 'goal-check artifact validation failed')"
  fi

  printf '%s\n' "$reason_code" > "$reason_file"
  printf '%s\n' "$reason_details" > "$summary_file"
  # [goal-check-validation removed - errors go to goal-check-validation-errors.jsonl]
  rm -f "$validation_error_file" 2>/dev/null || true
  [ "$reason_code" = "valid" ]
}

emit_error_event() {
  local error_type="$1"
  local detail="$2"
  local recovery="${3:-continue}"
  emit_event "error" "error_type=$error_type" "detail=$detail" "recovery_action=$recovery"
}

consolidate_phase_file() {
  local phase_file="$1"
  if [ -f "$phase_file" ] && [ -s "$phase_file" ]; then
    # Convert JSONL to JSON array
    jq -s '.' "$phase_file"
  else
    # Return empty array if file doesn't exist or is empty
    printf '[]'
  fi
}

metadata_env_fingerprints_json() {
  node - "${KASEKI_RESULTS_DIR}" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const resultsDir = process.argv[2];
const files = [
  'validation-baseline-env.log',
  'pre-agent-validation-env.log',
  'validation-env.log',
];
const out = {};
for (const file of files) {
  const full = path.join(resultsDir, file);
  if (!fs.existsSync(full)) continue;
  const text = fs.readFileSync(full);
  const lines = text.toString('utf8').split(/\r?\n/).filter(Boolean);
  const safe = {};
  for (const line of lines) {
    const m = line.match(/^\[validation (?:command|environment)\] ([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (['NODE_OPTIONS', 'NODE_PATH', 'disk_available', 'disk_space_available', 'disk_space_used', 'node_version', 'npm_version', 'stage', 'working_directory'].includes(key)) {
      safe[key.toLowerCase()] = m[2];
    }
  }
  out[file.replace(/\.log$/, '')] = {
    source_artifact_removed: file,
    sha256: crypto.createHash('sha256').update(text).digest('hex'),
    line_count: lines.length,
    safe_values: safe,
  };
}
process.stdout.write(JSON.stringify(out));
NODE
}

remove_low_value_artifacts() {
  local artifact
  local cleanup_artifacts
  cleanup_artifacts="progress.log baseline-npm-ci.log validation-baseline-raw.log validation-baseline-env.log pre-agent-validation-env.log validation-env.log restoration-report.md critical-change-expectations.log summarizer-stdout.log"
  if [ "${STATUS:-0}" -eq 0 ]; then
    cleanup_artifacts="stdout.log $cleanup_artifacts"
  fi
  for artifact in \
    $cleanup_artifacts; do
    if [ -e "${KASEKI_RESULTS_DIR}/$artifact" ]; then
      emit_event "artifact_consolidated" "artifact=$artifact" "action=removed_after_finalization"
      rm -f "${KASEKI_RESULTS_DIR}/$artifact" 2>/dev/null || true
    fi
  done
}

write_metadata() {
  local end_epoch end_iso duration exit_code stages_json
  end_epoch="$(date +%s)"
  end_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  duration=$((end_epoch - START_EPOCH))
  exit_code="${1:-$STATUS}"
  
  # Convert stages array to JSON array
  local stage_array
  stage_array="$(build_stages_array)"
  stages_json="$(printf '%s\n' "$stage_array" | jq -R . | jq -s . 2>/dev/null)"
  if [ -z "$stages_json" ]; then
    stages_json="[\"unknown\"]"
  fi
  
  cat > "${KASEKI_RESULTS_DIR}"/metadata.json <<META
{
  "schema_version": "2.0",
  "instance": $(printf '%s' "$INSTANCE_NAME" | json_encode),
  "repo_url": $(printf '%s' "$REPO_URL" | json_encode),
  "git_ref": $(printf '%s' "$GIT_REF" | json_encode),
  "provider": $(printf '%s' "$KASEKI_PROVIDER" | json_encode),
  "model": $(printf '%s' "$KASEKI_MODEL" | json_encode),
  "scouting_model": $(printf '%s' "$KASEKI_SCOUTING_MODEL" | json_encode),
  "goal_check_enabled": $([[ "$KASEKI_GOAL_CHECK" == "1" ]] && printf 'true' || printf 'false'),
  "goal_check_model": $(printf '%s' "$KASEKI_GOAL_CHECK_MODEL" | json_encode),
  "goal_check_max_retries": $KASEKI_GOAL_CHECK_MAX_RETRIES,
  "scouting_validation": {
    "validation_errors_log": "scouting-validation-errors.jsonl",
    "prompt_diagnostics_log": "prompt-diagnostics.jsonl",
    "max_output_tokens": $KASEKI_SCOUTING_MAX_OUTPUT_TOKENS
  },
  "filesystem_diagnostics": {
    "check_status": $(printf '%s' "$FILESYSTEM_CHECK_STATUS" | json_encode),
    "readonly_reason": $(printf '%s' "$FILESYSTEM_READONLY_REASON" | json_encode),
    "suggests_docker_run_fix": $([ -n "$FILESYSTEM_READONLY_REASON" ] && printf 'true' || printf 'false'),
    "suggested_fix": "docker run -v /path/to/results:/results:rw kaseki-agent"
  },
  "goal_check_validation": {
    "attempt_count": $GOAL_CHECK_ATTEMPTS,
    "validation_errors_log": "goal-check-validation-errors.jsonl",
    "attempts_log": "goal-check-attempts.jsonl"
  },
  "typescript_precheck": {
    "enabled": $([[ "$KASEKI_TS_PRE_CHECK" == "1" ]] && printf 'true' || printf 'false'),
    "command": $(printf '%s' "$KASEKI_TS_CHECK_COMMAND" | json_encode),
    "exit_code": $TS_PRE_CHECK_EXIT,
    "duration_seconds": $TS_PRE_CHECK_DURATION_SECONDS,
    "timestamp": $(printf '%s' "$TS_PRE_CHECK_TIMESTAMP" | json_encode),
    "log_file": "pre-validation-ts-check.log"
  },
  "run_evaluation_enabled": $([[ "$KASEKI_RUN_EVALUATION" == "1" ]] && printf 'true' || printf 'false'),
  "run_evaluation_model": $(printf '%s' "$KASEKI_RUN_EVALUATION_MODEL" | json_encode),
  "task_mode": $(printf '%s' "$KASEKI_TASK_MODE" | json_encode),
  "allow_empty_diff": $(printf '%s' "$KASEKI_ALLOW_EMPTY_DIFF" | json_encode),
  "started_at": $(printf '%s' "$START_ISO" | json_encode),
  "current_stage": $(printf '%s' "$CURRENT_STAGE" | json_encode),
  "ended_at": $(printf '%s' "$end_iso" | json_encode),
  "duration_seconds": $duration,
  "total_duration_seconds": $duration,
  "pi_duration_seconds": $PI_DURATION_SECONDS,
  "scouting_duration_seconds": $SCOUTING_DURATION_SECONDS,
  "scouting_attempts": ${KASEKI_SCOUTING_ATTEMPTS:-1},
  "scouting_succeeded_on_attempt": $([ -n "${KASEKI_SCOUTING_SUCCEEDED_ON_ATTEMPT:-}" ] && printf '%s' "$KASEKI_SCOUTING_SUCCEEDED_ON_ATTEMPT" || printf 'null'),
  "goal_setting_duration_seconds": $GOAL_SETTING_DURATION_SECONDS,
  "goal_setting_attempts": ${KASEKI_GOAL_SETTING_ATTEMPTS:-1},
  "goal_setting_succeeded_on_attempt": $([ -n "${KASEKI_GOAL_SETTING_SUCCEEDED_ON_ATTEMPT:-}" ] && printf '%s' "$KASEKI_GOAL_SETTING_SUCCEEDED_ON_ATTEMPT" || printf 'null'),
  "goal_check_duration_seconds": $GOAL_CHECK_DURATION_SECONDS,
  "run_evaluation_duration_seconds": $RUN_EVALUATION_DURATION_SECONDS,
  "exit_code": $exit_code,
  "failed_command": $(printf '%s' "$FAILED_COMMAND" | json_encode),
  "validation_failed_command": $(printf '%s' "$VALIDATION_FAILED_COMMAND_DETAIL" | json_encode),
  "validation_failure_reason": $(printf '%s' "$VALIDATION_FAILURE_REASON" | json_encode),
  "validation_allowlist_failure_reason": $(printf '%s' "$VALIDATION_ALLOWLIST_FAILURE_REASON" | json_encode),
  "pre_validation_failed_command": $(printf '%s' "$PRE_VALIDATION_FAILED_COMMAND_DETAIL" | json_encode),
  "pre_validation_failure_reason": $(printf '%s' "$PRE_VALIDATION_FAILURE_REASON" | json_encode),
  "quality_failure_reason": $(printf '%s' "$QUALITY_FAILURE_REASON" | json_encode),
  "goal_check_failure_reason": $(printf '%s' "$GOAL_CHECK_FAILURE_REASON" | json_encode),
  "provider_error_type": $(printf '%s' "$PROVIDER_ERROR_TYPE" | json_encode),
  "provider_error_phase": $(printf '%s' "$PROVIDER_ERROR_PHASE" | json_encode),
  "provider_error_provider": $(printf '%s' "$PROVIDER_ERROR_PROVIDER" | json_encode),
  "provider_error_api": $(printf '%s' "$PROVIDER_ERROR_API" | json_encode),
  "provider_error_model": $(printf '%s' "$PROVIDER_ERROR_MODEL" | json_encode),
  "provider_error_message": $(printf '%s' "$PROVIDER_ERROR_MESSAGE" | json_encode),
  "provider_error_retryable": $(printf '%s' "$PROVIDER_ERROR_RETRYABLE" | json_encode),
  "provider_error_retry_attempt_count": $PROVIDER_ERROR_RETRY_ATTEMPT_COUNT,
  "provider_error_retry_result": $(printf '%s' "$PROVIDER_ERROR_RETRY_RESULT" | json_encode),
  "provider_error_fallback_provider": $(printf '%s' "$PROVIDER_ERROR_FALLBACK_PROVIDER" | json_encode),
  "provider_error_fallback_model": $(printf '%s' "$PROVIDER_ERROR_FALLBACK_MODEL" | json_encode),
  "provider_error_fallback_result": $(printf '%s' "$PROVIDER_ERROR_FALLBACK_RESULT" | json_encode),
  "provider_error_primary": ${PROVIDER_ERROR_PRIMARY_JSON:-null},
  "provider_error_recovery": ${PROVIDER_ERROR_RECOVERY_JSON:-null},
  "pi_exit_code": $PI_EXIT,
  "scouting_exit_code": $SCOUTING_EXIT,
  "goal_setting_exit_code": $GOAL_SETTING_EXIT,
  "goal_setting_fallback_used": $([[ "${GOAL_SETTING_FALLBACK_USED:-0}" == "1" ]] && printf 'true' || printf 'false'),
  "goal_setting_fallback_mode": $(printf '%s' "${GOAL_SETTING_FALLBACK_MODE:-}" | json_encode),
  "goal_check_exit_code": $GOAL_CHECK_EXIT,
  "run_evaluation_exit_code": $RUN_EVALUATION_EXIT,
  "goal_check_attempts": $GOAL_CHECK_ATTEMPTS,
  "goal_check_met": $GOAL_CHECK_MET,
  "pre_validation_exit_code": $PRE_VALIDATION_EXIT,
  "validation_exit_code": $VALIDATION_EXIT,
  "validation_fail_fast_mode": $([[ "$KASEKI_VALIDATION_FAIL_FAST" == "1" ]] && printf 'true' || printf 'false'),
  "validation_run_all_commands": $([[ "$KASEKI_VALIDATION_RUN_ALL_COMMANDS" == "1" ]] && printf 'true' || printf 'false'),
  "pre_validation_stopped_early": $([[ "$PRE_VALIDATION_STOPPED_EARLY" == "true" ]] && printf 'true' || printf 'false'),
  "validation_stopped_early": $([[ "$VALIDATION_STOPPED_EARLY" == "true" ]] && printf 'true' || printf 'false'),
  "pre_validation_commands_attempted": $PRE_VALIDATION_COMMANDS_ATTEMPTED,
  "validation_commands_attempted": $VALIDATION_COMMANDS_ATTEMPTED,
  "auto_lint_cleanup_exit_code": $AUTO_LINT_CLEANUP_EXIT,
  "auto_lint_cleanup_result": $(printf '%s' "$AUTO_LINT_CLEANUP_RESULT" | json_encode),
  "auto_lint_cleanup_classification": $(printf '%s' "$AUTO_LINT_CLEANUP_CLASSIFICATION" | json_encode),
  "auto_lint_cleanup_failure_classification": $(printf '%s' "$AUTO_LINT_CLEANUP_FAILURE_CLASSIFICATION" | json_encode),
  "auto_lint_cleanup_commands_attempted": $AUTO_LINT_CLEANUP_COMMANDS_ATTEMPTED,
  "auto_lint_cleanup_commands_skipped": $AUTO_LINT_CLEANUP_COMMANDS_SKIPPED,
  "quality_exit_code": $QUALITY_EXIT,
  "secret_scan_exit_code": $SECRET_SCAN_EXIT,
  "github_push_exit_code": $GITHUB_PUSH_EXIT,
  "github_pr_exit_code": $GITHUB_PR_EXIT,
  "github_operation_phase": $(printf '%s' "$GITHUB_OPERATION_PHASE" | json_encode),
  "diff_nonempty": $DIFF_NONEMPTY,
  "actual_model": $(printf '%s' "$ACTUAL_MODEL" | json_encode),
  "scouting_actual_model": $(printf '%s' "$SCOUTING_ACTUAL_MODEL" | json_encode),
  "goal_setting_actual_model": $(printf '%s' "$GOAL_SETTING_ACTUAL_MODEL" | json_encode),
  "goal_check_actual_model": $(printf '%s' "$GOAL_CHECK_ACTUAL_MODEL" | json_encode),
  "run_evaluation_actual_model": $(printf '%s' "$RUN_EVALUATION_ACTUAL_MODEL" | json_encode),
  "run_evaluation_warning": $(printf '%s' "$RUN_EVALUATION_WARNING" | json_encode),
  "github_pr_url": $(printf '%s' "$GITHUB_PR_URL" | json_encode),
  "publish_mode": $(printf '%s' "$KASEKI_PUBLISH_MODE" | json_encode),
  "github_skip_reasons": $(github_skip_reasons_json),
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
  "validation_infrastructure_diagnostics": {
    "startup_diagnostics_log": "validation-startup-diagnostics.log",
    "filter_diagnostics_log": "filter-diagnostics.log",
    "has_memory_pressure_events": $([ -f "${KASEKI_RESULTS_DIR}/filter-diagnostics.log" ] && grep -q "memory" "${KASEKI_RESULTS_DIR}/filter-diagnostics.log" && printf 'true' || printf 'false'),
    "has_backpressure_events": $([ -f "${KASEKI_RESULTS_DIR}/filter-diagnostics.log" ] && grep -q "backpressure" "${KASEKI_RESULTS_DIR}/filter-diagnostics.log" && printf 'true' || printf 'false'),
    "infrastructure_failure": $([[ "$VALIDATION_EXIT" == "141" ]] && printf 'true' || printf 'false')
  },
  "baseline_validation_enabled": $([[ "$KASEKI_BASELINE_VALIDATION_ENABLED" == "1" ]] && printf 'true' || printf 'false'),
  "baseline_cache_status": $(printf '%s' "$BASELINE_CACHE_STATUS" | json_encode),
  "baseline_validation_exit_code": $BASELINE_VALIDATION_EXIT,
  "baseline_validation_failed_command": $(printf '%s' "$BASELINE_VALIDATION_FAILED_COMMAND_DETAIL" | json_encode),
  "test_failure_classification_status": $(printf '%s' "$TEST_FAILURE_CLASSIFICATION_STATUS" | json_encode),
  "newly_introduced_failures_count": $NEWLY_INTRODUCED_FAILURES_COUNT,
  "environment_fingerprints": $(metadata_env_fingerprints_json),
  "node_version": $(node --version 2>/dev/null | json_encode || printf 'null'),
  "npm_version": $(npm --version 2>/dev/null | json_encode || printf 'null'),
  "pi_version": $(printf '%s' "$PI_VERSION" | json_encode),
  "stages": $stages_json,
  "phases": {
    "validation": {
      "exit_code": $VALIDATION_EXIT,
      "commands_attempted": $VALIDATION_COMMANDS_ATTEMPTED,
      "stopped_early": $([[ "$VALIDATION_STOPPED_EARLY" == "true" ]] && printf 'true' || printf 'false'),
      "results": $(consolidate_phase_file "${KASEKI_RESULTS_DIR}"/.validation-results-temp.jsonl)
    },
    "quality_gates": {
      "exit_code": $QUALITY_EXIT,
      "violations": $(consolidate_phase_file "${KASEKI_RESULTS_DIR}"/.quality-gates-temp.jsonl)
    },
    "secret_scan": {
      "exit_code": $SECRET_SCAN_EXIT,
      "matches": $(consolidate_phase_file "${KASEKI_RESULTS_DIR}"/.secret-scan-temp.jsonl)
    },
    "gateway_normalization": {
      "diagnostics_file": ".gateway-diagnostics.jsonl",
      "events": $(consolidate_phase_file "${KASEKI_RESULTS_DIR}"/.gateway-diagnostics.jsonl)
    }
  }
}
META
  printf '%s\n' "$exit_code" > "${KASEKI_RESULTS_DIR}"/exit_code
}

set_current_stage() {
  CURRENT_STAGE="$1"
}

# Build array of expected stages based on configuration
build_stages_array() {
  local stages=()
  stages+=("clone repository")
  stages+=("prepare node dependencies")
  
  if [[ "$KASEKI_PRE_AGENT_VALIDATION" == "1" ]]; then
    stages+=("pre-agent validation")
  fi

  if [[ "$KASEKI_TS_PRE_CHECK" == "1" ]]; then
    stages+=("typescript precheck")
  fi

  if [[ "$KASEKI_GOAL_SETTING" == "1" ]]; then
    stages+=("pi goal-setting agent")
  fi
  
  if [[ "$KASEKI_SCOUTING" == "1" ]]; then
    stages+=("scouting prerequisites validation")
    stages+=("pi scouting agent")
    stages+=("derive allowlist from scouting")
  fi
  
  if [[ "$KASEKI_GOAL_CHECK" == "1" ]]; then
    stages+=("goal check")
  fi
  
  if [[ "$KASEKI_RUN_EVALUATION" == "1" ]]; then
    stages+=("run evaluation")
  fi
  
  stages+=("pi coding agent")
  if [[ "$KASEKI_AUTO_LINT_CLEANUP" == "1" ]]; then
    stages+=("auto lint cleanup")
  fi
  stages+=("collect agent diff")
  stages+=("quality checks")
  stages+=("validation")
  stages+=("secret scan")
  
  # GitHub operations: only if not dry-run and GitHub app is enabled
  if [[ "$KASEKI_DRY_RUN" != "1" ]] && [[ "$GITHUB_APP_ENABLED" == "1" ]]; then
    stages+=("github operations")
  fi
  
  stages+=("complete")

  local stage
  for stage in "${stages[@]}"; do
    printf '%s\n' "$stage"
  done
}

extract_failure_diagnostic_reason() {
  # Prefer terminal failure state captured by the main flow over validation
  # diagnostics from earlier phases that recovered and completed successfully.
  if [ -n "$PROVIDER_ERROR_MESSAGE" ]; then
    printf '%s: %s%s' "$PROVIDER_ERROR_TYPE" "$PROVIDER_ERROR_MESSAGE" "$([ -n "$PROVIDER_ERROR_PHASE" ] && printf ' (phase: %s)' "$PROVIDER_ERROR_PHASE")"
    return 0
  fi
  if [ -n "$GOAL_CHECK_FAILURE_REASON" ]; then
    printf '%s' "$GOAL_CHECK_FAILURE_REASON"
    return 0
  fi
  if [ -n "$QUALITY_FAILURE_REASON" ]; then
    printf '%s' "$QUALITY_FAILURE_REASON"
    return 0
  fi
  if [ -n "$VALIDATION_FAILURE_REASON" ]; then
    printf '%s' "$VALIDATION_FAILURE_REASON"
    return 0
  fi
  if [ -n "$VALIDATION_ALLOWLIST_FAILURE_REASON" ]; then
    printf '%s' "$VALIDATION_ALLOWLIST_FAILURE_REASON"
    return 0
  fi
  if [ -n "$PRE_VALIDATION_FAILURE_REASON" ]; then
    printf '%s' "$PRE_VALIDATION_FAILURE_REASON"
    return 0
  fi

  # A terminal runtime/import failure is more causal than missing downstream
  # artifacts produced after that command failed. Prefer the last structured
  # Node/shell error from stderr before phase-validation fallout.
  local terminal_runtime_error
  terminal_runtime_error="$(node - "${KASEKI_RESULTS_DIR}/stderr.log" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
if (!fs.existsSync(file)) process.exit(0);
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const runtimeError = lines.find((line) =>
  /^Error(?:\s+\[[A-Z0-9_]+\])?:/.test(line) || /(?:ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND)/.test(line)
);
const wrapperError = lines.find((line) => /^ERROR:\s+/.test(line));
if (runtimeError || wrapperError) process.stdout.write(runtimeError || wrapperError);
NODE
)"
  if [ -n "$terminal_runtime_error" ]; then
    printf '%s: %s' "${FAILED_COMMAND:-runtime failure}" "$terminal_runtime_error"
    return 0
  fi

  local diagnostic
  diagnostic="$(node - "${KASEKI_RESULTS_DIR}" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const resultsDir = process.argv[2];
const files = [
  'scouting-validation-errors.jsonl',
  'goal-setting-validation-errors.jsonl',
  'goal-check-validation-errors.jsonl',
  'artifact-validation-errors.jsonl',
];

function firstJsonLine(file) {
  const full = path.join(resultsDir, file);
  if (!fs.existsSync(full) || fs.statSync(full).size === 0) return undefined;
  const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/).filter(Boolean);
  const parsed = [];
  for (const line of lines) {
    try { parsed.push(JSON.parse(line)); } catch {}
  }
  const unrecovered = parsed.filter((data) => data && data.severity !== 'warning' && !data.recovered);
  const data = unrecovered.length ? unrecovered[unrecovered.length - 1] : undefined;
  return data ? { file, data } : undefined;
}

for (const file of files) {
  const entry = firstJsonLine(file);
  if (!entry) continue;
  const data = entry.data;
  const reason = data.reason_code || data.reason || data.status || 'artifact validation error';
  const field = data.field || data.file || '';
  const actual = data.actual || data.detail || data.suggestion || '';
  const parts = [entry.file, reason, field, actual].filter(Boolean);
  process.stdout.write(parts.join(': '));
  process.exit(0);
}
NODE
)"

  if [ -n "$diagnostic" ]; then
    printf '%s' "$diagnostic"
  fi
}

capture_provider_error_from_summary() {
  local summary_file="$1"
  local phase="$2"
  local payload

  [ -s "$summary_file" ] || return 1
  payload="$(node - "$summary_file" "$phase" <<'NODE' 2>/dev/null || true
const fs = require('node:fs');
const [summaryPath, phase] = process.argv.slice(2);
let summary;
try { summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')); } catch { process.exit(0); }
const error = summary && typeof summary === 'object'
  ? summary.primary_provider_error || (Array.isArray(summary.provider_errors) ? summary.provider_errors[0] : null)
  : null;
if (!error || typeof error !== 'object' || typeof error.message !== 'string' || !error.message.trim()) {
  process.exit(0);
}
const normalized = {
  type: typeof error.type === 'string' && error.type ? error.type : 'provider_error',
  phase,
  provider: typeof error.provider === 'string' ? error.provider : '',
  api: typeof error.api === 'string' ? error.api : '',
  model: typeof error.model === 'string' ? error.model : '',
  message: error.message,
};
process.stdout.write(JSON.stringify(normalized));
NODE
)"
  [ -n "$payload" ] || return 1

  printf '%s\n' "$payload" > "${KASEKI_RESULTS_DIR}/provider-error.json"
  PROVIDER_ERROR_TYPE="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(String(p.type || ""));' "$payload" 2>/dev/null || true)"
  PROVIDER_ERROR_PHASE="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(String(p.phase || ""));' "$payload" 2>/dev/null || true)"
  PROVIDER_ERROR_PROVIDER="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(String(p.provider || ""));' "$payload" 2>/dev/null || true)"
  PROVIDER_ERROR_API="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(String(p.api || ""));' "$payload" 2>/dev/null || true)"
  PROVIDER_ERROR_MODEL="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(String(p.model || ""));' "$payload" 2>/dev/null || true)"
  PROVIDER_ERROR_MESSAGE="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(String(p.message || ""));' "$payload" 2>/dev/null || true)"
  return 0
}

capture_provider_error_from_log() {
  local log_file="$1"
  local phase="$2"
  local payload

  [ -s "$log_file" ] || return 1
  payload="$(node - "$log_file" "$phase" "$KASEKI_PROVIDER" <<'NODE' 2>/dev/null || true
const fs = require('node:fs');
const [logPath, phase, provider] = process.argv.slice(2);
let text = '';
try { text = fs.readFileSync(logPath, 'utf8'); } catch { process.exit(0); }
const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
if (lines.length === 0) process.exit(0);
const keywords = [
  /gateway/i,
  /provider/i,
  /api key/i,
  /auth/i,
  /unauthori[sz]ed/i,
  /\b401\b/,
  /\b403\b/,
  /model/i,
  /manifest/i,
  /fetch/i,
  /network/i,
  /responses/i,
  /openai/i,
];
const matched = lines.filter((line) => keywords.some((pattern) => pattern.test(line)));
const selected = (matched.length ? matched : lines).slice(-8).join('\n');
if (!selected) process.exit(0);
const lower = selected.toLowerCase();
const type = lower.includes('api key') || lower.includes('auth') || lower.includes('401') || lower.includes('403')
  ? 'provider_auth_error'
  : 'provider_error';
process.stdout.write(JSON.stringify({
  type,
  phase,
  provider: provider || '',
  api: '',
  model: '',
  message: selected,
}));
NODE
)"
  [ -n "$payload" ] || return 1

  printf '%s\n' "$payload" > "${KASEKI_RESULTS_DIR}/provider-error.json"
  PROVIDER_ERROR_TYPE="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(String(p.type || ""));' "$payload" 2>/dev/null || true)"
  PROVIDER_ERROR_PHASE="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(String(p.phase || ""));' "$payload" 2>/dev/null || true)"
  PROVIDER_ERROR_PROVIDER="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(String(p.provider || ""));' "$payload" 2>/dev/null || true)"
  PROVIDER_ERROR_API="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(String(p.api || ""));' "$payload" 2>/dev/null || true)"
  PROVIDER_ERROR_MODEL="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(String(p.model || ""));' "$payload" 2>/dev/null || true)"
  PROVIDER_ERROR_MESSAGE="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(String(p.message || ""));' "$payload" 2>/dev/null || true)"
  return 0
}

provider_error_is_terminal() {
  [ -n "$PROVIDER_ERROR_MESSAGE" ]
}

clear_provider_error() {
  PROVIDER_ERROR_TYPE=""
  PROVIDER_ERROR_PHASE=""
  PROVIDER_ERROR_PROVIDER=""
  PROVIDER_ERROR_API=""
  PROVIDER_ERROR_MODEL=""
  PROVIDER_ERROR_MESSAGE=""
  PROVIDER_ERROR_RETRYABLE=""
  PROVIDER_ERROR_RETRY_ATTEMPT_COUNT=0
  PROVIDER_ERROR_RETRY_RESULT="none"
  PROVIDER_ERROR_FALLBACK_PROVIDER=""
  PROVIDER_ERROR_FALLBACK_MODEL=""
  PROVIDER_ERROR_FALLBACK_RESULT="none"
  PROVIDER_ERROR_PRIMARY_JSON=""
  PROVIDER_ERROR_RECOVERY_JSON=""
}

snapshot_provider_attempt() {
  local raw_events_file="$1" summary_file="$2" phase_name="$3" provider="$4" model="$5" attempt_name="$6"
  local attempt_dir="${KASEKI_RESULTS_DIR}/provider-attempts/${phase_name}"
  mkdir -p "$attempt_dir"
  cp "$raw_events_file" "$attempt_dir/${attempt_name}.events.jsonl" 2>/dev/null || true
  cp "$summary_file" "$attempt_dir/${attempt_name}.summary.json" 2>/dev/null || true
  node - "$summary_file" "$provider" "$model" "$phase_name" "$attempt_name" > "$attempt_dir/${attempt_name}.json" <<'NODE' 2>/dev/null || true
const fs = require('node:fs');
const [summaryPath, provider, model, phase, attempt] = process.argv.slice(2);
let summary = {};
try { summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')); } catch {}
const error = summary.primary_provider_error || (Array.isArray(summary.provider_errors) ? summary.provider_errors[0] : null);
process.stdout.write(JSON.stringify({ phase, attempt, provider, model, error: error || null }, null, 2) + '\n');
NODE
  node - "$attempt_dir/${attempt_name}.json" <<'NODE' >> "${KASEKI_RESULTS_DIR}/provider-attempts.jsonl" 2>/dev/null || true
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
process.stdout.write(JSON.stringify(value) + '\n');
NODE
}

provider_error_json_from_summary() {
  local summary_file="$1" phase_name="$2" provider="$3" model="$4"
  node - "$summary_file" "$phase_name" "$provider" "$model" <<'NODE' 2>/dev/null || printf '{}'
const fs = require('node:fs');
const [summaryPath, phase, provider, model] = process.argv.slice(2);
let summary = {};
try { summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')); } catch {}
const error = summary.primary_provider_error || (Array.isArray(summary.provider_errors) ? summary.provider_errors[0] : null) || {};
process.stdout.write(JSON.stringify({
  type: error.type || 'provider_error', phase, provider: error.provider || provider,
  api: error.api || '', model: error.model || model, message: error.message || '',
  retryable: error.retryable === true
}));
NODE
}

resolve_openrouter_fallback_key() {
  openrouter_api_key="${OPENROUTER_API_KEY:-}"
  [ -n "$openrouter_api_key" ] && return 0

  local candidate
  for candidate in \
    "${OPENROUTER_API_KEY_FILE:-}" \
    "${KASEKI_SECRETS_DIR:-/run/secrets/kaseki}/openrouter_api_key" \
    "/agents/secrets/openrouter_api_key" \
    "$HOME/.kaseki/secrets/openrouter_api_key"; do
    if [ -n "$candidate" ] && [ -r "$candidate" ] && [ -s "$candidate" ]; then
      openrouter_api_key="$(tr -d '\r\n' < "$candidate")"
      [ -n "$openrouter_api_key" ] && return 0
    fi
  done
  return 1
}

check_if_provider_error_retryable() {
  # Check if the most recent provider error (from summary file) is retryable
  # Sets PROVIDER_ERROR_RETRYABLE variable and returns 0 if retryable, 1 if not
  local summary_file="$1"
  
  PROVIDER_ERROR_RETRYABLE="false"
  [ -s "$summary_file" ] || return 1
  
  # Check if primary_provider_error.retryable is true
  if node -e "
const fs = require('node:fs');
const summary = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const error = summary && typeof summary === 'object'
  ? summary.primary_provider_error || (Array.isArray(summary.provider_errors) ? summary.provider_errors[0] : null)
  : null;
if (error && typeof error === 'object' && error.retryable === true) {
  process.exit(0);  // Retryable
}
process.exit(1);  // Not retryable or no error
" "$summary_file" 2>/dev/null; then
    PROVIDER_ERROR_RETRYABLE="true"
    return 0
  fi
  return 1
}

run_pi_with_retry() {
  # Wrapper around run_pi_json_capture that implements automatic single retry for transient provider errors.
  # 
  # Arguments:
  #   $1: raw_events_file    - Path to write raw event JSONL
  #   $2: timeout_seconds    - Timeout for Pi invocation
  #   $3: model              - Model to use
  #   $4: prompt             - Task prompt
  #   $5: summary_file_base  - Base path for summary files (without .json extension, e.g., "pi-summary")
  #   $6: stderr_target      - Optional: stderr file path
  #   $7: phase_name         - Phase name for logging (e.g., "coding", "scouting")
  #   $8: allow_fallback     - Set to 1 to allow gateway -> OpenRouter fallback
  #
  # Returns:
  #   Exit code from Pi invocation (after retry logic applied)
  #
  # Sets global variables:
  #   PROVIDER_ERROR_RETRY_ATTEMPT_COUNT - 0 if no retry, 1-2 if retried
  #   PROVIDER_ERROR_RETRY_RESULT - "none" (no error), "success" (retry succeeded), "failed" (retry failed)
  #
  # Behavior:
  # - Calls run_pi_json_capture to invoke Pi
  # - Runs the event filter after every invocation because Pi can exit 0 even
  #   when the provider stream reports a terminal finish_reason:error event
  # - Normalizes a terminal provider event to exit 88 before retry decisions
  # - If retryable: sleep 3s, clears raw events, retries once
  # - Caller may run the event filter again when collecting final artifacts
  # - Max 2 total invocations (initial + 1 retry)
  
  local raw_events_file="$1"
  local timeout_seconds="$2"
  local model="$3"
  local prompt="$4"
  local summary_file_base="$5"
  local stderr_target="${6:-}"
  local phase_name="${7:-unknown}"
  local allow_fallback="${8:-0}"
  local pi_exit summary_file attempt=1 original_provider="$KASEKI_PROVIDER"
  local previous_retryable="${PROVIDER_ERROR_RETRYABLE:-}"
  local previous_retry_attempt_count="${PROVIDER_ERROR_RETRY_ATTEMPT_COUNT:-0}"
  local previous_retry_result="${PROVIDER_ERROR_RETRY_RESULT:-none}"
  local previous_fallback_provider="${PROVIDER_ERROR_FALLBACK_PROVIDER:-}"
  local previous_fallback_model="${PROVIDER_ERROR_FALLBACK_MODEL:-}"
  local previous_fallback_result="${PROVIDER_ERROR_FALLBACK_RESULT:-none}"
  
  # Reset retry tracking
  PROVIDER_ERROR_RETRY_ATTEMPT_COUNT=0
  PROVIDER_ERROR_RETRY_RESULT="none"
  PROVIDER_ERROR_FALLBACK_PROVIDER=""
  PROVIDER_ERROR_FALLBACK_MODEL=""
  PROVIDER_ERROR_FALLBACK_RESULT="none"
  
  invoke_pi() {
    if [ -n "$stderr_target" ]; then
      run_pi_json_capture "$raw_events_file" "$timeout_seconds" "$model" "$prompt" "$stderr_target"
    else
      run_pi_json_capture "$raw_events_file" "$timeout_seconds" "$model" "$prompt"
    fi
  }

  summarize_invocation() {
    summary_file="${KASEKI_RESULTS_DIR}/${summary_file_base}.json"
    if [ "$summary_file_base" = "pi-summary" ]; then
      kaseki-pi-event-filter "$raw_events_file" "${KASEKI_RESULTS_DIR}/pi-events.jsonl" "$summary_file" 2>/dev/null || true
    elif [ "$summary_file_base" = "scouting-summary" ]; then
      kaseki-pi-event-filter "$raw_events_file" "${KASEKI_RESULTS_DIR}/scouting-events.jsonl" "$summary_file" 2>/dev/null || true
    elif [ "$summary_file_base" = "goal-setting-summary" ]; then
      kaseki-pi-event-filter "$raw_events_file" "${KASEKI_RESULTS_DIR}/goal-setting-events.jsonl" "$summary_file" 2>/dev/null || true
    elif [ "$summary_file_base" = "goal-check-summary" ]; then
      kaseki-pi-event-filter "$raw_events_file" "${KASEKI_RESULTS_DIR}/goal-check-events.jsonl" "$summary_file" 2>/dev/null || true
    else
      cp "$raw_events_file" "${summary_file_base}.jsonl" 2>/dev/null || true
    fi

    # Pi 0.77 may return success even though an OpenAI-compatible stream ended
    # with finish_reason:error. Treat the structured event as authoritative.
    if capture_provider_error_from_summary "$summary_file" "$phase_name"; then
      pi_exit=88
      check_if_provider_error_retryable "$summary_file" || true
      return 0
    fi
    return 1
  }

  # First attempt
  invoke_pi
  pi_exit=$?
  summarize_invocation || true
  snapshot_provider_attempt "$raw_events_file" "$summary_file" "$phase_name" "$original_provider" "$model" "primary-1"
  if [ "$pi_exit" -eq 88 ]; then
    PROVIDER_ERROR_PRIMARY_JSON="$(provider_error_json_from_summary "$summary_file" "$phase_name" "$original_provider" "$model")"
  fi

  # For phase-specific retries, we need to check provider errors
  # Only retry if we got exit 88 (provider error) on first attempt
  if [ "$pi_exit" -eq 88 ] && [ "$attempt" -eq 1 ]; then
    # Check if error is retryable
    if check_if_provider_error_retryable "$summary_file"; then
      printf '[RETRY] Provider error is retryable in %s phase; attempting second invocation after 3s delay (model: %s)\n' \
        "$phase_name" "$model" >&2
      
      PROVIDER_ERROR_RETRY_ATTEMPT_COUNT=1
      sleep 3
      rm -f "$raw_events_file" 2>/dev/null || true
      : > "$raw_events_file"
      
      attempt=2
      invoke_pi
      pi_exit=$?
      summarize_invocation || true
      snapshot_provider_attempt "$raw_events_file" "$summary_file" "$phase_name" "$original_provider" "$model" "primary-2"
      if [ "$pi_exit" -eq 88 ]; then
        PROVIDER_ERROR_PRIMARY_JSON="$(provider_error_json_from_summary "$summary_file" "$phase_name" "$original_provider" "$model")"
      fi
      
      if [ "$pi_exit" -eq 0 ]; then
        PROVIDER_ERROR_RETRY_RESULT="success"
        printf '[RETRY SUCCESS] Provider error resolved on retry in %s phase\n' "$phase_name" >&2
      elif [ "$pi_exit" -eq 88 ]; then
        PROVIDER_ERROR_RETRY_ATTEMPT_COUNT=2
        PROVIDER_ERROR_RETRY_RESULT="failed"
        printf '[RETRY EXHAUSTED] Provider error persisted after retry in %s phase; exiting with code 88\n' \
          "$phase_name" >&2
      fi
    fi
  fi

  if [ "$pi_exit" -eq 88 ] && [ "$PROVIDER_ERROR_RETRYABLE" = "true" ] && [ "$allow_fallback" = "1" ] && \
    [ "$original_provider" = "gateway" ] && [ "$KASEKI_PROVIDER_FALLBACK" = "openrouter" ] && \
    resolve_openrouter_fallback_key; then
    PROVIDER_ERROR_FALLBACK_PROVIDER="openrouter"
    PROVIDER_ERROR_FALLBACK_MODEL="$KASEKI_PROVIDER_FALLBACK_MODEL"
    printf '[FALLBACK] Gateway provider failed in %s phase; retrying with provider=%s model=%s\n' \
      "$phase_name" "$PROVIDER_ERROR_FALLBACK_PROVIDER" "$PROVIDER_ERROR_FALLBACK_MODEL" >&2
    rm -f "$raw_events_file" 2>/dev/null || true
    : > "$raw_events_file"
    KASEKI_PROVIDER="$PROVIDER_ERROR_FALLBACK_PROVIDER"
    model="$PROVIDER_ERROR_FALLBACK_MODEL"
    invoke_pi
    pi_exit=$?
    summarize_invocation || true
    snapshot_provider_attempt "$raw_events_file" "$summary_file" "$phase_name" "$PROVIDER_ERROR_FALLBACK_PROVIDER" "$PROVIDER_ERROR_FALLBACK_MODEL" "fallback-1"
    PROVIDER_ERROR_RECOVERY_JSON="$(provider_error_json_from_summary "$summary_file" "$phase_name" "$PROVIDER_ERROR_FALLBACK_PROVIDER" "$PROVIDER_ERROR_FALLBACK_MODEL")"
    KASEKI_PROVIDER="$original_provider"
    if [ "$pi_exit" -eq 0 ]; then
      PROVIDER_ERROR_FALLBACK_RESULT="success"
      printf '[FALLBACK SUCCESS] OpenRouter completed the %s phase\n' "$phase_name" >&2
    else
      PROVIDER_ERROR_FALLBACK_RESULT="failed"
      printf '[FALLBACK FAILED] OpenRouter failed the %s phase with exit %s\n' "$phase_name" "$pi_exit" >&2
    fi
    openrouter_api_key=""
  fi

  # A later goal-check coding attempt must not erase recovery telemetry from an
  # earlier attempt when the later invocation itself needed no recovery.
  if [ "$pi_exit" -eq 0 ] && [ "$PROVIDER_ERROR_RETRY_ATTEMPT_COUNT" -eq 0 ] && \
    [ "$PROVIDER_ERROR_FALLBACK_RESULT" = "none" ] && \
    { [ "$previous_retry_attempt_count" -gt 0 ] || [ "$previous_fallback_result" != "none" ]; }; then
    PROVIDER_ERROR_RETRYABLE="$previous_retryable"
    PROVIDER_ERROR_RETRY_ATTEMPT_COUNT="$previous_retry_attempt_count"
    PROVIDER_ERROR_RETRY_RESULT="$previous_retry_result"
    PROVIDER_ERROR_FALLBACK_PROVIDER="$previous_fallback_provider"
    PROVIDER_ERROR_FALLBACK_MODEL="$previous_fallback_model"
    PROVIDER_ERROR_FALLBACK_RESULT="$previous_fallback_result"
  fi
  
  return "$pi_exit"
}

append_pre_coding_provider_fallback_error() {
  local log_file="$1"
  local phase="$2"
  local recovery_action="$3"
  local artifact="$4"

  node - "$log_file" "$phase" "$recovery_action" "$artifact" \
    "$PROVIDER_ERROR_TYPE" "$PROVIDER_ERROR_PROVIDER" "$PROVIDER_ERROR_API" "$PROVIDER_ERROR_MODEL" "$PROVIDER_ERROR_MESSAGE" <<'NODE' 2>/dev/null || true
const fs = require('node:fs');
const [
  logFile,
  phase,
  recoveryAction,
  artifact,
  type,
  provider,
  api,
  model,
  message,
] = process.argv.slice(2);
const entry = {
  timestamp: new Date().toISOString(),
  reason_code: type || 'provider_error',
  phase,
  field: 'assistant.content',
  expected: 'assistant text, tool calls, or a valid JSON artifact',
  actual: message || 'provider returned no usable assistant output',
  severity: 'warning',
  provider: provider || '',
  api: api || '',
  model: model || '',
  recovered: true,
  recovery_action: recoveryAction,
  fallback_artifact: artifact || '',
  suggestion: 'Gateway model=auto must continue routing, but the Responses API adapter should return assistant output_text/message content instead of an empty assistant turn.',
};
fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
NODE
}

write_result_summary() {
  # Generate a human-readable markdown summary of the run
  local metadata_file="${KASEKI_RESULTS_DIR}/metadata.json"
  local failure_file="${KASEKI_RESULTS_DIR}/failure.json"
  local summary_file="${KASEKI_RESULTS_DIR}/result-summary.md"
  
  # Extract key information from metadata.json if it exists; during EXIT finalization,
  # metadata may not have been written yet, so fall back to the in-memory final status.
  local exit_code="$STATUS"
  local failed_command="$FAILED_COMMAND"
  local instance_name="$INSTANCE_NAME"
  
  if [ -f "$metadata_file" ]; then
    exit_code="$(jq -r '.exit_code // empty' "$metadata_file" 2>/dev/null || true)"
    failed_command="$(jq -r '.failed_command // empty' "$metadata_file" 2>/dev/null || true)"
    instance_name="$(jq -r '.instance // empty' "$metadata_file" 2>/dev/null || true)"
  fi
  [ -n "$exit_code" ] || exit_code="$STATUS"
  [ -n "$failed_command" ] || failed_command="$FAILED_COMMAND"
  [ -n "$instance_name" ] || instance_name="$INSTANCE_NAME"
  
  # Determine status line
  local status_line
  if [ "$exit_code" -eq 0 ]; then
    status_line="✅ Success"
  else
    status_line="❌ Failed (exit code $exit_code)"
  fi
  
  # Generate markdown summary
  cat > "$summary_file" <<SUMMARY
# Kaseki Agent Run Summary

- Status: $status_line
- Instance: $instance_name
- Exit Code: $exit_code
SUMMARY
  
  if [ -n "$failed_command" ]; then
    printf -- "- Failed Command: %s\n" "$failed_command" >> "$summary_file"
  fi

  local diagnostic_reason
  diagnostic_reason="$(extract_failure_diagnostic_reason)"
  if [ -n "$diagnostic_reason" ]; then
    printf -- "- Failure Detail: %s\n" "$diagnostic_reason" >> "$summary_file"
  fi
  
  # Add git diff info if available
  if [ -f "${KASEKI_RESULTS_DIR}/git.diff" ]; then
    local diff_lines
    diff_lines="$(wc -l < "${KASEKI_RESULTS_DIR}/git.diff" 2>/dev/null || printf '0')"
    printf -- "- Diff Lines: %s\n" "$diff_lines" >> "$summary_file"
  fi
  
  # Add changed files count if available
  if [ -f "${KASEKI_RESULTS_DIR}/changed-files.txt" ]; then
    local changed_count
    changed_count="$(wc -l < "${KASEKI_RESULTS_DIR}/changed-files.txt" 2>/dev/null || printf '0')"
    printf -- "- Changed Files: %s\n" "$changed_count" >> "$summary_file"
  fi
  
  # Add validation status if available
  if [ -f "$failure_file" ]; then
    local validation_exit
    validation_exit="$(jq -r '.validation_exit_code // empty' "$failure_file" 2>/dev/null || true)"
    [ -n "$validation_exit" ] || validation_exit="-1"
    if [ "$validation_exit" -ge 0 ]; then
      if [ "$validation_exit" -eq 0 ]; then
        printf -- "- Validation: Passed\n" >> "$summary_file"
      else
        printf -- "- Validation: Failed (exit code %s)\n" "$validation_exit" >> "$summary_file"
      fi
    fi
  fi
}

write_validation_infrastructure_diagnostics() {
  # Generate diagnostic report when validation infrastructure failure (SIGPIPE, memory, etc.) detected
  local diagnostics_file="${KASEKI_RESULTS_DIR}/validation-infrastructure-diagnostics.md"
  local validation_exit="$VALIDATION_EXIT"
  
  # Only generate if infrastructure failure (SIGPIPE exit code 141)
  [ "$validation_exit" -ne 141 ] && return 0
  
  {
    printf '# Validation Infrastructure Failure Diagnostics\n\n'
    printf '**Instance**: %s\n\n' "$INSTANCE_NAME"
    printf '## Summary\n\n'
    printf 'The validation pipeline encountered an infrastructure failure (exit code 141 — SIGPIPE).\n'
    printf 'This indicates the validation-output-filter process crashed or exited unexpectedly while processing command output.\n\n'
    
    printf '## Likely Causes\n\n'
    printf '1. **Large validation output** — The npm test/build command produced 100k+ lines of output\n'
    printf '2. **Memory pressure** — The filter process ran out of heap memory (RPi 4 has 4GB total)\n'
    printf '3. **Encoding issue** — Validation output contained non-UTF8 characters\n'
    printf '4. **Resource exhaustion** — Disk full, file descriptor limit, or network issue\n\n'
    
    printf '## System State Before Failure\n\n'
    if [ -f "${KASEKI_RESULTS_DIR}/validation-startup-diagnostics.log" ]; then
      printf '```\n'
      cat "${KASEKI_RESULTS_DIR}/validation-startup-diagnostics.log"
      printf '\n```\n\n'
    else
      printf '*(No startup diagnostics captured)*\n\n'
    fi
    
    printf '## Filter Process Diagnostics\n\n'
    if [ -f "${KASEKI_RESULTS_DIR}/filter-diagnostics.log" ]; then
      local filter_startup filter_close
      filter_startup="$(grep '^\\[.*\\] filter-startup:' "${KASEKI_RESULTS_DIR}/filter-diagnostics.log" | head -10)"
      filter_close="$(grep '^\\[.*\\] filter-close:' "${KASEKI_RESULTS_DIR}/filter-diagnostics.log")"
      
      printf '### Filter Startup\n\n'
      if [ -n "$filter_startup" ]; then
        printf '```\n%s\n```\n\n' "$filter_startup"
      else
        printf '*(No startup events captured)*\n\n'
      fi
      
      printf '### Filter Shutdown\n\n'
      if [ -n "$filter_close" ]; then
        printf '```\n%s\n```\n\n' "$filter_close"
      else
        printf '*(No shutdown events captured)*\n\n'
      fi
      
      # Check for specific issues
      if grep -q 'memory' "${KASEKI_RESULTS_DIR}/filter-diagnostics.log"; then
        printf '### Memory Pressure Detected\n\n'
        grep 'memory' "${KASEKI_RESULTS_DIR}/filter-diagnostics.log" | sed 's/^/- /' | head -10
        printf '\n\n'
      fi
      
      if grep -q 'backpressure' "${KASEKI_RESULTS_DIR}/filter-diagnostics.log"; then
        printf '### Backpressure Events Detected\n\n'
        printf 'The downstream pipe (tee) was unable to consume data as fast as the filter produced it.\n'
        printf 'This can cause readline buffers to accumulate and exhaust memory.\n\n'
      fi
    else
      printf '*(No filter diagnostics captured)*\n\n'
    fi
    
    printf '## Remediation Steps\n\n'
    printf '### Immediate (Try First)\n\n'
    printf '1. **Increase container memory** if possible:\n'
    printf '   ```bash\n'
    printf '   docker run --memory=4g kaseki-agent  # Allocate 4GB instead of default\n'
    printf '   ```\n\n'
    
    printf '2. **Reduce validation output verbosity** (in task-prompt or configuration):\n'
    printf '   ```bash\n'
    printf '   # Pass --silent or --quiet to npm test/build\n'
    printf '   export KASEKI_VALIDATION_COMMANDS="npm run test -- --silent"\n'
    printf '   ```\n\n'
    
    printf '3. **Split large test suites** across multiple validation commands:\n'
    printf '   ```bash\n'
    printf '   export KASEKI_VALIDATION_COMMANDS="npm run test:unit;npm run test:integration"\n'
    printf '   ```\n\n'
    
    printf '### Advanced\n\n'
    printf '1. **Enable filter idle watchdog** to catch stalled pipes early:\n'
    printf '   ```bash\n'
    printf '   export FILTER_IDLE_WATCHDOG_SECONDS=30\n'
    printf '   ```\n\n'
    
    printf '2. **Review validation command output** to identify noisy commands:\n'
    printf '   - Check `validation-raw.log` for lines that can be suppressed\n'
    printf '   - Filter patterns already exclude npm notices/progress bars\n'
    printf '   - Consider disabling verbose test reporters\n\n'
    
    printf '3. **Check system resources** during run:\n'
    printf '   ```bash\n'
    printf '   watch "free -h && df -h /tmp"\n'
    printf '   ```\n\n'
    
    printf '## References\n\n'
    printf '- **Exit Code 141**: SIGPIPE (signal 13) — Broken pipe, upstream process crashed\n'
    printf '- **Validation Log**: `validation.log` (filtered) and `validation-raw.log` (unfiltered)\n'
    printf '- **Filter Diagnostics**: `filter-diagnostics.log` (detailed process events)\n'
  } > "$diagnostics_file"
}

write_failure_json() {
  local exit_code="$1"
  local stderr_tail diagnostic_reason
  stderr_tail="$(tail -20 "${KASEKI_RESULTS_DIR}"/stderr.log 2>/dev/null || true)"
  diagnostic_reason="$(extract_failure_diagnostic_reason)"
  if [ "$exit_code" -eq 0 ]; then
    : > "${KASEKI_RESULTS_DIR}"/failure.json
    return 0
  fi
  cat > "${KASEKI_RESULTS_DIR}"/failure.json <<FAILURE
{
  "instance": $(printf '%s' "$INSTANCE_NAME" | json_encode),
  "exit_code": $exit_code,
  "failed_command": $(printf '%s' "$FAILED_COMMAND" | json_encode),
  "pre_validation_exit_code": $PRE_VALIDATION_EXIT,
  "validation_exit_code": $VALIDATION_EXIT,
  "validation_failed_command": $(printf '%s' "$VALIDATION_FAILED_COMMAND_DETAIL" | json_encode),
  "validation_failure_reason": $(printf '%s' "$VALIDATION_FAILURE_REASON" | json_encode),
  "validation_allowlist_failure_reason": $(printf '%s' "$VALIDATION_ALLOWLIST_FAILURE_REASON" | json_encode),
  "pre_validation_failed_command": $(printf '%s' "$PRE_VALIDATION_FAILED_COMMAND_DETAIL" | json_encode),
  "pre_validation_failure_reason": $(printf '%s' "$PRE_VALIDATION_FAILURE_REASON" | json_encode),
  "quality_failure_reason": $(printf '%s' "$QUALITY_FAILURE_REASON" | json_encode),
  "goal_check_failure_reason": $(printf '%s' "$GOAL_CHECK_FAILURE_REASON" | json_encode),
  "provider_error_type": $(printf '%s' "$PROVIDER_ERROR_TYPE" | json_encode),
  "provider_error_phase": $(printf '%s' "$PROVIDER_ERROR_PHASE" | json_encode),
  "provider_error_provider": $(printf '%s' "$PROVIDER_ERROR_PROVIDER" | json_encode),
  "provider_error_api": $(printf '%s' "$PROVIDER_ERROR_API" | json_encode),
  "provider_error_model": $(printf '%s' "$PROVIDER_ERROR_MODEL" | json_encode),
  "provider_error_message": $(printf '%s' "$PROVIDER_ERROR_MESSAGE" | json_encode),
  "provider_error_retryable": $(printf '%s' "$PROVIDER_ERROR_RETRYABLE" | json_encode),
  "provider_error_retry_attempt_count": $PROVIDER_ERROR_RETRY_ATTEMPT_COUNT,
  "provider_error_retry_result": $(printf '%s' "$PROVIDER_ERROR_RETRY_RESULT" | json_encode),
  "provider_error_fallback_provider": $(printf '%s' "$PROVIDER_ERROR_FALLBACK_PROVIDER" | json_encode),
  "provider_error_fallback_model": $(printf '%s' "$PROVIDER_ERROR_FALLBACK_MODEL" | json_encode),
  "provider_error_fallback_result": $(printf '%s' "$PROVIDER_ERROR_FALLBACK_RESULT" | json_encode),
  "provider_error_primary": ${PROVIDER_ERROR_PRIMARY_JSON:-null},
  "provider_error_recovery": ${PROVIDER_ERROR_RECOVERY_JSON:-null},
  "goal_check_attempts": $GOAL_CHECK_ATTEMPTS,
  "goal_check_met": $GOAL_CHECK_MET,
  "stage": $(printf '%s' "$CURRENT_STAGE" | json_encode),
  "diagnostic_reason": $(printf '%s' "$diagnostic_reason" | json_encode),
  "stderr_tail": $(printf '%s' "$stderr_tail" | json_encode),
  "artifacts_dir": "${KASEKI_RESULTS_DIR}",
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
  if [ -d "${KASEKI_WORKSPACE_DIR}"/repo/.git ]; then
    while IFS= read -r untracked_file || [ -n "$untracked_file" ]; do
      [ -z "$untracked_file" ] && continue
      git -C "${KASEKI_WORKSPACE_DIR}"/repo add -N -- "$untracked_file" 2>/dev/null || true
    done < <(git -C "${KASEKI_WORKSPACE_DIR}"/repo ls-files --others --exclude-standard 2>/dev/null || true)
    git -C "${KASEKI_WORKSPACE_DIR}"/repo diff -- . > "${KASEKI_RESULTS_DIR}"/git.diff 2>/dev/null || true
    git -C "${KASEKI_WORKSPACE_DIR}"/repo diff --name-only -- . > "${KASEKI_RESULTS_DIR}"/changed-files.txt 2>/dev/null || true
    if [ -s "${KASEKI_RESULTS_DIR}"/git.diff ]; then
      DIFF_NONEMPTY=true
    fi
  else
    : > "${KASEKI_RESULTS_DIR}"/git.diff
    : > "${KASEKI_RESULTS_DIR}"/changed-files.txt
  fi
}

run_static_test_impact_check() {
  local changed_files_file="${KASEKI_RESULTS_DIR}/changed-files.txt"
  local diff_file="${KASEKI_RESULTS_DIR}/git.diff"
  local artifact="${TEST_IMPACT_WARNINGS_ARTIFACT:-${KASEKI_RESULTS_DIR}/test-impact-warnings.log}"
  local indicator_regex='(parse|parser|regex|regexp|stage|event|format|serialize|name)'
  local production_matches diff_matches warning_detail

  : > "$artifact"
  if [ ! -s "$changed_files_file" ] || [ ! -s "$diff_file" ]; then
    return 0
  fi

  if grep -Eq '(^tests/|(^|/)[^/]+[.](test|spec)[.][^/]+$)' "$changed_files_file" 2>/dev/null; then
    return 0
  fi

  production_matches="$(grep -Ei "$indicator_regex" "$changed_files_file" 2>/dev/null | grep -Ev '(^tests/|(^|/)[^/]+[.](test|spec)[.][^/]+$)' || true)"
  diff_matches="$(grep -Ein '^[+-]' "$diff_file" 2>/dev/null | grep -Ei "(parse|parser|regex|regexp|stage|event|format|serialize|name)" | head -20 || true)"

  if [ -z "$production_matches" ] && [ -z "$diff_matches" ]; then
    return 0
  fi

  warning_detail="Production parser/output/naming-adjacent changes were detected without changed test files; review test impact and add focused tests when appropriate."
  {
    printf 'Static test-impact warning (%s)\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '\n%s\n' "$warning_detail"
    printf '\nWhy this was flagged:\n'
    printf -- '- No changed files matched tests/**, *.test.*, or *.spec.*.\n'
    printf -- '- At least one changed production path or diff hunk matched one of: parse, parser, regex, RegExp, stage, event, format, serialize, name.\n'
    if [ -n "$production_matches" ]; then
      printf '\nChanged production files with indicators:\n'
      printf '%s\n' "$production_matches" | sed 's/^/- /'
    fi
    if [ -n "$diff_matches" ]; then
      printf '\nDiff hunks with indicators (first 20 matching +/- lines):\n'
      printf '%s\n' "$diff_matches" | sed 's/^/- /'
    fi
    printf '\nAction: If these changes affect parsing, output formatting, event/stage serialization, or naming behavior, add or update a focused test before relying on validation alone. If existing tests already cover the behavior, note that explicitly in goal-check evidence.\n'
  } >> "$artifact"

  emit_event "warning" \
    "warning_type=test_impact_without_tests" \
    "artifact=$artifact" \
    "detail=$warning_detail"
  return 0
}


derive_critical_change_expectations() {
  local output_file="${CRITICAL_CHANGE_EXPECTATIONS_ARTIFACT:-${KASEKI_RESULTS_DIR}/critical-change-expectations.json}"
  node - "$GOAL_SETTING_ARTIFACT" "$SCOUTING_ARTIFACT" "$output_file" "$KASEKI_ALLOW_EMPTY_DIFF" <<'NODE' 2>> "${KASEKI_RESULTS_DIR}/critical-change-expectations.log" || {
const fs = require('node:fs');
const path = require('node:path');
const [goalPath, scoutingPath, outputPath, allowEmptyDiff] = process.argv.slice(2);
function readJson(file) {
  if (!file) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function strings(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
}
function normalizeBool(value) {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
  }
  return undefined;
}
function isPlaceholderString(value) {
  if (typeof value !== 'string') return false;
  return [
    /\brepo-relative files that must be changed to satisfy the goal; use only when certain\b/i,
    /\bliteral strings or diff hunk markers that must appear in git\.diff; use only when certain\b/i,
    /\bglob patterns for files the coding agent should modify\b/i,
    /\bglob patterns for files validation commands may touch\b/i,
    /\bbrief task interpretation\b/i,
    /\bimportant requirements and constraints\b/i,
  ].some((pattern) => pattern.test(value));
}
function removePlaceholders(values) {
  return values.filter((value) => !isPlaceholderString(value));
}
function firstContract(...artifacts) {
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== 'object') continue;
    for (const key of ['critical_change_expectations', 'criticalChangeExpectations']) {
      const contract = artifact[key];
      if (contract && typeof contract === 'object' && !Array.isArray(contract)) return contract;
    }
  }
  return {};
}
const goal = readJson(goalPath);
const scouting = readJson(scoutingPath);
const explicit = firstContract(scouting, goal);
const requiredFiles = removePlaceholders([...new Set(strings(explicit.required_files || explicit.requiredFiles))]);
const requiredSearchStrings = removePlaceholders([...new Set(strings(explicit.required_search_strings || explicit.requiredSearchStrings || explicit.required_diff_markers || explicit.requiredDiffMarkers))]);
const explicitForbidden = normalizeBool(explicit.forbidden_empty_diff ?? explicit.forbiddenEmptyDiff);
const forbiddenEmptyDiff = explicitForbidden === undefined ? allowEmptyDiff !== '1' : explicitForbidden;
const scoutingFallback = Boolean(scouting && typeof scouting === 'object' && (scouting.fallback === true || scouting.fallback_reason));
const artifact = {
  version: 1,
  source_artifacts: {
    goal_setting: goal && fs.existsSync(goalPath) ? path.basename(goalPath) : null,
    scouting: scouting && fs.existsSync(scoutingPath) ? path.basename(scoutingPath) : null,
    ...(scoutingFallback ? { scouting_fallback: true } : {}),
  },
  ...(scoutingFallback ? { fallback_reason: String(scouting.fallback_reason || 'scouting_fallback') } : {}),
  required_files: requiredFiles,
  required_search_strings: requiredSearchStrings,
  forbidden_empty_diff: forbiddenEmptyDiff,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(artifact, null, 2) + '\n');
NODE
    printf '{"version":1,"source_artifacts":{"goal_setting":null,"scouting":null},"required_files":[],"required_search_strings":[],"forbidden_empty_diff":%s}\n' "$([ "$KASEKI_ALLOW_EMPTY_DIFF" = "1" ] && printf false || printf true)" > "$output_file"
  }
}

verify_critical_change_expectations() {
  local expectation_file="${CRITICAL_CHANGE_EXPECTATIONS_ARTIFACT:-${KASEKI_RESULTS_DIR}/critical-change-expectations.json}"
  local changed_files_file="${KASEKI_RESULTS_DIR}/changed-files.txt"
  local diff_file="${KASEKI_RESULTS_DIR}/git.diff"
  local report_file="${KASEKI_RESULTS_DIR}/critical-change-verification.log"

  : > "$report_file"
  if [ ! -s "$expectation_file" ]; then
    printf '[critical-change] skipped: expectation artifact missing or empty: %s\n' "$expectation_file" >> "$report_file"
    return 0
  fi

  node - "$expectation_file" "$changed_files_file" "$diff_file" "$report_file" <<'NODE'
const fs = require('node:fs');
const [expectationPath, changedFilesPath, diffPath, reportPath] = process.argv.slice(2);
function read(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}
function loadJson(file) {
  try { return JSON.parse(read(file)); } catch (error) { return { __invalid: String(error && error.message || error) }; }
}
function asStrings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : [];
}
function asBoolean(value) {
  if (value === true || value === false) return value;
  if (typeof value === 'string') return ['true', '1', 'yes'].includes(value.trim().toLowerCase());
  return false;
}
const expectations = loadJson(expectationPath);
const failures = [];
const notes = [];
if (expectations.__invalid) {
  failures.push(`expectation artifact is not valid JSON: ${expectations.__invalid}`);
} else {
  const changedFiles = new Set(read(changedFilesPath).split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const diff = read(diffPath);
  if (asBoolean(expectations.forbidden_empty_diff) && diff.trim().length === 0) {
    failures.push('git.diff is empty but forbidden_empty_diff is true');
  }
  for (const file of asStrings(expectations.required_files)) {
    if (!changedFiles.has(file)) failures.push(`required file missing from changed-files.txt: ${file}`);
  }
  for (const needle of asStrings(expectations.required_search_strings)) {
    if (!diff.includes(needle)) failures.push(`required search string missing from git.diff: ${needle}`);
  }
  notes.push(`required_files=${asStrings(expectations.required_files).length}`);
  notes.push(`required_search_strings=${asStrings(expectations.required_search_strings).length}`);
  notes.push(`forbidden_empty_diff=${asBoolean(expectations.forbidden_empty_diff)}`);
}
const lines = [];
lines.push(`[critical-change] artifact=${expectationPath}`);
for (const note of notes) lines.push(`[critical-change] ${note}`);
if (failures.length) {
  lines.push('[critical-change] verification failed:');
  for (const failure of failures) lines.push(`- ${failure}`);
  fs.writeFileSync(reportPath, lines.join('\n') + '\n');
  process.stdout.write(failures.join('\n'));
  process.exit(1);
}
lines.push('[critical-change] verification passed');
fs.writeFileSync(reportPath, lines.join('\n') + '\n');
NODE
}

critical_change_expectations_from_scouting_fallback() {
  local expectation_file="${CRITICAL_CHANGE_EXPECTATIONS_ARTIFACT:-${KASEKI_RESULTS_DIR}/critical-change-expectations.json}"
  [ -s "$expectation_file" ] || return 1
  node - "$expectation_file" <<'NODE' 2>/dev/null
const fs = require('node:fs');
try {
  const expectations = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const sources = expectations && typeof expectations === 'object' ? expectations.source_artifacts : null;
  if ((sources && sources.scouting_fallback === true) || Boolean(expectations && expectations.fallback_reason)) {
    process.exit(0);
  }
} catch {}
process.exit(1);
NODE
}

format_fallback_empty_diff_critical_change_failure() {
  local phase_label="$1"
  local failure_summary="$2"
  printf '%s' "${phase_label} critical-change verification failed: scouting did not produce a candidate artifact, so Kaseki used conservative patch fallback expectations; the coding agent still produced no git diff. Inspect the original TASK_PROMPT and make the smallest required repository change, or run in inspect mode / allow empty diff if no code change is expected. Failures: ${failure_summary}"
}

format_fallback_empty_diff_repair_prompt() {
  local phase_label="$1"
  local failure_summary="$2"
  cat <<EOF
${phase_label} critical-change verification failed because the previous coding attempt produced an empty git diff after scouting fell back to the original task prompt.

This is a patch-mode run, so a no-op is not acceptable. Re-read the task below, inspect the repository, and make the smallest useful repository change that satisfies it. If the request is documentation-only or formatting-only, edit the most relevant documentation or formatting target directly. Do not finish until git diff is non-empty.

Original task prompt:
${TASK_PROMPT}

Verification failure:
${failure_summary}
EOF
}


run_expectation_mismatch_detector() {
  local detector_script
  detector_script="$SCRIPT_DIR/scripts/detect-expectation-mismatches.js"
  if [ ! -f "$detector_script" ] && [ -f /app/scripts/detect-expectation-mismatches.js ]; then
    detector_script="/app/scripts/detect-expectation-mismatches.js"
  fi

  : > "$EXPECTATION_MISMATCH_WARNINGS_ARTIFACT"
  if [ ! -s "${KASEKI_RESULTS_DIR}"/git.diff ]; then
    emit_event "expectation_mismatch_skipped" "reason=empty_diff"
    return 0
  fi
  if [ ! -f "$detector_script" ]; then
    printf '[expectation-mismatch] skipped: detector script not found (%s)\n' "$detector_script" >/dev/null
    return 0
  fi

  if ! node "$detector_script" \
    --repo "${KASEKI_WORKSPACE_DIR}"/repo \
    --diff "${KASEKI_RESULTS_DIR}"/git.diff \
    --output "$EXPECTATION_MISMATCH_WARNINGS_ARTIFACT" \
    --progress /dev/null; then
    printf '[expectation-mismatch] warning: detector failed; continuing to validation\n' >/dev/null
  fi
}

resolve_allowlist_helper() {
  local script_dir="$1"
  local script_relative_helper="$script_dir/scripts/allowlist-helper.sh"
  local fallback_helper="${KASEKI_ALLOWLIST_HELPER_FALLBACK:-/app/scripts/allowlist-helper.sh}"

  if [ -r "$script_relative_helper" ]; then
    printf '%s\n' "$script_relative_helper"
    return 0
  fi

  if [ -r "$fallback_helper" ]; then
    printf '%s\n' "$fallback_helper"
    return 0
  fi

  printf 'ERROR: Allowlist helper is not readable. Expected packaged helper at %s or fallback helper at %s. This worker image or mounted template is incomplete; rebuild the image or restore scripts/allowlist-helper.sh.\n' \
    "$script_relative_helper" \
    "$fallback_helper" >&2
  return 66
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ALLOWLIST_HELPER="$(resolve_allowlist_helper "$SCRIPT_DIR")"
allowlist_helper_status=$?
if [ "$allowlist_helper_status" -ne 0 ]; then
  exit "$allowlist_helper_status"
fi
SCOUTING_ALLOWLIST_HELPER="$SCRIPT_DIR/scripts/scouting-allowlist.js"
if [ ! -r "$SCOUTING_ALLOWLIST_HELPER" ] && [ -r "$SCRIPT_DIR/dist/scouting-allowlist.js" ]; then
  SCOUTING_ALLOWLIST_HELPER="$SCRIPT_DIR/dist/scouting-allowlist.js"
fi
if [ ! -r "$SCOUTING_ALLOWLIST_HELPER" ] && [ -r /app/dist/scouting-allowlist.js ]; then
  SCOUTING_ALLOWLIST_HELPER="/app/dist/scouting-allowlist.js"
fi
if [ ! -r "$SCOUTING_ALLOWLIST_HELPER" ] && [ -r /usr/local/bin/scripts/scouting-allowlist.js ]; then
  SCOUTING_ALLOWLIST_HELPER="/usr/local/bin/scripts/scouting-allowlist.js"
fi

ARTIFACT_RECOVERY_HELPER="$SCRIPT_DIR/dist/artifact-recovery.js"
if [ ! -r "$ARTIFACT_RECOVERY_HELPER" ] && [ -r /app/dist/artifact-recovery.js ]; then
  ARTIFACT_RECOVERY_HELPER="/app/dist/artifact-recovery.js"
fi
if [ ! -r "$ARTIFACT_RECOVERY_HELPER" ] && [ -r "$SCRIPT_DIR/scripts/artifact-recovery.ts" ]; then
  ARTIFACT_RECOVERY_HELPER="$SCRIPT_DIR/scripts/artifact-recovery.ts"
fi

run_artifact_recovery_helper() {
  local phase="$1"
  local raw_events_path="$2"
  local candidate_path="$3"
  local results_dir="${4:-}"

  if [ ! -r "$ARTIFACT_RECOVERY_HELPER" ]; then
    return 1
  fi

  case "$ARTIFACT_RECOVERY_HELPER" in
    *.ts) npx tsx "$ARTIFACT_RECOVERY_HELPER" "$phase" "$raw_events_path" "$candidate_path" "$results_dir" ;;
    *) node "$ARTIFACT_RECOVERY_HELPER" "$phase" "$raw_events_path" "$candidate_path" "$results_dir" ;;
  esac
}
if [ ! -r "$SCOUTING_ALLOWLIST_HELPER" ]; then
  printf 'error: scouting allowlist helper is missing; checked repository dist and packaged runtime paths\n' >&2
  exit 87
fi
# shellcheck source=scripts/allowlist-helper.sh
. "$ALLOWLIST_HELPER" || {
  printf 'ERROR: Failed to source %s (exit code: %d)\n' "$ALLOWLIST_HELPER" $? >&2
  exit 1
}

# Verify the helper was sourced successfully by checking for the required function
if ! declare -f build_allowlist_regex >/dev/null 2>&1; then
  printf 'ERROR: build_allowlist_regex function not found after sourcing %s\n' "$ALLOWLIST_HELPER" >&2
  exit 1
fi

if [ "${KASEKI_AGENT_HELPER_RESOLUTION_CHECK:-0}" = "1" ]; then
  build_allowlist_regex "${KASEKI_CHANGED_FILES_ALLOWLIST:-}" >/dev/null 2>&1 || {
    printf 'ERROR: build_allowlist_regex exited with status %d\n' $? >&2
    exit 1
  }
  printf 'allowlist_helper=%s\n' "$ALLOWLIST_HELPER"
  exit 0
fi

derive_allowlist_from_scouting() {
  local scouting_artifact
  scouting_artifact="${1:?missing scouting artifact path}"

  if [ ! -f "$scouting_artifact" ]; then
    printf 'derive_allowlist_from_scouting: scouting artifact not found: %s\n' "$scouting_artifact" >&2
    return 1
  fi

  node "$SCOUTING_ALLOWLIST_HELPER" derive "$scouting_artifact"
}


validate_allowlist_patterns() {
  local patterns_str test_regex
  patterns_str="${1:-}"

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
  scouting_patterns="${1:-}"
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
  
  if [ ! -f "$scouting_artifact" ] || [ ! -f "${KASEKI_RESULTS_DIR}"/changed-files.txt ]; then
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
    agent_coverage="$(dry-run-allowlist.sh --result-dir "${KASEKI_RESULTS_DIR}" --allowlist "$agent_patterns" 2>/dev/null | grep -oP '(?<=Coverage: )\d+(?=%)' | head -n 1 || true)"
    [ -z "$agent_coverage" ] && agent_coverage="0"
    
    # Check for problematic coverage
    if [ "$agent_coverage" -lt 30 ]; then
      agent_warnings="patterns too narrow"
    elif [ "$agent_coverage" -gt 98 ]; then
      agent_warnings="patterns too broad"
    fi
  fi
  
  if [ -n "$validation_patterns" ] && command -v dry-run-allowlist.sh >/dev/null 2>&1; then
    validation_coverage="$(dry-run-allowlist.sh --result-dir "${KASEKI_RESULTS_DIR}" --allowlist "$validation_patterns" 2>/dev/null | grep -oP '(?<=Coverage: )\d+(?=%)' | head -n 1 || true)"
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
    } >> "${KASEKI_RESULTS_DIR}"/scouting-report.md
  fi
}

restore_disallowed_changes() {
  if [ "$KASEKI_RESTORE_DISALLOWED_CHANGES" != "1" ] || [ ! -d "${KASEKI_WORKSPACE_DIR}"/repo/.git ]; then
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
  : > "${KASEKI_RESULTS_DIR}"/restoration.jsonl

  while IFS= read -r changed_file || [ -n "$changed_file" ]; do
    [ -z "$changed_file" ] && continue
    if printf '%s\n' "$changed_file" | grep -Eq "^(${allowlist_regex})$"; then
      # File matched allowlist - keep it
      kept_count=$((kept_count + 1))
      {
        printf '{"timestamp":"%s","event":"file_evaluated","file":"%s","status":"kept","reason":"matched_allowlist"}\n' \
          "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(printf '%s' "$changed_file" | sed 's/"/\\"/g')"
      } >> "${KASEKI_RESULTS_DIR}"/restoration.jsonl
      continue
    fi
    # File did not match allowlist - restore it
    restored_count=$((restored_count + 1))
    emit_event "quality_gate_rule_evaluated" "rule=allowlist_restore" "passed=true" "file=$changed_file"
    # Phase 2C: Emit quality event to JSON
    append_quality_violation "${KASEKI_RESULTS_DIR}"/quality-gates.json "file_outside_allowlist_restored" "File $changed_file was outside allowlist but was restored" "info"
    {
      printf '{"timestamp":"%s","event":"file_restored","file":"%s","status":"restored","reason":"not_in_allowlist"}\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(printf '%s' "$changed_file" | sed 's/"/\\"/g')"
    } >> "${KASEKI_RESULTS_DIR}"/restoration.jsonl
    git -C "${KASEKI_WORKSPACE_DIR}"/repo restore --staged --worktree -- "$changed_file" 2>/dev/null || true
    git -C "${KASEKI_WORKSPACE_DIR}"/repo clean -f -- "$changed_file" 2>/dev/null || true
    restored_any=1
  done < "${KASEKI_RESULTS_DIR}"/changed-files.txt

  # Emit restoration summary to quality.log with actionable guidance
  if [ $((restored_count + kept_count)) -gt 0 ]; then
    coverage=$((kept_count * 100 / (restored_count + kept_count)))
  fi
  if [ "$restored_count" -gt 0 ] || [ "$kept_count" -gt 0 ]; then
    emit_event "allowlist_restoration_complete" "restored=$restored_count" "kept=$kept_count" "coverage=$coverage"
    printf '[allowlist summary] Restored: %s files; Kept: %s files (coverage: %s%%)\n' \
      "$restored_count" "$kept_count" "$coverage" >> "${KASEKI_RESULTS_DIR}"/quality.log
  fi

  if [ "$restored_any" -eq 1 ]; then
    collect_git_artifacts
  fi
}

check_validation_allowlist() {
  if [ -z "$KASEKI_VALIDATION_ALLOWLIST" ]; then
    return 0
  fi
  if [ ! -d "${KASEKI_WORKSPACE_DIR}"/repo/.git ]; then
    return 0
  fi

  local allowlist_regex validation_violation_count validation_changed_file changed_file
  local validation_before_state_file validation_after_state_file
  allowlist_regex="$(build_allowlist_regex "$KASEKI_VALIDATION_ALLOWLIST")"
  [ -z "$allowlist_regex" ] && return 0
  validation_violation_count=0
  validation_before_state_file="${KASEKI_RESULTS_DIR}/validation-before-state.txt"
  validation_after_state_file="${KASEKI_RESULTS_DIR}/validation-after-state.txt"
  validation_changed_file="${KASEKI_RESULTS_DIR}/validation-changed-files.txt"
  : > "$validation_changed_file"

  if [ -f "$validation_before_state_file" ] && [ -f "$validation_after_state_file" ]; then
    awk -F '\t' '
      NR == FNR { before[$1] = $2; seen[$1] = 1; next }
      { after[$1] = $2; seen[$1] = 1 }
      END {
        for (path in seen) {
          if (before[path] != after[path]) {
            print path
          }
        }
      }
    ' "$validation_before_state_file" "$validation_after_state_file" | LC_ALL=C sort -u > "$validation_changed_file"
  elif [ -f "${KASEKI_RESULTS_DIR}"/changed-files.txt ]; then
    cp "${KASEKI_RESULTS_DIR}"/changed-files.txt "$validation_changed_file"
  fi

  while IFS= read -r changed_file || [ -n "$changed_file" ]; do
    [ -z "$changed_file" ] && continue
    if ! printf '%s\n' "$changed_file" | grep -Eq "^(${allowlist_regex})$"; then
      emit_event "quality_gate_violation" "rule=validation_allowlist" "file=$changed_file"
      validation_violation_count=$((validation_violation_count + 1))
      emit_event "quality_gate_rule_evaluated" "rule=validation_allowlist" "passed=false" "file=$changed_file"
      # Phase 2C: Emit quality violation to JSON
      append_quality_violation "${KASEKI_RESULTS_DIR}"/quality-gates.json "validation_phase_file_outside_allowlist" "File $changed_file changed during validation outside KASEKI_VALIDATION_ALLOWLIST" "error"
      # Phase 2C: Emit quality violation to JSON
      append_quality_violation "${KASEKI_RESULTS_DIR}"/quality-gates.json "validation_phase_file_outside_allowlist" "File $changed_file changed during validation outside KASEKI_VALIDATION_ALLOWLIST" "error"
    else
      emit_event "quality_gate_rule_evaluated" "rule=validation_allowlist" "passed=true" "file=$changed_file"
    fi
  done < "$validation_changed_file"

  if [ "$validation_violation_count" -gt 0 ]; then
    QUALITY_EXIT=7
    VALIDATION_ALLOWLIST_FAILURE_REASON="validation_allowlist_check: $validation_violation_count file(s) changed during validation outside KASEKI_VALIDATION_ALLOWLIST"
    QUALITY_FAILURE_REASON="$VALIDATION_ALLOWLIST_FAILURE_REASON"
    emit_event "validation_allowlist_check_failed" "files_outside_allowlist=$validation_violation_count"
    return 1
  fi
  return 0
}

check_secret_scan_allowlist() {
  local allowlist_file="${KASEKI_WORKSPACE_DIR}/repo/.kaseki-secret-allowlist"
  
  # If no allowlist file exists, all matches are failures (real leaks)
  if [ ! -f "$allowlist_file" ]; then
    return 0  # Proceed with normal failure handling
  fi
  
  # Read the secret-scan.log and check each match against the allowlist
  local secret_matches=() unallowlisted_count=0 allowlisted_count=0
  local match_line allowlisted_matches=()
  
  # Read the log into a temp variable to avoid SC2094 (read-write in same pipeline)
  local temp_log
  temp_log=$(cat "${KASEKI_RESULTS_DIR}"/secret-scan.log)
  
  # Initialize secret-scan.json array
  init_json_array "${KASEKI_RESULTS_DIR}"/secret-scan.json
  
  while IFS= read -r match_line || [ -n "$match_line" ]; do
    [ -z "$match_line" ] && continue
    
    # Extract file path and the actual matched pattern from grep output
    # Format: /path/to/file:line_num:match_text
    local file_path pattern
    file_path=$(printf '%s\n' "$match_line" | cut -d: -f1)
    # Extract any credential-like pattern (sk-or-* or sk-test-*)
    pattern=$(printf '%s\n' "$match_line" | sed 's/^[^:]*:[^:]*://' | grep -oE 'sk-or-[A-Za-z0-9_-]{20,}|sk-test-[A-Za-z0-9_-]*' | head -n1)
    
    [ -z "$pattern" ] && continue
    
    # Normalize file path: remove leading "${KASEKI_WORKSPACE_DIR}"/repo/, repo/, and ./ if present
    file_path="${file_path#"${KASEKI_WORKSPACE_DIR}"/repo/}"
    file_path="${file_path#repo/}"
    file_path="${file_path#./}"
    
    # Check if this file:pattern combination is in the allowlist
    if grep -q "^${file_path}:${pattern}$" "$allowlist_file" 2>/dev/null; then
      printf '[secret-scan] ALLOWLISTED: %s\n' "$match_line"
      allowlisted_count=$((allowlisted_count + 1))
      allowlisted_matches+=("$match_line")
      emit_event "secret_scan_result" "status=allowlisted" "file=$file_path" "pattern=$pattern"
      # Write to JSON
      append_secret_scan_result "${KASEKI_RESULTS_DIR}"/secret-scan.json "$file_path" "$pattern" "allowlisted"
    else
      secret_matches+=("$match_line")
      unallowlisted_count=$((unallowlisted_count + 1))
      emit_event "secret_scan_result" "status=real_leak" "file=$file_path" "pattern=$pattern"
      # Write to JSON
      append_secret_scan_result "${KASEKI_RESULTS_DIR}"/secret-scan.json "$file_path" "$pattern" "real_leak"
    fi
  done <<< "$temp_log"
  
  # Exit code 6 only if there are unallowlisted matches
  if [ "$unallowlisted_count" -gt 0 ]; then
    return 1
  fi
  return 0
}


run_pi_event_filter_export() {
  local raw_events_file="$1"
  local events_file="$2"
  local summary_file="$3"
  local filter_exit=0
  local pi_stderr_log="${KASEKI_RESULTS_DIR}/pi-stderr.log"

  if [ ! -r "$raw_events_file" ]; then
    printf 'ERROR: raw Pi events file is not readable: %s\n' "$raw_events_file" | tee -a "$pi_stderr_log" >&2
    emit_error_event "pi_event_filter_failed" "raw Pi events file is not readable" "continue"
    if [ "$STATUS" -eq 0 ]; then
      STATUS=66
      FAILED_COMMAND="kaseki-pi-event-filter"
    fi
    return 66
  fi

  : >> "$pi_stderr_log"
  chmod 600 "$pi_stderr_log" 2>/dev/null || true

  set +e
  kaseki-pi-event-filter "$raw_events_file" "$events_file" "$summary_file" \
    2> >(tee -a "$pi_stderr_log" >&2)
  filter_exit=$?
  set +e

  if [ "$filter_exit" -eq 0 ]; then
    # Phase 3A: Consolidate pi-agent summary to all-phase-summaries.json
    append_phase_summary "${KASEKI_RESULTS_DIR}"/all-phase-summaries.json "pi-agent" "$summary_file"
    return 0
  fi

  printf 'pi-event-filter failed with exit %s; raw events preserved as fallback artifact\n' "$filter_exit" | tee -a "${KASEKI_RESULTS_DIR}"/quality.log
  printf 'ERROR: kaseki-pi-event-filter failed with exit %s while exporting Pi events\n' "$filter_exit" | tee -a "$pi_stderr_log" >&2
  emit_error_event "pi_event_filter_failed" "kaseki-pi-event-filter exited with code $filter_exit" "continue"
  if [ "$STATUS" -eq 0 ]; then
    STATUS="$filter_exit"
    FAILED_COMMAND="kaseki-pi-event-filter"
  fi
  cp "$raw_events_file" "${KASEKI_RESULTS_DIR}"/pi-events.raw.jsonl 2>/dev/null || true
  return "$filter_exit"
}

detect_empty_successful_agent_turn() {
  local events_file="$1"
  local diagnostics_file="$2"
  local phase="${3:-coding}"

  [ -s "$events_file" ] || return 1

  node - "$events_file" "$diagnostics_file" "$phase" <<'NODE' 2>/dev/null
const fs = require('node:fs');
const [eventsPath, diagnosticsPath, phase] = process.argv.slice(2);
const lines = fs.readFileSync(eventsPath, 'utf8').split(/\r?\n/).filter(Boolean);
let assistantTextChars = 0;
let assistantMessages = 0;
let toolCalls = 0;
let responseId = '';
let stopReason = '';

function textLengthFromContent(content) {
  if (typeof content === 'string') return content.trim().length;
  if (!Array.isArray(content)) return 0;
  let total = 0;
  for (const item of content) {
    if (typeof item === 'string') total += item.trim().length;
    else if (item && typeof item === 'object' && typeof item.text === 'string') total += item.text.trim().length;
  }
  return total;
}

for (const line of lines) {
  let event;
  try { event = JSON.parse(line); } catch { continue; }
  if (!event || typeof event !== 'object') continue;
  if (event.type === 'tool_call' || event.type === 'tool_start' || event.type === 'function_call') toolCalls += 1;
  const toolResults = event.toolResults || event.message?.toolResults;
  if (Array.isArray(toolResults) && toolResults.length > 0) toolCalls += toolResults.length;
  const message = event.message;
  if (message && typeof message === 'object' && message.role === 'assistant') {
    assistantMessages += 1;
    assistantTextChars += textLengthFromContent(message.content);
    if (!responseId && typeof event.responseId === 'string') responseId = event.responseId;
    if (!responseId && typeof message.responseId === 'string') responseId = message.responseId;
    if (!stopReason && typeof event.stopReason === 'string') stopReason = event.stopReason;
    if (!stopReason && typeof message.stopReason === 'string') stopReason = message.stopReason;
  }
}

if (assistantMessages > 0 && assistantTextChars === 0 && toolCalls === 0) {
  const diagnostic = {
    timestamp: new Date().toISOString(),
    reason_code: 'provider_empty_assistant_turn',
    phase,
    assistant_messages: assistantMessages,
    assistant_text_chars: assistantTextChars,
    tool_calls: toolCalls,
    response_id: responseId,
    stop_reason: stopReason,
    severity: 'critical',
    suggestion: 'Retry the agent once with explicit guidance; if it repeats, treat the provider response as an infrastructure failure instead of a completed coding attempt.',
  };
  fs.appendFileSync(diagnosticsPath, JSON.stringify(diagnostic) + '\n');
  process.exit(0);
}
process.exit(1);
NODE
}

run_pi_json_capture() {
  local raw_events_file="$1"
  local timeout_seconds="$2"
  local model="$3"
  local prompt="$4"
  local stderr_target="${5:-}"
  local pi_exit progress_exit progress_stderr progress_fifo progress_pid splitter_exit
  local -a pipeline_statuses

  wait_for_progress_stream() {
    local pid="$1"
    local waited=0
    local max_wait=50
    while kill -0 "$pid" 2>/dev/null; do
      if [ "$waited" -ge "$max_wait" ]; then
        kill "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
        return 124
      fi
      sleep 0.1
      waited=$((waited + 1))
    done
    wait "$pid"
  }

  rm -f "$raw_events_file" 2>/dev/null || true
  : > "$raw_events_file"
  progress_stderr="${KASEKI_RESULTS_DIR}/progress-stream-diagnostics.log"
  progress_fifo="${KASEKI_RESULTS_DIR}/pi-progress-stream.$$.$RANDOM.fifo"
  rm -f "$progress_fifo" 2>/dev/null || true

  if ! mkfifo "$progress_fifo" 2>>"$progress_stderr"; then
    printf '%s [kaseki-agent] failed to create progress fifo; falling back to post-run progress processing\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$progress_stderr" 2>/dev/null || true
  fi

  set +e
  if [ -p "$progress_fifo" ]; then
    KASEKI_STREAM_PROGRESS=0 kaseki-pi-progress-stream "${KASEKI_RESULTS_DIR}"/progress.jsonl /dev/null \
      < "$progress_fifo" \
      2>>"$progress_stderr" &
    progress_pid=$!

    if [ -n "$stderr_target" ]; then
      OPENROUTER_API_KEY="${openrouter_api_key:-${OPENROUTER_API_KEY:-}}" \
        LLM_GATEWAY_API_KEY="$llm_gateway_api_key" \
        LLM_GATEWAY_URL="$llm_gateway_url" \
        timeout --signal=SIGTERM "$timeout_seconds" \
        pi --mode json --no-session --provider "$KASEKI_PROVIDER" --model "$model" "$prompt" \
        2> >(tee -a "$stderr_target" >&2) \
        | node -e '
const fs = require("fs");
const [rawPath, fifoPath] = process.argv.slice(1);
const raw = fs.openSync(rawPath, "a");
let fifo;
try {
  fifo = fs.openSync(fifoPath, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
} catch {
  fifo = undefined;
}
function writeProgressChunk(chunk) {
  if (fifo === undefined) return;
  try {
    fs.writeSync(fifo, chunk);
  } catch (error) {
    if (error && (error.code === "EPIPE" || error.code === "ENXIO")) {
      try { fs.closeSync(fifo); } catch {}
      fifo = undefined;
    } else if (!(error && error.code === "EAGAIN")) {
      throw error;
    }
  }
}
process.stdin.on("data", (chunk) => {
  fs.writeSync(raw, chunk);
  writeProgressChunk(chunk);
});
process.stdin.on("end", () => {
  if (fifo !== undefined) fs.closeSync(fifo);
  fs.closeSync(raw);
});
' "$raw_events_file" "$progress_fifo"
    else
      OPENROUTER_API_KEY="${openrouter_api_key:-${OPENROUTER_API_KEY:-}}" \
        LLM_GATEWAY_API_KEY="$llm_gateway_api_key" \
        LLM_GATEWAY_URL="$llm_gateway_url" \
        timeout --signal=SIGTERM "$timeout_seconds" \
        pi --mode json --no-session --provider "$KASEKI_PROVIDER" --model "$model" "$prompt" \
        | node -e '
const fs = require("fs");
const [rawPath, fifoPath] = process.argv.slice(1);
const raw = fs.openSync(rawPath, "a");
let fifo;
try {
  fifo = fs.openSync(fifoPath, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
} catch {
  fifo = undefined;
}
function writeProgressChunk(chunk) {
  if (fifo === undefined) return;
  try {
    fs.writeSync(fifo, chunk);
  } catch (error) {
    if (error && (error.code === "EPIPE" || error.code === "ENXIO")) {
      try { fs.closeSync(fifo); } catch {}
      fifo = undefined;
    } else if (!(error && error.code === "EAGAIN")) {
      throw error;
    }
  }
}
process.stdin.on("data", (chunk) => {
  fs.writeSync(raw, chunk);
  writeProgressChunk(chunk);
});
process.stdin.on("end", () => {
  if (fifo !== undefined) fs.closeSync(fifo);
  fs.closeSync(raw);
});
' "$raw_events_file" "$progress_fifo"
    fi
    pipeline_statuses=("${PIPESTATUS[@]}")
    pi_exit="${pipeline_statuses[0]:-1}"
    splitter_exit="${pipeline_statuses[1]:-0}"
    wait_for_progress_stream "$progress_pid"
    progress_exit=$?
    rm -f "$progress_fifo" 2>/dev/null || true

    if [ "$splitter_exit" -ne 0 ]; then
      printf '%s [kaseki-agent] raw event splitter failed pi_exit=%s splitter_exit=%s raw_events=%s\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$pi_exit" "$splitter_exit" "$raw_events_file" >> "$progress_stderr" 2>/dev/null || true
      if [ "$pi_exit" -eq 0 ]; then
        pi_exit="$splitter_exit"
      fi
    fi
  else
    if [ -n "$stderr_target" ]; then
      OPENROUTER_API_KEY="${openrouter_api_key:-${OPENROUTER_API_KEY:-}}" \
        LLM_GATEWAY_API_KEY="$llm_gateway_api_key" \
        LLM_GATEWAY_URL="$llm_gateway_url" \
        timeout --signal=SIGTERM "$timeout_seconds" \
        pi --mode json --no-session --provider "$KASEKI_PROVIDER" --model "$model" "$prompt" \
        > "$raw_events_file" \
        2> >(tee -a "$stderr_target" >&2)
    else
      OPENROUTER_API_KEY="${openrouter_api_key:-${OPENROUTER_API_KEY:-}}" \
        LLM_GATEWAY_API_KEY="$llm_gateway_api_key" \
        LLM_GATEWAY_URL="$llm_gateway_url" \
        timeout --signal=SIGTERM "$timeout_seconds" \
        pi --mode json --no-session --provider "$KASEKI_PROVIDER" --model "$model" "$prompt" \
        > "$raw_events_file"
    fi
    pi_exit=$?

    KASEKI_STREAM_PROGRESS=0 kaseki-pi-progress-stream "${KASEKI_RESULTS_DIR}"/progress.jsonl /dev/null \
      < "$raw_events_file" \
      2>>"$progress_stderr"
    progress_exit=$?
  fi

  if [ "$progress_exit" -ne 0 ]; then
    printf '%s [kaseki-agent] progress stream failed pi_exit=%s progress_exit=%s raw_events=%s\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$pi_exit" "$progress_exit" "$raw_events_file" >> "$progress_stderr" 2>/dev/null || true
    emit_error_event "pi_progress_stream_failed" "Progress stream failed while processing Pi output: $progress_exit" "continue"
  fi
  set +e

  return "$pi_exit"
}

if [ "${KASEKI_PI_EVENT_FILTER_HELPER_TEST:-0}" = "1" ]; then
  mkdir -p "$KASEKI_RESULTS_DIR"
  RAW_EVENTS="${KASEKI_TEST_RAW_EVENTS:-$RAW_EVENTS}"
  : > "${KASEKI_RESULTS_DIR}/progress.jsonl"
  : > "${KASEKI_RESULTS_DIR}/quality.log"
  : > "${KASEKI_RESULTS_DIR}/pi-stderr.log"
  run_pi_event_filter_export "$RAW_EVENTS" "${KASEKI_RESULTS_DIR}/pi-events.jsonl" "${KASEKI_RESULTS_DIR}/pi-summary.json"
  helper_exit=$?
  write_metadata "$STATUS"
  exit "$helper_exit"
fi

finish() {
  local code=$?
  maybe_call_finish_helper() {
    local helper="$1"
    shift
    if declare -F "$helper" >/dev/null; then
      "$helper" "$@"
      return $?
    fi
    printf '[finish] helper_missing name=%s status=%s stage=%s\n' "$helper" "$STATUS" "$CURRENT_STAGE" >&2
    if declare -F emit_event >/dev/null; then
      emit_event "finish_helper_missing" "helper=$helper" "status=$STATUS" "stage=$CURRENT_STAGE"
    fi
    return 0
  }
  if [ "$code" -ne 0 ] && [ "$STATUS" -eq 0 ]; then
    # Capture diagnostic context for the catch-all error
    STATUS="$code"
    FAILED_COMMAND="unexpected shell failure"
    # Log the last command that was executed
    {
      printf '[unexpected-failure] Exit code: %d\n' "$code"
      printf '[unexpected-failure] Last command: %s\n' "$LAST_COMMAND"
      printf '[unexpected-failure] Current stage: %s\n' "$CURRENT_STAGE"
      if [ -f "${KASEKI_RESULTS_DIR}"/progress.jsonl ]; then
        printf '[unexpected-failure] Last 5 progress events:\n'
        tail -5 "${KASEKI_RESULTS_DIR}"/progress.jsonl | sed 's/^/  /'
      fi
    } | tee -a "$LAST_COMMAND_LOG" >&2
    emit_error_event "unexpected_shell_failure" "Uncaught shell error (exit $code) in stage '$CURRENT_STAGE'. Last command: $LAST_COMMAND. See $LAST_COMMAND_LOG for context." "exit"
  fi
  # Authoritative call site: this runs at EXIT so artifacts reflect final repo state.
  maybe_call_finish_helper collect_git_artifacts
  
  # Analyze test failures and compare baseline vs. working results
  if [ "$KASEKI_BASELINE_VALIDATION_ENABLED" = "1" ] && [ -f "${KASEKI_RESULTS_DIR}"/validation-baseline.log ]; then
    set_current_stage "test failure analysis"
    if analyze_test_failures_baseline; then
      TEST_FAILURE_CLASSIFICATION_STATUS="completed"
      # Try to extract newly_introduced_failures_count from JSON output (if jq available)
      if [ -f "${KASEKI_RESULTS_DIR}"/test-baseline-comparison.json ] && command -v jq >/dev/null 2>&1; then
        NEWLY_INTRODUCED_FAILURES_COUNT=$(jq -r '.summary.total_newly_introduced // 0' "${KASEKI_RESULTS_DIR}"/test-baseline-comparison.json 2>/dev/null || printf '0')
      elif [ -f "${KASEKI_RESULTS_DIR}"/test-baseline-comparison.json ]; then
        # Fallback: try to extract with grep/sed if jq not available
        NEWLY_INTRODUCED_FAILURES_COUNT=$(grep -o '"total_newly_introduced": [0-9]*' "${KASEKI_RESULTS_DIR}"/test-baseline-comparison.json 2>/dev/null | grep -o '[0-9]*$' || printf '0')
      fi
    else
      TEST_FAILURE_CLASSIFICATION_STATUS="failed"
    fi
  else
    if [ "$KASEKI_BASELINE_VALIDATION_ENABLED" != "1" ]; then
      TEST_FAILURE_CLASSIFICATION_STATUS="disabled"
    else
      TEST_FAILURE_CLASSIFICATION_STATUS="skipped"
    fi
  fi
  
  if [ "${KASEKI_DEBUG_RAW_EVENTS:-0}" = "1" ]; then
    if [ -f "${KASEKI_RESULTS_DIR}"/restoration.jsonl ]; then
      printf '[debug] restoration.jsonl exists (size=%d bytes)\n' "$(wc -c < "${KASEKI_RESULTS_DIR}"/restoration.jsonl)" >&2
    else
      printf '[debug] restoration.jsonl does not exist\n' >&2
    fi
  fi
  
  # restoration-report.md artifact removed (Phase 1: low-value artifacts deletion)

  # Calculate and record maturity score without leaking artifact JSON into live logs.
  if [ -x /app/scripts/kaseki-maturity-score.sh ]; then
    maturity_score_log="${KASEKI_RESULTS_DIR}/maturity-score.log"
    if [ -d "${KASEKI_WORKSPACE_DIR}"/repo ]; then
      if KASEKI_MATURITY_SCORE_STDOUT=0 /app/scripts/kaseki-maturity-score.sh "${KASEKI_WORKSPACE_DIR}"/repo "${KASEKI_RESULTS_DIR}"/maturity-score.json >"$maturity_score_log" 2>&1; then
        printf 'maturity-score: wrote %s\n' "${KASEKI_RESULTS_DIR}/maturity-score.json" >"$maturity_score_log"
      else
        printf 'maturity-score: generation failed; see prior output if any\n' >>"$maturity_score_log"
      fi
    else
      printf 'maturity-score: skipped because repo checkout is missing: %s\n' "${KASEKI_WORKSPACE_DIR}/repo" >"$maturity_score_log"
    fi
  fi
  
  # Calculate and record performance metrics
  if [ -x /app/scripts/kaseki-performance-metrics.sh ] && [ -f "${KASEKI_RESULTS_DIR}"/stage-timings.tsv ]; then
    /app/scripts/kaseki-performance-metrics.sh "${KASEKI_RESULTS_DIR}"/stage-timings.tsv "${KASEKI_RESULTS_DIR}"/performance-metrics.json 2>/dev/null || true
  fi
  
  maybe_call_finish_helper write_result_summary
  # Phase 3: Generate infrastructure diagnostics report if validation had SIGPIPE failure
  maybe_call_finish_helper write_validation_infrastructure_diagnostics
  
  # Generate inspect-report.md for inspect mode on success
  if [ "$KASEKI_TASK_MODE" = "inspect" ] && [ "$STATUS" -eq 0 ]; then
    if [ -x /app/scripts/generate-inspect-report.js ]; then
      node /app/scripts/generate-inspect-report.js "${KASEKI_RESULTS_DIR}" 2>/dev/null || true
    fi
  fi
  
  # Phase 3B, 3C, 3D: Consolidate artifacts before finalizing
  consolidate_timings_to_json "${KASEKI_RESULTS_DIR}"/timings-manifest.json "${VALIDATION_TIMINGS_FILE}" "${PRE_VALIDATION_TIMINGS_FILE}"
  consolidate_phase_errors "${KASEKI_RESULTS_DIR}"/phase-errors.jsonl "${KASEKI_RESULTS_DIR}"/critical-change-expectations.log "${KASEKI_RESULTS_DIR}"/summarizer-stderr.log "${KASEKI_RESULTS_DIR}"/baseline-npm-ci.log
  consolidate_validation_errors "${KASEKI_RESULTS_DIR}"/artifact-validation-errors.jsonl "${KASEKI_RESULTS_DIR}"/scouting-validation-errors.jsonl "${KASEKI_RESULTS_DIR}"/goal-setting-validation-errors.jsonl "${KASEKI_RESULTS_DIR}"/goal-check-validation-errors.jsonl
  
  maybe_call_finish_helper write_failure_json "$STATUS"
  maybe_call_finish_helper write_repo_memory_summary
  maybe_call_finish_helper write_metadata "$STATUS"
  maybe_call_finish_helper remove_low_value_artifacts
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
  printf '%s\n' "$@" >> "${KASEKI_RESULTS_DIR}"/validation.log
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
  rm -rf "${KASEKI_WORKSPACE_DIR}"/repo
  GIT_CLONE_STRATEGY="direct_shallow"
  git clone --depth 1 --branch "$GIT_REF" "$REPO_URL" "${KASEKI_WORKSPACE_DIR}"/repo
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

  rm -rf "${KASEKI_WORKSPACE_DIR}"/repo
  GIT_CLONE_STRATEGY="reference_shallow"
  git clone --reference-if-able "$mirror" --depth 1 --branch "$GIT_REF" "$REPO_URL" "${KASEKI_WORKSPACE_DIR}"/repo
  clone_rc=$?
  if [ "$clone_rc" -eq 0 ]; then
    return 0
  fi

  rm -rf "${KASEKI_WORKSPACE_DIR}"/repo
  GIT_CLONE_STRATEGY="mirror_local"
  emit_error_event "git_cache_reference_clone_failed" "Reference clone failed for key=$GIT_CACHE_KEY exit=$clone_rc; trying local mirror clone" "try_mirror_clone"
  git clone --branch "$GIT_REF" "$mirror" "${KASEKI_WORKSPACE_DIR}"/repo
  clone_rc=$?
  if [ "$clone_rc" -eq 0 ] && git -C "${KASEKI_WORKSPACE_DIR}"/repo rev-parse --verify HEAD >/dev/null 2>&1; then
    git -C "${KASEKI_WORKSPACE_DIR}"/repo remote set-url origin "$REPO_URL" >/dev/null 2>&1 || true
    return 0
  fi

  rm -rf "${KASEKI_WORKSPACE_DIR}"/repo
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
    # Report to Sentry if available
    sentry_error "Git clone failed with exit code $code (strategy=$GIT_CLONE_STRATEGY)" "git-clone" "$code" "$GIT_CLONE_DURATION_SECONDS" 2>/dev/null || true
  fi
  return "$code"
}


same_filesystem() {
  local left="$1"
  local right="$2"
  local left_device right_device
  left_device="$(stat -c %d "$left" 2>/dev/null || stat -f %d "$left" 2>/dev/null || true)"
  right_device="$(stat -c %d "$right" 2>/dev/null || stat -f %d "$right" 2>/dev/null || true)"
  [ -n "$left_device" ] && [ "$left_device" = "$right_device" ]
}

resolve_dependency_restore_mode() {
  local source_dir="$1"
  local target_dir="$2"
  local mode="${3:-auto}"
  if [ "$mode" != "auto" ]; then
    printf '%s\n' "$mode"
    return 0
  fi
  if same_filesystem "$source_dir" "$(dirname "$target_dir")"; then
    printf 'hardlink\n'
  else
    printf 'copy\n'
  fi
}

restore_node_modules_from_cache() {
  local source_dir="$1"
  local target_dir="$2"
  local mode="${3:-copy}"
  mode="$(resolve_dependency_restore_mode "$source_dir" "$target_dir" "$mode")"
  DEPENDENCY_RESTORE_METHOD="$mode"
  case "$mode" in
    copy)
      cp -a "$source_dir" "$target_dir"
      ;;
    hardlink)
      if same_filesystem "$source_dir" "$(dirname "$target_dir")"; then
        local hardlink_stderr_file hardlink_reason hardlink_stderr_trimmed
        hardlink_stderr_file="$(mktemp /tmp/kaseki-hardlink-stderr.XXXXXX)" || return 1
        if cp -al "$source_dir" "$target_dir" 2>"$hardlink_stderr_file"; then
          rm -f "$hardlink_stderr_file"
          DEPENDENCY_RESTORE_METHOD="hardlink"
          return 0
        fi
        if grep -q "Invalid cross-device link\|EXDEV" "$hardlink_stderr_file"; then
          hardlink_reason="hardlink_cross_device"
        else
          hardlink_reason="hardlink_failed"
        fi
        DEPENDENCY_RESTORE_METHOD="hardlink_fallback_copy"
        printf 'Dependency cache status: hardlink restore fallback to copy (reason=%s).\n' "$hardlink_reason" | tee -a "$DEPENDENCY_CACHE_LOG"
        emit_event "dependency_cache_decision" "strategy=hardlink_restore_fallback" "restore_mode=hardlink" "restore_method=hardlink_fallback_copy" "reason=$hardlink_reason"
        if [ "$hardlink_reason" != "hardlink_cross_device" ]; then
          hardlink_stderr_trimmed="$(tr '\n' ' ' < "$hardlink_stderr_file" | sed 's/[[:space:]]\+/ /g' | sed 's/^ //; s/ $//' | cut -c1-300)"
          if [ -n "$hardlink_stderr_trimmed" ]; then
            printf 'Dependency cache debug: hardlink restore stderr=%s\n' "$hardlink_stderr_trimmed" >&2
          fi
        fi
        rm -f "$hardlink_stderr_file"
        cp -a "$source_dir" "$target_dir"
      else
        DEPENDENCY_RESTORE_METHOD="hardlink_cross_fs_copy"
        printf 'Dependency cache status: hardlink restore skipped because cache and workspace are on different filesystems; falling back to copy.\n' | tee -a "$DEPENDENCY_CACHE_LOG"
        emit_event "dependency_cache_decision" "strategy=hardlink_restore_fallback" "restore_mode=hardlink" "restore_method=hardlink_cross_fs_copy" "reason=hardlink_cross_fs"
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
      printf 'Unsupported KASEKI_DEPENDENCY_RESTORE_MODE: %s (expected auto, copy, hardlink, or symlink)\n' "$mode" >&2
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

dependency_cache_entry_roots() {
  local cache_dir="$1"
  find "$cache_dir" -mindepth 4 -maxdepth 4 -type d -name 'flags-*' 2>/dev/null || true
}

dependency_cache_size_bytes() {
  local cache_dir="$1"
  # Sum per-entry metadata instead of recursively scanning the entire shared
  # cache on every worker run. Older entries without metadata are accounted
  # for when they are next published.
  dependency_cache_entry_roots "$cache_dir" | while IFS= read -r entry; do
    [ -r "$entry/.entry-size-bytes" ] && cat "$entry/.entry-size-bytes"
  done | awk '{ total += $1 } END { printf "%.0f\n", total + 0 }'
}

record_dependency_cache_entry_size() {
  local entry_root="$1"
  local source_dir="$2"
  local size_kb
  size_kb="$(du -sk "$source_dir" 2>/dev/null | awk '{print $1}')"
  [ -n "$size_kb" ] || return 0
  printf '%s\n' $((size_kb * 1024)) > "$entry_root/.entry-size-bytes"
}

invalidate_workspace_dependency_cache() {
  local cache_dir="$1"
  local stamp_file="$2"
  local metadata_file="$3"
  rm -rf "$cache_dir"
  rm -f "$stamp_file" "$metadata_file"
}

write_dependency_cache_metrics() {
  local cache_dir="$1"
  local metrics_file="$2"
  local size_bytes entry_count now
  mkdir -p "$(dirname "$metrics_file")" 2>/dev/null || return 0
  size_bytes="$(dependency_cache_size_bytes "$cache_dir")"
  entry_count="$(dependency_cache_entry_roots "$cache_dir" | wc -l | tr -d ' ')"
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  {
    printf 'timestamp=%s\n' "$now"
    printf 'cache_dir=%s\n' "$cache_dir"
    printf 'size_bytes=%s\n' "$size_bytes"
    printf 'entry_count=%s\n' "$entry_count"
    printf 'max_bytes=%s\n' "$KASEKI_DEPENDENCY_CACHE_MAX_BYTES"
    printf 'max_age_days=%s\n' "$KASEKI_DEPENDENCY_CACHE_MAX_AGE_DAYS"
  } > "$metrics_file" 2>/dev/null || true
}

prune_dependency_cache() {
  local cache_dir="$1"
  local max_bytes="$2"
  local max_age_days="$3"
  local metrics_file="$4"
  local size_bytes oldest_entry

  [ "$KASEKI_DEPENDENCY_CACHE_PRUNE" = "1" ] || return 0
  [ -d "$cache_dir" ] || return 0

  if [ "$max_age_days" -gt 0 ] 2>/dev/null; then
    dependency_cache_entry_roots "$cache_dir" | while IFS= read -r entry; do
      if [ -n "$entry" ] && [ "$(find "$entry" -maxdepth 0 -mtime +"$max_age_days" -print 2>/dev/null)" = "$entry" ]; then
        printf 'Dependency cache prune: removing aged entry %s\n' "$entry" | tee -a "$DEPENDENCY_CACHE_LOG"
        rm -rf "$entry"
      fi
    done
  fi

  if [ "$max_bytes" -gt 0 ] 2>/dev/null; then
    # Entries created before per-entry accounting cannot be included without a
    # blocking recursive scan. Remove them once so future enforcement remains
    # fast and exact.
    dependency_cache_entry_roots "$cache_dir" | while IFS= read -r entry; do
      [ -n "$entry" ] || continue
      if [ ! -r "$entry/.entry-size-bytes" ]; then
        printf 'Dependency cache prune: removing unmetered legacy entry %s\n' "$entry" | tee -a "$DEPENDENCY_CACHE_LOG"
        rm -rf "$entry"
      fi
    done
    size_bytes="$(dependency_cache_size_bytes "$cache_dir")"
    while [ "$size_bytes" -gt "$max_bytes" ]; do
      oldest_entry="$(dependency_cache_entry_roots "$cache_dir" | while IFS= read -r entry; do
        [ -n "$entry" ] || continue
        printf '%s\t%s\n' "$(stat -c %Y "$entry" 2>/dev/null || stat -f %m "$entry" 2>/dev/null || printf '0')" "$entry"
      done | sort -n | awk 'NR==1 {print $2}')"
      [ -n "$oldest_entry" ] || break
      printf 'Dependency cache prune: removing oldest entry %s (size=%s max=%s)\n' "$oldest_entry" "$size_bytes" "$max_bytes" | tee -a "$DEPENDENCY_CACHE_LOG"
      rm -rf "$oldest_entry"
      size_bytes="$(dependency_cache_size_bytes "$cache_dir")"
    done
  fi

  write_dependency_cache_metrics "$cache_dir" "$metrics_file"
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

append_default_validation_command() {
  local current="$1"
  local next_command="$2"
  if [ -z "$current" ]; then
    printf '%s' "$next_command"
  else
    printf '%s;%s' "$current" "$next_command"
  fi
}

construct_default_validation_commands() {
  local commands=""

  if package_json_has_npm_script "build"; then
    commands="$(append_default_validation_command "$commands" "npm run build")"
  elif package_json_has_npm_script "type-check"; then
    commands="$(append_default_validation_command "$commands" "npm run type-check")"
  elif has_typescript_project; then
    commands="$(append_default_validation_command "$commands" "tsc --noEmit")"
  elif package_json_has_npm_script "check"; then
    commands="$(append_default_validation_command "$commands" "npm run check")"
  fi

  if package_json_has_npm_script "test"; then
    commands="$(append_default_validation_command "$commands" "npm run test")"
  fi

  if [ -n "$commands" ]; then
    printf '%s' "$commands"
    return 0
  fi

  # Keep validation non-empty even when the repository does not define common
  # scripts. The validation runner will report each missing npm script clearly.
  printf '%s' "npm run build;npm run type-check;npm run test"
}

apply_default_validation_commands() {
  local detected_commands

  if [ -n "${KASEKI_VALIDATION_COMMANDS_EXPLICIT:-}" ]; then
    return 0
  fi

  detected_commands="$(construct_default_validation_commands)"
  KASEKI_VALIDATION_COMMANDS="$detected_commands"
  if [ -z "${KASEKI_PRE_AGENT_VALIDATION_COMMANDS_EXPLICIT:-}" ]; then
    KASEKI_PRE_AGENT_VALIDATION_COMMANDS="$detected_commands"
  fi
}

record_skipped_npm_script_command() {
  local command="$1"
  local script_name="$2"
  local duration_seconds="$3"
  local log_file="${4:-${KASEKI_RESULTS_DIR}/validation.log}"
  local timings_file="${5:-$VALIDATION_TIMINGS_FILE}"
  local skip_label="${6:-skipped}"
  local classification="${7:-}"
  {
    printf '\n==> %s\n' "$command"
    printf '%s: package.json does not define npm script "%s"\n' "$skip_label" "$script_name"
    if [ -n "$classification" ]; then
      printf 'classification=%s\n' "$classification"
    fi
  } 2>&1 | tee -a "$log_file"
  if [ -n "$classification" ]; then
    printf '%s\tskipped\t%s\tmissing_npm_script=%s\tclassification=%s\n' "$command" "$duration_seconds" "$script_name" "$classification" >> "$timings_file"
  else
    printf '%s\tskipped\t%s\tmissing_npm_script=%s\n' "$command" "$duration_seconds" "$script_name" >> "$timings_file"
  fi
}


classify_auto_lint_cleanup_command_exit() {
  local command_exit="$1"
  local missing_script="${2:-}"
  if [ -n "$missing_script" ]; then
    printf 'missing_cleanup_command'
  elif [ "$command_exit" -eq 127 ]; then
    printf 'command_not_found'
  elif [ "$command_exit" -eq 0 ]; then
    printf 'passed'
  else
    printf 'lint_fix_error'
  fi
}

record_skipped_validation_command() {
  record_skipped_npm_script_command "$1" "$2" "$3" "${4:-${KASEKI_RESULTS_DIR}/validation.log}" "${5:-$VALIDATION_TIMINGS_FILE}" "skipped"
  # Phase 2C: Emit skipped validation result to JSON
  append_validation_result "${KASEKI_RESULTS_DIR}"/validation-results.json "$1" "127" "$3" "skipped"
}

capture_validation_startup_diagnostics() {
  # Phase 2: Capture system state before validation filter starts
  # This helps diagnose SIGPIPE failures on memory-constrained systems (RPi 4 with 4GB)
  local diagnostics_file="${1:-$VALIDATION_STARTUP_DIAGNOSTICS_LOG}"
  
  {
    printf '[validation-startup] timestamp=%s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    printf '[validation-startup] pid=%s\n' "$$"
    
    # Memory state
    if command -v free &>/dev/null; then
      printf '[validation-startup] memory_state=%s\n' "$(free -h | head -2 | tail -1)"
    fi
    
    # Disk state
    if command -v df &>/dev/null; then
      printf '[validation-startup] disk_results=%s\n' "$(df -h "${KASEKI_RESULTS_DIR}" 2>/dev/null | tail -1)"
    fi
    
    # File descriptor count (indicator of resource exhaustion)
    if [ -d "/proc/self/fd" ]; then
      printf '[validation-startup] open_file_descriptors=%d\n' "$(find /proc/self/fd -maxdepth 1 2>/dev/null | wc -l)"
    fi
    
    # Process memory usage
    if [ -f "/proc/self/status" ]; then
      printf '[validation-startup] process_vm_rss=%s\n' "$(grep '^VmRSS' /proc/self/status | awk '{print $2 " " $3}' || echo 'unknown')"
    fi
  } | tee -a "$diagnostics_file"
}

has_typescript_project() {
  # Auto-detect TypeScript presence in the project
  # Checks for:
  # 1. tsconfig.json file (explicit TypeScript config)
  # 2. typescript dependency (regular, dev, or optional)
  # Exit code: 0 if TypeScript detected, 1 otherwise
  
  # Check for tsconfig.json
  [ -f tsconfig.json ] && return 0
  
  # Check for typescript in package.json (dev, regular, or optional dependencies)
  [ -f package.json ] || return 1
  node - <<'NODE'
try {
  const pkg = require('./package.json');
  const isDep = pkg.dependencies?.typescript || 
                pkg.devDependencies?.typescript ||
                pkg.optionalDependencies?.typescript;
  process.exit(isDep ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

has_npm_build_command() {
  # Check if the configured npm script exists in package.json
  # Returns 0 if script exists, 1 otherwise
  local command="$1"
  local script_name
  
  script_name="$(npm_run_script_name "$command")" || return 1
  package_json_has_npm_script "$script_name" && return 0
  return 1
}

run_typescript_precheck() {
  # TypeScript compilation pre-check: runs before agent invocation to catch export/compile errors early
  # Now with intelligent auto-detection:
  # - Skips if no TypeScript detected in project
  # - Skips if configured command (npm script) doesn't exist
  # - Only fails if TypeScript is present AND the check genuinely fails
  # Exit code: 0 = passed/skipped, non-zero = failed
  # Returns silently; exit code stored in TS_PRE_CHECK_EXIT global
  
  TS_PRE_CHECK_EXIT=0
  TS_PRE_CHECK_DURATION_SECONDS=0
  TS_PRE_CHECK_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  
  if [ "$KASEKI_TS_PRE_CHECK" != "1" ]; then
    emit_progress "typescript precheck" "skipped (KASEKI_TS_PRE_CHECK=0)"
    record_stage_timing "typescript precheck" 0 0 "skipped_by_config"
    return 0
  fi
  
  # Auto-detect: skip if no TypeScript project detected
  if ! has_typescript_project; then
    emit_progress "typescript precheck" "skipped (no TypeScript detected)"
    record_stage_timing "typescript precheck" 0 0 "skipped_no_typescript"
    return 0
  fi
  
  # Auto-detect: skip if configured npm script doesn't exist
  if ! has_npm_build_command "$KASEKI_TS_CHECK_COMMAND"; then
    local missing_script
    missing_script="$(npm_run_script_name "$KASEKI_TS_CHECK_COMMAND")" || missing_script="$KASEKI_TS_CHECK_COMMAND"
    printf '\n==> TypeScript pre-check\n' | tee -a "${KASEKI_RESULTS_DIR}"/pre-validation-ts-check.log
    printf 'Command: %s\n' "$KASEKI_TS_CHECK_COMMAND" | tee -a "${KASEKI_RESULTS_DIR}"/pre-validation-ts-check.log
    printf 'skipped: npm script "%s" not found in package.json\n' "$missing_script" | tee -a "${KASEKI_RESULTS_DIR}"/pre-validation-ts-check.log
    emit_error_event "typescript_precheck_skipped_missing_script" "TypeScript check skipped: npm script '$missing_script' not defined" "continue"
    emit_progress "typescript precheck" "skipped (npm script '$missing_script' not found)"
    record_stage_timing "typescript precheck" 0 0 "skipped_missing_script"
    return 0
  fi
  
  # TypeScript detected and script exists - run the check
  set +e
  local ts_check_start ts_check_end ts_check_duration ts_check_exit
  ts_check_start="$(date +%s)"
  
  {
    printf '\n==> TypeScript pre-check\n'
    printf 'Command: %s\n' "$KASEKI_TS_CHECK_COMMAND"
    (
      cd "${KASEKI_WORKSPACE_DIR}"/repo || exit 1
      bash -lc "$KASEKI_TS_CHECK_COMMAND"
    ) 2>&1
  } 2>&1 | tee -a "${KASEKI_RESULTS_DIR}"/pre-validation-ts-check.log
  ts_check_exit="${PIPESTATUS[0]}"
  
  ts_check_end="$(date +%s)"
  ts_check_duration=$((ts_check_end - ts_check_start))
  TS_PRE_CHECK_EXIT=$ts_check_exit
  TS_PRE_CHECK_DURATION_SECONDS=$ts_check_duration
  
  if [ "$ts_check_exit" -eq 0 ]; then
    emit_progress "typescript precheck" "passed ($ts_check_duration seconds)"
    record_stage_timing "typescript precheck" 0 "$ts_check_duration" "success"
  else
    emit_error_event "typescript_precheck_failed" "TypeScript compilation failed: $KASEKI_TS_CHECK_COMMAND" "continue"
    emit_progress "typescript precheck" "failed (exit $ts_check_exit, $ts_check_duration seconds)"
    record_stage_timing "typescript precheck" "$ts_check_exit" "$ts_check_duration" "failed"
  fi
  
  set -e
  return "$ts_check_exit"
}

append_validation_failure_tail() {
  local raw_log="$1"
  local visible_log="$2"
  local quality_log="${3:-${KASEKI_RESULTS_DIR}/quality.log}"

  if ! [ -s "$raw_log" ]; then
    return 0
  fi

  {
    printf '\n[DIAGNOSTICS] Raw validation output tail (last 80 lines):\n'
    tail -80 "$raw_log" 2>/dev/null || printf '<failed to read raw validation log>\n'
  } | tee -a "$visible_log" "$quality_log" >/dev/null
}

auto_lint_cleanup_enabled_for_mode() {
  [ "$KASEKI_AUTO_LINT_CLEANUP" = "1" ] || return 1
  [ "$KASEKI_DRY_RUN" != "1" ] || return 1
  if [ "$KASEKI_TASK_MODE" = "inspect" ] && [ -z "$KASEKI_AUTO_LINT_CLEANUP_EXPLICIT" ]; then
    return 1
  fi
  return 0
}

skip_auto_lint_cleanup_before_core_change_verified() {
  local reason="${1:-core_change_absent}"
  local detail="${2:-}"

  AUTO_LINT_CLEANUP_EXIT=0
  AUTO_LINT_CLEANUP_COMMANDS_ATTEMPTED=0
  AUTO_LINT_CLEANUP_COMMANDS_SKIPPED=0
  AUTO_LINT_CLEANUP_RESULT="skipped"
  AUTO_LINT_CLEANUP_CLASSIFICATION="skipped_before_core_change_verified"
  AUTO_LINT_CLEANUP_FAILURE_CLASSIFICATION=""

  if [ -n "$detail" ]; then
    printf 'Auto lint cleanup skipped_before_core_change_verified: reason=%s detail=%s\n' "$reason" "$detail" >> "$AUTO_LINT_CLEANUP_LOG"
  else
    printf 'Auto lint cleanup skipped_before_core_change_verified: reason=%s\n' "$reason" >> "$AUTO_LINT_CLEANUP_LOG"
  fi
  record_stage_timing "auto lint cleanup" 0 0 "skipped_before_core_change_verified reason=$reason"
  emit_event "auto_lint_cleanup_finished" \
    "exit_code=0" \
    "result=$AUTO_LINT_CLEANUP_RESULT" \
    "classification=$AUTO_LINT_CLEANUP_CLASSIFICATION" \
    "reason=$reason" \
    "attempted_commands=0" \
    "skipped_commands=0"
  emit_progress "auto lint cleanup" "skipped_before_core_change_verified"
  return 0
}

run_auto_lint_cleanup_after_core_change_verified() {
  if [ "$KASEKI_TASK_MODE" = "patch" ] && [ ! -s "${KASEKI_RESULTS_DIR}/git.diff" ]; then
    skip_auto_lint_cleanup_before_core_change_verified "patch_diff_empty" "collect_git_artifacts produced no patch diff before cleanup"
    return $?
  fi

  run_auto_lint_cleanup
}

run_trailing_whitespace_cleanup_for_changed_tracked_text_files() {
  local helper_script app_root
  # Use KASEKI_APP_ROOT if set (container context), otherwise try to resolve from script location
  app_root="${KASEKI_APP_ROOT:-}"
  if [ -z "$app_root" ]; then
    # Fallback: try relative to script location (for host execution)
    app_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ "$app_root" = "/usr/local/bin" ] || [ "$app_root" = "/usr/bin" ]; then
      # Script is in a bin directory; prefer /app/scripts if it exists
      app_root="/app"
    fi
  fi
  helper_script="$app_root/scripts/cleanup-trailing-whitespace.sh"
  
  if [ -r "$helper_script" ]; then
    # shellcheck source=scripts/cleanup-trailing-whitespace.sh
    . "$helper_script"
    cleanup_trailing_whitespace_for_changed_files
    return $?
  fi

  printf 'ERROR: trailing whitespace cleanup helper is missing: %s (KASEKI_APP_ROOT=%s)\n' "$helper_script" "${KASEKI_APP_ROOT:-<unset>}"
  return 1
}

collect_changed_file_set() {
  local output_file="$1"
  : > "$output_file"
  if [ ! -d "${KASEKI_WORKSPACE_DIR}"/repo/.git ]; then
    return 0
  fi

  {
    git -C "${KASEKI_WORKSPACE_DIR}"/repo diff --name-only -- . 2>/dev/null || true
    git -C "${KASEKI_WORKSPACE_DIR}"/repo diff --name-only --cached -- . 2>/dev/null || true
    git -C "${KASEKI_WORKSPACE_DIR}"/repo ls-files --others --exclude-standard 2>/dev/null || true
  } | sed '/^$/d' | LC_ALL=C sort -u > "$output_file"
}

collect_changed_file_state() {
  local output_file="$1"
  local changed_files_file path staged_hash unstaged_hash content_hash state
  : > "$output_file"
  if [ ! -d "${KASEKI_WORKSPACE_DIR}"/repo/.git ]; then
    return 0
  fi

  changed_files_file="$(mktemp)"
  collect_changed_file_set "$changed_files_file"

  while IFS= read -r path || [ -n "$path" ]; do
    [ -z "$path" ] && continue
    if git -C "${KASEKI_WORKSPACE_DIR}"/repo ls-files --error-unmatch -- "$path" >/dev/null 2>&1; then
      staged_hash="$(git -C "${KASEKI_WORKSPACE_DIR}"/repo diff --binary --cached -- "$path" 2>/dev/null | sha256sum | awk '{print $1}')"
      unstaged_hash="$(git -C "${KASEKI_WORKSPACE_DIR}"/repo diff --binary -- "$path" 2>/dev/null | sha256sum | awk '{print $1}')"
      state="tracked:staged=${staged_hash}:unstaged=${unstaged_hash}"
    elif [ -f "${KASEKI_WORKSPACE_DIR}/repo/$path" ]; then
      content_hash="$(git -C "${KASEKI_WORKSPACE_DIR}"/repo hash-object --no-filters -- "$path" 2>/dev/null || sha256sum "${KASEKI_WORKSPACE_DIR}/repo/$path" 2>/dev/null | awk '{print $1}')"
      state="untracked:file=${content_hash}"
    elif [ -d "${KASEKI_WORKSPACE_DIR}/repo/$path" ]; then
      state="untracked:directory"
    else
      state="untracked:missing"
    fi
    printf '%s\t%s\n' "$path" "$state"
  done < "$changed_files_file" | LC_ALL=C sort -u > "$output_file"

  rm -f "$changed_files_file"
}

restore_cleanup_disallowed_changes() {
  local disallowed_file="$1"
  local changed_file
  [ -s "$disallowed_file" ] || return 0

  while IFS= read -r changed_file || [ -n "$changed_file" ]; do
    [ -z "$changed_file" ] && continue
    printf 'Restoring cleanup-created file outside allowlist: %s\n' "$changed_file" | tee -a "$AUTO_LINT_CLEANUP_LOG" "${KASEKI_RESULTS_DIR}"/quality.log
    emit_event "auto_lint_cleanup_file_restored" "file=$changed_file" "reason=not_in_cleanup_allowlist"
    git -C "${KASEKI_WORKSPACE_DIR}"/repo restore --staged --worktree -- "$changed_file" 2>/dev/null || true
    git -C "${KASEKI_WORKSPACE_DIR}"/repo clean -f -- "$changed_file" 2>/dev/null || true
  done < "$disallowed_file"
}

check_auto_lint_cleanup_allowlist() {
  local before_file="$1"
  local after_file="$2"
  local cleanup_created_file="${KASEKI_RESULTS_DIR}/auto-lint-cleanup-created-files.txt"
  local disallowed_file="${KASEKI_RESULTS_DIR}/auto-lint-cleanup-disallowed-files.txt"
  local post_restore_file="${KASEKI_RESULTS_DIR}/auto-lint-cleanup-post-restore-files.txt"
  local allowlist_patterns allowlist_regex changed_file disallowed_count unrestored_count

  : > "$cleanup_created_file"
  : > "$disallowed_file"
  : > "$post_restore_file"
  if [ ! -d "${KASEKI_WORKSPACE_DIR}"/repo/.git ]; then
    return 0
  fi

  comm -13 "$before_file" "$after_file" > "$cleanup_created_file" || true
  [ -s "$cleanup_created_file" ] || return 0

  allowlist_patterns="$(merge_allowlists "${KASEKI_CHANGED_FILES_ALLOWLIST:-}" "${KASEKI_VALIDATION_ALLOWLIST:-}")"
  allowlist_regex="$(build_allowlist_regex "$allowlist_patterns")"

  while IFS= read -r changed_file || [ -n "$changed_file" ]; do
    [ -z "$changed_file" ] && continue
    if [ -n "$allowlist_regex" ] && printf '%s\n' "$changed_file" | grep -Eq "^(${allowlist_regex})$"; then
      emit_event "quality_gate_rule_evaluated" "rule=auto_lint_cleanup_allowlist" "passed=true" "file=$changed_file"
    else
      printf 'Auto lint cleanup created changed file outside allowlist: %s\n' "$changed_file" | tee -a "$AUTO_LINT_CLEANUP_LOG" "${KASEKI_RESULTS_DIR}"/quality.log
      printf '%s\n' "$changed_file" >> "$disallowed_file"
      emit_event "quality_gate_rule_evaluated" "rule=auto_lint_cleanup_allowlist" "passed=false" "file=$changed_file"
      # Phase 2C: Emit quality violation to JSON
      append_quality_violation "${KASEKI_RESULTS_DIR}"/quality-gates.json "auto_lint_cleanup_file_outside_allowlist" "File $changed_file created by auto lint cleanup outside allowlist" "error"
    fi
  done < "$cleanup_created_file"

  disallowed_count="$(wc -l < "$disallowed_file" | tr -d ' ')"
  disallowed_count="${disallowed_count:-0}"
  [ "$disallowed_count" -gt 0 ] || return 0

  if [ "${KASEKI_RESTORE_DISALLOWED_CHANGES:-}" = "1" ]; then
    restore_cleanup_disallowed_changes "$disallowed_file"
    collect_changed_file_set "$post_restore_file"
    unrestored_count=0
    while IFS= read -r changed_file || [ -n "$changed_file" ]; do
      [ -z "$changed_file" ] && continue
      if grep -Fxq -- "$changed_file" "$post_restore_file"; then
        printf 'ERROR: Cleanup-created disallowed change could not be restored: %s\n' "$changed_file" | tee -a "$AUTO_LINT_CLEANUP_LOG" "${KASEKI_RESULTS_DIR}"/quality.log
        unrestored_count=$((unrestored_count + 1))
        # Phase 2C: Emit quality violation to JSON
        append_quality_violation "${KASEKI_RESULTS_DIR}"/quality-gates.json "cleanup_restoration_failure" "File $changed_file from auto lint cleanup could not be restored" "error"
      fi
    done < "$disallowed_file"
    if [ "$unrestored_count" -eq 0 ]; then
      printf 'Auto lint cleanup restored %s cleanup-created file(s) outside allowlist.\n' "$disallowed_count" | tee -a "$AUTO_LINT_CLEANUP_LOG" "${KASEKI_RESULTS_DIR}"/quality.log
      emit_event "auto_lint_cleanup_allowlist_restoration_complete" "restored=$disallowed_count" "unrestored=0"
      collect_git_artifacts
      return 0
    fi
  fi

  AUTO_LINT_CLEANUP_EXIT=7
  AUTO_LINT_CLEANUP_RESULT="failed"
  AUTO_LINT_CLEANUP_CLASSIFICATION="cleanup_allowlist_failed"
  AUTO_LINT_CLEANUP_FAILURE_CLASSIFICATION="cleanup_allowlist_failed"
  QUALITY_EXIT=7
  QUALITY_FAILURE_REASON="auto_lint_cleanup_allowlist: $disallowed_count cleanup-created file(s) outside KASEKI_CHANGED_FILES_ALLOWLIST/KASEKI_VALIDATION_ALLOWLIST"
  printf 'ERROR: %s\n' "$QUALITY_FAILURE_REASON" | tee -a "$AUTO_LINT_CLEANUP_LOG" "${KASEKI_RESULTS_DIR}"/quality.log
  emit_error_event "auto_lint_cleanup_allowlist_failed" "$QUALITY_FAILURE_REASON" "continue"
  return 1
}

run_auto_lint_cleanup() {
  local stage_label="auto lint cleanup"
  local stage_start cleanup_start cleanup_end duration command trimmed missing_npm_script
  local command_exit command_classification pipefail_was_enabled cleanup_before_file cleanup_after_file
  local -a cleanup_commands

  AUTO_LINT_CLEANUP_EXIT=0
  AUTO_LINT_CLEANUP_COMMANDS_ATTEMPTED=0
  AUTO_LINT_CLEANUP_COMMANDS_SKIPPED=0
  AUTO_LINT_CLEANUP_RESULT="passed"
  AUTO_LINT_CLEANUP_CLASSIFICATION="passed"
  AUTO_LINT_CLEANUP_FAILURE_CLASSIFICATION=""
  printf '\n==> %s\n' "$stage_label"
  set_current_stage "$stage_label"
  emit_progress "$stage_label" "started"
  emit_event "auto_lint_cleanup_started" "commands=${KASEKI_AUTO_LINT_CLEANUP_COMMANDS:-}"
  stage_start="$(date +%s)"

  if ! auto_lint_cleanup_enabled_for_mode; then
    if [ "$KASEKI_AUTO_LINT_CLEANUP" != "1" ]; then
      printf 'Auto lint cleanup skipped because KASEKI_AUTO_LINT_CLEANUP=%s.\n' "$KASEKI_AUTO_LINT_CLEANUP" | tee -a "$AUTO_LINT_CLEANUP_LOG"
      AUTO_LINT_CLEANUP_RESULT="skipped"
      AUTO_LINT_CLEANUP_CLASSIFICATION="skipped_by_config"
      record_stage_timing "$stage_label" 0 0 "skipped_by_config"
    elif [ "$KASEKI_DRY_RUN" = "1" ]; then
      printf 'Auto lint cleanup skipped in dry-run mode.\n' | tee -a "$AUTO_LINT_CLEANUP_LOG"
      AUTO_LINT_CLEANUP_RESULT="skipped"
      AUTO_LINT_CLEANUP_CLASSIFICATION="dry_run"
      record_stage_timing "$stage_label" 0 0 "dry_run=true"
    elif [ "$KASEKI_TASK_MODE" = "inspect" ]; then
      printf 'Auto lint cleanup skipped for inspect mode. Set KASEKI_AUTO_LINT_CLEANUP=1 explicitly to enable.\n' | tee -a "$AUTO_LINT_CLEANUP_LOG"
      AUTO_LINT_CLEANUP_RESULT="skipped"
      AUTO_LINT_CLEANUP_CLASSIFICATION="skipped_inspect_mode"
      record_stage_timing "$stage_label" 0 0 "skipped_inspect_mode"
    else
      printf 'Auto lint cleanup skipped.\n' | tee -a "$AUTO_LINT_CLEANUP_LOG"
      AUTO_LINT_CLEANUP_RESULT="skipped"
      AUTO_LINT_CLEANUP_CLASSIFICATION="skipped"
      record_stage_timing "$stage_label" 0 0 "skipped"
    fi
    emit_event "auto_lint_cleanup_finished" "exit_code=0" "result=$AUTO_LINT_CLEANUP_RESULT" "classification=$AUTO_LINT_CLEANUP_CLASSIFICATION"
    emit_progress "$stage_label" "skipped"
    return 0
  fi

  if [ -z "$KASEKI_AUTO_LINT_CLEANUP_COMMANDS" ] || [ "$KASEKI_AUTO_LINT_CLEANUP_COMMANDS" = "none" ]; then
    printf 'Auto lint cleanup skipped because commands=%s.\n' "${KASEKI_AUTO_LINT_CLEANUP_COMMANDS:-<empty>}" | tee -a "$AUTO_LINT_CLEANUP_LOG"
    AUTO_LINT_CLEANUP_RESULT="skipped"
    AUTO_LINT_CLEANUP_CLASSIFICATION="skipped_by_commands"
    record_stage_timing "$stage_label" 0 0 "skipped_by_commands"
    emit_event "auto_lint_cleanup_finished" "exit_code=0" "result=$AUTO_LINT_CLEANUP_RESULT" "classification=$AUTO_LINT_CLEANUP_CLASSIFICATION"
    emit_progress "$stage_label" "skipped"
    return 0
  fi

  if ! [ -d "${KASEKI_WORKSPACE_DIR}"/repo ]; then
    AUTO_LINT_CLEANUP_EXIT=1
    AUTO_LINT_CLEANUP_RESULT="failed"
    AUTO_LINT_CLEANUP_CLASSIFICATION="directory_missing"
    AUTO_LINT_CLEANUP_FAILURE_CLASSIFICATION="directory_missing"
    printf 'ERROR: Working directory "${KASEKI_WORKSPACE_DIR}"/repo does not exist before auto lint cleanup.\n' | tee -a "$AUTO_LINT_CLEANUP_LOG"
    printf 'workspace_missing\t%s\t0\tclassification=directory_missing\n' "$AUTO_LINT_CLEANUP_EXIT" >> "$AUTO_LINT_CLEANUP_TIMINGS_FILE"
    record_stage_timing "$stage_label" "$AUTO_LINT_CLEANUP_EXIT" "$(($(date +%s) - stage_start))" "directory_missing classification=directory_missing"
    emit_event "auto_lint_cleanup_finished" "exit_code=$AUTO_LINT_CLEANUP_EXIT" "result=failed" "classification=directory_missing" "reason=directory_missing"
    emit_progress "$stage_label" "finished with exit $AUTO_LINT_CLEANUP_EXIT"
    return 0
  fi

  cleanup_before_file="${KASEKI_RESULTS_DIR}/auto-lint-cleanup-before-files.txt"
  cleanup_after_file="${KASEKI_RESULTS_DIR}/auto-lint-cleanup-after-files.txt"
  collect_changed_file_set "$cleanup_before_file"

  set +e
  IFS=';' read -r -a cleanup_commands <<< "$KASEKI_AUTO_LINT_CLEANUP_COMMANDS"
  for command in "${cleanup_commands[@]}"; do
    trimmed="$(printf '%s' "$command" | sed 's/^ *//; s/ *$//')"
    [ -z "$trimmed" ] && continue
    cleanup_start="$(date +%s)"
    if [ "${KASEKI_SKIP_MISSING_NPM_SCRIPTS:-1}" = "1" ] && missing_npm_script="$(missing_npm_script_for_validation_command "$trimmed")"; then
      cleanup_end="$(date +%s)"
      duration=$((cleanup_end - cleanup_start))
      command_classification="$(classify_auto_lint_cleanup_command_exit 0 "$missing_npm_script")"
      AUTO_LINT_CLEANUP_COMMANDS_SKIPPED=$((AUTO_LINT_CLEANUP_COMMANDS_SKIPPED + 1))
      if [ "$AUTO_LINT_CLEANUP_EXIT" -eq 0 ]; then
        AUTO_LINT_CLEANUP_RESULT="warning"
        AUTO_LINT_CLEANUP_CLASSIFICATION="$command_classification"
      fi
      record_skipped_npm_script_command "$trimmed" "$missing_npm_script" "$duration" "$AUTO_LINT_CLEANUP_LOG" "$AUTO_LINT_CLEANUP_TIMINGS_FILE" "skipped cleanup" "$command_classification"
      emit_event "auto_lint_cleanup_command_skipped" "command=$trimmed" "reason=$command_classification" "script=$missing_npm_script" "classification=$command_classification" "duration_seconds=$duration"
      continue
    fi

    AUTO_LINT_CLEANUP_COMMANDS_ATTEMPTED=$((AUTO_LINT_CLEANUP_COMMANDS_ATTEMPTED + 1))
    emit_event "auto_lint_cleanup_command_started" "command=$trimmed"
    pipefail_was_enabled=0
    if set -o | grep -q '^pipefail[[:space:]]*on'; then
      pipefail_was_enabled=1
    fi
    set -o pipefail
    {
      printf '\n==> %s\n' "$trimmed"
      unset LLM_GATEWAY_API_KEY
      if [ "$trimmed" = "__kaseki_trailing_whitespace_cleanup__" ]; then
        run_trailing_whitespace_cleanup_for_changed_tracked_text_files
        command_exit=$?
      else
        bash -c "$trimmed"
        command_exit=$?
      fi
      printf 'exit_code=%s\n' "$command_exit"
      exit "$command_exit"
    } 2>&1 | tee -a "$AUTO_LINT_CLEANUP_LOG"
    command_exit="${PIPESTATUS[0]}"
    if [ "$pipefail_was_enabled" -eq 1 ]; then
      set -o pipefail
    else
      set +o pipefail
    fi
    cleanup_end="$(date +%s)"
    duration=$((cleanup_end - cleanup_start))
    command_classification="$(classify_auto_lint_cleanup_command_exit "$command_exit")"
    printf '%s\t%s\t%s\tclassification=%s\n' "$trimmed" "$command_exit" "$duration" "$command_classification" >> "$AUTO_LINT_CLEANUP_TIMINGS_FILE"
    if [ "$command_exit" -eq 127 ]; then
      printf 'classification=%s\n' "$command_classification" | tee -a "$AUTO_LINT_CLEANUP_LOG" >/dev/null
    fi
    emit_event "auto_lint_cleanup_command_finished" "command=$trimmed" "exit_code=$command_exit" "classification=$command_classification" "duration_seconds=$duration"
    if [ "$command_exit" -ne 0 ] && [ "$AUTO_LINT_CLEANUP_EXIT" -eq 0 ]; then
      AUTO_LINT_CLEANUP_EXIT="$command_exit"
      AUTO_LINT_CLEANUP_RESULT="failed"
      AUTO_LINT_CLEANUP_CLASSIFICATION="$command_classification"
      AUTO_LINT_CLEANUP_FAILURE_CLASSIFICATION="$command_classification"
      emit_error_event "auto_lint_cleanup_command_failed" "Auto lint cleanup command failed: $trimmed (exit $command_exit, classification=$command_classification)" "continue"
    fi
  done
  set +e

  collect_changed_file_set "$cleanup_after_file"
  check_auto_lint_cleanup_allowlist "$cleanup_before_file" "$cleanup_after_file" || true

  if [ "$AUTO_LINT_CLEANUP_EXIT" -eq 0 ] && [ "$AUTO_LINT_CLEANUP_COMMANDS_SKIPPED" -eq 0 ]; then
    AUTO_LINT_CLEANUP_RESULT="passed"
    AUTO_LINT_CLEANUP_CLASSIFICATION="passed"
  fi

  record_stage_timing "$stage_label" "$AUTO_LINT_CLEANUP_EXIT" "$(($(date +%s) - stage_start))" "attempted_commands=$AUTO_LINT_CLEANUP_COMMANDS_ATTEMPTED skipped_commands=$AUTO_LINT_CLEANUP_COMMANDS_SKIPPED classification=$AUTO_LINT_CLEANUP_CLASSIFICATION"
  emit_event "auto_lint_cleanup_finished" "exit_code=$AUTO_LINT_CLEANUP_EXIT" "result=$AUTO_LINT_CLEANUP_RESULT" "classification=$AUTO_LINT_CLEANUP_CLASSIFICATION" "attempted_commands=$AUTO_LINT_CLEANUP_COMMANDS_ATTEMPTED" "skipped_commands=$AUTO_LINT_CLEANUP_COMMANDS_SKIPPED"
  emit_progress "$stage_label" "finished with exit $AUTO_LINT_CLEANUP_EXIT"
  return 0
}

# === Baseline Test Failure Comparison (Pre-existing vs Newly-Introduced) ===

baseline_validation_cache_key() {
  # Cache key: repo_url + main_branch_ref + validation commands
  # This ensures different validation command sets get different cache entries
  printf '%s\n%s\n%s' "$REPO_URL" "main" "$KASEKI_PRE_AGENT_VALIDATION_COMMANDS" | sha256sum | awk '{print $1}'
}

baseline_validation_cache_dir() {
  local cache_root="${KASEKI_BASELINE_CACHE_ROOT:-${KASEKI_CACHE_DIR}/kaseki-baseline}"
  local cache_key
  cache_key="$(baseline_validation_cache_key)"
  printf '%s/%s' "$cache_root" "$cache_key"
}

baseline_validation_cache_is_valid() {
  local cache_dir="$1"
  local max_age_hours="${KASEKI_BASELINE_CACHE_MAX_AGE_HOURS:-24}"
  
  [ -d "$cache_dir" ] || return 1
  [ -f "$cache_dir/validation.log" ] || return 1
  [ -f "$cache_dir/validation-timings.tsv" ] || return 1
  
  # Check age: if older than max_age_hours, invalidate
  local cache_mtime now_seconds age_hours
  cache_mtime="$(stat -c %Y "$cache_dir/validation.log" 2>/dev/null || printf '0')"
  now_seconds="$(date +%s)"
  age_hours=$(( (now_seconds - cache_mtime) / 3600 ))
  [ "$age_hours" -lt "$max_age_hours" ]
}

restore_baseline_validation_from_cache() {
  local cache_dir="$1"
  
  if [ "$KASEKI_BASELINE_CACHE_DISABLED" = "1" ]; then
    return 1
  fi
  
  if ! baseline_validation_cache_is_valid "$cache_dir"; then
    return 1
  fi
  
  # Restore cached files to results directory
  mkdir -p "${KASEKI_RESULTS_DIR}"
  
  if ! cp "$cache_dir/validation.log" "${KASEKI_RESULTS_DIR}"/validation-baseline.log 2>/dev/null; then
    return 1
  fi
  if ! cp "$cache_dir/validation-raw.log" "${KASEKI_RESULTS_DIR}"/validation-baseline-raw.log 2>/dev/null; then
    return 1
  fi
  if ! cp "$cache_dir/validation-timings.tsv" "${KASEKI_RESULTS_DIR}"/validation-baseline-timings.tsv 2>/dev/null; then
    return 1
  fi
  if [ -f "$cache_dir/validation-env.log" ]; then
    cp "$cache_dir/validation-env.log" "${KASEKI_RESULTS_DIR}"/validation-baseline-env.log 2>/dev/null || true
  fi
  
  return 0
}

save_baseline_validation_to_cache() {
  local cache_dir="$1"
  
  if [ "$KASEKI_BASELINE_CACHE_DISABLED" = "1" ]; then
    return 0
  fi
  
  # Create cache directory
  mkdir -p "$cache_dir" || return 1
  
  # Save validation results to cache
  if [ -f "${KASEKI_RESULTS_DIR}"/validation-baseline.log ]; then
    cp "${KASEKI_RESULTS_DIR}"/validation-baseline.log "$cache_dir/validation.log" || return 1
  fi
  
  if [ -f "${KASEKI_RESULTS_DIR}"/validation-baseline-raw.log ]; then
    cp "${KASEKI_RESULTS_DIR}"/validation-baseline-raw.log "$cache_dir/validation-raw.log" || return 1
  fi
  
  if [ -f "${KASEKI_RESULTS_DIR}"/validation-baseline-timings.tsv ]; then
    cp "${KASEKI_RESULTS_DIR}"/validation-baseline-timings.tsv "$cache_dir/validation-timings.tsv" || return 1
  fi
  
  if [ -f "${KASEKI_RESULTS_DIR}"/validation-baseline-env.log ]; then
    cp "${KASEKI_RESULTS_DIR}"/validation-baseline-env.log "$cache_dir/validation-env.log" 2>/dev/null || true
  fi
  
  return 0
}

checkout_baseline_repo() {
  local baseline_dir="${KASEKI_WORKSPACE_BASELINE_DIR}"
  local baseline_checkout_log="${KASEKI_RESULTS_DIR}/baseline-checkout.log"
  local baseline_npm_ci_log="${KASEKI_RESULTS_DIR}/baseline-npm-ci.log"

  # Ensure primary baseline log paths are writable before any redirection.
  if ! mkdir -p "$(dirname "$baseline_checkout_log")" "$(dirname "$baseline_npm_ci_log")"; then
    emit_error_event "baseline_log_dir_failed" "Failed to create baseline log directory under ${KASEKI_RESULTS_DIR}" "continue"
    return 1
  fi
  
  # Clean up any existing baseline
  rm -rf "$baseline_dir" 2>/dev/null || true
  mkdir -p "$baseline_dir"
  
  emit_progress "baseline preparation" "checking out main branch"
  
  # Clone main branch into baseline directory
  if ! git clone --depth 1 --branch main "$REPO_URL" "$baseline_dir" 2>>"$baseline_checkout_log"; then
    emit_error_event "baseline_checkout_failed" "Failed to checkout main branch for baseline comparison" "continue"
    return 1
  fi
  
  # Install dependencies in baseline
  if [ -f "$baseline_dir/package.json" ]; then
    emit_progress "baseline preparation" "installing baseline dependencies"
    if ! cd "$baseline_dir" && npm ci --prefer-offline 2>>"$baseline_npm_ci_log"; then
      emit_error_event "baseline_deps_failed" "Failed to install baseline dependencies" "continue"
      cd "${KASEKI_WORKSPACE_DIR}"/repo
      return 1
    fi
    cd "${KASEKI_WORKSPACE_DIR}"/repo
  fi
  
  return 0
}

run_baseline_validation() {
  local baseline_dir="${KASEKI_WORKSPACE_BASELINE_DIR}"
  local baseline_log="${KASEKI_RESULTS_DIR}/validation-baseline.log"
  local baseline_timings="${KASEKI_RESULTS_DIR}/validation-baseline-timings.tsv"
  local baseline_exit_var="BASELINE_VALIDATION_EXIT"
  local baseline_detail_var="BASELINE_VALIDATION_FAILED_COMMAND_DETAIL"
  local baseline_reason_var="BASELINE_VALIDATION_FAILURE_REASON"
  
  if [ ! -d "$baseline_dir" ]; then
    return 1
  fi
  
  # Save current working directory
  local saved_pwd="$PWD"
  # Change to baseline directory temporarily
  cd "$baseline_dir" || return 1
  
  # Run validation commands in baseline
  run_validation_commands \
    "baseline validation" \
    "$KASEKI_PRE_AGENT_VALIDATION_COMMANDS" \
    "$baseline_log" \
    "/dev/null" \
    "$baseline_timings" \
    "${KASEKI_RESULTS_DIR}/validation-baseline-env.log" \
    "baseline_validation_failed" \
    "$baseline_exit_var" \
    "$baseline_detail_var" \
    "$baseline_reason_var" \
    "BASELINE_VALIDATION_STOPPED_EARLY" \
    "BASELINE_VALIDATION_COMMANDS_ATTEMPTED"
  
  local baseline_exit=$?
  
  # Restore working directory
  cd "$saved_pwd" || return 1
  
  # Store baseline exit code for later analysis
  export BASELINE_VALIDATION_EXIT=$baseline_exit
  
  return $baseline_exit
}

analyze_test_failures_baseline() {
  local baseline_log="${KASEKI_RESULTS_DIR}/validation-baseline.log"
  local working_log="${KASEKI_RESULTS_DIR}/pre-validation.log"
  local output_file="${KASEKI_RESULTS_DIR}/test-baseline-comparison.json"
  local results_dir="${KASEKI_RESULTS_DIR}"
  
  if [ ! -f "$baseline_log" ] || [ ! -f "$working_log" ]; then
    emit_progress "test failure analysis" "skipped (baseline or working log missing)"
    return 0
  fi
  
  emit_progress "test failure analysis" "comparing baseline and working test results"
  
  # 1. Prefer pre-compiled global binary or library JS (fastest in Docker)
  if command -v analyze-test-failures >/dev/null 2>&1; then
    analyze-test-failures "$baseline_log" "$working_log" "$output_file" "$results_dir"
    return $?
  fi

  local lib_analyzer_js="/app/lib/analyze-test-failures.js"
  if [ -f "$lib_analyzer_js" ]; then
    node "$lib_analyzer_js" "$baseline_log" "$working_log" "$output_file" "$results_dir"
    return $?
  fi

  # 2. Fall back to on-the-fly transpilation of .ts source (local development)
  # In Docker, prefer /app/src/ (installed with image); fall back to local $SCRIPT_DIR for dev
  local analyzer_ts="/app/src/analyze-test-failures.ts"
  local analyzer_js="/tmp/analyze-test-failures.js"
  
  # For local development (running outside Docker), use source from repo
  if [ ! -f "$analyzer_ts" ] && [ -f "$SCRIPT_DIR/src/analyze-test-failures.ts" ]; then
    analyzer_ts="$SCRIPT_DIR/src/analyze-test-failures.ts"
  fi
  
  if [ -f "$analyzer_ts" ]; then
    # Transpile on-the-fly if npx esbuild or tsc available, otherwise run via node with ts-node
    if command -v npx >/dev/null 2>&1; then
      npx -y esbuild "$analyzer_ts" --bundle --platform=node --outfile="$analyzer_js" 2>/dev/null || {
        # Fallback to ts-node
        npx -y ts-node "$analyzer_ts" "$baseline_log" "$working_log" "$output_file" "$results_dir" 2>/dev/null
        return $?
      }
      node "$analyzer_js" "$baseline_log" "$working_log" "$output_file" "$results_dir"
      local result=$?
      rm -f "$analyzer_js"
      return $result
    else
      # Try running with node's native TypeScript support if available
      node "$analyzer_ts" "$baseline_log" "$working_log" "$output_file" "$results_dir" 2>/dev/null
      return $?
    fi
  else
    emit_error_event "test_failure_analyzer_missing" "Test failure analyzer script not found at $analyzer_ts (no global binary or library JS found either)" "continue"
    return 1
  fi
}

analyze_validation_failure_causality() {
  local baseline_log="${KASEKI_RESULTS_DIR}/validation-baseline.log"
  local post_change_log="${KASEKI_RESULTS_DIR}/validation.log"
  local git_diff="${KASEKI_RESULTS_DIR}/git.diff"
  local changed_files="${KASEKI_RESULTS_DIR}/changed-files.txt"
  local output_file="${KASEKI_RESULTS_DIR}/validation-causality-analysis.json"

  # Skip if no baseline (first run)
  if [ ! -f "$baseline_log" ]; then
    emit_progress "validation causality analysis" "skipped (no baseline validation results)"
    return 0
  fi

  # Skip if no post-change validation
  if [ ! -f "$post_change_log" ]; then
    emit_progress "validation causality analysis" "skipped (no post-change validation results)"
    return 0
  fi

  emit_progress "validation causality analysis" "analyzing failure causality (3 signals)"

  # 1. Prefer pre-compiled global binary or library JS (fastest in Docker)
  if command -v validation-causality-analysis >/dev/null 2>&1; then
    validation-causality-analysis "$baseline_log" "$post_change_log" "$git_diff" "$changed_files" "$output_file"
    return $?
  fi

  local lib_analyzer_js="/app/lib/lib/validation-causality-analysis.js"
  if [ -f "$lib_analyzer_js" ]; then
    node "$lib_analyzer_js" "$baseline_log" "$post_change_log" "$git_diff" "$changed_files" "$output_file"
    return $?
  fi

  # 2. Fall back to on-the-fly execution of .ts source (local development)
  # Use TypeScript utilities to analyze causality
  local analyzer_module="src/lib/validation-causality-analysis.ts"
  if [ ! -f "$analyzer_module" ] && [ -f "/app/$analyzer_module" ]; then
    analyzer_module="/app/$analyzer_module"
  fi

  if [ -f "$analyzer_module" ]; then
    # Try to run the analysis through the TypeScript CLI.
    if command -v npx >/dev/null 2>&1; then
      npx -y tsx "$analyzer_module" "$baseline_log" "$post_change_log" "$git_diff" "$changed_files" "$output_file" 2>/dev/null || \
        npx -y ts-node --esm "$analyzer_module" "$baseline_log" "$post_change_log" "$git_diff" "$changed_files" "$output_file" 2>/dev/null || {
          # If TypeScript execution fails, just note that analysis was attempted.
          emit_progress "validation causality analysis" "TypeScript analysis unavailable; skipping detailed causality breakdown"
          return 0
        }
    else
      emit_progress "validation causality analysis" "npx not available; skipping detailed causality breakdown"
      return 0
    fi
  else
    emit_progress "validation causality analysis" "Causality analyzer script not found; skipping"
    return 0
  fi

  # Check if artifact was created
  if [ -f "$output_file" ]; then
    # Extract verdict from artifact
    if command -v jq >/dev/null 2>&1; then
      local verdict
      verdict=$(jq -r '.assessment.failureType // "unknown"' "$output_file")
      local confidence
      confidence=$(jq -r '.assessment.confidence // 0' "$output_file")
      emit_progress "validation causality analysis" "completed: $verdict (${confidence}% confidence)"
      return 0
    else
      emit_progress "validation causality analysis" "completed (artifact created)"
      return 0
    fi
  fi

  return 0
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
  validation_exit_ref=0
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
  
  # Phase 2: Capture pre-filter startup diagnostics for infrastructure failure diagnosis
  capture_validation_startup_diagnostics "$VALIDATION_STARTUP_DIAGNOSTICS_LOG"

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
    if ! [ -d "${KASEKI_WORKSPACE_DIR}"/repo ]; then
      printf 'ERROR: Working directory %s/repo does not exist before %s\n' "$KASEKI_WORKSPACE_DIR" "$stage_label" | tee -a "$log_file"
      printf 'Current pwd: %s\n' "$(pwd 2>&1 || echo '<pwd failed>')" | tee -a "$log_file"
      printf 'Filesystem state:\n' | tee -a "$log_file"
      find /workspace -maxdepth 3 -type f 2>&1 | head -100 | tee -a "$log_file"
      validation_exit_ref=1
      validation_detail_ref="Working directory ${KASEKI_WORKSPACE_DIR}/repo missing before $stage_label"
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
          printf '[validation command] disk_available=%s\n' "$(df -h "${KASEKI_RESULTS_DIR}" 2>/dev/null | tail -1 | awk '{print $4}' || echo '<df failed>')"
        } | tee -a "$env_log"
        # Use pipefail to catch errors in any stage of the pipe.
        pipefail_was_enabled=0
        if set -o | grep -q '^pipefail[[:space:]]*on'; then
          pipefail_was_enabled=1
        fi
        set -o pipefail
        # validation-output-filter may intentionally stop reading early (for
        # truncation/summary behavior), which can close a downstream pipe.
        # Use warn-nopipe so tee still reports real file-write problems but
        # does not emit noisy benign broken-pipe warnings for pipe sinks.
        {
          printf '\n==> %s\n' "$trimmed"
          unset LLM_GATEWAY_API_KEY
          # Use non-login shell (bash -c) to avoid initialization issues in --read-only containers.
          # Login shell (bash -l) sources /etc/profile and ~/.bashrc, which can fail with getcwd()
          # errors when running in constrained filesystem environments (read-only root, etc.).
          bash -c "$trimmed"
          command_exit=$?
          printf 'exit_code=%s\n' "$command_exit"
          exit "$command_exit"
        } 2>&1 |
          tee --output-error=warn-nopipe \
            >(cat >> "$log_file") \
            >(cat >> "$raw_log") \
            2> >(sed 's/^/[validation-tee] /' >> "$FILTER_STDERR_FILE") |
          FILTER_DIAGNOSTICS_LOG="$FILTER_DIAGNOSTICS_LOG" validation-output-filter 2>>"$FILTER_STDERR_FILE"
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
        
        # Phase 2C: Emit validation result to JSON
        local cmd_status="passed"
        [ "$command_exit" -ne 0 ] && cmd_status="failed"
        append_validation_result "${KASEKI_RESULTS_DIR}"/validation-results.json "$trimmed" "$command_exit" "$duration" "$cmd_status"

        FILTER_STDERR_TAIL=""
        {
          printf '\n[validation pipeline] command=%s\n' "$trimmed"
          printf '[validation pipeline] statuses: command=%s tee=%s filter=%s\n' "$command_exit" "$tee_exit" "$filter_exit"
          printf '[validation pipeline] logs: visible=%s diagnostics=%s\n' "$log_file" "$FILTER_DIAGNOSTICS_LOG"
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
          } | tee -a "$log_file" "${KASEKI_RESULTS_DIR}"/quality.log
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
          } | tee -a "$log_file" "${KASEKI_RESULTS_DIR}"/quality.log "$FILTER_DIAGNOSTICS_LOG"
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
              printf '  %s/repo exists: %s\n' "$KASEKI_WORKSPACE_DIR" "$([ -d "${KASEKI_WORKSPACE_DIR}/repo" ] && echo 'yes' || echo 'no')"
              if [ -L "${KASEKI_WORKSPACE_DIR}"/repo/node_modules ]; then
                printf '  node_modules is symlink → %s\n' "$(readlink "${KASEKI_WORKSPACE_DIR}"/repo/node_modules 2>&1 || echo '<readlink failed>')"
              fi
              printf 'Last 20 lines of validation log:\n'
              tail -20 "$log_file"
            } | tee -a "${KASEKI_RESULTS_DIR}"/quality.log
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
  if [[ ! "$validation_exit_ref" =~ ^[0-9]+$ ]]; then
    printf 'ERROR: Validation exit target %s contained non-integer value: %s\n' "$exit_var" "$validation_exit_ref" | tee -a "$log_file"
    validation_exit_ref=1
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
  REPO_MEMORY_COMMIT_SHA="$(git -C "${KASEKI_WORKSPACE_DIR}"/repo rev-parse HEAD 2>/dev/null || printf 'unknown')"
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

# shellcheck source=/dev/null
. "$KASEKI_AGENT_PROMPT_HELPER" || {
  printf 'ERROR: Failed to source %s (exit code: %d)\n' "$KASEKI_AGENT_PROMPT_HELPER" $? >&2
  exit 1
}
is_transient_goal_setting_failure() {
  local exit_code="$1"
  local stderr_content="$2"

  # First, check if we have an explicit validation reason code from our helper
  if [ -f "${KASEKI_RESULTS_DIR}"/goal-setting-validation-reason.txt ]; then
    local reason_code
    reason_code=$(cat "${KASEKI_RESULTS_DIR}"/goal-setting-validation-reason.txt 2>/dev/null || echo "")
    case "$reason_code" in
      valid)
        return 1
        ;;
      placeholder_content)
        # Deterministic failure - same prompt will produce same placeholder result
        # Retry requires a different prompt or model configuration, not just retry
        return 1
        ;;
      schema_mismatch|malformed_json|missing_required_fields|empty_goal)
        # Deterministic failures - do not retry
        return 1
        ;;
    esac
  fi

  # EXPLICIT EXIT CODE MAPPING (do not treat unknown codes as transient)
  case "$exit_code" in
    # Success cases (should not reach here, but handle for safety)
    0)
      return 1  # Not transient, unexpected here
      ;;
    # Timeout = transient, should retry
    124)
      return 0
      ;;
    # Local validation failures = deterministic, do not retry
    86)
      return 1
      ;;
    # Provider/model errors = deterministic until model/config changes
    88)
      return 1
      ;;
    # Missing config/API key = deterministic, not retryable
    2)
      return 1
      ;;
    # Exit code 1 = generic agent error - check stderr for transient indicators
    # Do NOT assume transient without evidence
    1)
      # Only retry if stderr contains transient indicators
      if echo "$stderr_content" | grep -qi -E "(timeout|ETIMEDOUT|rate.?limit|429|503|temporary|transient|try.?again|connection.?reset|ECONNRESET|EPIPE)" 2>/dev/null; then
        return 0  # Transient (retry)
      fi
      # Otherwise treat as deterministic error
      return 1
      ;;
    # Any other non-zero exit code not explicitly mapped
    # Require strong evidence of transient condition before retrying
    *)
      # Check for clear transient error patterns in stderr
      if echo "$stderr_content" | grep -qi -E "(timeout|connection.*error|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network.*error|try.?again|rate.?limit|temporarily.*unavailable)" 2>/dev/null; then
        return 0  # Transient (retry)
      fi
      # Default to deterministic for unknown exit codes
      return 1
      ;;
  esac
  
  # Should not reach here (all cases above return)
  # shellcheck disable=SC2317
  return 1
}

build_goal_setting_prompt() {
  local caveman_instruction
  caveman_instruction="$(get_caveman_instruction)"
  
  cat <<EOF
${caveman_instruction:+$caveman_instruction

}You are a goal-setting Pi agent. Your task is to upgrade a user's task prompt into a mature, specific goal that maximizes downstream agent success.

- Write exactly one JSON object to $GOAL_SETTING_CANDIDATE_ARTIFACT.

=== GOAL-SETTING BEST PRACTICES ===

Well-formed goals have:
- **Explicit anti-patterns**: Concrete "do not" constraints (e.g., "Do not modify src/generated/**")
- **SMART criteria**: Specific (name function), Measurable (test count), Achievable (file count), Relevant (task scope), Time-bound (single run)
- **Typed constraints**: Separate Operational, Architectural, Technical, and Business constraints
- **Codebase context**: Tech stack, folder patterns, naming conventions
- **Examples**: Input/output before/after if inferrable
- **Reasoning**: Explain why constraints exist

=== INPUT ANALYSIS ===

User task prompt:
$ORIGINAL_TASK_PROMPT

Analyze for: success criteria, scope boundaries, anti-patterns, conventions, drivers

=== OUTPUT SCHEMA ===

Write exactly one JSON object to $GOAL_SETTING_CANDIDATE_ARTIFACT (no markdown, no code fences) with this shape:

{
  "original_prompt": "<the user's original task prompt, verbatim>",
  "upgraded_goal": "<concise goal (1-3 sentences), actionable for a coding agent>",
  "key_requirements": ["<requirement 1>", "<requirement 2>"],
  "success_criteria": [
    {
      "criterion": "<specific, measurable criterion>",
      "smart_score": "high",
      "reasoning": "<brief reason why this is SMART (Specific, Measurable, Achievable, Relevant, Time-bound)>"
    }
  ],
  "anti_patterns": {
    "do_not_modify": ["<file/pattern to preserve>"],
    "do_not_break": ["<functionality/contract to preserve>"],
    "must_preserve": ["<behavior/structure to preserve>"]
  },
  "constraints": {
    "operational": ["<operational constraint>"],
    "architectural": ["<architectural constraint>"],
    "technical": ["<technical constraint>"],
    "business": ["<business constraint>"]
  },
  "examples": {
    "before": "<input/state before changes>",
    "after": "<expected output/state after changes>"
  },
  "quality_metrics": {
    "clarity": "high|medium|low",
    "measurability": "high|medium|low",
    "specificity": "high|medium|low",
    "scope_clarity": "high|medium|low",
    "constraint_strength": "high|medium|low"
  },
  "reasoning": "<explanation of upgrades made and key decisions>",
  "confidence": "high|medium|low"
}

=== CONCRETE EXAMPLE (for reference - NOT to be copied) ===

For a task like "Fix the parser's null-handling in parseRole()", a valid output would be:

{
  "original_prompt": "Fix null-safety in parseRole() function. Currently crashes on null input; should return undefined instead.",
  "upgraded_goal": "Add null-safety checks to parseRole() to handle null/undefined inputs gracefully, with test coverage",
  "key_requirements": [
    "Must pass TypeScript type checking",
    "Must not break existing callers",
    "All new tests must pass"
  ],
  "success_criteria": [
    {
      "criterion": "parseRole(null) returns undefined instead of throwing",
      "smart_score": "high",
      "reasoning": "Directly addresses the null-safety issue and is immediately testable"
    },
    {
      "criterion": "Add 3 tests covering null, undefined, and invalid-type cases",
      "smart_score": "high",
      "reasoning": "Specific, measurable, and verifiable in one run"
    }
  ],
  "anti_patterns": {
    "do_not_modify": ["src/lib/role-constants.ts", "src/types/**"],
    "do_not_break": ["API contract for parseRole()", "existing error handling patterns"],
    "must_preserve": ["Error message format for validation failures"]
  },
  "constraints": {
    "operational": ["Change only src/lib/parser.ts and tests/parser.test.ts"],
    "architectural": ["Respect the existing error-handling pattern"],
    "technical": ["Must pass type checking and linting"],
    "business": ["No breaking changes to API callers"]
  },
  "reasoning": "The task is focused on defensive programming (null-handling) in a well-tested function. Constraint to parser.ts+tests is tight, making this achievable in one run.",
  "confidence": "high"
}

=== CRITICAL INSTRUCTIONS ===

1. **DO NOT COPY THE SCHEMA TEMPLATE ABOVE.** Replace every field with concrete values from the actual task prompt.
2. **DO NOT USE PLACEHOLDER TEXT.** Never write "e.g., max 3 files changed" or "path/pattern1/**" or "input/state before changes (if inferrable)". Write actual values.
3. **DO NOT USE ANGLE BRACKETS <...> IN YOUR OUTPUT.** The angle brackets above are markers only. Replace them with real text.
4. **CONFIDENCE FIELD**: Use only "high", "medium", or "low" (not "high|medium|low").
5. **ENUM FIELDS**: quality_metrics.clarity must be one of: "high", "medium", "low" (not all three).

If you find yourself about to output a template or example shape, STOP and rewrite with concrete values instead.

Enum fields must contain only one literal value: "high", "medium", or "low".

=== TEST UPDATE REQUIREMENTS ===

**CRITICAL FOR CODE-MODIFYING TASKS**: If this task involves modifying any of these areas, ALWAYS include explicit test-update success criteria:

- **Parsers or regex logic**: "Add 3-5 tests for [null/empty/invalid input handling]"
- **Event handling or field changes**: "Update 2-3 tests for [event field validation/timing]"
- **Response construction or serialization**: "Add round-trip serialization tests covering [format changes]"
- **Naming conventions or transformations**: "Update test assertions for renamed [fields/functions]"

Examples of strong test-update criteria:
✓ "Add 4 tests for null-role, empty-string-role, and whitespace-role cases (tests/parser.test.ts lines 120-150)"
✓ "Update 3 event-timing assertions in tests/event-handler.test.ts for new async behavior"
✓ "Add backward-compatibility test: serialize new format, deserialize to verify field mapping (tests/serialization.test.ts)"

Include these in success_criteria as SMART criteria with smart_score: "high" (measurable, specific, achievable in one run).

=== GUIDELINES ===

- Be concise but complete. This goal will drive all downstream agents.
- Distinguish hard constraints (safety-critical) from soft preferences.
- Include examples if inferrable from the prompt (helps agents avoid false starts).
- Categorize constraints by type to aid downstream prioritization.
- When task involves parser/event/response changes, include test-update criteria (see TEST UPDATE REQUIREMENTS above).
- If confidence is low, explain what's ambiguous and what clarification would help.
- Focus on goal quality over verbosity.
EOF
}

validate_goal_setting_artifact() {
  local candidate_artifact="$1"
  local final_artifact="$2"
  local reason_file="$3"
  local results_dir="$KASEKI_RESULTS_DIR"

  if ! [ -f "$candidate_artifact" ]; then
    {
      echo "{\"step\": \"parse\", \"status\": \"failure\", \"reason\": \"candidate artifact file not found\", \"file\": \"$candidate_artifact\"}"
    } >> "$results_dir/goal-setting-validation-errors.jsonl"
    [ -n "$reason_file" ] && echo "missing_file" > "$reason_file"
    echo "Goal-setting artifact file missing: $candidate_artifact" > "$results_dir/goal-setting-validation-summary.txt"
    return 1
  fi

  local json_content
  json_content=$(cat "$candidate_artifact" 2>/dev/null || true)

  # Try to parse as JSON
  if ! echo "$json_content" | jq . >/dev/null 2>&1; then
    {
      echo "{\"step\": \"parse\", \"status\": \"failure\", \"reason\": \"malformed_json\", \"preview\": \"$(echo "$json_content" | head -c 200)\"}"
    } >> "$results_dir/goal-setting-validation-errors.jsonl"
    [ -n "$reason_file" ] && echo "malformed_json" > "$reason_file"
    echo "Goal-setting artifact is not valid JSON" > "$results_dir/goal-setting-validation-summary.txt"
    return 1
  fi

  if ! validate_no_goal_setting_placeholders "$candidate_artifact" "$reason_file"; then
    echo "Goal-setting artifact contains prompt placeholder text" > "$results_dir/goal-setting-validation-summary.txt"
    return 1
  fi

  # Validate with Node.js
  if ! validate_goal_setting_artifact_with_node "$candidate_artifact" "$reason_file"; then
    cp "$candidate_artifact" "$final_artifact" 2>/dev/null || true
    echo "Goal-setting artifact failed Node.js validation" > "$results_dir/goal-setting-validation-summary.txt"
    return 1
  fi

  # Success: move candidate to final artifact
  mv "$candidate_artifact" "$final_artifact" 2>/dev/null || cp "$candidate_artifact" "$final_artifact" 2>/dev/null || true
  [ -n "$reason_file" ] && echo "valid" > "$reason_file"
  return 0
}

validate_no_goal_setting_placeholders() {
  local candidate_artifact="$1"
  local reason_file="$2"
  local results_dir="$KASEKI_RESULTS_DIR"

  if node - "$candidate_artifact" <<'NODE'
const fs = require('node:fs');
const artifactPath = process.argv[2];
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
const patterns = [
  /\bthe original user prompt\b/i,
  /\bconcise goal \(1-3 sentences\), actionable for a coding agent\b/i,
  /\brequirement 1 \(critical constraint or dependency\)\b/i,
  /\bspecific, measurable criterion\b/i,
  /\bbrief reason \(e\.g\., clearly measurable, achievable in one run\)\b/i,
  /\bpath\/pattern[0-9]+\/\*\*/i,
  /\be\.g\., max 3 files changed\b/i,
  /\be\.g\., respect service boundaries\b/i,
  /\be\.g\., must pass type checking\b/i,
  /\be\.g\., maintain user-facing behavior\b/i,
  /\binput\/state before changes \(if inferrable\)\b/i,
  /\bexpected output\/state after changes \(if inferrable\)\b/i,
  /\bexplanation of upgrades made and key decisions\b/i,
];
const hits = [];
function visit(value, path = []) {
  if (typeof value === 'string') {
    const matched = patterns.find((pattern) => pattern.test(value));
    if (matched) hits.push({ field: path.join('.') || 'root', value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, [...path, String(index)]));
    return;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => visit(item, [...path, key]));
  }
}
visit(artifact);
if (hits.length > 0) {
  console.error(JSON.stringify({
    status: 'invalid_placeholder_content',
    errors: hits.map((hit) => ({
      field: hit.field,
      expected: 'task-specific goal-setting content',
      actual: hit.value,
      severity: 'critical',
      suggestion: 'Replace prompt-shape placeholder text with concrete task-specific content.',
    })),
  }));
  process.exit(1);
}
NODE
  then
    return 0
  fi

  node - "$candidate_artifact" "$results_dir/goal-setting-validation-errors.jsonl" <<'NODE' || true
const fs = require('node:fs');
const [artifactPath, logPath] = process.argv.slice(2);
try {
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const patterns = [
    /\bthe original user prompt\b/i,
    /\bconcise goal \(1-3 sentences\), actionable for a coding agent\b/i,
    /\brequirement 1 \(critical constraint or dependency\)\b/i,
    /\bspecific, measurable criterion\b/i,
    /\bpath\/pattern[0-9]+\/\*\*/i,
    /\be\.g\., max 3 files changed\b/i,
    /\bexplanation of upgrades made and key decisions\b/i,
  ];
  const hits = [];
  function visit(value, path = []) {
    if (typeof value === 'string' && patterns.some((pattern) => pattern.test(value))) {
      hits.push({ field: path.join('.') || 'root', value });
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, String(index)]));
    } else if (value && typeof value === 'object') {
      Object.entries(value).forEach(([key, item]) => visit(item, [...path, key]));
    }
  }
  visit(artifact);
  for (const hit of hits) {
    fs.appendFileSync(logPath, JSON.stringify({
      step: 'semantic_validation',
      status: 'failure',
      reason: 'placeholder_content',
      field: hit.field,
      actual: hit.value,
    }) + '\n');
  }
} catch {}
NODE
  [ -n "$reason_file" ] && echo "placeholder_content" > "$reason_file"
  return 1
}

validate_goal_setting_artifact_with_node() {
  local candidate_artifact="$1"
  local reason_file="$2"
  local results_dir="$KASEKI_RESULTS_DIR"

  local validation_output
  validation_output=$(node -e "
    try {
      const artifact = require('$candidate_artifact');
      const errors = [];
      const warnings = [];

      // === REQUIRED CORE FIELDS ===
      if (!artifact.original_prompt || typeof artifact.original_prompt !== 'string') {
        errors.push('missing_or_invalid: original_prompt (must be non-empty string)');
      }
      if (!artifact.upgraded_goal || typeof artifact.upgraded_goal !== 'string') {
        errors.push('missing_or_invalid: upgraded_goal (must be non-empty string)');
      }
      if (!artifact.reasoning || typeof artifact.reasoning !== 'string') {
        errors.push('missing_or_invalid: reasoning (must be non-empty string)');
      }

      // === REQUIRED ARRAYS ===
      if (!Array.isArray(artifact.key_requirements)) {
        errors.push('missing_or_invalid: key_requirements (must be array)');
      } else if (artifact.key_requirements.length === 0) {
        warnings.push('empty_key_requirements: at least one requirement recommended');
      }

      // === SUCCESS CRITERIA (NEW SMART VALIDATION) ===
      if (!Array.isArray(artifact.success_criteria)) {
        errors.push('missing_or_invalid: success_criteria (must be array)');
      } else if (artifact.success_criteria.length === 0) {
        warnings.push('empty_success_criteria: at least one criterion recommended');
      } else {
        // Validate each criterion for SMART properties
        let weak_criteria = 0;
        artifact.success_criteria.forEach((c, idx) => {
          // Accept both old format (string) and new format (object with smart_score)
          const criterion_text = typeof c === 'string' ? c : (c.criterion || '');
          const smart_score = typeof c === 'object' ? c.smart_score : 'unknown';
          
          if (!criterion_text) {
            errors.push(\`success_criteria[\${idx}]: criterion must be non-empty string or object with 'criterion' field\`);
          } else if (smart_score === 'low') {
            weak_criteria++;
          }
        });
        if (weak_criteria > artifact.success_criteria.length / 2) {
          warnings.push('weak_smart_criteria: >50% of criteria scored as low SMART quality');
        }
      }

      // === ANTI-PATTERNS (NEW FIELD) ===
      if (artifact.anti_patterns) {
        if (typeof artifact.anti_patterns !== 'object') {
          errors.push('invalid: anti_patterns must be object');
        } else {
          const valid_keys = ['do_not_modify', 'do_not_break', 'must_preserve'];
          Object.keys(artifact.anti_patterns).forEach(key => {
            if (!valid_keys.includes(key)) {
              warnings.push(\`unexpected_anti_pattern_key: \${key} (expected: do_not_modify, do_not_break, must_preserve)\`);
            }
            if (!Array.isArray(artifact.anti_patterns[key])) {
              errors.push(\`invalid: anti_patterns.\${key} must be array\`);
            }
          });
        }
      } else {
        warnings.push('missing_anti_patterns: recommended to include explicit do-NOT clauses');
      }

      // === CONSTRAINTS BY CATEGORY (NEW FIELD) ===
      if (artifact.constraints) {
        if (typeof artifact.constraints !== 'object') {
          errors.push('invalid: constraints must be object');
        } else {
          const valid_categories = ['operational', 'architectural', 'technical', 'business'];
          Object.keys(artifact.constraints).forEach(cat => {
            if (!valid_categories.includes(cat)) {
              warnings.push(\`unexpected_constraint_category: \${cat}\`);
            }
            if (!Array.isArray(artifact.constraints[cat])) {
              errors.push(\`invalid: constraints.\${cat} must be array\`);
            }
          });
        }
      } else {
        warnings.push('missing_constraints: recommended to categorize constraints');
      }

      // === EXAMPLES (NEW FIELD) ===
      if (artifact.examples) {
        if (typeof artifact.examples !== 'object') {
          errors.push('invalid: examples must be object');
        } else if (!artifact.examples.before && !artifact.examples.after) {
          warnings.push('empty_examples: before/after examples not provided (helpful for clarity)');
        }
      }

      // === QUALITY METRICS (NEW FIELD) ===
      if (artifact.quality_metrics) {
        if (typeof artifact.quality_metrics !== 'object') {
          errors.push('invalid: quality_metrics must be object');
        } else {
          const valid_metrics = ['clarity', 'measurability', 'specificity', 'scope_clarity', 'constraint_strength'];
          const valid_scores = ['high', 'medium', 'low'];
          Object.keys(artifact.quality_metrics).forEach(metric => {
            if (!valid_metrics.includes(metric)) {
              warnings.push(\`unexpected_quality_metric: \${metric}\`);
            }
            const score = artifact.quality_metrics[metric];
            if (!valid_scores.includes(score)) {
              errors.push(\`invalid: quality_metrics.\${metric} must be high|medium|low (got \${score})\`);
            }
          });
        }
      } else {
        warnings.push('missing_quality_metrics: recommended 5-point quality scorecard');
      }

      // === CONFIDENCE FIELD ===
      if (artifact.confidence && !['high', 'medium', 'low'].includes(artifact.confidence)) {
        errors.push('invalid: confidence must be high|medium|low');
      }

      // === LEGACY FIELD COMPATIBILITY ===
      // Support old 'potential_constraints' field for backward compatibility
      if (artifact.potential_constraints && !artifact.constraints) {
        warnings.push('legacy_potential_constraints: use new constraints schema instead');
      }

      // === BUILD RESULT ===
      const result = {
        status: errors.length > 0 ? 'invalid_fields' : 'valid',
        errors,
        warnings,
        smart_quality: warnings.some(w => w.includes('SMART') || w.includes('smart')) ? 'low' : 'high'
      };

      console.log(JSON.stringify(result));
      process.exit(errors.length > 0 ? 1 : 0);
    } catch (e) {
      console.log(JSON.stringify({status: 'error', message: e.message}));
      process.exit(1);
    }
  " 2>&1)

  if ! echo "$validation_output" | jq . >/dev/null 2>&1; then
    {
      echo "{\"step\": \"node_validation\", \"status\": \"failure\", \"reason\": \"node_error\", \"output\": \"$validation_output\"}"
    } >> "$results_dir/goal-setting-validation-errors.jsonl"
    [ -n "$reason_file" ] && echo "schema_mismatch" > "$reason_file"
    return 1
  fi

  local status
  status=$(echo "$validation_output" | jq -r '.status' 2>/dev/null || echo "error")

  if [ "$status" != "valid" ]; then
    {
      echo "$validation_output"
    } >> "$results_dir/goal-setting-validation-errors.jsonl"
    [ -n "$reason_file" ] && echo "missing_required_fields" > "$reason_file"
    return 1
  fi

  # Log warnings to optional file for inspection (non-blocking)
  local warnings
  warnings=$(echo "$validation_output" | jq -r '.warnings | @json' 2>/dev/null || echo "[]")
  if [ "$warnings" != "[]" ] && [ -n "$warnings" ]; then
    {
      echo "goal-setting-warnings:"
      echo "$warnings" | jq -r '.[]' 2>/dev/null || true
    } >> "$results_dir/goal-setting-validation-notes.txt" 2>/dev/null || true
  fi

  return 0
}

create_fallback_goal_setting_artifact() {
  local task_prompt="$1"
  local output_path="$2"
  local results_dir="${KASEKI_RESULTS_DIR:-/results}"
  
  # Generate fallback using Node.js utility function
  node - "$task_prompt" "$output_path" <<'NODE_FALLBACK'
const fs = require('fs');
const path = require('path');

const taskPrompt = process.argv[2];
const outputPath = process.argv[3];

// Use full task prompt as upgraded_goal (no truncation)
// This preserves rich context for downstream phases
const fallbackGoal = {
  original_prompt: taskPrompt,
  upgraded_goal: taskPrompt,
  key_requirements: [
    'Complete the task as specified',
    'Maintain stability'
  ],
  success_criteria: [
    {
      criterion: 'Task completed as specified in the original prompt',
      smart_score: 'medium',
      reasoning: 'Primary success criterion when goal-setting failed'
    }
  ],
  anti_patterns: {
    do_not_modify: [],
    do_not_break: ['Existing functionality', 'API contracts'],
    must_preserve: []
  },
  constraints: {
    operational: [],
    architectural: [],
    technical: ['Must pass type checking if applicable'],
    business: []
  },
  reasoning: 'Fallback goal-setting artifact generated because the goal-setting agent failed to produce valid output with concrete task-specific content. Using original task prompt as primary reference.',
  confidence: 'low'
};

fs.writeFileSync(outputPath, JSON.stringify(fallbackGoal, null, 2) + '\n');
NODE_FALLBACK
  
  if [ -f "$output_path" ]; then
    printf 'Goal-setting fallback artifact created at %s\n' "$output_path" >> "${results_dir}/goal-setting.log" 2>/dev/null || true
    return 0
  else
    printf 'Failed to create fallback goal-setting artifact\n' >> "${results_dir}/goal-setting.log" 2>/dev/null || true
    return 1
  fi
}

run_goal_setting_agent() {
  local goal_setting_prompt goal_setting_start goal_setting_stderr_capture

  printf '\n==> pi goal-setting agent\n'
  set_current_stage "pi goal-setting agent"
  
  if [ "$KASEKI_GOAL_SETTING" = "0" ]; then
    printf 'Pi goal-setting agent skipped because KASEKI_GOAL_SETTING=0.\n'
    record_stage_timing "pi goal-setting agent" 0 0 "skipped_by_config"
    return 0
  fi
  
  if [ "$KASEKI_DRY_RUN" = "1" ]; then
    printf 'DRY-RUN: Pi goal-setting agent would upgrade the task prompt into a mature goal.\n'
    record_stage_timing "pi goal-setting agent" 0 0 "dry_run=true"
    return 0
  fi

  goal_setting_prompt="$(build_goal_setting_prompt)"
  goal_setting_start="$(date +%s)"
  
  set +e
  run_pi_with_retry "$GOAL_SETTING_RAW_EVENTS" "$KASEKI_GOAL_SETTING_TIMEOUT_SECONDS" "$KASEKI_GOAL_SETTING_MODEL" "$goal_setting_prompt" "goal-setting-summary" "" "goal-setting"
  GOAL_SETTING_EXIT="$?"
  GOAL_SETTING_DURATION_SECONDS=$(($(date +%s) - goal_setting_start))
  unset goal_setting_prompt LLM_GATEWAY_API_KEY LLM_GATEWAY_URL
  set +e

  # Artifact recovery: if artifact file doesn't exist, try to recover from event stream
  if [ "$GOAL_SETTING_EXIT" -eq 0 ] && [ ! -f "$GOAL_SETTING_CANDIDATE_ARTIFACT" ]; then
    run_artifact_recovery_helper "goal-setting" "$GOAL_SETTING_RAW_EVENTS" "$GOAL_SETTING_CANDIDATE_ARTIFACT" "$KASEKI_RESULTS_DIR" >/dev/null 2>&1 || true
  fi

  kaseki-pi-event-filter "$GOAL_SETTING_RAW_EVENTS" "${KASEKI_RESULTS_DIR}"/goal-setting-events.jsonl "${KASEKI_RESULTS_DIR}"/goal-setting-summary.json 2>/dev/null || cp "$GOAL_SETTING_RAW_EVENTS" "${KASEKI_RESULTS_DIR}"/goal-setting-events.raw.jsonl 2>/dev/null || true
  if capture_provider_error_from_summary "${KASEKI_RESULTS_DIR}/goal-setting-summary.json" "goal-setting"; then
    if [ "$PROVIDER_ERROR_TYPE" = "provider_empty_assistant_turn" ]; then
      emit_error_event "$PROVIDER_ERROR_TYPE" "Goal-setting provider returned an empty assistant turn; using fallback goal-setting artifact" "continue"
      append_pre_coding_provider_fallback_error "${KASEKI_RESULTS_DIR}/goal-setting-validation-errors.jsonl" "goal-setting" "fallback_goal_setting_artifact" "$GOAL_SETTING_ARTIFACT"
      printf '\n==> Creating fallback goal-setting artifact after empty assistant turn (degraded mode)\n'
      if create_fallback_goal_setting_artifact "$ORIGINAL_TASK_PROMPT" "$GOAL_SETTING_ARTIFACT"; then
        printf 'Fallback artifact created successfully. Run will proceed with confidence=low goal-setting.\n'
        GOAL_SETTING_EXIT=0
        GOAL_SETTING_FALLBACK_USED=1
        GOAL_SETTING_FALLBACK_MODE="provider_empty_assistant_turn"
      else
        printf 'Failed to create fallback artifact. Run will fail.\n'
        GOAL_SETTING_EXIT=88
      fi
    else
      GOAL_SETTING_EXIT=88
      emit_error_event "$PROVIDER_ERROR_TYPE" "Goal-setting provider error: $PROVIDER_ERROR_MESSAGE" "continue"
    fi
  fi

  if [ "$GOAL_SETTING_EXIT" -eq 0 ] && [ "$GOAL_SETTING_FALLBACK_USED" != "1" ] && ! validate_goal_setting_artifact "$GOAL_SETTING_CANDIDATE_ARTIFACT" "$GOAL_SETTING_ARTIFACT" "${KASEKI_RESULTS_DIR}/goal-setting-validation-reason.txt"; then
    GOAL_SETTING_EXIT=86
    goal_setting_validation_summary="$(cat "${KASEKI_RESULTS_DIR}"/goal-setting-validation-summary.txt 2>/dev/null || printf 'goal-setting artifact validation failed')"
    emit_error_event "pi_goal_setting_artifact_invalid" "Pi goal-setting artifact invalid: $goal_setting_validation_summary (full details: ${KASEKI_RESULTS_DIR}/goal-setting-validation-errors.jsonl)" "continue"
    
    # TIER 1 FALLBACK: Create minimal valid goal-setting artifact
    printf '\n==> Creating fallback goal-setting artifact (degraded mode)\n'
    if create_fallback_goal_setting_artifact "$ORIGINAL_TASK_PROMPT" "$GOAL_SETTING_ARTIFACT"; then
      printf 'Fallback artifact created successfully. Run will proceed with confidence=low goal-setting.\n'
      GOAL_SETTING_EXIT=0  # Mark as success since we have valid artifact
      GOAL_SETTING_FALLBACK_USED=1
      emit_error_event "goal_setting_fallback_activated" "Goal-setting validation failed, using fallback mode (confidence=low)" "warning"
    else
      printf 'Failed to create fallback artifact. Run will fail.\n'
      # Keep GOAL_SETTING_EXIT=86 to indicate failure
    fi
  fi
  
  rm -f "$GOAL_SETTING_CANDIDATE_ARTIFACT"
  # Phase 3A: Consolidate goal-setting summary to all-phase-summaries.json
  append_phase_summary "${KASEKI_RESULTS_DIR}"/all-phase-summaries.json "goal-setting" "${KASEKI_RESULTS_DIR}"/goal-setting-summary.json
  GOAL_SETTING_ACTUAL_MODEL="$(node -e 'try { const s=require(process.env.KASEKI_RESULTS_DIR + "/goal-setting-summary.json"); const v=String(s.selected_model || s.model || "").trim(); console.log(v && v !== "unknown" && v !== "null" ? v : "unknown"); } catch { console.log("unknown"); }' 2>/dev/null)"
  
  record_stage_timing "pi goal-setting agent" "$GOAL_SETTING_EXIT" "$GOAL_SETTING_DURATION_SECONDS" "artifact=$GOAL_SETTING_ARTIFACT timeout_seconds=$KASEKI_GOAL_SETTING_TIMEOUT_SECONDS"
  
  if [ "$GOAL_SETTING_EXIT" -ne 0 ]; then
    emit_error_event "pi_goal_setting_failed" "Goal-setting agent exited before scouting: $GOAL_SETTING_EXIT; continuing with original TASK_PROMPT" "continue"
    return 1
  fi
  
  emit_progress "pi goal-setting agent" "wrote goal-setting artifact"
  rm -f "${KASEKI_RESULTS_DIR}"/goal-setting-validation-reason.txt 2>/dev/null || true
  
  return 0
}

write_goal_setting_metrics() {
  local invoked_at="$1"
  local completed_at="$2"
  local retry_count="${KASEKI_GOAL_SETTING_ATTEMPTS:-0}"
  local success=false
  local failure_reason=""

  # Determine success/failure using unified classification
  if [ -n "$KASEKI_GOAL_SETTING_SUCCEEDED_ON_ATTEMPT" ]; then
    success=true
  else
    # Use unified error classification
    failure_reason="$(classify_goal_setting_error "$GOAL_SETTING_EXIT" "$goal_setting_last_stderr")"
  fi

  local duration_ms=$(( (completed_at - invoked_at) * 1000 ))

  # Write metrics JSON
  node -e "
    const fs = require('fs');
    const metrics = {
      invoked_at: new Date(${invoked_at}000).toISOString(),
      completed_at: new Date(${completed_at}000).toISOString(),
      duration_ms: ${duration_ms},
      retry_count: ${retry_count},
      success: ${success},
      $(if [ "$success" = "false" ]; then echo "failure_reason: '$failure_reason',"; fi)
      model: '${GOAL_SETTING_ACTUAL_MODEL:-unknown}',
      timeout_seconds: ${KASEKI_GOAL_SETTING_TIMEOUT_SECONDS:-300}
    };
    fs.writeFileSync('${KASEKI_RESULTS_DIR}/goal-setting-metrics.json', JSON.stringify(metrics, null, 2) + '\n');
  " 2>/dev/null || {
    # Fallback to jq or printf if node fails
    {
      printf '{\n'
      printf '  "invoked_at": "%s",\n' "$(date -d @"${invoked_at}" -u +%Y-%m-%dT%H:%M:%SZ)"
      printf '  "completed_at": "%s",\n' "$(date -d @"${completed_at}" -u +%Y-%m-%dT%H:%M:%SZ)"
      printf '  "duration_ms": %d,\n' "$duration_ms"
      printf '  "retry_count": %d,\n' "$retry_count"
      printf '  "success": %s,\n' "$([ "$success" = "true" ] && echo "true" || echo "false")"
      if [ "$success" = "false" ]; then
        printf '  "failure_reason": "%s",\n' "$failure_reason"
      fi
      printf '  "model": "%s",\n' "${GOAL_SETTING_ACTUAL_MODEL:-unknown}"
      printf '  "timeout_seconds": %d\n' "${KASEKI_GOAL_SETTING_TIMEOUT_SECONDS:-300}"
      printf '}\n'
    } > "${KASEKI_RESULTS_DIR}"/goal-setting-metrics.json
  }
}

classify_goal_setting_error() {
  local exit_code="$1"
  local stderr_content="$2"

  # Check validation reason file first (most authoritative)
  if [ -f "${KASEKI_RESULTS_DIR}"/goal-setting-validation-reason.txt ]; then
    local reason_code
    reason_code=$(cat "${KASEKI_RESULTS_DIR}"/goal-setting-validation-reason.txt 2>/dev/null || echo "")
    case "$reason_code" in
      placeholder_content)
        echo "GOAL_SETTING_PLACEHOLDER_CONTENT"
        return 0
        ;;
      schema_mismatch)
        echo "GOAL_SETTING_SCHEMA_MISMATCH"
        return 0
        ;;
      malformed_json)
        echo "GOAL_SETTING_MALFORMED_JSON"
        return 0
        ;;
      missing_required_fields)
        echo "GOAL_SETTING_MISSING_REQUIRED_FIELDS"
        return 0
        ;;
      missing_file)
        echo "GOAL_SETTING_MISSING_FILE"
        return 0
        ;;
    esac
  fi

  # Classify by exit code
  case "$exit_code" in
    0)
      echo "GOAL_SETTING_SUCCESS"
      ;;
    2)
      echo "GOAL_SETTING_MISSING_CONFIG"
      ;;
    86)
      echo "GOAL_SETTING_VALIDATION_ERROR"
      ;;
    124)
      echo "GOAL_SETTING_TIMEOUT"
      ;;
    *)
      # Check stderr for specific errors
      if echo "$stderr_content" | grep -qi "timeout" 2>/dev/null; then
        echo "GOAL_SETTING_TIMEOUT"
      elif echo "$stderr_content" | grep -qi "rate.?limit" 2>/dev/null; then
        echo "GOAL_SETTING_RATE_LIMITED"
      elif echo "$stderr_content" | grep -qi "api.?error\|connection" 2>/dev/null; then
        echo "GOAL_SETTING_API_ERROR"
      elif echo "$stderr_content" | grep -qi "schema\|validation\|invalid" 2>/dev/null; then
        echo "GOAL_SETTING_VALIDATION_ERROR"
      else
        echo "GOAL_SETTING_PI_ERROR_EXIT_$exit_code"
      fi
      ;;
  esac
}

run_goal_setting_agent_with_retry() {
  local attempt goal_setting_stderr_capture max_attempts goal_setting_last_exit goal_setting_last_stderr
  local pre_goal_setting_status pre_goal_setting_failed_command goal_setting_phase_start_time
  local attempt_start_time attempt_end_time attempt_duration_sec

  max_attempts=2
  attempt=1
  goal_setting_last_exit=0
  goal_setting_last_stderr=""
  pre_goal_setting_status="$STATUS"
  pre_goal_setting_failed_command="$FAILED_COMMAND"
  goal_setting_phase_start_time="$(date +%s)"

  # Initialize goal-setting retry tracking env vars
  export KASEKI_GOAL_SETTING_ATTEMPTS=0
  export KASEKI_GOAL_SETTING_SUCCEEDED_ON_ATTEMPT=""

  while [ "$attempt" -le "$max_attempts" ]; do
    attempt_start_time="$(date +%s.%N)"
    printf '[Goal-Setting Phase] Attempt %d/%d (timeout: %ds)\n' "$attempt" "$max_attempts" "$KASEKI_GOAL_SETTING_TIMEOUT_SECONDS"
    rm -f "${KASEKI_RESULTS_DIR}"/goal-setting-validation-reason.txt 2>/dev/null || true

    # Capture stderr for failure classification
    goal_setting_stderr_capture="/tmp/goal-setting-stderr-$attempt.log"
    set +e
    run_goal_setting_agent 2>"$goal_setting_stderr_capture"
    goal_setting_last_exit=$?
    set -e
    attempt_end_time="$(date +%s.%N)"
    attempt_duration_sec=$(printf '%.1f' "$(printf '%s - %s\n' "$attempt_end_time" "$attempt_start_time" | bc -l 2>/dev/null || echo 0)")

    goal_setting_last_stderr="$(cat "$goal_setting_stderr_capture" 2>/dev/null || true)"
    if [ -n "$goal_setting_last_stderr" ] || [ "$goal_setting_last_exit" -ne 0 ]; then
      {
        printf '[attempt %d exit %d duration %.1fs timestamp %s]\n' "$attempt" "$goal_setting_last_exit" "$attempt_duration_sec" "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
        if [ -n "$goal_setting_last_stderr" ]; then
          printf '%s\n' "$goal_setting_last_stderr"
        else
          printf '(no stderr captured)\n'
        fi
      } >> "${KASEKI_RESULTS_DIR}/goal-setting-stderr.log"
      capture_provider_error_from_log "${KASEKI_RESULTS_DIR}/goal-setting-stderr.log" "goal-setting" || true
    fi
    rm -f "$goal_setting_stderr_capture"

    # Success on any attempt
    if [ "$goal_setting_last_exit" -eq 0 ]; then
      export KASEKI_GOAL_SETTING_ATTEMPTS=$attempt
      export KASEKI_GOAL_SETTING_SUCCEEDED_ON_ATTEMPT=$attempt
      clear_provider_error
      
      # Extract upgraded goal and replace TASK_PROMPT, BUT only if we didn't use fallback
      # (If fallback was used, preserve the original rich TASK_PROMPT for better downstream context)
      if [ "$GOAL_SETTING_FALLBACK_USED" != "1" ] && [ -f "$GOAL_SETTING_ARTIFACT" ]; then
        local upgraded_goal
        upgraded_goal="$(node -e 'try { const a=require("'"$GOAL_SETTING_ARTIFACT"'"); console.log(a.upgraded_goal || ""); } catch { console.log(""); }' 2>/dev/null || true)"
        if [ -n "$upgraded_goal" ]; then
          export TASK_PROMPT="$upgraded_goal"
          printf '[Goal-Setting Phase] Upgraded TASK_PROMPT\n'
        fi
      elif [ "$GOAL_SETTING_FALLBACK_USED" = "1" ]; then
        printf '[Goal-Setting Phase] Fallback artifact used; preserving original TASK_PROMPT for downstream agents\n'
      fi
      
      STATUS="$pre_goal_setting_status"
      FAILED_COMMAND="$pre_goal_setting_failed_command"
      clear_provider_error
      write_goal_setting_metrics "$goal_setting_phase_start_time" "$(date +%s)"
      return 0
    fi

    # Check if this is a transient failure worth retrying
    if is_transient_goal_setting_failure "$goal_setting_last_exit" "$goal_setting_last_stderr"; then
      if [ "$attempt" -lt "$max_attempts" ]; then
        printf '[Goal-Setting Phase] Transient failure detected (exit %d, %.1fs elapsed), retrying immediately...\n' "$goal_setting_last_exit" "$attempt_duration_sec"
        # Log retry decision with stderr snippet for debugging
        if [ -n "$goal_setting_last_stderr" ]; then
          printf '[Goal-Setting Phase] Retry reason: %s\n' "$(echo "$goal_setting_last_stderr" | head -1)" | head -c 200
        fi
        attempt=$((attempt + 1))
        # Reset goal-setting artifacts for retry
        rm -f "$GOAL_SETTING_ARTIFACT" "$GOAL_SETTING_RAW_EVENTS" 2>/dev/null || true
        rm -f "${KASEKI_RESULTS_DIR}"/goal-setting-validation-reason.txt 2>/dev/null || true
        continue
      fi
    else
      # Deterministic failure - do not retry
      local failure_reason
      failure_reason="$(classify_goal_setting_error "$goal_setting_last_exit" "$goal_setting_last_stderr")"
      printf '[Goal-Setting Phase] Deterministic failure (exit %d: %s), not retrying\n' "$goal_setting_last_exit" "$failure_reason"
      export KASEKI_GOAL_SETTING_ATTEMPTS=$attempt
      export KASEKI_GOAL_SETTING_SUCCEEDED_ON_ATTEMPT=""
      # Fall through to use original TASK_PROMPT without letting optional failures
      # affect the final run status.
      STATUS="$pre_goal_setting_status"
      FAILED_COMMAND="$pre_goal_setting_failed_command"
      write_goal_setting_metrics "$goal_setting_phase_start_time" "$(date +%s)"
      return 0
    fi

    attempt=$((attempt + 1))
  done

  # Max attempts exhausted - use original TASK_PROMPT
  export KASEKI_GOAL_SETTING_ATTEMPTS=$max_attempts
  export KASEKI_GOAL_SETTING_SUCCEEDED_ON_ATTEMPT=""
  local total_goal_setting_duration
  total_goal_setting_duration=$(($(date +%s) - goal_setting_phase_start_time))
  printf '[Goal-Setting Phase] Max retry attempts exhausted (exit %d after %ds), using original TASK_PROMPT\n' "$goal_setting_last_exit" "$total_goal_setting_duration"
  
  # Write structured failure diagnostics to goal-setting-validation-errors.jsonl
  node -e '
    const fs = require("fs");
    const [
      errorsPath,
      goalSettingExit,
      maxAttempts,
      totalDurationSeconds,
      timeoutSeconds,
      model,
      stderrTail,
    ] = process.argv.slice(1);
    const entry = {
      timestamp: new Date().toISOString(),
      phase: "goal-setting",
      exit_code: Number(goalSettingExit),
      attempts: Number(maxAttempts),
      total_duration_seconds: Number(totalDurationSeconds),
      timeout_seconds: Number(timeoutSeconds),
      model,
      reason: "max_retry_attempts_exhausted",
      stderr_tail: stderrTail,
      fallback_to_original_prompt: true
    };
    const content = (fs.existsSync(errorsPath) ? fs.readFileSync(errorsPath, "utf8") : "") + JSON.stringify(entry) + "\n";
    fs.writeFileSync(errorsPath, content);
  ' \
    "${KASEKI_RESULTS_DIR}/goal-setting-validation-errors.jsonl" \
    "$goal_setting_last_exit" \
    "$max_attempts" \
    "$total_goal_setting_duration" \
    "${KASEKI_GOAL_SETTING_TIMEOUT_SECONDS:-300}" \
    "${GOAL_SETTING_ACTUAL_MODEL:-unknown}" \
    "$(printf '%s' "$goal_setting_last_stderr" | tail -c 400)" \
    2>/dev/null || true
  
  STATUS="$pre_goal_setting_status"
  FAILED_COMMAND="$pre_goal_setting_failed_command"
  clear_provider_error
  write_goal_setting_metrics "$goal_setting_phase_start_time" "$(date +%s)"
  return 0
}

is_transient_scouting_failure() {
  local exit_code="$1"
  local stderr_content="$2"

  # First, check if we have an explicit validation reason code from our helper
  if [ -f "${KASEKI_RESULTS_DIR}"/scouting-validation-reason.txt ]; then
    local reason_code
    reason_code=$(cat "${KASEKI_RESULTS_DIR}"/scouting-validation-reason.txt 2>/dev/null || echo "")
    case "$reason_code" in
      valid)
        # This shouldn't happen when exit_code=86, but just in case
        return 1
        ;;
      schema_mismatch|malformed_json|missing_required_fields|missing_file)
        # Deterministic failures - do not retry
        return 1
        ;;
    esac
  fi

  # Exit code 124 = timeout (transient, retryable)
  if [ "$exit_code" -eq 124 ]; then
    return 0
  fi

  # Exit code 86 = local validation failure (deterministic, not retryable)
  if [ "$exit_code" -eq 86 ]; then
    return 1
  fi

  # Exit code 88 = provider/model error (deterministic until model/config changes)
  if [ "$exit_code" -eq 88 ]; then
    return 1
  fi

  # Exit code 2 = missing config/API key (not retryable)
  if [ "$exit_code" -eq 2 ]; then
    return 1
  fi

  # Check for deterministic schema/validation errors first
  if echo "$stderr_content" | grep -qi -E "schema|validation|invalid.?json|malformed" 2>/dev/null; then
    return 1  # Deterministic (do not retry)
  fi

  # Check for Pi CLI errors in stderr (transient LLM/network issues)
  if echo "$stderr_content" | grep -qi -E "error|failed|connection|timeout|rate.?limit|api.?error" 2>/dev/null; then
    return 0  # Transient (retry)
  fi

  # Pi non-zero exit (transient, could be model unavailability)
  if [ "$exit_code" -ne 0 ]; then
    return 0  # Transient (retry)
  fi

  # Exit code 0 but validation failed = deterministic
  return 1
}

# Phase 2.1: Detect if task requires detailed guidance (parser, events, serialization, etc.)
# Returns 0 if complex task, 1 if simple task
is_complex_change_task() {
  local task_text="$1"
  # Check for keywords indicating complex changes that need detailed test_impact guidance
  if printf '%s\n' "$task_text" | grep -qiE '(parser|regex|serializ|event|listen|emit|field|schema|format|type.*change|response|construct|enum|constant|rename|refactor.*[a-z]{3,})' 2>/dev/null; then
    return 0  # Complex task
  fi
  return 1  # Simple task (bug fix, documentation, etc.)
}

is_docs_only_task() {
  local task_text="$1"
  if printf '%s\n' "$task_text" | grep -qiE '(docs?/|README|CHANGELOG|documentation|markdown|\\.md|index\\.md)' 2>/dev/null &&
     ! printf '%s\n' "$task_text" | grep -qiE '(parser|api|endpoint|runtime|code|test|typescript|javascript|schema|event|provider|gateway|auth|database|server|client)' 2>/dev/null; then
    return 0
  fi
  return 1
}

record_prompt_diagnostics() {
  local phase="$1"
  local prompt="$2"
  local model="$3"
  local max_output_tokens="${4:-}"
  local prompt_file

  prompt_file="$(mktemp 2>/dev/null || printf '/tmp/kaseki-prompt-diagnostics-%s.txt' "$$")"
  printf '%s' "$prompt" > "$prompt_file" 2>/dev/null || return 0
  node - "$KASEKI_RESULTS_DIR/prompt-diagnostics.jsonl" "$phase" "$model" "$max_output_tokens" "$prompt_file" <<'NODE' 2>/dev/null || true
const fs = require('node:fs');
const [file, phase, model, maxOutputTokens, promptFile] = process.argv.slice(2);
const prompt = fs.readFileSync(promptFile, 'utf8');
const entry = {
  timestamp: new Date().toISOString(),
  phase,
  model,
  prompt_chars: prompt.length,
  prompt_bytes: Buffer.byteLength(prompt, 'utf8'),
  estimated_prompt_tokens: Math.ceil(prompt.length / 4),
  max_output_tokens: maxOutputTokens ? Number(maxOutputTokens) : null,
  stream: true,
  tool_count: 4,
};
fs.appendFileSync(file, JSON.stringify(entry) + '\n');
NODE
  rm -f "$prompt_file" 2>/dev/null || true
}

build_scouting_prompt() {
  local task_text="$TASK_PROMPT"
  local use_detailed_guidance=0
  local use_compact_guidance=1
  local caveman_instruction
  caveman_instruction="$(get_caveman_instruction)"
  
  # Keep scouting prompts compact by default. Verbose guidance is opt-in for
  # local debugging or hard tasks where prompt size is less important.
  if [ "$KASEKI_SCOUTING_PROMPT_DETAIL" = "verbose" ] && is_complex_change_task "$task_text"; then
    use_compact_guidance=0
    use_detailed_guidance=1
  fi
  
  # Prepend caveman instruction if enabled
  if [ -n "$caveman_instruction" ]; then
    printf '%s\n\n' "$caveman_instruction"
  fi
  
  if [ "$use_compact_guidance" -eq 1 ]; then
    cat <<'SCOUTING_COMPACT'
You are a read-only scouting Pi agent inside a Kaseki-managed ephemeral workspace.

Inspect only files needed to scope the task. Do not edit files, tests, lockfiles, git state, secrets, or environment variables.

Use the write tool to write exactly one JSON object to $SCOUTING_CANDIDATE_ARTIFACT. Do not rely on final assistant text for the artifact.

JSON fields:
- task: concise actionable task string
- requirements: 3-8 concrete requirements
- relevant_files: 2-10 repo-relative files with reasons
- observations: concrete facts from inspection
- plan: 3-8 coding steps for the downstream agent
- validation: 1-5 focused checks
- risks: known risks or empty array
- test_impact: empty for pure documentation-only changes, otherwise affected tests
- critical_change_expectations: include required_files and forbidden_empty_diff when concrete
- suggested_allowlist: agent_patterns and validation_patterns arrays

For code behavior changes, include impacted tests in test_impact. For renames, parser/output changes, events, schemas, or API fields, include concrete test files and expected assertion patterns. For documentation-only changes, test_impact may be [].

Keep JSON under 20 KB. Prefer accuracy over exhaustiveness.
SCOUTING_COMPACT
  else
    # Build base prompt (always included)
    cat <<'SCOUTING_BASE'
You are a read-only scouting Pi agent inside a Kaseki-managed ephemeral workspace.

## [ROLE]

Research the task before a separate coding agent starts. Your job is to analyze the repository, understand the task scope, and produce a structured JSON artifact that helps a downstream coding agent execute the task efficiently and correctly.

## [OPERATIONAL CONSTRAINTS - Read-Only Phase]

- Inspect the repository and relevant files needed to understand the task.
- Do not edit source files, tests, lockfiles, or git state.
- Do not run git add, git commit, git push, gh, hub, package installation, or validation commands that modify files.
- Do not print, inspect, or expose environment variables, secrets, credentials, API keys, or mounted secret files.
- The repository tree is read-only during scouting. Use the write tool to write exactly one JSON object to $SCOUTING_CANDIDATE_ARTIFACT. Do not rely on final assistant text for the artifact.

The JSON object must be concise and useful to the coding agent. Use this schema-style shape (field descriptions only; do not copy this text as output):
- task: string (max 200 characters); a concrete interpretation of the requested task.
  - Examples: "Fix null-safety in parseRole()", "Add JWT auth to src/auth/middleware.ts"
  - Constraint: Restate original request concisely; must be actionable by a developer
  - Too vague: "Make it better", "Improve code quality"
- requirements: array of 3-8 strings; concrete, testable requirements derived from the task.
  - Example: ["Handle null role parameter without throwing", "Maintain backward compatibility", "Pass all existing tests"]
  - Constraint: Each must be independently verifiable; avoid generic items like "code quality"
  - Min items: 3 (too few suggests incomplete analysis)
  - Max items: 8 (too many suggests scope creep or lack of prioritization)
- relevant_files: array of 5-20 objects with path and reason strings; repo-relative files and why each matters.
  - Example: {"path": "src/lib/role.ts", "reason": "Contains parseRole() function being modified"}
  - Constraint: Include source files, test files, and config files affected by changes
  - Min items: 5 (suggests incomplete file discovery)
  - Max items: 20 (keeps focus on high-impact files; truncate if >20 with "(...X more files)"
  - Prioritize: files the agent will modify first, then affected tests, then supporting config
- observations: array of strings; concrete facts learned from repository inspection (git structure, build config, test framework, etc.).
  - Helps coding agent understand project structure without re-scanning
  - Truncate with "(...truncated for brevity)" if approaching size limit
- plan: array of 5-15 strings; ordered, task-specific coding steps.
  - Example step: "Add null check at start of parseRole() function"
  - Constraint: No "finish" or "verify" steps; steps should be concrete code changes only
  - Min items: 5 (too few suggests incomplete breakdown)
  - Max items: 15 (too many suggests lack of higher-level grouping)
  - Each step should be independently reviewable
- validation: array of 2-10 strings; focused commands or checks appropriate for this task.
  - Examples: "npm run test tests/role.test.ts", "npm run lint -- src/lib/role.ts"
  - Constraint: Commands must exist in package.json or run without modification
  - Min items: 2 (suggests incomplete validation strategy)
  - Max items: 10 (avoid over-testing; focus on core validation)
  - Avoid: generic "npm test" if specific tests are known
- risks: array of 0-10 strings; concrete unknowns, boundary conditions, or task assumptions.
  - Example: "Unclear whether null should be treated as fallback or error"
  - Empty array is acceptable if no known risks
  - Constraint: Each risk should suggest remediation or investigation
- test_impact: array of objects with path, reason, and optional test_examples; describes test coverage implications.
  - Constraint: MUST include entries for files affected by task (no empty array unless task is pure inspection)
  - Max per file: 5 test_examples (keep focused on key patterns)
  - See detailed guidelines below for comprehensive patterns by change type
- critical_change_expectations: optional object with required_files, required_search_strings, forbidden_empty_diff.
  - Only include if concrete expected changes can be identified
  - required_files: array of repo-relative paths that MUST appear in git diff
  - required_search_strings: array of literal strings expected in git diff (e.g., function name, config key)
  - forbidden_empty_diff: boolean; true if task is a change request, false if read-only inspection
  - Constraint: Omit if uncertain; this is enforced before goal-check evaluation
- suggested_allowlist: object with agent_patterns and validation_patterns arrays.
  - agent_patterns: glob patterns narrowing which files coding agent can modify (e.g., "src/**/*.ts")
  - validation_patterns: glob patterns for files validation commands may modify (often same as agent_patterns)
  - Constraint: Empty arrays acceptable if task scope is unclear; prefer specificity over convenience

Output rules for the JSON artifact:
- Do not copy the example text or this field description.
- Every string must be concrete to the task (no generic guidance).
- Use empty arrays only for optional fields (risks, test_impact) when genuinely no items apply.
- Prioritize: task clarity > requirement specificity > relevant_files accuracy
- Total JSON size must not exceed 50 KB (truncate observations or relevant_files if necessary).

## [TASK VALIDATION - Ensure Task is Valid Before Scouting]

Before proceeding with repository inspection, validate that the task is concrete and scoping is possible:

**Valid tasks** (proceed with scouting):
- ✓ "Fix null-safety in parseRole() function in src/lib/role.ts"
- ✓ "Add TypeScript type annotations to src/config/loader.ts"
- ✓ "Implement JWT authentication in src/auth/middleware.ts and update tests"
- ✓ "Rename parseConfig to loadConfigFromFile across src/lib and tests"

**Ambiguous/Invalid tasks** (ask clarifying questions):
- ✗ "Make the code better" → Too vague. Ask: Which file(s)? What specific improvement?
- ✗ "Fix bugs" → No scope. Ask: Which bugs? Which files contain them?
- ✗ "Refactor everything" → Unbounded. Ask: Which components? What metrics define success?

**Success Criteria for Scouting**:
Your scouting artifact is successful when:
1. The task field clearly restates the original request in concrete, actionable language
2. requirements list 3-8 specific, testable requirements
3. relevant_files includes 5-20 files with clear rationales
4. plan has 5-15 distinct coding steps (no step is "finish")
5. test_impact identifies 80%+ of files that will be affected by code changes
6. critical_change_expectations, when present, includes concrete search strings
7. JSON size is <50 KB and completes scouting within 2 minutes

**When to Ask Clarifying Questions**:
If the task is ambiguous or lacks sufficient scope information, do NOT proceed with scouting. Instead, write a minimal JSON artifact with:
- task: "[UNCLEAR - needs clarification]"
- requirements: ["Clarify which files are in scope", "Specify concrete acceptance criteria", "Define what done means"]
- relevant_files: []
- observations: ["Task prompt was: <original prompt>", "Unable to scope repository changes without more context"]
- plan: ["Await clarification from user"]
- validation: []
- risks: ["Task scope is undefined; scouting may make incorrect assumptions"]
- test_impact: []
- suggested_allowlist: {agent_patterns: [], validation_patterns: []}

Guidelines for test_impact:

**When to Include test_impact**:
- ALWAYS include test_impact entries for code that affects parsing, validation, output formatting, naming, event structure, or serialization
- Include entries for files with test cases that assert on concrete implementation details (field names, value types, timing)
- Include entries when task modifies constants, enum values, API method names, or data structures

**When test_impact Can Be Empty**:
- ✓ Pure documentation updates (README, comments) with no code changes
- ✓ Build configuration changes that don't affect runtime behavior
- ✓ Dependency upgrades where public API is unchanged
- ✓ File reorganization (move/rename) without behavioral changes
- ✓ Infrastructure changes (Docker, CI/CD) unrelated to application code
- In all other cases: provide at least 1 test_impact entry with concrete examples

**test_examples Field Structure**:
- **type**: "added_assertion", "modified_assertion", "added_test_case", or "added_pattern"
- **before**: Current or expected-to-fail assertion/test code (1-2 lines max)
- **after**: Corrected/new assertion/test code (1-2 lines max)
- **pattern**: Short name of the pattern (e.g., "Null-coalescing assertion", "Event field presence")
- **description**: 1-2 sentences explaining why this change matters
- Max 5 test_examples per file (keep focused on key patterns; avoid exhaustive lists)
SCOUTING_BASE
  fi

  # Conditionally include detailed guidance for complex tasks
  if [ $use_detailed_guidance -eq 1 ]; then
    cat <<'SCOUTING_DETAILED'

**Enhanced Guidelines by Change Type** (with 5+ concrete patterns each):

1. **Parser & Validation Changes** (keywords: parse, validate, input, null safety, type checking)
   - Detection keywords: parse, parser, regex, validation, sanitize, decode, input handling, edge cases
   - Test files to check: tests/parser.test.ts, tests/validation.test.ts, tests/sanitization.test.ts
   - Common test_impact patterns:
     a) Null/undefined handling: expect().toThrow() → expect().toEqual() or vice versa
     b) Empty string/whitespace: test edge cases like "", "   ", "\\n\\t"
     c) Type coercion: number-to-string, boolean-to-string conversions in parsing
     d) Regex pattern changes: test cases that should now match or no longer match
     e) Error message changes: expect(error.message).toContain("old") → .toContain("new")
     f) Boundary value testing: min/max values, overflow conditions
   - Example test_examples:
     ✓ Null safety: {"type": "modified_assertion", "before": "expect(parse(null)).toThrow()", "after": "expect(parse(null)).toEqual(defaults())", "pattern": "Null-safe fallback", "description": "Function now handles null as valid input with sensible defaults"}
     ✓ Whitespace: {"type": "added_assertion", "before": "N/A", "after": "expect(parse('  \\t  ')).toEqual(parse(''))", "pattern": "Whitespace normalization", "description": "Input parsing now treats whitespace as empty"}
     ✓ Type coercion: {"type": "modified_assertion", "before": "expect(parseNumber('42px')).toThrow()", "after": "expect(parseNumber('42px')).toBe(42)", "pattern": "Unit stripping", "description": "Parser now extracts numeric portion"}

2. **Event Handling & Progress Changes** (keywords: event, emit, listener, signal, progress, field)
   - Detection keywords: event, emit, listener, on, once, signal, progress, stage, timing, field name
   - Test files to check: tests/event-handler.test.ts, tests/progress.test.ts, tests/listeners.test.ts
   - Common test_impact patterns:
     a) Event structure changes: new/removed/renamed fields in emitted event objects
     b) Timing expectations: synchronous → async or vice versa, timeout thresholds
     c) Field presence: assert listener receives expected event properties
     d) Event ordering: sequence of event emissions, promises/callbacks
     e) Listener registration: changes to addEventListener, on, once API
     f) Error event handling: error events now emitted for certain conditions
   - Example test_examples:
     ✓ Event field: {"type": "added_assertion", "before": "listener(event); expect(event.stage).toBeDefined()", "after": "listener(event); expect(event.stage).toContain('SCOUTING')", "pattern": "Event field presence", "description": "New stage field now always present in event"}
     ✓ Async timing: {"type": "modified_assertion", "before": "await done; // within 50ms", "after": "await done; // within 500ms", "pattern": "Async emission delay", "description": "Event emission now batches async; increased timeout"}
     ✓ Error event: {"type": "added_test_case", "before": "// No error event handling", "after": "emitter.on('error', handler); trigger(); expect(handler).toHaveBeenCalled()", "pattern": "Error event emission", "description": "New error events emitted for recoverable failures"}

3. **Response Construction & Serialization Changes** (keywords: serialize, format, response, construct, transform, payload)
   - Detection keywords: response, serialize, serialize, format, construct, map, transform, output, payload, toJSON, stringify
   - Test files to check: tests/response.test.ts, tests/serialization.test.ts, tests/format.test.ts
   - Common test_impact patterns:
     a) Field name changes: response.old_field → response.newField
     b) Field type changes: string → object, number → string, array → map
     c) Nested structure changes: flat response → nested, vice versa
     d) Omit/include behavior: fields now optional or always present
     e) Serialization format: JSON, JSONL, CSV, binary encoding changes
     f) Round-trip assertions: serialize/deserialize preserves values
   - Example test_examples:
     ✓ Field rename: {"type": "modified_assertion", "before": "expect(response.status_code).toBe(200)", "after": "expect(response.statusCode).toBe(200)", "pattern": "camelCase migration", "description": "Response fields now use camelCase convention"}
     ✓ Type change: {"type": "modified_assertion", "before": "expect(typeof response.metadata).toBe('string')", "after": "expect(typeof response.metadata).toBe('object')", "pattern": "Structured metadata", "description": "Metadata now structured object instead of serialized string"}
     ✓ Round-trip: {"type": "added_assertion", "before": "N/A", "after": "const original = {...}; const restored = deserialize(serialize(original)); expect(restored).toEqual(original)", "pattern": "Serialization round-trip", "description": "Serialize/deserialize cycle must preserve all fields"}

4. **Naming Conventions & Constants Changes** (keywords: rename, constant, enum, field name, identifier)
   - Detection keywords: rename, constant, enum, identifier, symbol, property name, method name, migrate naming
   - Test files to check: tests/**/*.test.ts (grep for old constants/names)
   - Common test_impact patterns:
     a) Constant value changes: OLD_VALUE = "x" → NEW_VALUE = "y"
     b) Enum migrations: Color.RED → Color.PRIMARY_RED
     c) API method renames: .oldMethod() → .newMethod()
     d) Export name changes: export MyClass → export MyClassV2
     e) Configuration key changes: config.old_key → config.newKey
     f) String literal assertions: ".toContain('oldName')" → ".toContain('newName')"
   - Example test_examples:
     ✓ Constant rename: {"type": "modified_assertion", "before": "expect(TIMEOUT_MS).toBe(5000)", "after": "expect(SCOUTING_TIMEOUT_MS).toBe(120000)", "pattern": "Constant renaming & value change", "description": "Timeout constant renamed and value updated"}
     ✓ Enum value: {"type": "modified_assertion", "before": "expect(phase).toBe('PARSE')", "after": "expect(phase).toBe('SCOUTING')", "pattern": "Enum value rename", "description": "Phase name updated to match new phase names"}
     ✓ API method: {"type": "modified_assertion", "before": "instance.configure(); expect(result).toBe(true)", "after": "instance.setup(); expect(result).toBe(true)", "pattern": "Method rename", "description": "API method renamed for clarity"}

5. **Configuration & Multi-file Patterns** (keywords: config, multi-file, cross-module, integration)
   - Detection keywords: config, configuration, settings, environment, multi-file changes, cross-repo coordination
   - Test files to check: tests/integration.test.ts, tests/config.test.ts, tests/e2e.test.ts
   - Common test_impact patterns:
     a) Configuration schema changes: new required fields, deprecated fields
     b) Multi-file coordination: one change requires updates in 3+ test files
     c) Integration points: mocking changes, stub contracts
     d) Allowlist/blocklist changes: file patterns affect test file discovery
     e) Build-time vs runtime: constants vs environment variable changes
   - Example test_examples:
     ✓ Config schema: {"type": "added_assertion", "before": "config = loadConfig(); expect(config.timeout).toBeDefined()", "after": "config = loadConfig(); expect(config.timeout).toBeGreaterThan(0); expect(config.retries).toBeDefined()", "pattern": "Config schema expansion", "description": "New required config fields must be validated"}
     ✓ Multi-file: {"type": "added_test_case", "before": "// Only single file tested", "after": "// Test mocking across src/a.ts, src/b.ts, tests/mock-factory.ts", "pattern": "Integration mocking", "description": "Mock strategy now affects multiple test files"}

SCOUTING_DETAILED
  elif [ "$use_compact_guidance" -eq 0 ]; then
    # For simple tasks, include minimal guidance
    cat <<'SCOUTING_MINIMAL'

**Minimal test_impact Guidelines** (for simple bug fixes and documentation):
- Include test_impact for any code changes affecting behavior, especially: null/undefined handling, error cases, field names, timing
- Empty test_impact is acceptable only for pure documentation, build config, or dependency updates with no behavioral changes
- Max 2-3 test_examples per file; keep focused on key changes
SCOUTING_MINIMAL
  fi
  
  # Common section included for all complexity levels
  if [ "$use_compact_guidance" -eq 0 ]; then
    cat <<EOF

**Examples of Strong test_impact Entries**:
✓ Parser change:
  {"path": "tests/parser.test.ts", "reason": "parseRole() function now handles null with fallback", "test_examples": [{"type": "added_assertion", "pattern": "Null-coalescing", "before": "expect(parseRole(null)).toThrow(NullReferenceError)", "after": "expect(parseRole(null)).toEqual({ name: 'Unnamed', level: 0 })", "description": "Null now treated as valid input with sensible defaults"}]}

✓ Event change:
  {"path": "tests/event-handler.test.ts", "reason": "Event emission now async with new timing", "test_examples": [{"type": "modified_assertion", "pattern": "Async timing", "before": "await eventPromise; // resolves within 10ms", "after": "await eventPromise; // resolves within 100ms (now batched)", "description": "Async batching adds latency; timeout increased"}]}

✓ Serialization change:
  {"path": "tests/response.test.ts", "reason": "Response fields now use camelCase", "test_examples": [{"type": "modified_assertion", "pattern": "camelCase fields", "before": "expect(response.status_code).toBe(200)", "after": "expect(response.statusCode).toBe(200)", "description": "All response field names migrated to camelCase"}]}

✓ Config change:
  {"path": "tests/config.test.ts", "reason": "New required config fields added", "test_examples": [{"type": "added_assertion", "pattern": "Schema validation", "before": "expect(config).toHaveProperty('timeout')", "after": "expect(config).toHaveProperty('timeout'); expect(config).toHaveProperty('maxRetries'); expect(config).toHaveProperty('backoffMs')", "description": "Three new retry-related fields now required"}]}

Guidelines for critical_change_expectations:
- Include critical_change_expectations when scouting can identify concrete files or literal diff evidence that must change for the goal to be real.
- required_files must be repo-relative paths and should only list files that must appear in changed-files.txt, not files that are merely relevant for reading.
- required_search_strings must be literal strings expected to appear in git.diff, such as a new function name, config key, assertion text, or diff hunk marker.
- Set forbidden_empty_diff to true when the task is a patch/change request rather than read-only inspection.
- Omit uncertain expectations rather than guessing; this contract is enforced before the LLM goal-check evaluator runs.

Guidelines for suggested_allowlist:
- agent_patterns: Glob patterns narrowing which files the coding agent can modify. Use specific files (e.g., "src/parser.ts") or directories (e.g., "src/**", "tests/**"). If many related files, use broad patterns like "src/**.ts".
- validation_patterns: Glob patterns for files that validation commands (npm test, npm run lint, etc.) may legitimately modify. Often identical to agent_patterns, but may differ (e.g., allow ".coverage" or "node_modules/" if generated during validation).
- Both arrays can be empty if the task scope is unclear; the coding agent will work without allowlist constraints.
- Prefer accurate scope over convenience: too-broad patterns defeat the purpose; too-narrow patterns will require restoration.

## [EXECUTION CONTEXT - Optimize for Efficiency]

**Timeouts**:
- Scouting should complete within 2 minutes total.
- Avoid deep directory recursion (git log, file enumeration across 1000+ files, slow regex searches).
- Use fast commands: find, grep, head (instead of cat for large files).

**Artifact Size Constraints**:
- Maximum JSON size: 50 KB.
- If observations or relevant_files grow large, prioritize the most important ones.
- Truncate observations with "(...truncated for brevity)" if approaching size limit.

**Error Handling**:
- If repository inspection fails (unreadable files, malformed code), report the error in observations and proceed with limited scope.
- Example: "Unable to parse src/config.json due to syntax error; focusing on src/lib instead."
- Do not fail the entire scouting phase due to isolated file read errors; adapt and continue.

## [ORIGINAL TASK PROMPT FOR REFERENCE]

See goal-setting artifact ($GOAL_SETTING_ARTIFACT) if available for upgraded goal with SMART criteria, anti-patterns, and constraints. Otherwise, use the original task prompt below.

Original task (before goal-setting upgrade):
$TASK_PROMPT
EOF
  else
    cat <<EOF

## [ORIGINAL TASK PROMPT]

$TASK_PROMPT
EOF
  fi
}

run_scouting_agent() {
  local scouting_prompt scouting_start scout_dirty_before scout_dirty_after

  printf '\n==> pi scouting agent\n'
  set_current_stage "pi scouting agent"
  if [ "$KASEKI_SCOUTING" = "0" ]; then
    printf 'Pi scouting agent skipped because KASEKI_SCOUTING=0.\n'
    record_stage_timing "pi scouting agent" 0 0 "skipped_by_config"
    return 0
  fi
  if [ "$KASEKI_DRY_RUN" = "1" ]; then
    printf 'DRY-RUN: Pi scouting agent would inspect the task before coding.\n'
    record_stage_timing "pi scouting agent" 0 0 "dry_run=true"
    return 0
  fi

  scouting_prompt="$(build_scouting_prompt)"
  record_prompt_diagnostics "scouting" "$scouting_prompt" "$KASEKI_SCOUTING_MODEL" "$KASEKI_SCOUTING_MAX_OUTPUT_TOKENS"
  scouting_start="$(date +%s)"
  scout_dirty_before="$(git status --porcelain 2>/dev/null || true)"
  chmod -R a-w "${KASEKI_WORKSPACE_DIR}"/repo 2>/dev/null || true
  set +e
  LLM_GATEWAY_MAX_OUTPUT_TOKENS="$KASEKI_SCOUTING_MAX_OUTPUT_TOKENS"
  export LLM_GATEWAY_MAX_OUTPUT_TOKENS
  run_pi_with_retry "$SCOUTING_RAW_EVENTS" "$KASEKI_SCOUTING_TIMEOUT_SECONDS" "$KASEKI_SCOUTING_MODEL" "$scouting_prompt" "scouting-summary" "" "scouting"
  SCOUTING_EXIT="$?"
  SCOUTING_DURATION_SECONDS=$(($(date +%s) - scouting_start))
  unset scouting_prompt LLM_GATEWAY_API_KEY LLM_GATEWAY_URL LLM_GATEWAY_MAX_OUTPUT_TOKENS
  set +e
  chmod -R u+w "${KASEKI_WORKSPACE_DIR}"/repo 2>/dev/null || true

  # Artifact recovery: if artifact file doesn't exist, try to recover from event stream
  if [ "$SCOUTING_EXIT" -eq 0 ] && [ ! -f "$SCOUTING_CANDIDATE_ARTIFACT" ]; then
    run_artifact_recovery_helper "scouting" "$SCOUTING_RAW_EVENTS" "$SCOUTING_CANDIDATE_ARTIFACT" "$KASEKI_RESULTS_DIR" >/dev/null 2>&1 || true
  fi

  kaseki-pi-event-filter "$SCOUTING_RAW_EVENTS" "${KASEKI_RESULTS_DIR}"/scouting-events.jsonl "${KASEKI_RESULTS_DIR}"/scouting-summary.json 2>/dev/null || cp "$SCOUTING_RAW_EVENTS" "${KASEKI_RESULTS_DIR}"/scouting-events.raw.jsonl 2>/dev/null || true
  SCOUTING_FALLBACK_USED=0
  if capture_provider_error_from_summary "${KASEKI_RESULTS_DIR}/scouting-summary.json" "scouting"; then
    if [ "$PROVIDER_ERROR_TYPE" = "provider_empty_assistant_turn" ]; then
      emit_error_event "$PROVIDER_ERROR_TYPE" "Scouting provider returned an empty assistant turn; continuing with conservative fallback" "continue"
      append_pre_coding_provider_fallback_error "${KASEKI_RESULTS_DIR}/scouting-validation-errors.jsonl" "scouting" "fallback_scouting_artifact" "$SCOUTING_ARTIFACT"
      rm -f "$SCOUTING_CANDIDATE_ARTIFACT" 2>/dev/null || true
      write_scouting_fallback_artifact "$SCOUTING_CANDIDATE_ARTIFACT"
      SCOUTING_FALLBACK_USED=1
      SCOUTING_EXIT=0
    else
      SCOUTING_EXIT=88
      emit_error_event "$PROVIDER_ERROR_TYPE" "Scouting provider error: $PROVIDER_ERROR_MESSAGE" "exit"
    fi
  fi

  if [ "$SCOUTING_EXIT" -eq 0 ] && [ "$KASEKI_TASK_MODE" = "inspect" ] && [ ! -f "$SCOUTING_CANDIDATE_ARTIFACT" ]; then
    write_scouting_fallback_artifact "$SCOUTING_CANDIDATE_ARTIFACT"
    SCOUTING_FALLBACK_USED=1
  fi

  if [ "$SCOUTING_EXIT" -eq 0 ] && ! validate_scouting_artifact "$SCOUTING_CANDIDATE_ARTIFACT" "$SCOUTING_ARTIFACT" "${KASEKI_RESULTS_DIR}/scouting-validation-reason.txt"; then
    if [ "$KASEKI_TASK_MODE" = "patch" ]; then
      rm -f "$SCOUTING_CANDIDATE_ARTIFACT" 2>/dev/null || true
      write_scouting_fallback_artifact "$SCOUTING_CANDIDATE_ARTIFACT"
      SCOUTING_FALLBACK_USED=1
      if ! validate_scouting_artifact "$SCOUTING_CANDIDATE_ARTIFACT" "$SCOUTING_ARTIFACT" "${KASEKI_RESULTS_DIR}/scouting-validation-reason.txt"; then
        SCOUTING_EXIT=86
        scouting_validation_error="$(tail -1 "${KASEKI_RESULTS_DIR}"/scouting-validation-errors.jsonl 2>/dev/null | jq -r '.details // .reason_code // "validation failed"' 2>/dev/null || printf 'scouting artifact validation failed')"
        emit_error_event "pi_scouting_artifact_invalid" "Pi scouting handoff invalid after fallback: $scouting_validation_error (full details: ${KASEKI_RESULTS_DIR}/scouting-validation-errors.jsonl)" "exit"
      else
        mark_scouting_fallback_recovered "patch_fallback_recovered"
        emit_error_event "pi_scouting_artifact_invalid" "Pi scouting handoff invalid; continuing with conservative patch fallback (full details: ${KASEKI_RESULTS_DIR}/scouting-validation-errors.jsonl)" "continue"
      fi
    else
      SCOUTING_EXIT=86
      scouting_validation_error="$(tail -1 "${KASEKI_RESULTS_DIR}"/scouting-validation-errors.jsonl 2>/dev/null | jq -r '.details // .reason_code // "validation failed"' 2>/dev/null || printf 'scouting artifact validation failed')"
      emit_error_event "pi_scouting_artifact_invalid" "Pi scouting handoff invalid: $scouting_validation_error (full details: ${KASEKI_RESULTS_DIR}/scouting-validation-errors.jsonl)" "exit"
    fi
  fi
  if [ "$SCOUTING_EXIT" -eq 0 ] && [ "${SCOUTING_FALLBACK_USED:-0}" -eq 1 ]; then
    mark_scouting_fallback_recovered "${KASEKI_TASK_MODE}_fallback_recovered"
  fi
  scout_dirty_after="$(git status --porcelain 2>/dev/null || true)"
  if [ "$SCOUTING_EXIT" -eq 0 ] && [ "$scout_dirty_before" != "$scout_dirty_after" ]; then
    SCOUTING_EXIT=86
    emit_error_event "pi_scouting_workspace_modified" "Read-only scouting changed repository state before coding" "exit"
  fi
  rm -f "$SCOUTING_CANDIDATE_ARTIFACT"
  git reset --hard -q HEAD 2>/dev/null || true
  git clean -fd -q 2>/dev/null || true
  # Phase 3A: Consolidate scouting summary to all-phase-summaries.json
  append_phase_summary "${KASEKI_RESULTS_DIR}"/all-phase-summaries.json "scouting" "${KASEKI_RESULTS_DIR}"/scouting-summary.json
  SCOUTING_ACTUAL_MODEL="$(node -e 'try { const s=require(process.env.KASEKI_RESULTS_DIR + "/scouting-summary.json"); const v=String(s.selected_model || s.model || "").trim(); console.log(v && v !== "unknown" && v !== "null" ? v : "unknown"); } catch { console.log("unknown"); }' 2>/dev/null)"
  record_stage_timing "pi scouting agent" "$SCOUTING_EXIT" "$SCOUTING_DURATION_SECONDS" "artifact=$SCOUTING_ARTIFACT timeout_seconds=$KASEKI_SCOUTING_TIMEOUT_SECONDS"
  if [ "$SCOUTING_EXIT" -ne 0 ]; then
    STATUS="$SCOUTING_EXIT"
    FAILED_COMMAND="pi scouting agent"
    emit_error_event "pi_scouting_failed" "Scouting agent exited before the coding agent: $SCOUTING_EXIT" "exit"
    return "$SCOUTING_EXIT"
  fi
  emit_progress "pi scouting agent" "wrote scouting artifact"
  # Clean up validation reason file on success
  rm -f "${KASEKI_RESULTS_DIR}"/scouting-validation-reason.txt 2>/dev/null || true
  return 0
}

run_scouting_agent_with_retry() {
  local attempt scouting_stderr_capture max_attempts scouting_last_exit scouting_last_stderr

  max_attempts=2
  attempt=1
  scouting_last_exit=0
  scouting_last_stderr=""

  # Initialize scouting retry tracking env vars
  export KASEKI_SCOUTING_ATTEMPTS=0
  export KASEKI_SCOUTING_SUCCEEDED_ON_ATTEMPT=""
  export KASEKI_SCOUTING_ERRORS=""

  while [ "$attempt" -le "$max_attempts" ]; do
    printf '[Scouting Phase] Attempt %d/%d\n' "$attempt" "$max_attempts"

    # Capture stderr for failure classification
    scouting_stderr_capture="/tmp/scouting-stderr-$attempt.log"
    set +e
    run_scouting_agent 2>"$scouting_stderr_capture"
    scouting_last_exit=$?
    set -e

    scouting_last_stderr="$(cat "$scouting_stderr_capture" 2>/dev/null || true)"
    if [ -n "$scouting_last_stderr" ]; then
      {
        printf '[attempt %d exit %d]\n' "$attempt" "$scouting_last_exit"
        printf '%s\n' "$scouting_last_stderr"
      } >> "${KASEKI_RESULTS_DIR}/scouting-stderr.log"
      capture_provider_error_from_log "${KASEKI_RESULTS_DIR}/scouting-stderr.log" "scouting" || true
    fi
    rm -f "$scouting_stderr_capture"

    # Success on any attempt
    if [ "$scouting_last_exit" -eq 0 ]; then
      export KASEKI_SCOUTING_ATTEMPTS=$attempt
      export KASEKI_SCOUTING_SUCCEEDED_ON_ATTEMPT=$attempt
      clear_provider_error
      return 0
    fi

    if [ "${SCOUTING_EXIT:-0}" -eq 86 ] || [ "${STATUS:-0}" -eq 86 ]; then
      printf '[Scouting Phase] Deterministic validation failure (exit 86), not retrying\n'
      export KASEKI_SCOUTING_ATTEMPTS=$attempt
      export KASEKI_SCOUTING_SUCCEEDED_ON_ATTEMPT=""
      return 86
    fi

    # Check if this is a transient failure worth retrying
    if is_transient_scouting_failure "$scouting_last_exit" "$scouting_last_stderr"; then
      if [ "$attempt" -lt "$max_attempts" ]; then
        printf '[Scouting Phase] Transient failure detected (exit %d), retrying immediately...\n' "$scouting_last_exit"
        attempt=$((attempt + 1))
        # Reset scouting artifacts for retry
        rm -f "$SCOUTING_ARTIFACT" "$SCOUTING_RAW_EVENTS" 2>/dev/null || true
        # Clean up validation reason file from previous attempt
        rm -f "${KASEKI_RESULTS_DIR}"/scouting-validation-reason.txt 2>/dev/null || true
        continue
      fi
    else
      # Deterministic failure - do not retry
      printf '[Scouting Phase] Deterministic failure (exit %d), not retrying\n' "$scouting_last_exit"
      export KASEKI_SCOUTING_ATTEMPTS=$attempt
      export KASEKI_SCOUTING_SUCCEEDED_ON_ATTEMPT=""
      return "$scouting_last_exit"
    fi

    # Fallthrough to next attempt
    attempt=$((attempt + 1))
  done

  # Max attempts exhausted
  export KASEKI_SCOUTING_ATTEMPTS=$max_attempts
  export KASEKI_SCOUTING_SUCCEEDED_ON_ATTEMPT=""
  printf '[Scouting Phase] Max retry attempts exhausted (exit %d)\n' "$scouting_last_exit"
  return "$scouting_last_exit"
}

snapshot_attempt_artifacts() {
  local attempt_dir
  attempt_dir="${KASEKI_RESULTS_DIR}/attempt-$1"
  mkdir -p "$attempt_dir" 2>/dev/null || return 0
  for artifact in \
    pi-events.jsonl pi-summary.json pi-stderr.log git.diff changed-files.txt \
    quality.log validation.log validation-raw.log validation-timings.tsv goal-check.json \
    critical-change-expectations.json critical-change-verification.log; do
    if [ -e "${KASEKI_RESULTS_DIR}/$artifact" ]; then
      cp "${KASEKI_RESULTS_DIR}/$artifact" "$attempt_dir/$artifact" 2>/dev/null || true
    fi
  done
}

collect_goal_check_feedback() {
  local instance_name="$1"
  local goal_setting_path="$GOAL_SETTING_ARTIFACT"
  local results_dir="$KASEKI_RESULTS_DIR"
  local goal_check_path="$results_dir/goal-check.json"
  local metadata_path="$results_dir/metadata.json"
  local feedback_file="$results_dir/goal-feedback.jsonl"

  # Only collect if goal-check succeeded and artifacts exist
  if [ "$GOAL_CHECK_EXIT" -ne 0 ] || [ ! -f "$goal_check_path" ]; then
    return 0
  fi

  # Use node script to collect feedback, append as JSONL
  node "$SCRIPT_DIR/scripts/collect-feedback.js" goal-check "$instance_name" "$goal_setting_path" "$goal_check_path" "$metadata_path" 2>/dev/null | tee -a "$feedback_file" >/dev/null || true
}

collect_run_evaluation_feedback() {
  local instance_name="$1"
  local run_evaluation_path="${KASEKI_RESULTS_DIR}/run-evaluation.json"
  local metadata_path="${KASEKI_RESULTS_DIR}/metadata.json"
  local feedback_file="${KASEKI_RESULTS_DIR}/kaseki-improvements.jsonl"

  # Only collect if run-evaluation succeeded and artifacts exist
  if [ ! -f "$run_evaluation_path" ] || [ "$RUN_EVALUATION_EXIT" -ne 0 ]; then
    return 0
  fi

  # Use node script to collect feedback, append as JSONL
  node "$SCRIPT_DIR/scripts/collect-feedback.js" run-evaluation "$instance_name" "$run_evaluation_path" "$metadata_path" 2>/dev/null | tee -a "$feedback_file" >/dev/null || true
}


build_goal_check_prompt() {
  local validation_tail progress_tail goal_setting_context validation_context test_impact_context causality_context validation_summary caveman_instruction
  
  # Get caveman instruction if enabled
  caveman_instruction="$(get_caveman_instruction)"
  
  # Build validation summary instead of raw tail (reduce from ~400 tokens to ~50)
  if [ -f "${KASEKI_RESULTS_DIR}"/validation-timings.tsv ]; then
    validation_summary="$(node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(process.env.KASEKI_RESULTS_DIR + "/validation-timings.tsv", "utf8").trim().split(/\r?\n/).slice(1);
const passed = lines.filter(l => l.includes("\t0$")).length;
const failed = lines.filter(l => !l.includes("\t0$")).length;
const exitCodes = lines.map(l => l.split("\t")[2]).filter(Boolean).sort(String);
console.log(`Commands: ${passed} passed, ${failed} failed`);
if (exitCodes.length) console.log(`Exit codes: ${[...new Set(exitCodes)].join(", ")}`);
if (failed > 0) {
  const failedCmd = lines.find(l => !l.includes("\t0$"));
  console.log(`First failure: ${failedCmd ? failedCmd.split("\t")[0] : "unknown"}`);
}
' 2>/dev/null || true)"
  else
    validation_summary="Validation log: validation-timings.tsv not yet available (optional evidence for pre-validation checks)"
  fi
  
  if [ -n "$validation_summary" ]; then
    validation_context="Validation summary:
$validation_summary

Full logs available in ${KASEKI_RESULTS_DIR}/validation.log (optional for detailed debugging)"
  else
    validation_context="Validation log: not yet available. Rely on goal-setting output, scouting output, changed files, and git diff to determine requirement completion."
  fi
  
  progress_tail="$(tail -80 "${KASEKI_RESULTS_DIR}"/progress.jsonl 2>/dev/null || true)"
  if [ -s "$TEST_IMPACT_WARNINGS_ARTIFACT" ]; then
    test_impact_context="Static test-impact warnings artifact ($TEST_IMPACT_WARNINGS_ARTIFACT):
$(cat "$TEST_IMPACT_WARNINGS_ARTIFACT" 2>/dev/null)

---
"
  else
    test_impact_context="Static test-impact warnings artifact ($TEST_IMPACT_WARNINGS_ARTIFACT): no warnings emitted.

---
"
  fi
  
  # Include goal-setting output if available (provides SMART criteria, quality metrics, anti-patterns)
  if [ -f "$GOAL_SETTING_ARTIFACT" ]; then
    goal_setting_context="GOAL-SETTING ARTIFACT: $GOAL_SETTING_ARTIFACT
(Use to validate SMART criteria, anti-patterns, and constraints)

---
"
  else
    goal_setting_context=""
  fi

  # Include causality assessment if available (helps interpret validation failures)
  if [ -f "${KASEKI_RESULTS_DIR}"/validation-causality-analysis.json ]; then
    # shellcheck disable=SC2016
    causality_context="VALIDATION FAILURE CAUSALITY ASSESSMENT:

$(node -e '
let input = "";
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input);
    const assess = data.assessment;
    console.log(`Type: ${assess.failureType}`);
    console.log(`Confidence: ${(assess.confidence * 100).toFixed(0)}%`);
    console.log(`Rationale: ${assess.rationale}`);
    console.log();
    if (assess.failureType === "pre_existing") {
      console.log("⚠️  Key Finding: Validation failures appear to be PRE-EXISTING (not caused by code changes).");
      console.log("   - You can assess goal-check verdict based on requirements implementation, not blocked by these failures.");
      console.log("   - Implementation may be valid despite validation failures.");
    } else if (assess.failureType === "change_related") {
      console.log("❌ Key Finding: Validation failures are CAUSED BY CODE CHANGES.");
      console.log("   - Implementation is not valid; failures must be fixed.");
    } else if (assess.failureType === "mixed") {
      console.log("⚠️  Key Finding: MIXED causality - some failures from changes, some pre-existing.");
      console.log("   - Identify and fix change-related failures.");
      console.log("   - Pre-existing failures may not block goal if implementation is otherwise valid.");
    } else if (assess.failureType === "inconclusive") {
      console.log("❓ Key Finding: Causality INCONCLUSIVE - insufficient signal agreement.");
      console.log("   - Be conservative; base verdict on other available evidence.");
    }
  } catch (e) {
    console.log("(Could not parse causality assessment)");
  }
});
'
)

---
"
  else
    causality_context=""
  fi

  # Prepend caveman instruction if enabled
  if [ -n "$caveman_instruction" ]; then
    printf '%s\n\n' "$caveman_instruction"
  fi

  cat <<EOF
You are a read-only goal-check Pi agent inside a Kaseki-managed ephemeral workspace.

Evaluate whether the coding agent's current repository changes realized the objective from the goal-setting report.

## Your Task

Determine if the agent successfully met the requirements specified in the goal-setting output. This is NOT a code review—focus on requirement completion, not code style.

## Inputs to Inspect

- Goal-setting artifact: $GOAL_SETTING_ARTIFACT (SMART criteria, anti-patterns, constraints)
- Scouting report: $SCOUTING_ARTIFACT
- Changed files: "${KASEKI_RESULTS_DIR}"/changed-files.txt
- Git diff: "${KASEKI_RESULTS_DIR}"/git.diff
- Agent summary: "${KASEKI_RESULTS_DIR}"/pi-summary.json
- Optional validation evidence: "${KASEKI_RESULTS_DIR}"/validation.log

## Evaluation: SMART Criteria Check

For each requirement from goal-setting, verify:
- **Specific**: Did agent address the specific function/module/file mentioned? (not generic improvements)
- **Measurable**: Can you verify via tests, diff, or goal-setting/scouting context?
- **Achievable**: Completed in this run? (not timeout or incomplete)
- **Relevant**: Maps directly to goal? (not scope creep)
- **Time-bound**: Completed in single run?

Cite specific evidence: file paths, line numbers, test names, validation results.

✅ Good evidence: "parseRole() now handles null at lines 45-52 in src/parser.ts"
❌ Poor evidence: "The parser was fixed"

## Confidence Mapping

- **high**: ≥3 specific evidence items + ≥4/5 SMART dimensions met
- **medium**: 2-3 evidence items + 3-4 SMART dimensions  
- **low**: <2 evidence items OR <3 SMART dimensions

## Retry Guidance

If goal not met, your retry_prompt must:
1. Name the specific unmet SMART dimension(s)
2. Reference what agent already did (avoid re-doing work)
3. Provide actionable next steps

## Required JSON artifact

{
  "met": true or false,
  "confidence": "high", "medium", or "low",
  "summary": "1-2 sentence verdict with key finding",
  "evidence": ["specific, verifiable evidence item 1 with file/line references", "..."],
  "missing": ["unmet requirement 1 (empty if met=true)", "..."],
  "retry_prompt": "actionable repair instructions; empty if met=true",
  "validation_notes": ["validation command 1: outcome", "..."]
}

## Context
$goal_setting_context
$causality_context
$test_impact_context
Original task prompt (for reference):
$TASK_PROMPT

$validation_context

Progress log tail (last 80 lines):
$progress_tail
EOF
}

run_goal_check() {
  local attempt goal_prompt goal_start verdict_met retry_prompt verdict_summary confidence goal_check_validation_reason goal_check_validation_summary
  attempt="$1"
  GOAL_CHECK_ATTEMPTS="$attempt"
  GOAL_CHECK_EXIT=0
  GOAL_CHECK_MET=false
  GOAL_CHECK_FAILURE_REASON=""

  printf '\n==> goal check\n'
  set_current_stage "goal check"
  if [ "$KASEKI_GOAL_CHECK" != "1" ]; then
    printf 'Goal check skipped because KASEKI_GOAL_CHECK=%s.\n' "$KASEKI_GOAL_CHECK"
    record_stage_timing "goal check" 0 0 "skipped_by_config attempt=$attempt"
    return 0
  fi
  if [ ! -s "$SCOUTING_ARTIFACT" ]; then
    printf 'Goal check skipped because scouting artifact is unavailable.\n'
    record_stage_timing "goal check" 0 0 "skipped_no_scouting attempt=$attempt"
    return 0
  fi

  goal_prompt="$(build_goal_check_prompt)"
  goal_start="$(date +%s)"
  set +e
  run_pi_with_retry "$GOAL_CHECK_RAW_EVENTS" "$KASEKI_GOAL_CHECK_TIMEOUT_SECONDS" "$KASEKI_GOAL_CHECK_MODEL" "$goal_prompt" "goal-check-summary" "" "goal-check"
  GOAL_CHECK_EXIT="$?"
  unset goal_prompt LLM_GATEWAY_API_KEY LLM_GATEWAY_URL
  GOAL_CHECK_DURATION_SECONDS=$((GOAL_CHECK_DURATION_SECONDS + $(date +%s) - goal_start))
  set +e

  kaseki-pi-event-filter "$GOAL_CHECK_RAW_EVENTS" "${KASEKI_RESULTS_DIR}"/goal-check-events.jsonl "${KASEKI_RESULTS_DIR}"/goal-check-summary.json 2>/dev/null || true
  # Phase 3A: Consolidate goal-check summary to all-phase-summaries.json
  append_phase_summary "${KASEKI_RESULTS_DIR}"/all-phase-summaries.json "goal-check" "${KASEKI_RESULTS_DIR}"/goal-check-summary.json

  if [ "$GOAL_CHECK_EXIT" -eq 0 ] && [ ! -f "$GOAL_CHECK_CANDIDATE_ARTIFACT" ]; then
    # Recover from goal-check agents that printed the verdict in assistant text instead of writing the artifact.
    # shellcheck disable=SC2016
    node -e '
const fs = require("node:fs");
const candidatePath = process.argv[1];
const rawPath = process.argv[2];
const filteredPath = process.argv[3];
const attempt = Number(process.argv[4]);

function stableStringify(value) {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function schemaErrors(artifact) {
  const errors = [];
  if (!artifact || Array.isArray(artifact) || typeof artifact !== "object") {
    errors.push("root must be an object");
    return errors;
  }
  if (typeof artifact.met !== "boolean") errors.push("met must be boolean");
  if (!["low", "medium", "high"].includes(artifact.confidence)) errors.push("confidence must be low|medium|high");
  if (typeof artifact.summary !== "string" || artifact.summary.trim().length === 0) errors.push("summary must be a non-empty string");
  if (artifact.met === false && (typeof artifact.retry_prompt !== "string" || artifact.retry_prompt.trim().length === 0)) errors.push("retry_prompt must be non-empty when met=false");
  for (const key of ["evidence", "missing", "validation_notes"]) {
    if (!Array.isArray(artifact[key]) || !artifact[key].every((v) => typeof v === "string")) errors.push(key + " must be an array of strings");
  }
  return errors;
}

function collectBalancedJsonObjects(text) {
  const snippets = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") {
      inString = true;
    } else if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        snippets.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return snippets;
}

function collectStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectStrings(item, out));
  return out;
}

const valid = new Map();
for (const path of [rawPath, filteredPath]) {
  let text = "";
  try { text = fs.readFileSync(path, "utf8"); } catch { continue; }
  const snippets = collectBalancedJsonObjects(text);
  for (const snippet of snippets) {
    try {
      const parsed = JSON.parse(snippet);
      if (schemaErrors(parsed).length === 0) valid.set(stableStringify(parsed), parsed);
      for (const innerText of collectStrings(parsed)) {
        for (const innerSnippet of collectBalancedJsonObjects(innerText)) {
          try {
            const inner = JSON.parse(innerSnippet);
            if (schemaErrors(inner).length === 0) valid.set(stableStringify(inner), inner);
          } catch {}
        }
      }
    } catch {}
  }
}

if (valid.size === 1) {
  const recovered = [...valid.values()][0];
  fs.writeFileSync(candidatePath, JSON.stringify(recovered, null, 2) + "\n");
}
' "$GOAL_CHECK_CANDIDATE_ARTIFACT" "$GOAL_CHECK_RAW_EVENTS" "${KASEKI_RESULTS_DIR}"/goal-check-events.jsonl "$attempt" 2>/dev/null || true
  fi

  if [ "$GOAL_CHECK_EXIT" -eq 0 ] && ! validate_goal_check_artifact "$GOAL_CHECK_CANDIDATE_ARTIFACT" "${KASEKI_RESULTS_DIR}"/goal-check.json "$attempt" "${KASEKI_RESULTS_DIR}"/goal-check-validation-reason.txt; then
    GOAL_CHECK_EXIT=86
    goal_check_validation_reason="$(cat "${KASEKI_RESULTS_DIR}"/goal-check-validation-reason.txt 2>/dev/null || printf 'schema_mismatch')"
    goal_check_validation_summary="$(cat "${KASEKI_RESULTS_DIR}"/goal-check-validation-summary.txt 2>/dev/null || printf 'goal-check artifact validation failed')"
    case "$goal_check_validation_reason" in
      missing_file)
        GOAL_CHECK_FAILURE_REASON="goal_check_artifact_missing"
        emit_error_event "goal_check_artifact_missing" "Goal-check candidate artifact was missing: $GOAL_CHECK_CANDIDATE_ARTIFACT ($goal_check_validation_summary; full details: ${KASEKI_RESULTS_DIR}/goal-check-validation-errors.jsonl)" "continue"
        ;;
      malformed_json)
        GOAL_CHECK_FAILURE_REASON="goal_check_artifact_malformed"
        emit_error_event "goal_check_artifact_malformed" "Goal-check Pi wrote malformed JSON: $goal_check_validation_summary (full details: ${KASEKI_RESULTS_DIR}/goal-check-validation-errors.jsonl)" "continue"
        ;;
      *)
        GOAL_CHECK_FAILURE_REASON="goal_check_artifact_invalid"
        emit_error_event "goal_check_artifact_invalid" "Goal-check Pi did not write a schema-valid JSON verdict: $goal_check_validation_summary (full details: ${KASEKI_RESULTS_DIR}/goal-check-validation-errors.jsonl)" "continue"
        ;;
    esac
  fi
  rm -f "$GOAL_CHECK_CANDIDATE_ARTIFACT"
  GOAL_CHECK_ACTUAL_MODEL="$(node -e 'try { const s=require(process.env.KASEKI_RESULTS_DIR + "/goal-check-summary.json"); const v=String(s.selected_model || s.model || "").trim(); console.log(v && v !== "unknown" && v !== "null" ? v : "unknown"); } catch { console.log("unknown"); }' 2>/dev/null)"

  if [ "$GOAL_CHECK_EXIT" -eq 0 ]; then
    verdict_met="$(node -e 'try { const v=require(process.argv[1]); console.log(v.met ? "true" : "false"); } catch { console.log("false"); }' "${KASEKI_RESULTS_DIR}/goal-check.json" 2>/dev/null || printf 'false')"
    retry_prompt="$(node -e 'try { const v=require(process.argv[1]); console.log(v.retry_prompt || ""); } catch { console.log(""); }' "${KASEKI_RESULTS_DIR}/goal-check.json" 2>/dev/null || true)"
    verdict_summary="$(node -e 'try { const v=require(process.argv[1]); console.log(v.summary || ""); } catch { console.log(""); }' "${KASEKI_RESULTS_DIR}/goal-check.json" 2>/dev/null || true)"
    confidence="$(node -e 'try { const v=require(process.argv[1]); console.log(v.confidence || "unknown"); } catch { console.log("unknown"); }' "${KASEKI_RESULTS_DIR}/goal-check.json" 2>/dev/null || true)"
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

build_run_evaluation_prompt() {
  local validation_tail progress_tail stage_timings dependency_cache restoration_report draft_pr_body metadata_text goal_setting_context test_impact_context caveman_instruction
  
  # Get caveman instruction if enabled
  caveman_instruction="$(get_caveman_instruction)"
  
  validation_tail="$(tail -80 "${KASEKI_RESULTS_DIR}"/validation.log 2>/dev/null || true)"
  progress_tail="$(tail -80 "${KASEKI_RESULTS_DIR}"/progress.jsonl 2>/dev/null || true)"
  stage_timings="$(tail -80 "${KASEKI_RESULTS_DIR}"/stage-timings.tsv 2>/dev/null || true)"
  dependency_cache="$(tail -80 "${KASEKI_RESULTS_DIR}"/dependency-cache.log 2>/dev/null || true)"
  restoration_report="$(tail -80 "${KASEKI_RESULTS_DIR}"/restoration.jsonl 2>/dev/null || true)"
  metadata_text="$(cat "${KASEKI_RESULTS_DIR}"/metadata.json 2>/dev/null || true)"
  draft_pr_body="$(build_pr_body)"
  if [ -s "$TEST_IMPACT_WARNINGS_ARTIFACT" ]; then
    test_impact_context="Static test-impact warnings artifact ($TEST_IMPACT_WARNINGS_ARTIFACT):
$(cat "$TEST_IMPACT_WARNINGS_ARTIFACT" 2>/dev/null)

---
"
  else
    test_impact_context="Static test-impact warnings artifact ($TEST_IMPACT_WARNINGS_ARTIFACT): no warnings emitted.

---
"
  fi
  
  # Include goal-setting output for quality context (influences reviewer_confidence)
  if [ -f "$GOAL_SETTING_ARTIFACT" ]; then
    goal_setting_context="GOAL-SETTING OUTPUT (use to calibrate reviewer_confidence):
$(head -n 200 "$GOAL_SETTING_ARTIFACT" 2>/dev/null)

---
"
  else
    goal_setting_context=""
  fi

  # Prepend caveman instruction if enabled
  if [ -n "$caveman_instruction" ]; then
    printf '%s\n\n' "$caveman_instruction"
  fi
  
  cat <<EOF
You are a read-only run-evaluation Pi agent inside a Kaseki-managed ephemeral workspace.

Evaluate Kaseki's process quality for this run. Be task-agnostic: focus on reviewer confidence, process efficiency, stage value, and opportunities for Kaseki to improve.

## Your Task

This is NOT another goal-check. The goal-check evaluator already determined if the goal was met. Your job is to assess:
1. **Reviewer Confidence**: Can humans trust this PR without exhaustive manual review?
2. **Process Value**: Which stages added value? Which could be streamlined?
3. **Kaseki Improvements**: What should the Kaseki system optimize for next time?
4. **Task Completion**: Did the agent realize the specific goal? (score 1-5)

## Inputs to Use

**Goal Quality Context** (influences reviewer_confidence assessment):
- Goal-setting artifact: $GOAL_SETTING_ARTIFACT
- Quality metrics, SMART criteria, anti-patterns

**Agent Artifacts** (verify goal was realized):
- Goal-check verdict: "${KASEKI_RESULTS_DIR}"/goal-check.json
- Scouting report: "${KASEKI_RESULTS_DIR}"/scouting.json
- Changed files: "${KASEKI_RESULTS_DIR}"/changed-files.txt
- Git diff: "${KASEKI_RESULTS_DIR}"/git.diff
- Validation timings/logs: "${KASEKI_RESULTS_DIR}"/pre-validation-timings.tsv, ${KASEKI_RESULTS_DIR}/validation-timings.tsv, ${KASEKI_RESULTS_DIR}/validation.log
- Static test-impact warnings (non-blocking): $TEST_IMPACT_WARNINGS_ARTIFACT
- Stage timings: "${KASEKI_RESULTS_DIR}"/stage-timings.tsv
- Progress events: "${KASEKI_RESULTS_DIR}"/progress.jsonl
- Metadata: "${KASEKI_RESULTS_DIR}"/metadata.json

## Evaluation Framework

### 1. Reviewer Confidence Grounding

Reviewer confidence should account for goal quality. Poor goals = harder to assess = lower confidence.

**High reviewer_confidence** (80%+ trust for merge):
- Goal quality ≥80 (high clarity, measurability, specificity)
- Goal-check: met=true with high confidence
- Validation: all pass (or failures are pre-existing)
- Diff: ≤200 lines, ≤3 files
- No warnings from evaluators

**Medium reviewer_confidence** (50-79% trust; recommend review):
- Goal quality 60-79 (medium quality)
- OR Goal-check: met=true but medium confidence
- OR Validation: mostly pass with 1-2 minor failures
- OR Diff: 200-500 lines, ≤5 files

**Low reviewer_confidence** (<50% trust; require manual review):
- Goal quality <60 (low clarity/measurability)
- OR Goal-check: unmet or low confidence
- OR Validation: failures (excluding pre-existing)
- OR Diff: >500 lines or >5 files
- OR Contradictory signals

Always account for goal quality. A low-quality goal makes success harder to assess.

### 2. Evidence Cross-Check (REQUIRED)

Before assigning reviewer_confidence or task_completion_score, compare all available evidence sources and explicitly handle contradictions:

- Read goal-check.json.met (the met field in "${KASEKI_RESULTS_DIR}"/goal-check.json) as one signal, not as authoritative proof.
- Compare goal-check.json.met against "${KASEKI_RESULTS_DIR}"/changed-files.txt, "${KASEKI_RESULTS_DIR}"/git.diff, and validation command outcomes from validation.log and validation-timings.tsv.
- Cross-check required files from goal-setting and scouting (success criteria, relevant_files, plan, test_impact, and validation expectations) against changed-files.txt and git.diff.
- Cross-check validation command outcomes: note which commands were attempted, passed, failed, skipped, or produced empty logs.
- Treat contradictory evidence as a warning and explain the contradiction in warnings and summary/reasoning fields.

Explicit contradiction-handling scoring rules:

- If goal-check.met=true but git.diff is empty in patch mode, task_completion_score must be 1 and warnings must mention contradictory evidence between the passing goal-check verdict and the empty diff.
- If required files from goal-setting/scouting are absent from changed-files.txt, task_completion_score cannot exceed 2, even when goal-check.met=true.
- If validation logs are empty and no commands were attempted, reviewer_confidence should be low unless task mode is inspect or dry-run.

### 3. Task Completion Score (1-5)

Use SMART framework from goal-setting:

- **5**: All SMART dimensions verified: specific requirements met, measurable criteria pass, achievable in one run, relevant to goal, time-bound (no pending work)
- **4**: 4/5 SMART dimensions clear; one minor dimension unclear
- **3**: 3/5 SMART dimensions met; some uncertainty remains
- **2**: 2/5 dimensions; major requirements unclear or unmet
- **1**: <2 dimensions met; goal largely unrealized

Reference specific goal-setting quality metrics (clarity, measurability, specificity) in your reasoning.

### 4. Stage Value Assessment (NOT effort, but VALUE)

For each stage, assess whether it contributed signal to the outcome:

**High value**: Stage identified/resolved critical requirement, prevented bug, or shaped agent focus
- Example: "Scouting discovered edge case in null handling; coding directly addressed it"
- Example: "Goal-check found unmet test requirement; agent could retry successfully"

**Medium value**: Stage provided baseline context without major direction change
- Example: "Validation confirmed no regressions"
- Example: "Scouting listed requirements; all were addressed as expected"

**Low value**: Stage produced minimal new signals or could be optimized
- Example: "Scouting repeated information already in goal-setting"
- Example: "Validation ran successfully but didn't catch anything unexpected"

Stages (assess value, not effort):
- goal-setting: Did it upgrade the goal meaningfully? (compare quality metrics)
- scouting: Did research uncover critical information? Or confirm expected?
- coding: Did agent implement efficiently? Or require retries?
- validation: Did validation catch issues? Or all pass as expected?
- goal-check: Did verdict provide clear signal? Or was it uncertain?

### 5. Kaseki Improvement Opportunities

Suggestions should be SPECIFIC and ACTIONABLE:

✅ Good improvement:
{
  "category": "goal_setting",
  "priority": "high",
  "suggestion": "Goal quality was 'medium' (specificity=low). Upgrades should emphasize scope clarity: clearly separate 'fix parseRole()' from 'refactor error handling' if both are needed."
}

❌ Poor improvement:
{
  "category": "general",
  "priority": "medium",
  "suggestion": "Do better"
}

Categories:
- goal_setting: Goal-setting agent or prompt improvements
- scouting: Scouting research or codebase context
- coding: Coding agent performance or configuration
- validation: Validation commands or testing framework
- goal_check: Goal-check evaluation logic
- run_evaluation: Run-evaluation (this phase) quality
- process: Overall pipeline design

Priorities:
- HIGH: Unblocks failures or improves success >10%
- MEDIUM: Improves efficiency/UX; 5-10% estimated gain
- LOW: Nice-to-have; <5% impact

### 6. Human Review Focus (2-4 items max)

What should humans manually review?

✅ Good:
- "The retry logic for null input may have side effects on callers; check parseRole(null) call sites"
- "New dependencies added (vitest-mock-extended, faker); verify these are acceptable"

❌ Poor:
- "Make sure it works"
- "Review everything"

Focus on things Kaseki didn't already verify (goal-check, validation).

### 7. PR Summary (1-2 sentences, human-ready)

Summarize the actual changes and their impact, NOT the original task.

✅ Good: "Added null-safety to parseRole() with 5 edge-case tests. All validation passes."
❌ Poor: "Fixed the parser bug"

## Required JSON Output

{
  "overall_assessment": "good" or excellent/mixed/poor/unknown,
  "reviewer_confidence": "high" or medium/low,
  "task_completion_score": 4,
  "summary": "1-2 sentence verdict accounting for goal quality and evaluator confidence",
  "human_review_focus": ["item 1", "item 2"],
  "stage_value": [
    {"stage": "goal-setting", "value": "high", "reason": "upgraded vague prompt to specific SMART criteria"},
    {"stage": "scouting", "value": "medium", "reason": "confirmed expected requirements; no surprises"}
  ],
  "efficiency_findings": ["observation 1", "observation 2"],
  "kaseki_improvement_opportunities": [
    {"category": "goal_setting", "priority": "high", "suggestion": "..."}
  ],
  "pr_summary": "1-2 sentence summary of actual changes",
  "warnings": ["warning 1 if any"]
}

## Rules

- Do not edit repository files, git state, dependencies, generated artifacts other than $RUN_EVALUATION_CANDIDATE_ARTIFACT, or secrets.
- Do not run git add, git commit, git push, gh, hub, package installation, or commands that modify files.
- Do not print, inspect, or expose environment variables, secrets, credentials, API keys, or mounted secret files.
- Write exactly one JSON object to $RUN_EVALUATION_CANDIDATE_ARTIFACT.
- Treat this evaluation as annotate-only. Do not recommend blocking the PR.
- Use goal-setting quality metrics to ground your confidence. Low-quality goals = lower reviewer_confidence even if goal-check passed.

## Context

$goal_setting_context
$test_impact_context
Original task prompt (for reference):
$TASK_PROMPT

Metadata:
$metadata_text

Stage timings:
$stage_timings

Validation log tail (last 80 lines):
$validation_tail

Progress log tail (last 80 lines):
$progress_tail

Dependency cache log tail (last 80 lines):
$dependency_cache

Restoration report tail (last 80 lines):
$restoration_report

Draft PR body:
$draft_pr_body
EOF
}

write_run_evaluation_fallback() {
  local warning="$1"
  RUN_EVALUATION_WARNING="$warning"
  node - "$RUN_EVALUATION_ARTIFACT" "$warning" "$KASEKI_RUN_EVALUATION_MODEL" "$RUN_EVALUATION_ACTUAL_MODEL" <<'NODE' 2>/dev/null || true
const fs = require('fs');
const [output, warning, model, actualModel] = process.argv.slice(2);
const artifact = {
  overall_assessment: 'unknown',
  reviewer_confidence: 'low',
  task_completion_score: 1,
  summary: 'Run evaluation was unavailable.',
  human_review_focus: ['Review the PR manually because the run evaluator did not produce a valid artifact.'],
  stage_value: [],
  efficiency_findings: [],
  kaseki_improvement_opportunities: [{
    category: 'run_evaluation',
    priority: 'medium',
    suggestion: 'Inspect run-evaluation-stderr.log and improve evaluator reliability.'
  }],
  pr_summary: 'Run evaluation was unavailable; please rely on the summary, validation results, and changed files.',
  warnings: [warning],
  timestamp: new Date().toISOString(),
  model,
  actual_model: actualModel || 'unknown'
};
fs.writeFileSync(output, JSON.stringify(artifact, null, 2) + '\n');
NODE
}

run_run_evaluation() {
  local evaluation_prompt evaluation_start eval_dirty_before eval_dirty_after
  RUN_EVALUATION_EXIT=0
  RUN_EVALUATION_WARNING=""

  printf '\n==> run evaluation\n'
  set_current_stage "run evaluation"
  if [ "$KASEKI_RUN_EVALUATION" != "1" ]; then
    printf 'Run evaluation skipped because KASEKI_RUN_EVALUATION=%s.\n' "$KASEKI_RUN_EVALUATION"
    record_stage_timing "run evaluation" 0 0 "skipped_by_config"
    return 0
  fi
  if [ "$KASEKI_DRY_RUN" = "1" ]; then
    printf 'Run evaluation skipped for dry-run/startup-check mode.\n'
    record_stage_timing "run evaluation" 0 0 "dry_run=true"
    return 0
  fi

  emit_progress "run evaluation" "started"
  write_metadata "$STATUS"
  evaluation_prompt="$(build_run_evaluation_prompt)"
  evaluation_start="$(date +%s)"
  eval_dirty_before="$(git status --porcelain 2>/dev/null || true)"
  chmod -R a-w "${KASEKI_WORKSPACE_DIR}"/repo 2>/dev/null || true
  set +e
  run_pi_with_retry "$RUN_EVALUATION_RAW_EVENTS" "$KASEKI_RUN_EVALUATION_TIMEOUT_SECONDS" "$KASEKI_RUN_EVALUATION_MODEL" "$evaluation_prompt" "run-evaluation-summary" "" "run-evaluation"
  RUN_EVALUATION_EXIT="$?"
  unset evaluation_prompt LLM_GATEWAY_API_KEY LLM_GATEWAY_URL
  RUN_EVALUATION_DURATION_SECONDS=$((RUN_EVALUATION_DURATION_SECONDS + $(date +%s) - evaluation_start))
  chmod -R u+w "${KASEKI_WORKSPACE_DIR}"/repo 2>/dev/null || true
  set +e

  if [ "$RUN_EVALUATION_EXIT" -eq 0 ] && ! node -e '
const fs = require("node:fs");
const input = process.argv[1];
const output = process.argv[2];
const model = process.argv[3];
const actualModel = process.argv[4] || "unknown";
const assessmentValues = new Set(["excellent", "good", "mixed", "poor", "unknown"]);
const confidenceValues = new Set(["high", "medium", "low"]);
const stageValueValues = new Set(["high", "medium", "low", "unknown"]);
const priorityValues = new Set(["high", "medium", "low"]);
const invalid = [];
const artifact = JSON.parse(fs.readFileSync(input, "utf8"));
if (!artifact || Array.isArray(artifact) || typeof artifact !== "object") invalid.push("root");
if (!assessmentValues.has(artifact.overall_assessment)) invalid.push("overall_assessment");
if (!confidenceValues.has(artifact.reviewer_confidence)) invalid.push("reviewer_confidence");
if (!Number.isInteger(artifact.task_completion_score) || artifact.task_completion_score < 1 || artifact.task_completion_score > 5) invalid.push("task_completion_score");
for (const key of ["summary", "pr_summary"]) if (typeof artifact[key] !== "string") invalid.push(key);
for (const key of ["human_review_focus", "efficiency_findings", "warnings"]) {
  if (!Array.isArray(artifact[key]) || !artifact[key].every((v) => typeof v === "string")) invalid.push(key);
}
if (!Array.isArray(artifact.stage_value) || !artifact.stage_value.every((item) => item && typeof item.stage === "string" && stageValueValues.has(item.value) && typeof item.reason === "string")) invalid.push("stage_value");
if (!Array.isArray(artifact.kaseki_improvement_opportunities) || !artifact.kaseki_improvement_opportunities.every((item) => item && typeof item.category === "string" && priorityValues.has(item.priority) && typeof item.suggestion === "string")) invalid.push("kaseki_improvement_opportunities");
if (invalid.length) throw new Error("invalid run-evaluation fields: " + invalid.join(", "));
artifact.timestamp = new Date().toISOString();
artifact.model = model;
artifact.actual_model = actualModel;
fs.writeFileSync(output, JSON.stringify(artifact, null, 2) + "\n");
' "$RUN_EVALUATION_CANDIDATE_ARTIFACT" "$RUN_EVALUATION_ARTIFACT" "$KASEKI_RUN_EVALUATION_MODEL" "$RUN_EVALUATION_ACTUAL_MODEL" 2>/dev/null; then
    RUN_EVALUATION_EXIT=86
    emit_error_event "run_evaluation_artifact_invalid" "Run-evaluation Pi did not write a schema-valid JSON artifact" "continue"
  fi
  rm -f "$RUN_EVALUATION_CANDIDATE_ARTIFACT"
  kaseki-pi-event-filter "$RUN_EVALUATION_RAW_EVENTS" "${KASEKI_RESULTS_DIR}"/run-evaluation-events.jsonl "${KASEKI_RESULTS_DIR}"/run-evaluation-summary.json 2>/dev/null || true
  if capture_provider_error_from_summary "${KASEKI_RESULTS_DIR}/run-evaluation-summary.json" "run-evaluation"; then
    RUN_EVALUATION_EXIT=88
    emit_error_event "$PROVIDER_ERROR_TYPE" "Run-evaluation provider error: $PROVIDER_ERROR_MESSAGE" "continue"
    RUN_EVALUATION_WARNING="run_evaluation_provider_error_$PROVIDER_ERROR_TYPE"
    clear_provider_error
  fi
  # Phase 3A: Consolidate run-evaluation summary to all-phase-summaries.json
  append_phase_summary "${KASEKI_RESULTS_DIR}"/all-phase-summaries.json "run-evaluation" "${KASEKI_RESULTS_DIR}"/run-evaluation-summary.json
  RUN_EVALUATION_ACTUAL_MODEL="$(node -e 'try { const s=require(process.env.KASEKI_RESULTS_DIR + "/run-evaluation-summary.json"); const v=String(s.selected_model || s.model || "").trim(); console.log(v && v !== "unknown" && v !== "null" ? v : "unknown"); } catch { console.log("unknown"); }' 2>/dev/null)"
  if [ -s "$RUN_EVALUATION_ARTIFACT" ]; then
    node - "$RUN_EVALUATION_ARTIFACT" "$RUN_EVALUATION_ACTUAL_MODEL" <<'NODE' 2>/dev/null || true
const fs = require('fs');
const [file, actualModel] = process.argv.slice(2);
const artifact = JSON.parse(fs.readFileSync(file, 'utf8'));
artifact.actual_model = actualModel || 'unknown';
fs.writeFileSync(file, JSON.stringify(artifact, null, 2) + '\n');
NODE
  fi

  eval_dirty_after="$(git status --porcelain 2>/dev/null || true)"
  if [ "$eval_dirty_before" != "$eval_dirty_after" ]; then
    RUN_EVALUATION_EXIT=86
    emit_error_event "run_evaluation_workspace_modified" "Read-only run evaluation changed repository state; restoring workspace" "continue"
    git reset --hard -q HEAD 2>/dev/null || true
    git clean -fd -q 2>/dev/null || true
  fi

  if [ "$RUN_EVALUATION_EXIT" -ne 0 ] || [ ! -s "$RUN_EVALUATION_ARTIFACT" ]; then
    if [ -n "$RUN_EVALUATION_WARNING" ]; then
      write_run_evaluation_fallback "$RUN_EVALUATION_WARNING"
    else
      write_run_evaluation_fallback "run_evaluation_failed_exit_$RUN_EVALUATION_EXIT"
    fi
    emit_progress "run evaluation" "finished with warning $RUN_EVALUATION_WARNING"
  else
    emit_progress "run evaluation" "wrote run evaluation artifact"
  fi
  record_stage_timing "run evaluation" "$RUN_EVALUATION_EXIT" "$(($(date +%s) - evaluation_start))" "timeout_seconds=$KASEKI_RUN_EVALUATION_TIMEOUT_SECONDS warning=$RUN_EVALUATION_WARNING"
  collect_run_evaluation_feedback "$INSTANCE_NAME"
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

  TOKEN_HELPER_STDOUT="$helper_stdout" TOKEN_HELPER_STDERR="$helper_stderr" TOKEN_HELPER_EXIT_CODE="$helper_exit_code" node <<'NODE' 2>/dev/null || printf 'github-app-token helper exited with code %s	' "$helper_exit_code"
const stdout = process.env.TOKEN_HELPER_STDOUT || '';
const stderr = process.env.TOKEN_HELPER_STDERR || '';
const exitCode = process.env.TOKEN_HELPER_EXIT_CODE || 'unknown';
const sanitize = (value) => String(value || '')
  .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g, '[redacted private key]')
  .replace(/\b(?:gh[opsru]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[redacted token]')
  .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted jwt]')
  .replace(/[\r\n\t]+/g, ' ')
  .replace(/ {2,}/g, ' ')
  .trim();
let error = '';
let status = '';
try {
  const structuredSource = stdout.trim().startsWith('{') ? stdout : stderr.trim().startsWith('{') ? stderr : '{}';
  const parsed = JSON.parse(structuredSource);
  error = parsed.error || parsed.message || '';
  const candidateStatus = parsed.status || parsed.statusCode || parsed.http_status || parsed.httpStatus || '';
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
NODE
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
  local metadata_file="${KASEKI_RESULTS_DIR}/github-app-private-key-metadata.json"
  github_private_key_metadata_json "$key_file" > "$metadata_file"
  printf '[health-check] GitHub App private key metadata: %s\n' "$(tr -d '\n' < "$metadata_file")" | tee -a "$health_log"
}


github_askpass_runtime_dir() {
  printf '%s\n' "${KASEKI_GITHUB_ASKPASS_DIR:-${KASEKI_RESULTS_DIR}}"
}

create_github_askpass_helper() {
  local log_file log_prefix askpass_dir askpass_file username_smoke_output password_smoke_output
  log_file="${1:-/dev/null}"
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
  local health_log="${KASEKI_HEALTH_LOG:-${KASEKI_RESULTS_DIR}/github-health-check.log}"
  github_preflight_fail() {
    local classification="$1"
    local remediation="$2"
    shift 2
    local message="$1"
    shift || true
    local message_arg
    for message_arg in "$@"; do
      message="${message/\%s/$message_arg}"
    done
    printf '[health-check] ERROR: %s\n' "$message" | tee -a "$health_log" >&2
    printf '[health-check] CLASSIFICATION: %s\n' "$classification" | tee -a "$health_log" >&2
    printf '[health-check] REMEDIATION: %s\n' "$remediation" | tee -a "$health_log" >&2
    return 1
  }
  : > "$health_log"
  
  printf '[preflight] github operations health check started\n' | tee -a "$health_log"
  
  # must match host preflight/API secret resolution contract.
  local github_app_id_file github_app_client_id_file github_app_private_key_file
  github_app_id_file="$(resolve_github_secret_file "GITHUB_APP_ID_FILE" "github_app_id")"
  github_app_client_id_file="$(resolve_github_secret_file "GITHUB_APP_CLIENT_ID_FILE" "github_app_client_id")"
  github_app_private_key_file="$(resolve_github_secret_file "GITHUB_APP_PRIVATE_KEY_FILE" "github_app_private_key")"
  
  if ! [ -r "$github_app_id_file" ]; then
    github_preflight_fail "missing_github_app_id" "Provide a readable GitHub App ID secret via GITHUB_APP_ID_FILE or KASEKI_SECRETS_DIR/github_app_id." "Cannot read GitHub App ID from %s" "$github_app_id_file"
    return $?
  fi
  if ! [ -r "$github_app_client_id_file" ]; then
    github_preflight_fail "missing_github_app_client_id" "Provide a readable GitHub App client ID secret via GITHUB_APP_CLIENT_ID_FILE or KASEKI_SECRETS_DIR/github_app_client_id." "Cannot read GitHub App client ID from %s" "$github_app_client_id_file"
    return $?
  fi
  if ! [ -r "$github_app_private_key_file" ]; then
    github_preflight_fail "missing_github_app_private_key" "Provide a readable GitHub App private key secret via GITHUB_APP_PRIVATE_KEY_FILE or KASEKI_SECRETS_DIR/github_app_private_key." "Cannot read GitHub App private key from %s" "$github_app_private_key_file"
    return $?
  fi
  log_github_private_key_metadata "$github_app_private_key_file" "$health_log"
  printf '[health-check] ✓ GitHub App secrets are readable\n' | tee -a "$health_log"
  
  # Check 2: Verify git is available
  if ! git --version >/dev/null 2>&1; then
    github_preflight_fail "missing_git" "Install git in the runtime image or ensure git is available on PATH before starting Kaseki." "git command is not available"
    return $?
  fi
  printf '[health-check] ✓ git is available\n' | tee -a "$health_log"
  
  # Check 3: Test Node.js github-app-token helper file exists and is executable
  local github_app_token_helper="${KASEKI_GITHUB_APP_TOKEN_HELPER:-/usr/local/bin/github-app-token}"
  if ! [ -x "$github_app_token_helper" ]; then
    github_preflight_fail "missing_github_app_token_helper" "Install or build the github-app-token helper and set KASEKI_GITHUB_APP_TOKEN_HELPER if it lives outside /usr/local/bin." "github-app-token helper not found at %s" "$github_app_token_helper"
    return $?
  fi
  printf '[health-check] ✓ github-app-token helper file exists and is executable\n' | tee -a "$health_log"
  
  # Check 4: Test Node.js is available
  if ! command -v node >/dev/null 2>&1; then
    github_preflight_fail "missing_node" "Install Node.js in the runtime image or ensure node is available on PATH before starting Kaseki." "Node.js is not available"
    return $?
  fi
  printf '[health-check] ✓ Node.js is available\n' | tee -a "$health_log"
  
  # Check 5: Test Node.js JSON parsing
  local test_output
  test_output=$(printf '{"test":"value"}' | node -e "const d = JSON.parse(require('fs').readFileSync(0, 'utf8')); process.stdout.write(d.test);" 2>&1) || {
    github_preflight_fail "node_json_parse_failed" "Verify the Node.js runtime is healthy and can execute inline scripts." "Node.js JSON parsing failed: %s" "$test_output"
    return $?
  }
  if [ "$test_output" != "value" ]; then
    github_preflight_fail "node_json_parse_unexpected_output" "Verify the Node.js runtime is healthy and not shadowed by a wrapper on PATH." "Node.js JSON parsing returned unexpected output: %s" "$test_output"
    return $?
  fi
  printf '[health-check] ✓ Node.js JSON parsing works\n' | tee -a "$health_log"
  
  # Check 6: Test github-app-token helper can start and resolve runtime imports
  local helper_probe_stdout_tmp helper_probe_stderr_tmp helper_probe_exit_code helper_probe_stdout helper_probe_stderr helper_probe_parse_result helper_probe_error
  helper_probe_stdout_tmp="$(mktemp /tmp/github-health-helper-probe-stdout.XXXXXX)" || {
    github_preflight_fail "tempfile_creation_failed" "Ensure /tmp is writable inside the runtime container." "Failed to create helper load probe stdout temp file"
    return $?
  }
  helper_probe_stderr_tmp="$(mktemp /tmp/github-health-helper-probe-stderr.XXXXXX)" || {
    github_preflight_fail "tempfile_creation_failed" "Ensure /tmp is writable inside the runtime container." "Failed to create helper load probe stderr temp file"
    local preflight_status=$?
    rm -f "$helper_probe_stdout_tmp"
    return $preflight_status
  }

  "$github_app_token_helper" >"$helper_probe_stdout_tmp" 2>"$helper_probe_stderr_tmp"
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
    github_preflight_fail "github_app_token_helper_load_failed" "Rebuild the runtime image or install the missing github-app-token helper dependencies." "github-app-token helper failed to load: %s" "$helper_probe_error"
    return $?
  fi
  printf '[health-check] ✓ github-app-token helper can start and resolve imports\n' | tee -a "$health_log"

  # Check 7: Test curl is available
  if ! command -v curl >/dev/null 2>&1; then
    github_preflight_fail "missing_curl" "Install curl in the runtime image or ensure curl is available on PATH before starting Kaseki." "curl is not available"
    return $?
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
        github_preflight_fail "missing_github_app_id" "Ensure the GitHub App ID secret is readable and non-empty before enabling the auth smoke test." "Cannot read GitHub App ID for auth smoke test"
        return $?
      fi

      token_stdout_tmp="$(mktemp /tmp/github-health-token-stdout.XXXXXX)" || {
        github_preflight_fail "tempfile_creation_failed" "Ensure /tmp is writable inside the runtime container." "Failed to create token stdout temp file"
        return $?
      }
      token_stderr_tmp="$(mktemp /tmp/github-health-token-stderr.XXXXXX)" || {
        github_preflight_fail "tempfile_creation_failed" "Ensure /tmp is writable inside the runtime container." "Failed to create token stderr temp file"
        local preflight_status=$?
        rm -f "$token_stdout_tmp"
        return $preflight_status
      }

      "$github_app_token_helper" "$app_id" "$github_app_private_key_file" "$owner" "$repo" >"$token_stdout_tmp" 2>"$token_stderr_tmp"
      token_exit_code=$?
      token_data="$(cat "$token_stdout_tmp" 2>/dev/null || true)"
      token_stderr="$(cat "$token_stderr_tmp" 2>/dev/null || true)"
      rm -f "$token_stdout_tmp" "$token_stderr_tmp"

      if [ "$token_exit_code" -ne 0 ]; then
        token_parse_result="$(parse_github_app_token_helper_failure "$token_data" "$token_stderr" "$token_exit_code")"
        token_error="${token_parse_result%%$'\t'*}"
        github_preflight_fail "github_app_token_generation_failed" "Verify the GitHub App is installed on REPO_URL and the app ID/private key pair are valid." "GitHub App token generation failed for owner/repo: %s" "$token_error"
        return $?
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
  local http_status response log_file error_type error_message json_valid
  http_status="$1"
  response="$2"
  log_file="${3:-/dev/null}"
  
  # Try to parse error info from response
  error_type="unknown"
  error_message=""

  if [ -z "$http_status" ] || ! printf '%s' "$http_status" | grep -Eq '^[0-9][0-9][0-9]$'; then
    error_type="invalid_http_status"
    error_message="GitHub API returned an invalid or missing HTTP status"
    printf 'GitHub API response malformed: %s (status: %s)\n' "$error_message" "${http_status:-missing}" | tee -a "$log_file" >&2
    GITHUB_API_ERROR_TYPE="$error_type"
    GITHUB_API_ERROR_MESSAGE="$error_message"
    GITHUB_API_HTTP_STATUS="${http_status:-0}"
    return 1
  fi

  if [ -z "$response" ]; then
    error_type="empty_response"
    error_message="GitHub API returned an empty response"
    printf 'GitHub API response malformed (HTTP %s): %s\n' "$http_status" "$error_message" | tee -a "$log_file" >&2
    GITHUB_API_ERROR_TYPE="$error_type"
    GITHUB_API_ERROR_MESSAGE="$error_message"
    GITHUB_API_HTTP_STATUS="$http_status"
    return 1
  fi

  if printf '%s' "$response" | node -e "JSON.parse(require('fs').readFileSync(0, 'utf8'))" >/dev/null 2>&1; then
    json_valid=1
  else
    json_valid=0
  fi

  if [ "$json_valid" -ne 1 ]; then
    error_type="malformed_json"
    error_message="GitHub API returned malformed JSON"
    printf 'GitHub API response malformed (HTTP %s): %s\n' "$http_status" "$error_message" | tee -a "$log_file" >&2
    GITHUB_API_ERROR_TYPE="$error_type"
    GITHUB_API_ERROR_MESSAGE="$error_message"
    GITHUB_API_HTTP_STATUS="$http_status"
    return 1
  fi
  
  if [ "$http_status" = "201" ]; then
    # Success - but still need to verify html_url exists
    return 0
  fi
  
  # Attempt to extract error info using Node.js
  {
    error_message=$(printf '%s' "$response" | node -e "
      const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
      if (d.message) process.stdout.write(d.message);
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
  log_file="${5:-/dev/null}"

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
  log_file="${3:-/dev/null}"
  
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
  local review_request_log="${KASEKI_RESULTS_DIR}/owner-review-request.log"
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
  if [ -s "${KASEKI_RESULTS_DIR}"/result-summary.md ]; then
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
      ' "${KASEKI_RESULTS_DIR}"/result-summary.md 2>/dev/null | sanitize_pr_metadata_text
    )"
  fi
  if [ -n "$summary_candidate" ]; then
    candidate="$summary_candidate"
  elif [ -z "$candidate" ] && [ -s "${KASEKI_RESULTS_DIR}"/result-summary.md ]; then
    candidate="$(sed -n '/^- Status:/p; /^- Changed files:/p; /^- Validation:/p' "${KASEKI_RESULTS_DIR}"/result-summary.md 2>/dev/null | head -n 3 | sanitize_pr_metadata_text)"
  fi

  candidate="$(printf '%s' "$candidate" | sed -E 's/^[[:space:]]*([0-9]+[.)]|[-*])[[:space:]]+//' | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g; s/(^|[[:space:]])[0-9]+[.)][[:space:]]+/\1/g; s/(^|[[:space:]])[-*][[:space:]]+/\1/g; s/userfacing/user-facing/Ig; s/customerfacing/customer-facing/Ig; s/front[ -]?end/frontend/Ig; s/back[ -]?end/backend/Ig; s/full[ -]?stack/full-stack/Ig; s/^[[:space:]]+//; s/[[:space:]]+$//')"

  stripped="$(printf '%s' "$candidate" | sed -E 's/^(task|request|please|implement|update|fix|add)[[:space:]:-]+//I')"
  if [ -n "$stripped" ] && [ "$stripped" != "$candidate" ]; then
    candidate="$stripped"
  fi

  if [ -s "${KASEKI_RESULTS_DIR}"/changed-files.txt ]; then
    changed_files="$(sanitize_pr_metadata_text < "${KASEKI_RESULTS_DIR}"/changed-files.txt || true)"
  else
    changed_files=""
  fi
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
  local changed_files_file="${KASEKI_RESULTS_DIR}/changed-files.txt"
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

format_pr_json_list() {
  local file="$1"
  local key="$2"
  local max_rows="${3:-3}"
  local max_length="${4:-180}"
  if [ ! -s "$file" ]; then
    return 0
  fi

  node - "$file" "$key" "$max_rows" "$max_length" <<'NODE' 2>/dev/null || true
const fs = require('fs');
const [file, key, maxRowsValue, maxLengthValue] = process.argv.slice(2);
const maxRows = Number.parseInt(maxRowsValue, 10) || 3;
const maxLength = Number.parseInt(maxLengthValue, 10) || 180;
let data;
try {
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch {
  process.exit(0);
}
const value = data && data[key];
const values = Array.isArray(value) ? value : value ? [value] : [];
for (const item of values.slice(0, maxRows)) {
  const text = String(item || '')
    .replace(/\r/g, '')
    .replace(/\n+/g, ' ')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) continue;
  const clipped = text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
  console.log(`- ${clipped}`);
}
NODE
}

build_pr_agent_review() {
  local validation_pass_flag="${1:-0}"
  case "$validation_pass_flag" in
    ''|*[!0-9-]*) validation_pass_flag=0 ;;
  esac
  local goal_file="${KASEKI_RESULTS_DIR}/goal-check.json"
  local scouting_file="${KASEKI_RESULTS_DIR}/scouting.json"
  local goal_summary evidence missing validation_notes risks

  goal_summary=""
  if [ -s "$goal_file" ]; then
    goal_summary="$(node - "$goal_file" <<'NODE' 2>/dev/null || true
const fs = require('fs');
try {
  const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const summary = String(data.summary || '').replace(/\r/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  if (summary) console.log(summary);
} catch {}
NODE
)"
    goal_summary="$(printf '%s' "$goal_summary" | sanitize_pr_metadata_text)"
    goal_summary="$(truncate_pr_metadata_text 220 "$goal_summary")"
  fi

  printf '### What went well\n'
  if [ -n "$goal_summary" ]; then
    printf -- '- %s\n' "$goal_summary"
  fi
  evidence="$(format_pr_json_list "$goal_file" "evidence" 3 180 | sanitize_pr_metadata_text)"
  validation_notes="$(format_pr_json_list "$goal_file" "validation_notes" 2 180 | sanitize_pr_metadata_text)"
  if [ -n "$evidence" ]; then
    printf '%s\n' "$evidence"
  elif [ "$validation_pass_flag" -eq 1 ]; then
    printf -- '- All configured validation, quality, and secret-scan gates passed.\n'
  fi
  if [ -n "$validation_notes" ]; then
    printf '%s\n' "$validation_notes"
  fi

  printf '\n### Needs attention\n'
  missing="$(format_pr_json_list "$goal_file" "missing" 3 180 | sanitize_pr_metadata_text)"
  risks="$(format_pr_json_list "$scouting_file" "risks" 2 180 | sanitize_pr_metadata_text)"
  if [ -n "$missing" ]; then
    printf '%s\n' "$missing"
  elif [ "$validation_pass_flag" -eq 1 ]; then
    printf -- '- No unmet task requirements were reported by the goal check.\n'
  fi
  if [ -n "$risks" ]; then
    printf '%s\n' "$risks"
  elif [ "$validation_pass_flag" -ne 1 ]; then
    printf -- '- Review the failed validation or quality gate output before merging.\n'
  fi
}

build_pr_agent_evaluation() {
  local evaluation_file="${KASEKI_RESULTS_DIR}/run-evaluation.json"
  if [ ! -s "$evaluation_file" ]; then
    return 0
  fi

  node - "$evaluation_file" <<'NODE' 2>/dev/null | sanitize_pr_body_text || true
const fs = require('fs');
const file = process.argv[2];
let data;
try {
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch {
  process.exit(0);
}
const text = (value, max = 220) => {
  const normalized = String(value || '')
    .replace(/\r/g, '')
    .replace(/\n+/g, ' ')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > max ? `${normalized.slice(0, Math.max(0, max - 3))}...` : normalized;
};

const parseEpochMs = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const epochMs = Date.parse(value);
  return Number.isFinite(epochMs) ? epochMs : null;
};

const durationMsFromTimestamps = (() => {
  const startMs = parseEpochMs(data.started_at || data.start_time || null);
  const endMs = parseEpochMs(data.ended_at || data.end_time || null);
  if (startMs === null || endMs === null) return null;
  return Math.max(0, endMs - startMs);
})();

const fallbackDurationMs = (() => {
  if (typeof data.duration_ms === 'number' && Number.isFinite(data.duration_ms) && data.duration_ms >= 0) {
    return data.duration_ms;
  }
  if (typeof data.duration_seconds === 'number' && Number.isFinite(data.duration_seconds) && data.duration_seconds >= 0) {
    return data.duration_seconds * 1000;
  }
  return null;
})();

const durationMs = durationMsFromTimestamps ?? fallbackDurationMs;
const formatDuration = (ms) => {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return 'unknown';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2).replace(/\.00$/, '')}s`;
};

// Key-value summary
const assessment = text(data.overall_assessment || 'unknown', 40);
const confidence = text(data.reviewer_confidence || 'unknown', 40);
console.log(`- Overall: ${assessment}`);
console.log(`- Reviewer confidence: ${confidence}`);
console.log(`- Duration: ${formatDuration(durationMs)}`);

// Summary subsection
const prSummary = text(data.pr_summary || data.summary || '', 320);
if (prSummary) {
  console.log('');
  console.log('### Summary');
  console.log(`- ${prSummary}`);
}

// Review focus subsection
const focus = Array.isArray(data.human_review_focus)
  ? data.human_review_focus.map((value) => text(value, 320)).filter(Boolean).slice(0, 3)
  : [];
if (focus.length > 0) {
  console.log('');
  console.log('### Review focus');
  for (const item of focus) {
    console.log(`- ${item}`);
  }
}

// Process notes subsection
let processNote = '';
if (Array.isArray(data.efficiency_findings) && data.efficiency_findings.length > 0) {
  processNote = text(data.efficiency_findings[0], 320);
} else if (Array.isArray(data.kaseki_improvement_opportunities) && data.kaseki_improvement_opportunities.length > 0) {
  const item = data.kaseki_improvement_opportunities[0] || {};
  processNote = text(item.suggestion || '', 320);
}
if (processNote) {
  console.log('');
  console.log('### Process notes');
  console.log(`- ${processNote}`);
}
NODE
}

build_pr_improvements_summary() {
  local changed_files_file="${KASEKI_RESULTS_DIR}/changed-files.txt"
  local diff_file="${KASEKI_RESULTS_DIR}/git.diff"
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

  if [ -s "${KASEKI_RESULTS_DIR}"/result-summary.md ]; then
    summary_source="${KASEKI_RESULTS_DIR}/result-summary.md"
  else
    for artifact in "${KASEKI_RESULTS_DIR}"/analysis.md ${KASEKI_RESULTS_DIR}/pi-summary.json; do
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
        if [ "$summary_capture" -eq 0 ] && [ "$summary_source" = "${KASEKI_RESULTS_DIR}/result-summary.md" ]; then
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

## Agent review
$(build_pr_agent_review "$all_validation_statuses_pass")

$(if [ -s "${KASEKI_RESULTS_DIR}"/run-evaluation.json ]; then printf '## Agent evaluation\n%s\n\n' "$(build_pr_agent_evaluation)"; fi)
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
    printf -- 'Cannot parse GitHub repo URL: %s\n' "$REPO_URL"  >&2
    return 7
  fi
  
  printf -- 'GitHub operations: owner=%s, repo=%s\n' "$owner" "$repo" | tee -a /dev/null
  GITHUB_OPERATION_PHASE="setup"
  
  # Set git user for commits
  git config user.name "GitHub App [$app_id]" || { printf 'Failed to set git user name\n' >&2; return 7; }
  git config user.email "${app_id}+kaseki@users.noreply.github.com" || { printf 'Failed to set git email\n' >&2; return 7; }
  
  # Generate GitHub App installation token
  GITHUB_OPERATION_PHASE="token_generation"
  printf 'Generating GitHub App installation token...\n' | tee -a /dev/null
  local github_app_token_helper="${KASEKI_GITHUB_APP_TOKEN_HELPER:-/usr/local/bin/github-app-token}"
  local token_stdout_tmp token_stderr_tmp token_exit_code token_stderr token_parse_result token_error token_http_status
  token_stdout_tmp="$(mktemp /tmp/github-app-token-stdout.XXXXXX)" || { printf 'Failed to create token stdout temp file\n' >&2; return 7; }
  token_stderr_tmp="$(mktemp /tmp/github-app-token-stderr.XXXXXX)" || {
    printf 'Failed to create token stderr temp file\n' >&2
    rm -f "$token_stdout_tmp"
    return 7
  }
  node "$github_app_token_helper" "$app_id" "$private_key_file" "$owner" "$repo" >"$token_stdout_tmp" 2>"$token_stderr_tmp"
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
    printf 'Failed to generate token: %s\n' "$token_error"  >&2
    GITHUB_API_ERROR_TYPE="github_app_token_error"
    GITHUB_API_ERROR_MESSAGE="$token_error"
    GITHUB_API_HTTP_STATUS="$token_http_status"
    emit_error_event "github_app_token_failed" "Failed to generate GitHub App installation token: $GITHUB_API_ERROR_MESSAGE" "exit"
    GITHUB_PUSH_EXIT=7
    return 7
  fi
  
  # Use helper to extract token from JSON response
  if ! run_node_subprocess token "const d = JSON.parse(require('fs').readFileSync(0, 'utf8')); process.stdout.write(d.token || '')" "$token_data" /dev/null; then
    printf -- 'Failed to extract token from response: %s\n' "$token_data"  >&2
    GITHUB_PUSH_EXIT=7
    return 7
  fi
  
  if [ -z "$token" ]; then
    printf -- 'Failed to extract token from response (empty result)\n'  >&2
    GITHUB_PUSH_EXIT=7
    return 7
  fi
  
  printf 'Token generated successfully\n' | tee -a /dev/null
  
  # Create and push feature branch
  GITHUB_OPERATION_PHASE="branch_creation"
  feature_branch="kaseki/$INSTANCE_NAME"
  printf -- 'Creating feature branch: %s\n' "$feature_branch" | tee -a /dev/null
  git checkout -b "$feature_branch" || {
    printf 'Failed to create branch\n'  >&2
    GITHUB_PUSH_EXIT=7
    return 7
  }
  
  # Commit changes (git should already have changes from pi agent)
  GITHUB_OPERATION_PHASE="commit"
  printf 'Committing changes...\n' | tee -a /dev/null
  if [ ! -s "${KASEKI_RESULTS_DIR}"/changed-files.txt ]; then
    printf 'No changed files to stage\n'  >&2
    GITHUB_PUSH_EXIT=7
    return 7
  fi
  while IFS= read -r changed_file || [ -n "$changed_file" ]; do
    [ -z "$changed_file" ] && continue
    git add -- "$changed_file" || {
      printf -- 'Failed to stage changed file: %s\n' "$changed_file"  >&2
      GITHUB_PUSH_EXIT=7
      return 7
    }
  done < "${KASEKI_RESULTS_DIR}"/changed-files.txt
  if ! git commit -m "Kaseki: $INSTANCE_NAME"; then
    printf 'No changes to commit or commit failed\n'  >&2
    GITHUB_PUSH_EXIT=7
    return 7
  fi
  
  # Push branch
  GITHUB_OPERATION_PHASE="push"
  printf 'Pushing branch to GitHub...\n' | tee -a /dev/null
  local askpass_file
  if ! create_github_askpass_helper /dev/null 'GitHub credential helper'; then
    return 8
  fi
  askpass_file="$GITHUB_ASKPASS_FILE"

  KASEKI_GITHUB_TOKEN="$token" GIT_ASKPASS="$askpass_file" GIT_TERMINAL_PROMPT=0 \
    git push "https://github.com/$owner/$repo.git" "$feature_branch" --force-with-lease 2>&1 | tee -a /dev/null
  git_push_exit="${PIPESTATUS[0]:-1}"
  if [ "$git_push_exit" -eq 0 ]; then
    printf 'Branch pushed successfully\n' | tee -a /dev/null
  else
    rm -f "$askpass_file"
    printf 'Failed to push branch (exit %s)\n' "$git_push_exit"  >&2
    GITHUB_PUSH_EXIT="$git_push_exit"
    return "$git_push_exit"
  fi
  rm -f "$askpass_file"

  if [ "$KASEKI_PUBLISH_MODE" = "branch" ]; then
    printf 'Publish mode branch: skipping pull request creation.\n' | tee -a /dev/null
    GITHUB_PR_EXIT=0
    GITHUB_OPERATION_PHASE="completed"
    unset token
    return 0
  fi
  if ! is_pr_creation_mode; then
    printf 'Publish mode %s: skipping pull request creation.\n' "$KASEKI_PUBLISH_MODE" | tee -a /dev/null
    GITHUB_PR_EXIT=0
    GITHUB_OPERATION_PHASE="completed"
    unset token
    return 0
  fi
  
  # Create pull request. Both pr and draft_pr push a branch and create a PR;
  # only draft_pr marks the GitHub Pulls API request as draft.
  GITHUB_OPERATION_PHASE="pr_creation"
  printf 'Creating pull request...\n' | tee -a /dev/null
  emit_progress "github operations" "pr_creation_starting"
  local pr_title pr_body pr_response pr_url pr_number pr_http_status pr_draft_json
  pr_title="$(derive_pr_title)"
  pr_body="$(build_pr_body)"
  local pr_body_compact
  pr_body_compact="$(printf '%s' "$pr_body" | tr -d '[:space:]')"
  if [ -z "$pr_body_compact" ]; then
    local fallback_timestamp fallback_validation_status
    fallback_timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    fallback_validation_status="unknown"
    fallback_validation_status="$([ "$VALIDATION_EXIT" -eq 0 ] && printf 'passed' || printf 'failed (exit %s)' "$VALIDATION_EXIT")"
    pr_body=$(cat <<EOF
## Summary
- Automated PR body fallback was used because generated body was empty after sanitization.

## Validation
- Post-agent validation: $fallback_validation_status
- Publish mode: ${KASEKI_PUBLISH_MODE:-pr}

## Run metadata
- Generated at (UTC): $fallback_timestamp
EOF
)
    printf 'WARN: build_pr_body returned empty content after sanitization; using fallback PR body.\n'  >&2
  fi
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
      printf 'Retrying PR creation (attempt %d of %d) after %ds delay...\n' $((retry_count + 1)) "$max_retries" "$backoff_delay" | tee -a /dev/null
      emit_progress "github operations" "pr_creation_attempt $((retry_count + 1))/$max_retries"
      sleep "$backoff_delay"
      # Exponential backoff: 2s, 4s, 8s
      backoff_delay=$((backoff_delay * 2))
      if [ $backoff_delay -gt 8 ]; then backoff_delay=8; fi
    fi
    
    # Capture both response and HTTP status code
    local pr_response_file temp_status_file
    pr_response_file="$(mktemp /tmp/kaseki-pr-response.XXXXXX)" || { printf 'Failed to create temp file for PR response\n'  >&2; GITHUB_PR_EXIT=8; return 8; }
    temp_status_file="$(mktemp /tmp/kaseki-pr-status.XXXXXX)" || { printf 'Failed to create temp file for PR status\n'  >&2; GITHUB_PR_EXIT=8; return 8; }
    
    if [ $retry_count -eq 0 ] && [ "${KASEKI_DEBUG:-0}" = "1" ]; then
      printf 'Debug: Creating PR with head=%s, base=%s, draft=%s\n' "$feature_branch" "$GIT_REF" "$pr_draft_json" | tee -a /dev/null
    fi
    
    # Encode PR title and body as JSON strings
    local pr_title_json pr_body_json
    pr_title_json='""'
    pr_body_json='""'
    if ! run_node_subprocess pr_title_json "console.log(JSON.stringify(require('fs').readFileSync(0, 'utf8')))" "$pr_title" /dev/null; then
      printf 'ERROR: Failed to JSON encode PR title\n'  >&2
      GITHUB_PR_EXIT=8
      return 8
    fi
    if ! run_node_subprocess pr_body_json "console.log(JSON.stringify(require('fs').readFileSync(0, 'utf8')))" "$pr_body" /dev/null; then
      printf 'ERROR: Failed to JSON encode PR body\n'  >&2
      GITHUB_PR_EXIT=8
      return 8
    fi
    
    # Validate both variables are non-empty before using in curl
    if [ -z "$pr_title_json" ] || [ -z "$pr_body_json" ]; then
      printf 'ERROR: JSON encoding produced empty values (title=%s, body=%s)\n' "$pr_title_json" "$pr_body_json"  >&2
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
      printf 'GitHub PR API curl command failed with exit code %d (attempt %d)\n' "$curl_exit" $((retry_count + 1))  >&2
      GITHUB_API_HTTP_STATUS="0"
      if is_github_pr_error_retryable "0" "curl_error" && [ "$retry_count" -lt "$((max_retries - 1))" ]; then
        retry_count=$((retry_count + 1))
        rm -f "$pr_response_file"
        continue
      else
        emit_error_event "github_pr_curl_failed" "curl command failed (exit $curl_exit) when creating PR" "exit"
        GITHUB_API_ERROR_TYPE="curl_error"
        GITHUB_API_ERROR_MESSAGE="curl exited with code $curl_exit"
        GITHUB_API_HTTP_STATUS="0"
        GITHUB_PR_EXIT=8
        rm -f "$pr_response_file"
        return 8
      fi
    fi
    
    if [ "${KASEKI_DEBUG:-0}" = "1" ]; then
      printf 'Debug: PR API response HTTP status: %s (attempt %d)\n' "$pr_http_status" $((retry_count + 1)) | tee -a /dev/null
    fi
    
    # Validate the API response
    if validate_github_api_response "$pr_http_status" "$pr_response" /dev/null; then
      # API returned success (201); now extract the URL and issue number using helper
      if ! run_node_subprocess pr_url "const d = JSON.parse(require('fs').readFileSync(0, 'utf8')); process.stdout.write(d.html_url || '')" "$pr_response" /dev/null; then
        printf 'ERROR: Failed to extract PR URL from API response\n'  >&2
        emit_error_event "github_pr_response_malformed" "Failed to parse PR API response to extract html_url" "exit"
        GITHUB_PR_EXIT=9
        pr_url=""
      fi
      if ! run_node_subprocess pr_number "const d = JSON.parse(require('fs').readFileSync(0, 'utf8')); if (Number.isInteger(d.number)) process.stdout.write(String(d.number));" "$pr_response" /dev/null; then
        printf 'Warning: failed to extract PR number from API response; leaving PR unlabeled\n'  >&2
        pr_number=""
      fi
      
      if [ -n "$pr_url" ]; then
        GITHUB_PR_URL="$pr_url"
        GITHUB_PR_EXIT=0
        printf 'Pull request created: %s\n' "$pr_url" | tee -a /dev/null
        if [ -n "$pr_number" ]; then
          apply_github_pr_labels "$owner" "$repo" "$pr_number" "$token" /dev/null || true
          # Request repository owner as reviewer for personal repos
          request_owner_review "$pr_response" "$token" /dev/null || true
        else
          printf 'Warning: PR API response missing number field; leaving PR unlabeled\n'  >&2
        fi
        pr_created=1
        rm -f "$pr_response_file"
        break
      else
        # HTTP 201 but no html_url in response - malformed response
        printf 'Pull request API returned success (201) but response missing html_url field\n'  >&2
        emit_error_event "github_pr_response_malformed" "GitHub PR API returned 201 but response missing html_url field" "exit"
        if [ "${KASEKI_DEBUG:-0}" = "1" ]; then
          printf 'Debug: Full API response:\n%s\n' "$pr_response" | tee -a /dev/null
        fi
        GITHUB_PR_EXIT=9
        pr_created=0
        rm -f "$pr_response_file"
        break
      fi
    else
      # API returned an error
      if is_github_pr_error_retryable "$pr_http_status" "$GITHUB_API_ERROR_TYPE" && [ "$retry_count" -lt "$((max_retries - 1))" ]; then
        printf 'GitHub API returned retryable error (attempt %d): %s (HTTP %s)\n' $((retry_count + 1)) "$GITHUB_API_ERROR_TYPE" "$pr_http_status" | tee -a /dev/null
        retry_count=$((retry_count + 1))
        rm -f "$pr_response_file"
        continue
      else
        # Permanent error, give up
        printf 'Failed to create PR. API error: %s\n' "$GITHUB_API_ERROR_MESSAGE"  >&2
        emit_error_event "github_pr_api_failed" "GitHub API error ($GITHUB_API_ERROR_TYPE): $GITHUB_API_ERROR_MESSAGE (HTTP $GITHUB_API_HTTP_STATUS)" "exit"
        if [ "${KASEKI_DEBUG:-0}" = "1" ]; then
          printf 'Debug: API error type: %s, HTTP status: %s\n' "$GITHUB_API_ERROR_TYPE" "$GITHUB_API_HTTP_STATUS" | tee -a /dev/null
          printf 'Debug: Full response:\n%s\n' "$pr_response" | tee -a /dev/null
        fi
        GITHUB_PR_EXIT=9
        pr_created=0
        rm -f "$pr_response_file"
        break
      fi
    fi
  done
  
  if [ "$pr_created" -eq 0 ] && [ "$GITHUB_PR_EXIT" -ne 0 ]; then
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
    emit_error_event "github_preflight_failed" "GitHub operations health check failed; check ${KASEKI_RESULTS_DIR}/github-health-check.log for details" "continue"
  fi
fi

# Resolve LLM Gateway Configuration
llm_gateway_url=""
llm_gateway_api_key=""
llm_gateway_api_key_source=""

# Only validate and resolve gateway credentials when using the gateway provider.
# Other providers (openrouter, anthropic, etc.) use their own credential mechanisms.
if [ "$KASEKI_PROVIDER" = "gateway" ]; then
  # Stage 1: Check explicit gateway URL
  if [ -z "${LLM_GATEWAY_URL:-}" ]; then
    set_current_stage "agent setup"
    printf 'Missing LLM Gateway configuration for provider=gateway.\n' | tee -a "${KASEKI_RESULTS_DIR}"/pi-stderr.log >&2
    printf '  Set LLM_GATEWAY_URL with an OpenAI-compatible endpoint:\n' | tee -a "${KASEKI_RESULTS_DIR}"/pi-stderr.log >&2
    printf '    - CloudFlare AI: https://gateway.ai.cloudflare.com/v1/{account_id}/{namespace}/compat\n' | tee -a "${KASEKI_RESULTS_DIR}"/pi-stderr.log >&2
    printf '    - Azure OpenAI: https://{resource}.openai.azure.com/\n' | tee -a "${KASEKI_RESULTS_DIR}"/pi-stderr.log >&2
    printf '    - Ollama: http://localhost:11434/v1\n' | tee -a "${KASEKI_RESULTS_DIR}"/pi-stderr.log >&2
    printf '    - Other: {your-endpoint}\n' | tee -a "${KASEKI_RESULTS_DIR}"/pi-stderr.log >&2
    printf '  Or set KASEKI_PROVIDER=openrouter and provide OPENROUTER_API_KEY to use OpenRouter instead.\n' | tee -a "${KASEKI_RESULTS_DIR}"/pi-stderr.log >&2
    : > "$RAW_EVENTS"
    PI_EXIT=2
    STATUS=2
    FAILED_COMMAND="missing LLM_GATEWAY_URL"
    emit_error_event "llm_gateway_config_missing" "Missing LLM gateway configuration; LLM_GATEWAY_URL not set" "exit"
    printf 'Skipped: LLM Gateway URL is missing; agent setup phase did not run\n' > "${KASEKI_RESULTS_DIR}"/quality.log
    printf 'Skipped: LLM Gateway URL is missing; agent did not run\n' > "${KASEKI_RESULTS_DIR}"/secret-scan.log
    exit 0
  fi
  llm_gateway_url="$LLM_GATEWAY_URL"

  # Stage 2: Check explicit API key
  if [ -n "${LLM_GATEWAY_API_KEY:-}" ]; then
    llm_gateway_api_key="$LLM_GATEWAY_API_KEY"
    llm_gateway_api_key_source="env"
  else
    # Stage 3: Check secret file
    llm_gateway_api_key_file="${LLM_GATEWAY_API_KEY_FILE:-$HOME/.kaseki/secrets.json}"
    if [ -r "$llm_gateway_api_key_file" ]; then
      secret_content="$(cat "$llm_gateway_api_key_file")"
      if [ -n "$secret_content" ]; then
        llm_gateway_api_key="$secret_content"
        llm_gateway_api_key_source="secret file"
      fi
    fi
  fi
  unset LLM_GATEWAY_API_KEY secret_content

  if [ -z "$llm_gateway_api_key" ]; then
    set_current_stage "agent setup"
    llm_gateway_api_key_file="${LLM_GATEWAY_API_KEY_FILE:-$HOME/.kaseki/secrets.json}"
    printf 'Missing LLM Gateway API key. Set LLM_GATEWAY_API_KEY or provide a readable LLM_GATEWAY_API_KEY_FILE at %s.\n' "$llm_gateway_api_key_file" | tee -a "${KASEKI_RESULTS_DIR}"/pi-stderr.log >&2
    : > "$RAW_EVENTS"
    PI_EXIT=2
    STATUS=2
    FAILED_COMMAND="missing LLM_GATEWAY_API_KEY"
    emit_error_event "llm_gateway_auth_config_missing" "Missing LLM Gateway API key; checked LLM_GATEWAY_API_KEY and LLM_GATEWAY_API_KEY_FILE=$llm_gateway_api_key_file" "exit"

    # Create required artifacts for early exit
    printf 'Skipped: LLM Gateway API key is missing; agent setup phase did not run\n' > "${KASEKI_RESULTS_DIR}"/quality.log
    printf 'Skipped: LLM Gateway API key is missing; agent did not run\n' > "${KASEKI_RESULTS_DIR}"/secret-scan.log

    # Finalize deterministically before any Pi-dependent agent phase can run with an empty key.
    exit 0
  fi

  if ! check_gateway_provider_capability; then
    exit 0
  fi
fi


if ! run_clone_repository; then
  exit 0
fi
cd "${KASEKI_WORKSPACE_DIR}"/repo || { STATUS=1; FAILED_COMMAND="enter repository"; exit "$STATUS"; }
apply_default_validation_commands

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
  install_reason="no_cache_available"
  restore_mode="$KASEKI_DEPENDENCY_RESTORE_MODE"
  restore_method="$restore_mode"
  case "$restore_mode" in
    auto|copy|hardlink|symlink) ;;
    *)
      printf 'Unsupported KASEKI_DEPENDENCY_RESTORE_MODE: %s (expected auto, copy, hardlink, or symlink)\n' "$restore_mode" >&2
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
      # Phase 2D: Emit cache metric to JSON
      append_cache_metric "${KASEKI_RESULTS_DIR}"/cache-metrics.json "existing_node_modules" "true" "repo" "0" "lock_hash_match"
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
    # Phase 2D: Emit cache metric to JSON
    append_cache_metric "${KASEKI_RESULTS_DIR}"/cache-metrics.json "workspace_cache_restored" "true" "workspace" "0" "restore_completed"
    cache_reused="true"
    cache_source="workspace"
    if ! npm ls --depth=0 >/dev/null 2>&1; then
      printf 'Dependency cache status: workspace cache failed npm ls validation; reinstalling.\n'
      set_dependency_cache_status "workspace-cache-invalid" "$cache_detail restore_method=$restore_method reason=npm_ls_failed"
      emit_event "dependency_cache_decision" "strategy=invalidate_workspace_cache" "restore_mode=$restore_mode" "restore_method=$restore_method" "reason=npm_ls_failed" "location=$workspace_cache_dir" "lock_hash=$lock_hash" "cache_key=$cache_key" "repo_ref_key=$repo_ref_key" "repo_url=$REPO_URL" "git_ref=$GIT_REF" "node_major=$node_major" "flags_hash=$flags_hash"
      # Phase 2D: Emit cache metric to JSON (validation failure)
      append_cache_metric "${KASEKI_RESULTS_DIR}"/cache-metrics.json "workspace_cache_invalid" "true" "workspace" "0" "npm_ls_failed"
      rm -rf node_modules
      invalidate_workspace_dependency_cache "$workspace_cache_dir" "$stamp_file" "$metadata_file"
      cache_reused="false"
      cache_source="none"
      install_reason="workspace_cache_validation_failed"
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
    # Phase 2D: Emit cache metric to JSON
    append_cache_metric "${KASEKI_RESULTS_DIR}"/cache-metrics.json "image_cache_restored" "true" "image" "0" "restore_completed"
    cache_reused="true"
    cache_source="image"
    if ! npm ls --depth=0 >/dev/null 2>&1; then
      printf 'Dependency cache status: image cache failed npm ls validation; reinstalling.\n'
      set_dependency_cache_status "image-cache-invalid" "$cache_detail restore_method=$restore_method reason=npm_ls_failed"
      emit_event "dependency_cache_decision" "strategy=invalidate_image_cache" "restore_mode=$restore_mode" "restore_method=$restore_method" "reason=npm_ls_failed" "location=$image_cache_dir" "lock_hash=$lock_hash" "cache_key=$cache_key" "repo_ref_key=$repo_ref_key" "repo_url=$REPO_URL" "git_ref=$GIT_REF" "node_major=$node_major" "flags_hash=$flags_hash"
      # Phase 2D: Emit cache metric to JSON (validation failure)
      append_cache_metric "${KASEKI_RESULTS_DIR}"/cache-metrics.json "image_cache_invalid" "true" "image" "0" "npm_ls_failed"
      rm -rf node_modules
      cache_reused="false"
      cache_source="none"
      install_reason="image_cache_validation_failed"
    fi
  fi

  if [ ! -d node_modules ]; then
    if [ "$install_reason" = "no_cache_available" ]; then
      printf 'Dependency cache status: cache miss for lock hash %s (repo_ref_key=%s), running install.\n' "$lock_hash" "$repo_ref_key"
    else
      printf 'Dependency cache status: installing after restored dependency cache failed validation (reason=%s; lock_hash=%s; repo_ref_key=%s).\n' "$install_reason" "$lock_hash" "$repo_ref_key"
    fi
    set_dependency_cache_status "cache-install-required" "$cache_detail reason=$install_reason"
    emit_event "dependency_cache_decision" "strategy=fresh_install" "restore_mode=$restore_mode" "restore_method=none" "reason=$install_reason" "location=none" "lock_hash=$lock_hash" "cache_key=$cache_key" "repo_ref_key=$repo_ref_key" "repo_url=$REPO_URL" "git_ref=$GIT_REF" "node_major=$node_major" "flags_hash=$flags_hash"
    # Phase 2D: Emit cache metric to JSON (cache miss)
    append_cache_metric "${KASEKI_RESULTS_DIR}"/cache-metrics.json "fresh_install" "true" "none" "0" "$install_reason"
    emit_progress "dependency install" "started cache_hit=false restore_mode=$restore_mode restore_method=none lockfile=$lock_source lock_hash=$lock_hash repo_ref_key=$repo_ref_key node_major=$node_major flags_hash=$flags_hash flags=$install_flags_display"
    install_start="$(date +%s)"
    if ! npm ci --prefer-offline "${install_flags[@]}"; then
      exec {cache_lock_fd}>&-
      # Report to Sentry if available
      sentry_error "npm ci failed with exit code $?" "npm-ci" "1" "$(($(date +%s) - install_start))" 2>/dev/null || true
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
    # Phase 2D: Emit cache metric to JSON (skip install)
    append_cache_metric "${KASEKI_RESULTS_DIR}"/cache-metrics.json "skip_install" "true" "$cache_source" "0" "cache_hit"
    if [ "$cache_reused" = "true" ]; then
      emit_progress "dependency install" "cache hit source=$cache_source restore_mode=$restore_mode restore_method=$restore_method lockfile=$lock_source lock_hash=$lock_hash repo_ref_key=$repo_ref_key node_major=$node_major flags_hash=$flags_hash flags=$install_flags_display"
      record_stage_timing "dependency install" "0" "0" "cache_hit=true cache_source=$cache_source install_mode=skipped restore_mode=$restore_mode restore_method=$restore_method lockfile=$lock_source lock_hash=$lock_hash repo_ref_key=$repo_ref_key node_major=$node_major flags_hash=$flags_hash flags=$install_flags_display"
    fi
  fi

  if [ "$cache_reused" = "true" ] && [ "$cache_source" = "workspace" ]; then
    printf 'Dependency cache status: workspace cache already current; skipping cache publish.\n' | tee -a "$DEPENDENCY_CACHE_LOG"
    set_dependency_cache_status "workspace-cache-publish-skipped" "$cache_detail restore_method=$restore_method reason=workspace_cache_hit"
    emit_event "dependency_cache_decision" "strategy=skip_workspace_cache_publish" "restore_mode=$restore_mode" "restore_method=$restore_method" "reason=workspace_cache_hit" "location=$workspace_cache_dir" "lock_hash=$lock_hash" "cache_key=$cache_key" "repo_ref_key=$repo_ref_key" "repo_url=$REPO_URL" "git_ref=$GIT_REF" "node_major=$node_major" "flags_hash=$flags_hash"
    prune_dependency_cache "$KASEKI_DEPENDENCY_CACHE_DIR" "$KASEKI_DEPENDENCY_CACHE_MAX_BYTES" "$KASEKI_DEPENDENCY_CACHE_MAX_AGE_DAYS" "$KASEKI_DEPENDENCY_CACHE_METRICS_FILE"
    exec {cache_lock_fd}>&-
    return 0
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
  record_dependency_cache_entry_size "$workspace_cache_root" "$workspace_cache_dir"
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

  prune_dependency_cache "$KASEKI_DEPENDENCY_CACHE_DIR" "$KASEKI_DEPENDENCY_CACHE_MAX_BYTES" "$KASEKI_DEPENDENCY_CACHE_MAX_AGE_DAYS" "$KASEKI_DEPENDENCY_CACHE_METRICS_FILE"

  exec {cache_lock_fd}>&-
  return 0
}

if ! run_step "prepare node dependencies" prepare_dependencies; then
  exit 0
fi

# Baseline validation: checkout main branch and run validation commands for test failure comparison
if [ "$KASEKI_BASELINE_VALIDATION_ENABLED" = "1" ] && [ "$KASEKI_PRE_AGENT_VALIDATION" = "1" ]; then
  printf '\n==> baseline validation setup\n'
  set_current_stage "baseline validation setup"
  emit_progress "baseline validation setup" "started"
  
  # Check cache first
  baseline_cache_dir="$(baseline_validation_cache_dir)"
  
  if restore_baseline_validation_from_cache "$baseline_cache_dir"; then
    BASELINE_CACHE_STATUS="cache_hit"
    emit_progress "baseline validation" "restored from cache (age < ${KASEKI_BASELINE_CACHE_MAX_AGE_HOURS}h, validation_commands_hash=${baseline_cache_dir##*/})"
    record_stage_timing "baseline validation" "0" "0" "cache_hit=true cache_dir=$baseline_cache_dir"
  else
    # Cache miss: checkout and run validation
    if checkout_baseline_repo; then
      BASELINE_CACHE_STATUS="completed"
      run_baseline_validation || {
        BASELINE_CACHE_STATUS="validation_failed"
        emit_progress "baseline validation" "completed with failures (will compare against working results)"
      }
      # Save results to cache for future runs
      if save_baseline_validation_to_cache "$baseline_cache_dir"; then
        emit_progress "baseline validation cache" "saved for future runs (will be valid for ${KASEKI_BASELINE_CACHE_MAX_AGE_HOURS}h)"
      else
        emit_progress "baseline validation cache" "failed to save (non-blocking)"
      fi
      # Cleanup baseline workspace to save space
      rm -rf "${KASEKI_WORKSPACE_BASELINE_DIR}" 2>/dev/null || true
    else
      BASELINE_CACHE_STATUS="checkout_failed"
      emit_error_event "baseline_checkout_failed" "Failed to setup baseline for test failure comparison; continuing without baseline" "continue"
    fi
  fi
else
  if [ "$KASEKI_BASELINE_VALIDATION_ENABLED" != "1" ]; then
    BASELINE_CACHE_STATUS="disabled"
    emit_progress "baseline validation" "disabled via KASEKI_BASELINE_VALIDATION_ENABLED"
  fi
fi

if [ "$KASEKI_PRE_AGENT_VALIDATION" = "0" ]; then
  printf '\n==> pre-agent validation\n'
  set_current_stage "pre-agent validation"
  emit_progress "pre-agent validation" "skipped by KASEKI_PRE_AGENT_VALIDATION=0"
  printf 'Pre-agent validation skipped because KASEKI_PRE_AGENT_VALIDATION=0.\n' >/dev/null
  record_stage_timing "pre-agent validation" 0 0 "skipped_by_config"
else
  run_validation_commands \
    "pre-agent validation" \
    "$KASEKI_PRE_AGENT_VALIDATION_COMMANDS" \
    "${KASEKI_RESULTS_DIR}/pre-validation.log" \
    "${KASEKI_RESULTS_DIR}/pre-validation.raw.log" \
    "$PRE_VALIDATION_TIMINGS_FILE" \
    "${KASEKI_RESULTS_DIR}/pre-agent-validation-env.log" \
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

# TypeScript pre-check: runs after pre-agent validation, before scouting agent
# Now with auto-detection: skips gracefully if no TypeScript is detected or npm script is missing
# Only fails if TypeScript is present AND the check genuinely fails
printf '\n==> typescript pre-check\n'
set_current_stage "typescript precheck"
if ! run_typescript_precheck; then
  if [ "$KASEKI_SCOUTING" = "1" ]; then
    # If scouting is enabled (experimental path), continue anyway with warning
    printf 'WARNING: TypeScript pre-check failed, but continuing due to scouting mode being enabled.\n' | tee -a "${KASEKI_RESULTS_DIR}"/quality.log
  else
    # Without scouting, TypeScript failures are fatal
    STATUS="$TS_PRE_CHECK_EXIT"
    FAILED_COMMAND="typescript precheck"
    emit_error_event "typescript_precheck_failed" "TypeScript pre-check failed before agent invocation" "exit"
    exit 0
  fi
fi

PI_VERSION="$(pi --version 2>&1 | head -n 1 || true)"
printf 'Pi version: %s\n' "$PI_VERSION"

# === Phase 1: Early Filesystem Diagnostics (Before Scouting) ===
# Detects read-only filesystem constraints that would cause silent scouting failures
check_filesystem_capabilities() {
  local results_dir="$KASEKI_RESULTS_DIR"
  local filesystem_writable=true
  local readonly_reason=""
  
  emit_progress "filesystem capabilities check" "verifying write capabilities for artifacts"
  
  # Test "${KASEKI_RESULTS_DIR}"/ writability
  if [ ! -w "$results_dir" ]; then
    filesystem_writable=false
    readonly_reason="${KASEKI_RESULTS_DIR} is READ-ONLY (Docker mounted with :ro or container --read-only flag)"
    emit_error_event "readonly_filesystem_detected" "$readonly_reason" "continue"
    {
      printf '\n[FILESYSTEM DIAGNOSTIC] READ-ONLY FILESYSTEM DETECTED\n'
      printf 'Details:\n'
      printf '  - Directory: %s\n' "$results_dir"
      printf '  - Status: exists but NOT WRITABLE\n'
      printf '  - Container UID: %d\n' "$(id -u)"
      printf '  - Expected reason: Docker mounted with :ro flag or container --read-only\n'
      printf '\nImpact:\n'
      printf '  - Scouting Pi agent will exit 0 but "${KASEKI_RESULTS_DIR}"/scouting-candidate.json will be MISSING\n'
      printf '  - Validation logs and artifacts cannot be written\n'
      printf '  - This causes exit code 86 (scouting validation failure)\n'
      printf '\nFix: Remount ${KASEKI_RESULTS_DIR} as read-write\n'
      printf '  docker run -v /path/to${KASEKI_RESULTS_DIR}:${KASEKI_RESULTS_DIR}:rw ...\n'
      printf 'Or remove --read-only flag from Docker run command\n'
    } | tee -a "${KASEKI_RESULTS_DIR}"/scouting-stderr.log
  else
    # Test actual write capability
    local test_file="$results_dir/.kaseki-fs-test-$$"
    if ! touch "$test_file" 2>/dev/null; then
      filesystem_writable=false
      readonly_reason="${KASEKI_RESULTS_DIR} is not writable (touch failed despite appearing writable)"
      emit_error_event "filesystem_write_test_failed" "$readonly_reason" "continue"
    else
      rm -f "$test_file" 2>/dev/null || true
      emit_progress "filesystem capabilities check" "✓ ${KASEKI_RESULTS_DIR} is writable"
    fi
  fi
  
  # Record in metadata for post-mortem analysis
  printf '%s\n' "$filesystem_writable" > "${KASEKI_RESULTS_DIR}"/filesystem-writable-at-start.txt
  [ -n "$readonly_reason" ] && printf '%s\n' "$readonly_reason" > "${KASEKI_RESULTS_DIR}"/filesystem-readonly-reason.txt
  
  if [ "$filesystem_writable" = "false" ]; then
    if [ "$KASEKI_BASELINE_VALIDATION_ENABLED" = "1" ]; then
      emit_progress "baseline validation preparation" "DISABLED due to read-only filesystem detected"
      KASEKI_BASELINE_VALIDATION_ENABLED="0"
      printf '[filesystem-diagnostic] Baseline validation auto-disabled due to read-only filesystem\n' | tee -a "${KASEKI_RESULTS_DIR}"/quality.log
    fi
    return 1
  fi
  return 0
}

# === Phase 1: Early Scouting Prerequisites Validation ===
# FATAL check before expensive Pi invocation
validate_scouting_prerequisites() {
  local results_dir="$KASEKI_RESULTS_DIR"
  
  printf '\n==> scouting prerequisites check\n'
  set_current_stage "scouting prerequisites validation"
  
  # Skip if scouting disabled
  if [ "$KASEKI_SCOUTING" = "0" ]; then
    emit_progress "scouting prerequisites validation" "skipped (KASEKI_SCOUTING=0)"
    export FILESYSTEM_CHECK_STATUS="skipped"
    return 0
  fi
  
  # Skip in dry-run mode
  if [ "$KASEKI_DRY_RUN" = "1" ]; then
    emit_progress "scouting prerequisites validation" "skipped (dry-run mode)"
    export FILESYSTEM_CHECK_STATUS="skipped"
    return 0
  fi
  
  # Test 1: /results directory exists
  if [ ! -d "$results_dir" ]; then
    printf '\n[SCOUTING PREREQUISITE FAILED] /results directory does not exist\n' >&2
    printf '  Expected: %s\n' "$results_dir" >&2
    printf '\nFix: Ensure /results is mounted as a volume\n' >&2
    printf '  docker run -v /path/to/results:/results:rw ...\n' >&2
    emit_error_event "scouting_prerequisite_failed_missing_results_dir" "/results directory not found at $results_dir" "exit"
    export FILESYSTEM_CHECK_STATUS="read_only"
    export FILESYSTEM_READONLY_REASON="missing /results directory"
    STATUS=83
    FAILED_COMMAND="scouting prerequisites: missing /results directory"
    return 1
  fi
  
  # Test 2: /results is writable (access check)
  if [ ! -w "$results_dir" ]; then
    printf '\n[SCOUTING PREREQUISITE FAILED] /results is not writable\n' >&2
    printf '  Directory: %s\n' "$results_dir" >&2
    printf '  Status: READ-ONLY\n' >&2
    printf '  Container UID: %d\n' "$(id -u)" >&2
    printf '\nRoot cause: Docker volume mounted with :ro flag or container --read-only\n' >&2
    printf '\nImpact:\n' >&2
    printf '  - Scouting Pi agent will fail to write scouting-candidate.json\n' >&2
    printf '  - This causes exit code 86 (scouting validation failure)\n' >&2
    printf '\nFix: Remount /results as read-write\n' >&2
    printf '  docker run -v /path/to/results:/results:rw kaseki-agent\n' >&2
    printf '  (note the :rw flag at the end of the volume mount)\n' >&2
    emit_error_event "scouting_prerequisite_failed_readonly" "/results is read-only (mounted with :ro or --read-only)" "exit"
    export FILESYSTEM_CHECK_STATUS="read_only"
    export FILESYSTEM_READONLY_REASON="/results is read-only (mounted with :ro or --read-only)"
    STATUS=83
    FAILED_COMMAND="scouting prerequisites: /results is read-only"
    return 1
  fi
  
  # Test 3: /results is actually writable (touch test)
  local test_file="$results_dir/.kaseki-prereq-test-$$"
  if ! touch "$test_file" 2>/dev/null; then
    printf '\n[SCOUTING PREREQUISITE FAILED] Cannot write to /results\n' >&2
    printf '  Directory: %s\n' "$results_dir" >&2
    printf '  Test operation: touch %s\n' "$test_file" >&2
    printf '  Error: Permission denied or filesystem error\n' >&2
    printf '\nFix: Check permissions and volume mounts\n' >&2
    printf '  docker run -v /path/to/results:/results:rw kaseki-agent\n' >&2
    emit_error_event "scouting_prerequisite_failed_write_test" "Cannot write test file to /results" "exit"
    export FILESYSTEM_CHECK_STATUS="read_only"
    export FILESYSTEM_READONLY_REASON="Cannot write to /results - permission denied"
    STATUS=83
    FAILED_COMMAND="scouting prerequisites: write permission denied"
    return 1
  fi
  
  # Clean up test file
  rm -f "$test_file" 2>/dev/null || true
  
  export FILESYSTEM_CHECK_STATUS="writable"
  emit_progress "scouting prerequisites validation" "✓ All checks passed"
  return 0
}

# Early validation BEFORE any expensive operations
if ! validate_scouting_prerequisites; then
  printf '\n==> exiting due to scouting prerequisites check\n'
  emit_error_event "scouting_prerequisites_validation_failed" "Scouting prerequisites validation failed before Pi invocation (exit 83)" "exit"
  exit 0
fi

# Call diagnostics before scouting (non-fatal for other checks)
check_filesystem_capabilities || true  # logs additional diagnostic info

# Goal-setting agent runs first (before scouting) to upgrade the user prompt into a mature goal
if [ "$KASEKI_GOAL_SETTING" = "1" ]; then
  if ! run_goal_setting_agent_with_retry; then
    # Goal-setting failure is non-fatal; continue with original TASK_PROMPT
    printf 'Goal-setting agent failed or was skipped; continuing with original TASK_PROMPT\n'
  fi
fi

if ! run_scouting_agent_with_retry; then
  exit 0
fi

if [ "$KASEKI_TASK_MODE" = "inspect" ]; then
  printf '{"version":1,"source_artifacts":{"goal_setting":null,"scouting":null},"required_files":[],"required_search_strings":[],"forbidden_empty_diff":false}\n' > "$CRITICAL_CHANGE_EXPECTATIONS_ARTIFACT"
else
  derive_critical_change_expectations
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
      
      # Log merge decisions with structured JSON construction so pattern text is escaped safely.
      append_jsonl_object "${KASEKI_RESULTS_DIR}"/metadata.jsonl \
        "timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        "event=allowlist_merge" \
        "scouting_agent_patterns=$scouting_agent_patterns" \
        "user_agent_patterns=$user_agent_patterns" \
        "merged_agent_allowlist=$merged_agent_allowlist" \
        "scouting_validation_patterns=$scouting_validation_patterns" \
        "user_validation_patterns=$user_validation_patterns" \
        "merged_validation_allowlist=$merged_validation_allowlist"
      
      allowlist_merge_status="merged"
      
      # Run coverage validation with dry-run
      if [ -s "${KASEKI_RESULTS_DIR}"/changed-files.txt ]; then
        run_scouting_allowlist_coverage "$SCOUTING_ARTIFACT" 2>&1 | tee -a "${KASEKI_RESULTS_DIR}"/quality.log
      fi
      
      emit_progress "derive allowlist from scouting" "finished (status=$allowlist_merge_status)"
    else
      # Pattern validation failed - fail fast
      printf 'ERROR: Derived allowlist patterns failed validation. Cannot proceed.\n' | tee -a "${KASEKI_RESULTS_DIR}"/quality.log >&2
      STATUS=86
      FAILED_COMMAND="allowlist pattern validation"
      emit_error_event "scouting_allowlist_invalid" "Derived allowlist patterns failed validation" "exit"
      exit 0
    fi
  else
    # Derivation failed - log and fail fast
    printf 'ERROR: Failed to derive allowlist from scouting artifact: %s\n' "$scouting_output" | tee -a "${KASEKI_RESULTS_DIR}"/quality.log >&2
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
VALIDATION_ALLOWLIST_FAILURE_REASON=""
VALIDATION_STOPPED_EARLY=false
VALIDATION_COMMANDS_ATTEMPTED=0
QUALITY_EXIT=0
QUALITY_FAILURE_REASON=""
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
  } | tee -a "${KASEKI_RESULTS_DIR}"/pi-stderr.log
  emit_progress "pi coding agent" "skipped (dry-run)"
  record_stage_timing "pi coding agent" "0" "$PI_DURATION_SECONDS" "dry_run=true"
else
  set +e
  [ -n "$llm_gateway_api_key_source" ] && printf 'LLM Gateway API key source: %s\n' "$llm_gateway_api_key_source"
  export KASEKI_STREAM_PROGRESS
  
  # Run kaseki-summarizer to pre-process files
  if command -v kaseki-summarizer >/dev/null 2>&1; then
    printf 'Running summarization analysis...\n'
    summarizer_exit=0
    kaseki-summarizer --repo-dir "$WORKSPACE_DIR" --results-dir "$KASEKI_RESULTS_DIR" --verbose >"${KASEKI_RESULTS_DIR}"/summarizer-stdout.log 2>"${KASEKI_RESULTS_DIR}"/summarizer-stderr.log || summarizer_exit=$?
    if [ -f "${KASEKI_RESULTS_DIR}"/summarization-metadata.json ]; then
      node - "${KASEKI_RESULTS_DIR}/summarization-metadata.json" "$summarizer_exit" "${KASEKI_RESULTS_DIR}/summarizer-stdout.log" <<'NODE' 2>/dev/null || true
const fs = require('node:fs');
const [file, exitCode, stdoutFile] = process.argv.slice(2);
let data = {};
try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
let stdoutTail = '';
try { stdoutTail = fs.readFileSync(stdoutFile, 'utf8').split(/\r?\n/).filter(Boolean).slice(-20).join('\n'); } catch {}
data.status = Number(exitCode) === 0 ? 'completed' : 'failed';
data.exit_code = Number(exitCode);
data.stdout_tail = stdoutTail;
data.stdout_artifact_removed = 'summarizer-stdout.log';
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
NODE
      printf '✓ Summarization analysis complete\n'
    elif [ "$summarizer_exit" -ne 0 ]; then
      emit_error_event "summarizer_failed" "kaseki-summarizer exited with $summarizer_exit" "continue"
    fi
  fi
  
  agent_prompt="$(build_agent_prompt)"
  PI_START_EPOCH="$(date +%s)"
  run_pi_with_retry "$RAW_EVENTS" "$KASEKI_AGENT_TIMEOUT_SECONDS" "$KASEKI_MODEL" "$agent_prompt" "pi-summary" "${KASEKI_RESULTS_DIR}/pi-stderr.log" "pi coding" "1"
  PI_EXIT="$?"
  unset agent_prompt
  PI_DURATION_SECONDS=$(($(date +%s) - PI_START_EPOCH))
  unset LLM_GATEWAY_API_KEY LLM_GATEWAY_URL
  set +e
  record_stage_timing "pi coding agent" "$PI_EXIT" "$PI_DURATION_SECONDS" "timeout_seconds=$KASEKI_AGENT_TIMEOUT_SECONDS"

  PI_EXTRACTION_DEPS_OK=1
  missing_executables=()
  missing_helpers=()
  for required_exec in kaseki-pi-event-filter kaseki-pi-progress-stream validation-output-filter; do
    if ! command -v "$required_exec" >/dev/null 2>&1; then
      missing_executables+=("$required_exec")
    fi
  done
  for helper_file in "${KASEKI_APP_LIB_DIR}"/event-aggregator.js ${KASEKI_APP_LIB_DIR}/timestamp-tracker.js ${KASEKI_APP_LIB_DIR}/progress-stream-utils.js; do
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
' "$extraction_error" | tee -a "${KASEKI_RESULTS_DIR}"/pi-stderr.log "${KASEKI_RESULTS_DIR}"/quality.log >&2
    emit_error_event "pi_extraction_dependency_missing" "missing executables: $missing_execs_joined; missing helpers: $missing_helpers_joined; ensure Pi binaries are in PATH and /app/lib helpers are present" "abort_extraction"
    if [ "$STATUS" -eq 0 ]; then
      STATUS=87
      FAILED_COMMAND="pi artifact extraction dependency validation"
    fi
    cp "$RAW_EVENTS" "${KASEKI_RESULTS_DIR}"/pi-events.raw.jsonl 2>/dev/null || true
  fi

  if [ "$PI_EXTRACTION_DEPS_OK" -eq 1 ]; then
    run_pi_event_filter_export "$RAW_EVENTS" "${KASEKI_RESULTS_DIR}"/pi-events.jsonl "${KASEKI_RESULTS_DIR}"/pi-summary.json
  fi
  if [ -s "$RAW_EVENTS" ] && { [ ! -s "${KASEKI_RESULTS_DIR}"/pi-events.jsonl ] || [ ! -s "${KASEKI_RESULTS_DIR}"/pi-summary.json ]; }; then
    printf 'ERROR: pi event export incomplete; raw events are non-empty but event artifacts are missing/empty\n' | tee -a "${KASEKI_RESULTS_DIR}"/pi-stderr.log >&2
    emit_error_event "pi_event_export_incomplete" "RAW_EVENTS has data but exported artifacts are empty or missing" "continue"
    if [ "$STATUS" -eq 0 ]; then
      STATUS=86
      FAILED_COMMAND="pi event export incomplete"
    fi
  fi
  if capture_provider_error_from_summary "${KASEKI_RESULTS_DIR}/pi-summary.json" "coding"; then
    PI_EXIT=88
    if [ "$STATUS" -eq 0 ]; then
      STATUS=88
      FAILED_COMMAND="pi provider error"
    fi
    emit_error_event "$PROVIDER_ERROR_TYPE" "Coding provider error: $PROVIDER_ERROR_MESSAGE" "exit"
  fi
  if [ "$PI_EXIT" -eq 0 ] && detect_empty_successful_agent_turn "${KASEKI_RESULTS_DIR}/pi-events.jsonl" "${KASEKI_RESULTS_DIR}/pi-agent-diagnostics.jsonl" "coding"; then
    GOAL_CHECK_MET=false
    GOAL_CHECK_FAILURE_REASON="provider_empty_assistant_turn: Coding agent returned a successful Pi exit code but produced no assistant text and no tool calls."
    GOAL_CHECK_RETRY_PROMPT="The previous coding attempt returned an empty assistant turn: no assistant text, no tool calls, and no repository diff. Re-read the original task prompt, inspect the relevant files from ${SCOUTING_ARTIFACT} and ${CRITICAL_CHANGE_EXPECTATIONS_ARTIFACT}, then make the smallest repository change required by the task before finishing."
    printf '%s\n' "$GOAL_CHECK_RETRY_PROMPT" | tee -a "${KASEKI_RESULTS_DIR}"/pi-stderr.log "${KASEKI_RESULTS_DIR}"/goal-check-stderr.log
    emit_error_event "provider_empty_assistant_turn" "Coding agent returned a zero exit code with an empty assistant turn" "retry"
    snapshot_attempt_artifacts "$coding_attempt"
    if [ "$coding_attempt" -lt "$max_coding_attempts" ]; then
      emit_progress "pi coding agent" "retrying after empty assistant turn (attempt $coding_attempt of $max_coding_attempts)"
      coding_attempt=$((coding_attempt + 1))
      continue
    fi
    PI_EXIT=88
    if [ "$STATUS" -eq 0 ]; then
      STATUS=88
      FAILED_COMMAND="pi provider empty assistant turn"
      PROVIDER_ERROR_TYPE="provider_empty_assistant_turn"
      PROVIDER_ERROR_PHASE="coding"
      PROVIDER_ERROR_PROVIDER="$KASEKI_PROVIDER"
      PROVIDER_ERROR_API=""
      PROVIDER_ERROR_MODEL="$KASEKI_MODEL"
      PROVIDER_ERROR_MESSAGE="Coding agent returned a successful Pi exit code but produced no assistant text and no tool calls."
    fi
    emit_error_event "provider_empty_assistant_turn" "$PROVIDER_ERROR_MESSAGE" "exit"
  fi

  # Process hashline_edit events (non-fatal phase; failures don't block pipeline)
  if [ "$PI_EXIT" -eq 0 ] && [ "$KASEKI_HASHLINE_EDITS" != "0" ] && [ -s "${KASEKI_RESULTS_DIR}"/pi-events.jsonl ]; then
    emit_progress "hashline validation" "started"
    HASHLINE_EXIT=0
    set +e
    npx tsx "${KASEKI_APP_LIB_DIR}"/hashline-event-handler-cli.js "${KASEKI_RESULTS_DIR}"/pi-events.jsonl /workspace "${KASEKI_RESULTS_DIR}"/hashline-events.jsonl "${KASEKI_RESULTS_DIR}"/hashline-summary.json 2>> "${KASEKI_RESULTS_DIR}"/hashline-validation.log
    HASHLINE_EXIT=$?
    set +e

    if [ "$HASHLINE_EXIT" -ne 0 ]; then
      printf 'Warning: hashline validation exited with code %s (non-fatal; continuing pipeline)\n' "$HASHLINE_EXIT" | tee -a "${KASEKI_RESULTS_DIR}"/hashline-validation.log
      emit_event "warning" "warning_type=hashline_validation_failed" "detail=hashline_edit processing exited with code $HASHLINE_EXIT"
    else
      emit_progress "hashline validation" "completed"
    fi

    # Record timing for hashline validation
    record_stage_timing "hashline validation" "$HASHLINE_EXIT" "0" "status=processing_hashline_edit_events"
  fi

  ACTUAL_MODEL_HELPER="$SCRIPT_DIR/scripts/resolve-actual-model.js"
  if [ ! -r "$ACTUAL_MODEL_HELPER" ] && [ -r /app/scripts/resolve-actual-model.js ]; then
    ACTUAL_MODEL_HELPER="/app/scripts/resolve-actual-model.js"
  fi
  ACTUAL_MODEL="$(node "$ACTUAL_MODEL_HELPER" "${KASEKI_RESULTS_DIR}/pi-summary.json" "$RAW_EVENTS" 2>/dev/null || printf 'unknown\n')"
  if [ "$ACTUAL_MODEL" = "unknown" ]; then
    emit_event "warning" "warning_type=model_attribution_missing" "detail=Unable to resolve model from pi-summary.json or raw events"
  fi
fi



if [ "$KASEKI_DRY_RUN" != "1" ]; then
  if [ "$PI_EXIT" -eq 124 ]; then
    printf 'pi timeout after %ss (exit 124)\n' "$KASEKI_AGENT_TIMEOUT_SECONDS" | tee -a "${KASEKI_RESULTS_DIR}"/pi-stderr.log >&2
    if [ "$STATUS" -eq 0 ]; then
      STATUS=124
      FAILED_COMMAND="pi coding agent timeout"
      emit_error_event "pi_timeout" "Coding agent exceeded timeout of $KASEKI_AGENT_TIMEOUT_SECONDS seconds" "exit"
      # Report to Sentry if available
      sentry_error "Pi coding agent timeout exceeded $KASEKI_AGENT_TIMEOUT_SECONDS seconds" "pi-invocation" "124" "$KASEKI_AGENT_TIMEOUT_SECONDS" 2>/dev/null || true
    fi
  elif [ "$PI_EXIT" -ne 0 ] && [ "$STATUS" -eq 0 ]; then
    STATUS="$PI_EXIT"
    FAILED_COMMAND="pi coding agent"
    emit_error_event "pi_agent_failed" "Coding agent exited with non-zero code: $PI_EXIT" "exit"
    # Report to Sentry if available
    sentry_error "Pi coding agent failed with exit code $PI_EXIT" "pi-invocation" "$PI_EXIT" "$PI_DURATION_SECONDS" 2>/dev/null || true
  fi
fi

if [ "$PI_EXIT" -ne 0 ]; then
  printf 'Auto lint cleanup deferred/skipped because pi coding agent failed with exit %s.\n' "$PI_EXIT" >> "$AUTO_LINT_CLEANUP_LOG"
elif [ "$STATUS" -ne 0 ]; then
  printf 'Auto lint cleanup deferred/skipped because status is already %s.\n' "$STATUS" >> "$AUTO_LINT_CLEANUP_LOG"
else
  printf 'Auto lint cleanup deferred until after the first critical-change verification.\n' >> "$AUTO_LINT_CLEANUP_LOG"
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

run_quality_checks

run_static_test_impact_check
run_expectation_mismatch_detector

pre_validation_goal_check_diff_hash=""
if [ "$STATUS" -eq 0 ] && [ "$PI_EXIT" -eq 0 ] && [ "$QUALITY_EXIT" -eq 0 ]; then
  if [ "$KASEKI_TASK_MODE" = "patch" ] && [ ! -s "${KASEKI_RESULTS_DIR}/git.diff" ]; then
    skip_auto_lint_cleanup_before_core_change_verified "patch_diff_empty" "collect_git_artifacts produced no patch diff before critical-change verification"
  fi
  if [ "$KASEKI_TASK_MODE" = "inspect" ]; then
    emit_progress "critical change verification" "skipped (inspect mode)"
    printf 'critical change verification skipped for inspect mode\n' >> "${KASEKI_RESULTS_DIR}/critical-change-verification.log"
  elif ! critical_change_failure_output="$(verify_critical_change_expectations 2>&1)"; then
    critical_change_failure_summary="$(printf '%s\n' "$critical_change_failure_output" | awk 'NF { if (seen) printf "; "; printf "%s", $0; seen=1 }')"
    skip_auto_lint_cleanup_before_core_change_verified "critical_change_verification_failed" "$critical_change_failure_summary"
    GOAL_CHECK_MET=false
    if critical_change_expectations_from_scouting_fallback && printf '%s' "$critical_change_failure_summary" | grep -q 'git.diff is empty but forbidden_empty_diff is true'; then
      GOAL_CHECK_FAILURE_REASON="critical_change_expectations_failed_empty_diff_after_scouting_fallback: $(format_fallback_empty_diff_critical_change_failure "Pre-goal-check" "$critical_change_failure_summary")"
      GOAL_CHECK_RETRY_PROMPT="$(format_fallback_empty_diff_repair_prompt "Pre-goal-check" "$critical_change_failure_summary")"
    else
      GOAL_CHECK_FAILURE_REASON="critical_change_expectations_failed: $critical_change_failure_summary"
      GOAL_CHECK_RETRY_PROMPT="Pre-goal-check verification failed before invoking the LLM evaluator. Re-read ${CRITICAL_CHANGE_EXPECTATIONS_ARTIFACT}, inspect ${KASEKI_RESULTS_DIR}/changed-files.txt and ${KASEKI_RESULTS_DIR}/git.diff, then make the required repository changes before finishing. Failures: $critical_change_failure_summary"
    fi
    printf '%s\n' "$GOAL_CHECK_RETRY_PROMPT" | tee -a "${KASEKI_RESULTS_DIR}"/goal-check-stderr.log
    emit_progress "critical change verification" "failed on attempt $coding_attempt"
    snapshot_attempt_artifacts "$coding_attempt"
    if [ "$coding_attempt" -lt "$max_coding_attempts" ]; then
      emit_progress "critical change verification" "retrying coding agent before goal check (attempt $coding_attempt of $max_coding_attempts)"
      coding_attempt=$((coding_attempt + 1))
      continue
    fi
    STATUS=8
    FAILED_COMMAND="critical change verification"
    emit_error_event "critical_change_expectations_failed" "Pre-goal-check verification failed after $coding_attempt attempt(s): $GOAL_CHECK_FAILURE_REASON" "exit"
    break
  fi
  if [ "$KASEKI_TASK_MODE" != "inspect" ]; then
    emit_progress "critical change verification" "passed on attempt $coding_attempt"
  fi

  if [ "$KASEKI_TASK_MODE" != "inspect" ] && [ "$PI_EXIT" -eq 0 ] && [ "$STATUS" -eq 0 ]; then
    run_auto_lint_cleanup_after_core_change_verified
    collect_git_artifacts
    restore_disallowed_changes
    collect_git_artifacts
    if ! critical_change_failure_output="$(verify_critical_change_expectations 2>&1)"; then
      critical_change_failure_summary="$(printf '%s\n' "$critical_change_failure_output" | awk 'NF { if (seen) printf "; "; printf "%s", $0; seen=1 }')"
      GOAL_CHECK_MET=false
      if critical_change_expectations_from_scouting_fallback && printf '%s' "$critical_change_failure_summary" | grep -q 'git.diff is empty but forbidden_empty_diff is true'; then
        GOAL_CHECK_FAILURE_REASON="critical_change_expectations_failed_after_cleanup_empty_diff_after_scouting_fallback: $(format_fallback_empty_diff_critical_change_failure "Post-cleanup" "$critical_change_failure_summary")"
        GOAL_CHECK_RETRY_PROMPT="$(format_fallback_empty_diff_repair_prompt "Post-cleanup" "$critical_change_failure_summary")"
      else
        GOAL_CHECK_FAILURE_REASON="critical_change_expectations_failed_after_cleanup: $critical_change_failure_summary"
        GOAL_CHECK_RETRY_PROMPT="Post-cleanup critical-change verification failed before invoking the LLM evaluator. Re-read ${CRITICAL_CHANGE_EXPECTATIONS_ARTIFACT}, inspect ${KASEKI_RESULTS_DIR}/changed-files.txt and ${KASEKI_RESULTS_DIR}/git.diff, then restore or implement the required repository changes before secondary work. Failures: $critical_change_failure_summary"
      fi
      printf '%s\n' "$GOAL_CHECK_RETRY_PROMPT" | tee -a "${KASEKI_RESULTS_DIR}"/goal-check-stderr.log
      emit_progress "critical change verification" "failed after cleanup on attempt $coding_attempt"
      snapshot_attempt_artifacts "$coding_attempt"
      if [ "$coding_attempt" -lt "$max_coding_attempts" ]; then
        emit_progress "critical change verification" "retrying coding agent after cleanup invalidated the required diff (attempt $coding_attempt of $max_coding_attempts)"
        coding_attempt=$((coding_attempt + 1))
        continue
      fi
      STATUS=8
      FAILED_COMMAND="critical change verification"
      emit_error_event "critical_change_expectations_failed" "Post-cleanup critical-change verification failed after $coding_attempt attempt(s): $GOAL_CHECK_FAILURE_REASON" "exit"
      break
    fi
    emit_progress "critical change verification" "passed after cleanup on attempt $coding_attempt"
  fi

  pre_validation_goal_check_diff_hash="$(sha256sum "${KASEKI_RESULTS_DIR}"/git.diff 2>/dev/null | awk '{print $1}')"
  run_goal_check "$coding_attempt"
  collect_goal_check_feedback "$INSTANCE_NAME"
  snapshot_attempt_artifacts "$coding_attempt"

  if [ "$KASEKI_GOAL_CHECK" = "1" ] && [ -s "$SCOUTING_ARTIFACT" ] && [ "$GOAL_CHECK_MET" != "true" ]; then
    if [ "$coding_attempt" -lt "$max_coding_attempts" ]; then
      emit_progress "goal check" "retrying coding agent after pre-validation unmet verdict (attempt $coding_attempt of $max_coding_attempts)"
      coding_attempt=$((coding_attempt + 1))
      continue
    fi

    STATUS=8
    FAILED_COMMAND="goal check"
    [ -z "$GOAL_CHECK_FAILURE_REASON" ] && GOAL_CHECK_FAILURE_REASON="goal_unmet_after_retries"
    emit_error_event "goal_unmet" "Goal check did not pass after $GOAL_CHECK_ATTEMPTS attempt(s): $GOAL_CHECK_FAILURE_REASON" "exit"
    break
  fi
fi

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
    printf '[validation environment] disk_space_available=%s\n' "$(df -h "${KASEKI_RESULTS_DIR}" 2>/dev/null | tail -1 | awk '{print $4}' || echo '<df failed>')"
    printf '[validation environment] disk_space_used=%s\n' "$(du -sh "${KASEKI_RESULTS_DIR}" 2>/dev/null | cut -f1 || echo '<du failed>')"
  } | tee -a "${KASEKI_RESULTS_DIR}"/validation.log >/dev/null
}
log_validation_environment
collect_changed_file_state "${KASEKI_RESULTS_DIR}"/validation-before-state.txt

if [ "$KASEKI_DRY_RUN" = "1" ] || [ -z "$KASEKI_VALIDATION_COMMANDS" ] || [ "$KASEKI_VALIDATION_COMMANDS" = "none" ]; then
  run_validation_commands \
    "validation" \
    "$KASEKI_VALIDATION_COMMANDS" \
    "${KASEKI_RESULTS_DIR}"/validation.log \
    "/dev/null" \
    "$VALIDATION_TIMINGS_FILE" \
    "${KASEKI_RESULTS_DIR}/validation-env.log" \
    "validation_command_failed"
elif [ "$QUALITY_EXIT" -ne 0 ]; then
  printf '\n==> validation\n'
  set_current_stage "validation"
  emit_progress "validation" "started"
  printf 'Validation skipped because quality gates failed with exit %s.\n' "$QUALITY_EXIT" | tee -a "${KASEKI_RESULTS_DIR}"/validation.log
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
  printf 'Validation skipped because pi coding agent failed with exit %s. Set KASEKI_VALIDATE_AFTER_AGENT_FAILURE=1 to run validation anyway.\n' "$PI_EXIT" | tee -a "${KASEKI_RESULTS_DIR}"/validation.log
  record_stage_timing "validation" "$PI_EXIT" 0 "skipped_after_agent_failure"
  emit_progress "validation" "finished with exit $VALIDATION_EXIT"
else
  run_validation_commands \
    "validation" \
    "$KASEKI_VALIDATION_COMMANDS" \
    "${KASEKI_RESULTS_DIR}"/validation.log \
    "/dev/null" \
    "$VALIDATION_TIMINGS_FILE" \
    "${KASEKI_RESULTS_DIR}/validation-env.log" \
    "validation_command_failed"
  
  # Analyze validation failure causality if validation failed
  if [ "$VALIDATION_EXIT" -ne 0 ]; then
    analyze_validation_failure_causality
  fi
fi

# Check validation-phase allowlist (if configured)
if [ "$VALIDATION_EXIT" -eq 0 ]; then
  collect_changed_file_state "${KASEKI_RESULTS_DIR}"/validation-after-state.txt
  collect_git_artifacts
  if ! check_validation_allowlist; then
    : # Exit code already set in check_validation_allowlist
  fi
fi

post_validation_goal_check_diff_hash="$(sha256sum "${KASEKI_RESULTS_DIR}"/git.diff 2>/dev/null | awk '{print $1}')"
if [ "$STATUS" -eq 0 ] && [ "$PI_EXIT" -eq 0 ] && [ "$QUALITY_EXIT" -eq 0 ] && [ "$VALIDATION_EXIT" -eq 0 ] && \
  [ "$KASEKI_GOAL_CHECK" = "1" ] && [ -s "$SCOUTING_ARTIFACT" ] && \
  [ -n "$pre_validation_goal_check_diff_hash" ] && [ -n "$post_validation_goal_check_diff_hash" ] && \
  [ "$post_validation_goal_check_diff_hash" != "$pre_validation_goal_check_diff_hash" ]; then
  printf 'Validation commands changed the final git diff; re-running goal check against post-validation artifacts.\n' | tee -a "${KASEKI_RESULTS_DIR}"/goal-check-stderr.log
  emit_progress "goal check" "re-running after validation changed the final diff (attempt $coding_attempt)"
  run_goal_check "$coding_attempt"
  collect_goal_check_feedback "$INSTANCE_NAME"

  if [ "$KASEKI_GOAL_CHECK" = "1" ] && [ -s "$SCOUTING_ARTIFACT" ] && [ "$GOAL_CHECK_MET" != "true" ]; then
    snapshot_attempt_artifacts "$coding_attempt"
    if [ "$coding_attempt" -lt "$max_coding_attempts" ]; then
      emit_progress "goal check" "retrying coding agent after post-validation unmet verdict (attempt $coding_attempt of $max_coding_attempts)"
      coding_attempt=$((coding_attempt + 1))
      continue
    fi

    STATUS=8
    FAILED_COMMAND="goal check"
    [ -z "$GOAL_CHECK_FAILURE_REASON" ] && GOAL_CHECK_FAILURE_REASON="goal_unmet_after_retries"
    emit_error_event "goal_unmet" "Goal check did not pass after post-validation diff changed on attempt $GOAL_CHECK_ATTEMPTS: $GOAL_CHECK_FAILURE_REASON" "exit"
    break
  fi
fi

snapshot_attempt_artifacts "$coding_attempt"

if [ "$STATUS" -ne 0 ] || [ "$PI_EXIT" -ne 0 ] || [ "$QUALITY_EXIT" -ne 0 ] || [ "$VALIDATION_EXIT" -ne 0 ]; then
  break
fi

break
done

run_secret_scan

run_run_evaluation

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
: > /dev/null
build_github_skip_reasons
if [ "${#GITHUB_SKIP_REASONS[@]}" -eq 0 ]; then
  github_app_id_file="$(resolve_github_secret_file "GITHUB_APP_ID_FILE" "github_app_id")"
  github_app_client_id_file="$(resolve_github_secret_file "GITHUB_APP_CLIENT_ID_FILE" "github_app_client_id")"
  github_app_private_key_file="$(resolve_github_secret_file "GITHUB_APP_PRIVATE_KEY_FILE" "github_app_private_key")"
  if [ -r "$github_app_id_file" ] && [ -r "$github_app_client_id_file" ] && [ -r "$github_app_private_key_file" ]; then
    run_github_operations
    github_operations_exit=$?
    if [ "$github_operations_exit" -ne 0 ]; then
      if [ "$GITHUB_PUSH_EXIT" -eq 0 ] && [ "$GITHUB_PR_EXIT" -ne 0 ]; then
        GITHUB_PUSH_EXIT="$GITHUB_PR_EXIT"
      elif [ "$GITHUB_PUSH_EXIT" -eq 0 ]; then
        GITHUB_PUSH_EXIT="$github_operations_exit"
      fi
    fi
  else
    GITHUB_SKIP_REASONS+=("github_app_secrets_missing")
    GITHUB_OPERATION_PHASE="secrets"
    printf -- 'GitHub operations: skipped (reasons: %s)\n' "$(IFS=,; printf '%s' "${GITHUB_SKIP_REASONS[*]}")"  >&2
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
    "$GITHUB_APP_ENABLED" | tee -a /dev/null
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
    # Report to Sentry if available
    sentry_error "Validation failed: $VALIDATION_FAILED_COMMAND_DETAIL" "validation" "$VALIDATION_EXIT" "" 2>/dev/null || true
  else
    emit_error_event "validation_failed" "Validation command exited with code $VALIDATION_EXIT" "exit"
    # Report to Sentry if available
    sentry_error "Validation command failed with exit code $VALIDATION_EXIT" "validation" "$VALIDATION_EXIT" "" 2>/dev/null || true
  fi
fi

if [ "$QUALITY_EXIT" -ne 0 ] && [ "$STATUS" -eq 0 ]; then
  STATUS="$QUALITY_EXIT"
  FAILED_COMMAND="quality checks"
  emit_error_event "quality_gate_failed" "Quality gate rule failed (exit code $QUALITY_EXIT)" "exit"
  # Report to Sentry if available
  sentry_error "Quality gate failed with exit code $QUALITY_EXIT" "quality-gates" "$QUALITY_EXIT" "" 2>/dev/null || true
fi

if [ "$SECRET_SCAN_EXIT" -ne 0 ] && [ "$STATUS" -eq 0 ]; then
  STATUS="$SECRET_SCAN_EXIT"
  FAILED_COMMAND="secret scan"
  emit_error_event "secret_scan_failed" "Secret scan detected potential credential leak" "exit"
  # Report to Sentry if available
  sentry_error "Secret scan detected potential credential leak" "secret-scan" "$SECRET_SCAN_EXIT" "" 2>/dev/null || true
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
