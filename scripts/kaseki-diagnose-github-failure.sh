#!/usr/bin/env bash
# kaseki-diagnose-github-failure.sh
# Diagnostic script to analyze github operations failures in kaseki run artifacts
# Usage: ./kaseki-diagnose-github-failure.sh /agents/kaseki-results/kaseki-N

set -eo pipefail

RESULTS_DIR="${1:-.}"
SCRIPT_NAME="$(basename "$0")"

if [ ! -d "$RESULTS_DIR" ]; then
  printf 'ERROR: Results directory not found: %s\n' "$RESULTS_DIR" >&2
  exit 1
fi

if [ ! -f "$RESULTS_DIR/metadata.json" ] || [ ! -f "$RESULTS_DIR/failure.json" ]; then
  printf 'ERROR: metadata.json or failure.json not found in %s\n' "$RESULTS_DIR" >&2
  exit 1
fi

# Helper to extract JSON values
json_value() {
  local file="$1"
  local key="$2"
  grep "\"$key\"" "$file" | head -1 | sed 's/.*"'"$key"'":\s*"\?//; s/".*$//'
}

# Read key fields from metadata
INSTANCE="$(json_value "$RESULTS_DIR/metadata.json" "instance")"
STAGE="$(json_value "$RESULTS_DIR/metadata.json" "current_stage")"
EXIT_CODE="$(json_value "$RESULTS_DIR/metadata.json" "exit_code")"
GITHUB_PUSH_EXIT="$(json_value "$RESULTS_DIR/metadata.json" "github_push_exit_code")"
GITHUB_PR_EXIT="$(json_value "$RESULTS_DIR/metadata.json" "github_pr_exit_code")"
GITHUB_API_ERROR_TYPE="$(json_value "$RESULTS_DIR/metadata.json" "github_api_error_type")"
GITHUB_API_ERROR_MESSAGE="$(json_value "$RESULTS_DIR/metadata.json" "github_api_error_message")"
GITHUB_API_HTTP_STATUS="$(json_value "$RESULTS_DIR/metadata.json" "github_api_http_status")"

printf '# GitHub Operations Failure Diagnostic Report\n\n'
printf '**Instance:** %s\n' "$INSTANCE"
printf '**Results directory:** %s\n' "$RESULTS_DIR"
printf '**Overall exit code:** %s\n\n' "$EXIT_CODE"

# ===== Stage-level diagnosis =====
printf '## Stage Status\n\n'
if [ "$STAGE" = "github operations" ]; then
  printf '- Current stage: github operations (failure occurred in this stage)\n'
else
  printf '- Current stage: %s (failure occurred before github operations)\n' "$STAGE"
fi
printf '- GitHub push exit code: %s\n' "$GITHUB_PUSH_EXIT"
printf '- GitHub PR exit code: %s\n' "$GITHUB_PR_EXIT"

# ===== Detailed diagnosis =====
printf '\n## Diagnosis\n\n'

# Check if failure occurred in github operations stage
if [ "$STAGE" != "github operations" ]; then
  printf '**Failure occurred before github operations stage.**\n'
  printf '\nGithub operations was never attempted. Check earlier stages:\n'
  if [ -f "$RESULTS_DIR/stage-timings.tsv" ]; then
    printf '\n```\n'
    cat "$RESULTS_DIR/stage-timings.tsv"
    printf '```\n'
  fi
  exit 0
fi

# Now we know stage is github operations
if [ "$GITHUB_PUSH_EXIT" -ne 0 ] && [ "$GITHUB_PR_EXIT" -eq 0 ]; then
  printf '**Git push failed (exit code: %s)**\n\n' "$GITHUB_PUSH_EXIT"
  printf 'The git push operation failed. Check git-push.log for details:\n'
  if [ -f "$RESULTS_DIR/git-push.log" ]; then
    printf '\n```\n'
    tail -20 "$RESULTS_DIR/git-push.log"
    printf '```\n'
  fi
elif [ "$GITHUB_PR_EXIT" -ne 0 ]; then
  printf '**GitHub PR creation failed (exit code: %s)**\n\n' "$GITHUB_PR_EXIT"
  
  if [ -n "$GITHUB_API_ERROR_TYPE" ]; then
    printf 'API error type: %s\n' "$GITHUB_API_ERROR_TYPE"
  fi
  if [ -n "$GITHUB_API_ERROR_MESSAGE" ]; then
    printf 'API error message: %s\n' "$GITHUB_API_ERROR_MESSAGE"
  fi
  if [ -n "$GITHUB_API_HTTP_STATUS" ]; then
    printf 'HTTP status: %s\n' "$GITHUB_API_HTTP_STATUS"
  fi
  
  printf '\nAPI error details from git-push.log:\n'
  if [ -f "$RESULTS_DIR/git-push.log" ]; then
    printf '\n```\n'
    tail -30 "$RESULTS_DIR/git-push.log"
    printf '```\n'
  fi
elif [ "$GITHUB_PUSH_EXIT" -eq 0 ] && [ "$GITHUB_PR_EXIT" -eq 0 ]; then
  printf '**GitHub operations completed successfully, but overall exit code is non-zero.**\n\n'
  printf 'This suggests the failure occurred in the finish() trap handler or post-github-ops cleanup.\n'
  printf 'Check the following:\n\n'
  
  if [ -f "$RESULTS_DIR/last-command.log" ]; then
    printf '- Last command log exists at: %s\n' "$RESULTS_DIR/last-command.log"
    printf '\n```\n'
    cat "$RESULTS_DIR/last-command.log"
    printf '```\n'
  fi
  
  if [ -f "$RESULTS_DIR/github-health-check.log" ]; then
    printf '\n- GitHub health check log:\n\n```\n'
    cat "$RESULTS_DIR/github-health-check.log"
    printf '```\n'
  fi
  
  if [ -f "$RESULTS_DIR/restoration-errors.log" ]; then
    printf '\n- Restoration errors:\n\n```\n'
    cat "$RESULTS_DIR/restoration-errors.log"
    printf '```\n'
  fi
else
  printf '**Unknown failure pattern.**\n\n'
  printf 'Push exit: %s, PR exit: %s\n' "$GITHUB_PUSH_EXIT" "$GITHUB_PR_EXIT"
fi

# ===== Check for subprocess errors =====
printf '\n## Node.js Subprocess Errors\n\n'
if [ -f "$RESULTS_DIR/git-push.log" ] && grep -q '\[node-subprocess-error\]' "$RESULTS_DIR/git-push.log"; then
  printf 'Node.js subprocess errors detected:\n\n'
  printf '```\n'
  grep '\[node-subprocess-error\]' "$RESULTS_DIR/git-push.log" | head -20
  printf '```\n'
else
  printf 'No Node.js subprocess errors detected.\n'
fi

# ===== Helpful references =====
printf '\n## Helpful Resources\n\n'
printf '- **Exit codes reference:** See docs/EXIT_CODES.md\n'
printf '- **Git-push.log:** Full GitHub operations details at %s/git-push.log\n' "$RESULTS_DIR"
printf '- **Metadata:** Complete run metadata at %s/metadata.json\n' "$RESULTS_DIR"
printf '- **Failure details:** See %s/failure.json\n' "$RESULTS_DIR"

printf '\n---\n\n'
printf '**Generated by %s**\n' "$SCRIPT_NAME"
