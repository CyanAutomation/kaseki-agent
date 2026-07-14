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

KASEKI_MODEL_RESOLUTION_HELPER="${KASEKI_MODEL_RESOLUTION_HELPER:-${KASEKI_SCRIPT_DIR}/scripts/lib/model-resolution.sh}"
if [ ! -r "$KASEKI_MODEL_RESOLUTION_HELPER" ] && [ -r /app/scripts/lib/model-resolution.sh ]; then
  KASEKI_MODEL_RESOLUTION_HELPER="/app/scripts/lib/model-resolution.sh"
fi
if [ ! -r "$KASEKI_MODEL_RESOLUTION_HELPER" ]; then
  printf 'ERROR: Model resolution helper is not readable. Expected %s or /app/scripts/lib/model-resolution.sh. This worker image or mounted template is incomplete; rebuild the image or restore scripts/lib/model-resolution.sh.\n' "$KASEKI_MODEL_RESOLUTION_HELPER" >&2
  exit 66
fi
# shellcheck source=/dev/null
. "$KASEKI_MODEL_RESOLUTION_HELPER" || {
  printf 'ERROR: Failed to source %s (exit code: %d)\n' "$KASEKI_MODEL_RESOLUTION_HELPER" $? >&2
  exit 1
}
kaseki_resolve_provider_model
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
export KASEKI_SCOUTING_EXPLICIT="${KASEKI_SCOUTING+x}"
export KASEKI_GOAL_SETTING_EXPLICIT="${KASEKI_GOAL_SETTING+x}"
export KASEKI_GOAL_CHECK_EXPLICIT="${KASEKI_GOAL_CHECK+x}"
KASEKI_INSPECT_MODE_DEFAULTS_HELPER="${KASEKI_INSPECT_MODE_DEFAULTS_HELPER:-${KASEKI_SCRIPT_DIR}/scripts/inspect-mode-defaults.sh}"
if [ ! -r "$KASEKI_INSPECT_MODE_DEFAULTS_HELPER" ] && [ -r /app/scripts/inspect-mode-defaults.sh ]; then
  KASEKI_INSPECT_MODE_DEFAULTS_HELPER="/app/scripts/inspect-mode-defaults.sh"
fi
if [ ! -r "$KASEKI_INSPECT_MODE_DEFAULTS_HELPER" ]; then
  printf 'ERROR: Inspect-mode defaults helper is not readable. Expected %s or /app/scripts/inspect-mode-defaults.sh. This worker image or mounted template is incomplete; rebuild the image or restore scripts/inspect-mode-defaults.sh.\n' "$KASEKI_INSPECT_MODE_DEFAULTS_HELPER" >&2
  exit 66
fi
# shellcheck source=/dev/null
. "$KASEKI_INSPECT_MODE_DEFAULTS_HELPER" || {
  printf 'ERROR: Failed to source %s (exit code: %d)\n' "$KASEKI_INSPECT_MODE_DEFAULTS_HELPER" $? >&2
  exit 1
}
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
kaseki_apply_inspect_mode_agent_defaults
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
INSTANCE_NAME="${KASEKI_INSTANCE:-kaseki}"
kaseki_apply_task_mode_diff_defaults
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
KASEKI_VALIDATION_TIMEOUT_SECONDS="${KASEKI_VALIDATION_TIMEOUT_SECONDS:-300}"
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
KASEKI_DEPENDENCY_CACHE_SCHEMA_VERSION="${KASEKI_DEPENDENCY_CACHE_SCHEMA_VERSION:-2}"
KASEKI_INSTALL_IGNORE_SCRIPTS="${KASEKI_INSTALL_IGNORE_SCRIPTS:-1}"
KASEKI_NPM_OMIT_DEV="${KASEKI_NPM_OMIT_DEV:-0}"
KASEKI_IMAGE_DEPENDENCY_CACHE_DIR="${KASEKI_IMAGE_DEPENDENCY_CACHE_DIR:-/opt/kaseki/workspace-cache}"
KASEKI_LOG_DIR="${KASEKI_LOG_DIR:-/var/log/kaseki}"
KASEKI_STRICT_HOST_LOGGING="${KASEKI_STRICT_HOST_LOGGING:-0}"
KASEKI_GIT_CACHE_MODE="${KASEKI_GIT_CACHE_MODE:-mirror}"
KASEKI_GIT_CACHE_ROOT="${KASEKI_GIT_CACHE_ROOT:-${KASEKI_CACHE_DIR}/git}"
KASEKI_GIT_CACHE_FETCH_TIMEOUT_SECONDS="${KASEKI_GIT_CACHE_FETCH_TIMEOUT_SECONDS:-120}"
KASEKI_PI_EVENTS_MAX_BYTES="${KASEKI_PI_EVENTS_MAX_BYTES:-16777216}"
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
    printf 'Host log mirror: %s\n 1
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
    2>/
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
  'validatiof '%s' "$VALIDATION_ALLOWLIST_FAILURE_REASON"
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

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/lib/provider-retry.sh"

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
    local metadata_exit_code metadata_failed_command
    metadata_exit_code="$(jq -r '.exit_code // empty' "$metadata_file" 2>/dev/null || true)"
    metadata_failed_command="$(jq -r '.failed_command // empty' "$metadata_file" 2>/dev/null || true)"
    # EXIT finalization can run after metadata was written with an earlier
    # success state. Never let stale metadata downgrade a live failure.
    if [ "$STATUS" -eq 0 ]; then
      exit_code="$metadata_exit_code"
      failed_command="$metadata_failed_command"
    fi
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
    printf '4. **Resource exhaustion** — Disk full, filell,
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
  const diff = read(diffPath);
  const listedFiles = read(changedFilesPath).split(/\r?\n/).map((line) => line.trim().replace(/^\.\//, '')).filter(Boolean);
  const diffFiles = [...diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].map((match) => match[2].trim());
  const changedFiles = new Set([...listedFiles, ...diffFiles]);
  if (diffFiles.some((file) => !listedFiles.includes(file))) {
    notes.push(`recovered_changed_files_from_diff=${diffFiles.filter((file) => !listedFiles.includes(file)).join(',')}`);
    fs.writeFileSync(changedFilesPath, [...changedFiles].sort().join('\n') + '\n');
  }
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
if [ ! -r "$SCOUTING_ALLOWLIST_HELPER" ] && [ -r "$SCRIPT_DIR/scripts/scouting-allowlist.ts" ]; then
  SCOUTING_ALLOWLIST_HELPER="$SCRIPT_DIR/scripts/scouting-allowlist.ts"
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

  chmod 600 "$pi_stderr_log" 2>/dev/null || true

  set +e
  kaseki-pi-event-filter "$raw_events_file" "$events_file" "$summary_file" \
    2> >(tee -a "$pi_stderr_logone_rc=$?
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
    sentry_error "Git clone failed with exit code $code (strategy=$GIT_CLONE_STRATEGY)" "git-clone" "$code" "$GIT_CLONE_DURATION_SECONDS"_log="$2"
  local quality_log="${3:-${KASEKI_RESULTS_DIR}/quality.log}"

  if ! [ -s "$raw_log" ]; then
    return 0
  fi

  {
    printf '\n[DIAGNOSTICS] Raw validation output tail (last 80 lines):\n'
    tail -80 "$raw_log" 2>/dev/null || printf '<failed to read raw validation log>\n'
  } | tee -a "$visible_log" "$quality_log" >/dev/null
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

choose_baseline_log_dir() {
  local preferred_log_dir="${KASEKI_LOG_DIR:-}"
  local fallback_log_dir="${KASEKI_RESULTS_DIR}"
  local temp_parent="${TMPDIR:-/tmp}"
  local temp_log_dir

  if [ -n "$preferred_log_dir" ] && mkdir -p "$preferred_log_dir" 2>/dev/null && [ -w "$preferred_log_dir" ]; then
    printf '%s\n' "$preferred_log_dir"
    return 0
  fi

  if mkdir -p "$fallback_log_dir" 2>/dev/null && [ -w "$fallback_log_dir" ]; then
    printf '%s\n' "$fallback_log_dir"
    return 0
  fi

  temp_log_dir="$(TMPDIR="$temp_parent" mktemp -d -t kaseki-baseline-logs.XXXXXX 2>/dev/null)" || return 1
  if [ -n "$temp_log_dir" ] && [ -d "$temp_log_dir" ] && [ -w "$temp_log_dir" ]; then
    printf '%s\n' "$temp_log_dir"
    return 0
  fi

  return 1
}

checkout_baseline_repo() {
  local baseline_dir="${KASEKI_WORKSPACE_BASELINE_DIR}"
  local baseline_log_dir
  if ! baseline_log_dir="$(choose_baseline_log_dir)d received SIGPIPE while output pipeline was unhealthy.\n'
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
          if [ "$command_exit" -eq 127 ]; then
            {
              printf '\n[DIAGNOSTICS] Command returned exit 127 (command or executable not found).\n'
              printf '  command=%s\n' "$trimmed"
              printf '  PATH=%s\n' "${PATH:-<unset>}"
              printf '  node=%s\n' "$(command -v node 2>&1 || echo '<not found>')"
              printf '  npm=%s\n' "$(command -v npm 2>&1 || echo '<not found>')"
              printf '  bash=%s\n' "$(command -v bash 2>&1 || echo '<not found>')"
              printf '  last_output:\n'
              tail -30 "$raw_log" 2>/dev/null || true
            } | tee -a "$log_file" "${KASEKI_RESULTS_DIR}/validation-command-diagnostics.log"
            validation_detail_ref="first failing command was \"$trimmed\" with exit 127 (command or executable not found; see validation-command-diagnostics.log)"
          elif [ "$command_exit" -eq 124 ]; then
            validation_detail_ref="first failing command was \"$trimmed\" (timed out after ${KASEKI_VALIDATION_TIMEOUT_SECONDS}s; see validation-command-diagnostics.log)"
            printf 'command=%s\ntimeout_seconds=%s\n' "$trimmed" "$KASEKI_VALIDATION_TIMEOUT_SECONDS" >> "${KASEKI_RESULTS_DIR}/validation-command-diagnostics.log"
            emit_event "validation_command_timeout" "stage=$stage_label" "command=$trimmed" "timeout_seconds=$KASEKI_VALIDATION_TIMEOUT_SECONDS"
          fi
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

read_repo_memoryeholder text" > "$results_dir/goal-setting-validation-summary.txt"
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
  H:%M:%SZ)"
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
      # PHASE 1 FIX: Check validation errors FIRST (e.g., schema_mismatch)
      # Only fall back to stderr parsing if no validation errors exist
      if ! capture_validation_error_classification "goal-setting"; then
        capture_provider_error_from_log "${KASEKI_RESULTS_DIR}/goal-setting-stderr.log" "goal-setting" || true
      fi
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

  # Exit code 88 = provider/model error (deterministic until model/config chang:
- task: "[UNCLEAR - needs clarification]"
- requirements: ["Clarify which files are in scope", "Specify concrete acceptance criteria", "Define what done means"]
- relevant_files: []
- observations: ["Task prompt was: <original prompt>", "Unable to scope repository changes without more context"]
- plan: ["Await clarification from use]; then
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
    export KASEKI_SCOUTING_CONTRACT_STRICT=1
    if [ "$attempt" -gt 1 ]; then
      export KASEKI_SCOUTING_CONTRACT_RETRY=1
      rm -f "$SCOUTING_ARTIFACT" "$SCOUTING_CANDIDATE_ARTIFACT" "$SCOUTING_RAW_EVENTS" 2>/dev/null || true
    else
      unset KASEKI_SCOUTING_CONTRACT_RETRY
    fi
    run_scouting_agent 2>"$scouting_stderr_capture"
    scouting_last_exit=$?
    set -e

    scouting_last_stderr="$(cat "$scouting_stderr_capture" 2>/dev/null || true)"
    if [ -n "$scouting_last_stderr" ]; then
      {
        printf '[attempt %d exit %d]\n' "$attempt" "$scouting_last_exit"
        printf '%s\n' "$scouting_last_stderr"
      } >> "${KASEKI_RESULTS_DIR}/scouting-stderr.log"
      # PHASE 1 FIX: Check validation errors FIRST (e.g., schema_mismatch)
      # Only fall back to stderr parsing if no validation errors exist
      if ! capture_validation_error_classification "scouting"; then
        capture_provider_error_from_log "${KASEKI_RESULTS_DIR}/scouting-stderr.log" "scouting" || true
      fi
    fi
    rm -f "$scouting_stderr_capture"

    # Success on any attempt
    node - "$attempt" "$scouting_last_exit" "$SCOUTING_CANDIDATE_ARTIFACT" "${KASEKI_RESULTS_DIR}/scouting-summary.json" <<'NODE' 2>/dev/null || true
const fs = require('node:fs');
const [attempt, exitCode, artifact, summary] = process.argv.slice(2);
let stats = {};
try { statng(s.selected_model || s.model || "").trim(); console.log(v && v !== "unknown" && v !== "null" ? v : "unknown"); } catch { console.log("unknown"); }' 2>/dev/null)"

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

**Goal Quality Contn
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
    if (data "$validation_notes"
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
      [ "$config_count" -eq 0 ] || categorth head=%s, base=%s, draft=%s\n' "$feature_branch" "$GIT_REF" "$pr_draft_json" | tee -a /dev/null
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
  # Provider retries, health checks, and every agent phase must resolve the
  # same endpoint even after phase-local environment cleanup.
  export KASEKI_GATEWAY_URL="$llm_gateway_url"

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

    # Finalize deterministically before a "${KASEKI_RESULTS_DIR}"/cache-metrics.json "image_cache_restored" "true" "image" "0" "restore_completed"
    cache_reused="true"
    cache_source="image"
    if ! npm ls --depth=0 >/dev/null 2>&1 || ! dependency_cache_required_bins_valid package.json; then
      printf 'Dependency cache status: image cache failed npm ls validation; reinstalling.\n'
      emit_error_event "dependency_cache_integrity_failed" "Image dependency cache failed npm/package validation; invalidating and reinstalling (lock_haTASK_PROMPT
    printf 'Goal-setting agent failed or was skipped; continuing with original TASK_PROMPT\n'
  fi
fi

if ! run_scouting_agent_with_retry; then
  exit 0
fi

if kaseki_should_skip_critical_change_gates; then
  kaseki_write_task_mode_critical_change_expectations "$CRITICAL_CHANGE_EXPECTATIONS_ARTIFACT"
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
      if [ -s "${KASEKI_RESULTS_DIR}"/changed-files.txt ]; thnmet verdict (attempt $coding_attempt of $max_coding_attempts)"
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

# A terminal coding-provider failure cannot produce a trustworthy diff. Preserve
# the safety scan, then finalize artifacts instead of presenting validation,
# evaluation, and GitHub operations as meaningful forward progress.
if [ "$PI_EXIT" -eq 88 ] && [ "$STATUS" -ne 0 ]; then
  run_secret_scan
  set_current_stage "terminal provider failure"
  emit_progress "terminal provider failure" "coding provider exhausted; skipping downstream validation, evaluation, and GitHub operations"
  record_stage_timing "terminal provider failure" "$STATUS" 0 "short_circuit_after_provider_failure"
  exit 0
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

  # Exit 127 commonly means a restored dependency tree lost package-manager
  # executable links. Repair dependencies once and retry the full validation
  # sequence; ordinary test/type failures remain fail-fast and are not retried.
  if [ "$VALIDATION_EXIT" -eq 127 ] && [ -f package-lock.json ]; then
    printf 'Validation command was not found (exit 127); repairing dependencies and retrying once.\n' | tee -a "${KASEKI_RESULTS_DIR}"/validatio