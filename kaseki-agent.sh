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
KASEKI_AGENT_TIMEOUT_SECONDS="${KASEKI_AGENT_TIMEOUT_SECONDS:-1200}"
if [ "${KASEKI_VALIDATION_COMMANDS+x}" = "x" ]; then
  KASEKI_VALIDATION_COMMANDS_WAS_DEFAULT=0
else
  KASEKI_VALIDATION_COMMANDS_WAS_DEFAULT=1
fi
KASEKI_VALIDATION_COMMANDS="${KASEKI_VALIDATION_COMMANDS-npm run check;npm run test;npm run build}"
KASEKI_SKIP_MISSING_NPM_SCRIPTS="${KASEKI_SKIP_MISSING_NPM_SCRIPTS:-$KASEKI_VALIDATION_COMMANDS_WAS_DEFAULT}"
KASEKI_DEBUG_RAW_EVENTS="${KASEKI_DEBUG_RAW_EVENTS:-0}"
KASEKI_STREAM_PROGRESS="${KASEKI_STREAM_PROGRESS:-1}"
KASEKI_VALIDATE_AFTER_AGENT_FAILURE="${KASEKI_VALIDATE_AFTER_AGENT_FAILURE:-0}"
KASEKI_TASK_MODE="${KASEKI_TASK_MODE:-patch}"
KASEKI_ALLOW_EMPTY_DIFF="${KASEKI_ALLOW_EMPTY_DIFF:-0}"
KASEKI_CHANGED_FILES_ALLOWLIST="${KASEKI_CHANGED_FILES_ALLOWLIST:-src/lib/parser.ts tests/parser.validation.ts}"
KASEKI_VALIDATION_ALLOWLIST="${KASEKI_VALIDATION_ALLOWLIST:-}"
KASEKI_MAX_DIFF_BYTES="${KASEKI_MAX_DIFF_BYTES:-200000}"
KASEKI_REPO_MEMORY_MODE="${KASEKI_REPO_MEMORY_MODE:-off}"
KASEKI_REPO_MEMORY_TTL_DAYS="${KASEKI_REPO_MEMORY_TTL_DAYS:-30}"
KASEKI_REPO_MEMORY_MAX_BYTES="${KASEKI_REPO_MEMORY_MAX_BYTES:-8000}"
TASK_PROMPT="${TASK_PROMPT:-Make normalizeRole treat a non-string Name fallback safely when FriendlyName is empty or missing. It should fall back to \"Unnamed Role\" instead of preserving arbitrary truthy non-string values. Add or update exactly one compact table-driven Vitest case in tests/parser.validation.ts, with a neutral static test title and no per-case assertion messages or explanatory comments. Do not add broad repeated test blocks. Do not print, inspect, or expose environment variables, secrets, credentials, or API keys. Keep changes limited to the source and test files needed for this fix.}"
KASEKI_AGENT_GUARDRAILS="${KASEKI_AGENT_GUARDRAILS:-1}"
KASEKI_RESTORE_DISALLOWED_CHANGES="${KASEKI_RESTORE_DISALLOWED_CHANGES:-1}"
KASEKI_VALIDATION_FAIL_FAST="${KASEKI_VALIDATION_FAIL_FAST:-1}"
KASEKI_STRICT_SCRIPT_CHECK="${KASEKI_STRICT_SCRIPT_CHECK:-0}"
GITHUB_APP_ENABLED="${GITHUB_APP_ENABLED:-0}"
KASEKI_PUBLISH_MODE="${KASEKI_PUBLISH_MODE:-auto}"
START_EPOCH="$(date +%s)"
START_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
CURRENT_STAGE="initializing"
PI_START_EPOCH=0
PI_DURATION_SECONDS=0
PI_VERSION=""
STATUS=0
FAILED_COMMAND=""
PI_EXIT=0
VALIDATION_EXIT=0
VALIDATION_FAILED_COMMAND_DETAIL=""
VALIDATION_FAILURE_REASON=""
VALIDATION_STOPPED_EARLY=false
VALIDATION_COMMANDS_ATTEMPTED=0
DIFF_NONEMPTY=false
QUALITY_EXIT=0
QUALITY_FAILURE_REASON=""
SECRET_SCAN_EXIT=0
GITHUB_PUSH_EXIT=0
GITHUB_PR_EXIT=0
ACTUAL_MODEL="unknown"
GITHUB_PR_URL=""
GITHUB_SKIP_REASONS=()
VALIDATION_TIMINGS_FILE="/results/validation-timings.tsv"
STAGE_TIMINGS_FILE="/results/stage-timings.tsv"
DEPENDENCY_CACHE_LOG="/results/dependency-cache.log"
RAW_EVENTS="/tmp/pi-events.raw.jsonl"
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
PI_VERSION="$(pi --version 2>&1 | head -n 1 || true)"
: > /results/stdout.log
: > /results/stderr.log
: > /results/pi-events.jsonl
: > /results/pi-summary.json
: > /results/validation.log
: > /results/quality.log
: > /results/secret-scan.log
: > /results/git-push.log
: > /results/progress.log
: > /results/progress.jsonl
: > /results/format-check-command.txt
: > /results/failure.json
: > /results/result-summary.md
: > "$VALIDATION_TIMINGS_FILE"
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
  if [ -z "$var_value" ] || [ "$var_value" = "-" ]; then
    printf 'error: %s is not numeric (value="%s")\n' "$var_name" "$var_value" >&2
    return 1
  fi
  # Check if value matches integer pattern
  if ! printf '%s' "$var_value" | grep -Eq '^[0-9]+$'; then
    printf 'error: %s is not a valid integer (value="%s")\n' "$var_name" "$var_value" >&2
    return 1
  fi
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
  "task_mode": $(printf '%s' "$KASEKI_TASK_MODE" | json_encode),
  "allow_empty_diff": $(printf '%s' "$KASEKI_ALLOW_EMPTY_DIFF" | json_encode),
  "started_at": $(printf '%s' "$START_ISO" | json_encode),
  "current_stage": $(printf '%s' "$CURRENT_STAGE" | json_encode),
  "ended_at": $(printf '%s' "$end_iso" | json_encode),
  "duration_seconds": $duration,
  "total_duration_seconds": $duration,
  "pi_duration_seconds": $PI_DURATION_SECONDS,
  "exit_code": $exit_code,
  "failed_command": $(printf '%s' "$FAILED_COMMAND" | json_encode),
  "validation_failed_command": $(printf '%s' "$VALIDATION_FAILED_COMMAND_DETAIL" | json_encode),
  "validation_failure_reason": $(printf '%s' "$VALIDATION_FAILURE_REASON" | json_encode),
  "quality_failure_reason": $(printf '%s' "$QUALITY_FAILURE_REASON" | json_encode),
  "pi_exit_code": $PI_EXIT,
  "validation_exit_code": $VALIDATION_EXIT,
  "validation_fail_fast_mode": $([[ "$KASEKI_VALIDATION_FAIL_FAST" == "1" ]] && printf 'true' || printf 'false'),
  "validation_stopped_early": $([[ "$VALIDATION_STOPPED_EARLY" == "true" ]] && printf 'true' || printf 'false'),
  "validation_commands_attempted": $VALIDATION_COMMANDS_ATTEMPTED,
  "quality_exit_code": $QUALITY_EXIT,
  "secret_scan_exit_code": $SECRET_SCAN_EXIT,
  "github_push_exit_code": $GITHUB_PUSH_EXIT,
  "github_pr_exit_code": $GITHUB_PR_EXIT,
  "diff_nonempty": $DIFF_NONEMPTY,
  "actual_model": $(printf '%s' "$ACTUAL_MODEL" | json_encode),
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
      pr_status="push failed"
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
- Validation: $validation_status ($VALIDATION_EXIT)
$(if [ -n "$VALIDATION_FAILURE_REASON" ]; then printf '  - Reason: %s\n' "$VALIDATION_FAILURE_REASON"; fi)
- Validation failure detail: ${VALIDATION_FAILED_COMMAND_DETAIL:-none}
$(if [ "$VALIDATION_STOPPED_EARLY" = "true" ]; then printf '- **⚠️ Validation stopped early** (fail-fast mode): %s of %s commands ran\n' "$(printf '%s' "${VALIDATION_COMMANDS[@]}" | wc -w)" "$(echo "$KASEKI_VALIDATION_COMMANDS" | tr ';' '\n' | grep -c .)"; fi)
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
  "validation_failed_command": $(printf '%s' "$VALIDATION_FAILED_COMMAND_DETAIL" | json_encode),
  "validation_failure_reason": $(printf '%s' "$VALIDATION_FAILURE_REASON" | json_encode),
  "quality_failure_reason": $(printf '%s' "$QUALITY_FAILURE_REASON" | json_encode),
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
  restored_count=$(grep -c '"status":"restored"' /results/restoration.jsonl 2>/dev/null || echo 0)
  printf '[debug] restoration report: restored_count="%s"\n' "$restored_count" >&2
  if ! validate_numeric "restored_count" "$restored_count"; then
    printf 'warning: restoration report generation failed - restored_count validation failed\n' >&2
    return 1
  fi
  
  kept_count=$(grep -c '"status":"kept"' /results/restoration.jsonl 2>/dev/null || echo 0)
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


finish() {
  local code=$?
  if [ "$code" -ne 0 ] && [ "$STATUS" -eq 0 ]; then
    STATUS="$code"
    FAILED_COMMAND="unexpected shell failure"
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
  [ "${KASEKI_SKIP_MISSING_NPM_SCRIPTS:-0}" = "1" ] || return 1
  script_name="$(npm_run_script_name "$command")" || return 1
  package_json_has_npm_script "$script_name" && return 1
  printf '%s' "$script_name"
  return 0
}

record_skipped_validation_command() {
  local command="$1"
  local script_name="$2"
  local duration_seconds="$3"
  {
    printf '\n==> %s\n' "$command"
    printf 'skipped: package.json does not define npm script "%s"\n' "$script_name"
  } 2>&1 | tee -a /results/validation.log
  printf '%s\tskipped\t%s\tmissing_npm_script=%s\n' "$command" "$duration_seconds" "$script_name" >> "$VALIDATION_TIMINGS_FILE"
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
  REPO_MEMORY_DIR="/cache/repo-memory/$REPO_MEMORY_KEY"
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
  node - "$KASEKI_REPO_MEMORY_MAX_BYTES" "$REPO_MEMORY_FILE" "$REPO_URL" "$GIT_REF" "$REPO_MEMORY_COMMIT_SHA" "$updated_at" "$KASEKI_TASK_MODE" "$STATUS" "$PI_EXIT" "$VALIDATION_EXIT" "$QUALITY_EXIT" "$SECRET_SCAN_EXIT" <<'NODE' || {
const fs = require('fs');
const path = require('path');
const [maxBytesArg, outputFile, repoUrl, gitRef, commitSha, timestamp, taskMode, status, piExit, validationExit, qualityExit, secretScanExit] = process.argv.slice(2);
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
  return sanitize(readFile('/results/changed-files.txt', 4000))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 40);
}

function validationOutcomes() {
  const rows = sanitize(readFile('/results/validation-timings.tsv', 8000))
    .split(/\r?\n/)
    .map((line) => line.split('\t'))
    .filter((parts) => parts.length >= 2 && parts[0]);
  if (!rows.length) return ['No per-command validation timings recorded.'];
  return rows.slice(0, 20).map(([command, exitCode, duration]) => `${command}: exit ${exitCode}${duration ? `, ${duration}s` : ''}`);
}

const resultLines = compactLines(readFile('/results/result-summary.md'));
const analysisLines = compactLines(readFile('/results/analysis.md'), 10);
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
  local memory_section
  memory_section="$(read_repo_memory_section)"
  if [ "$KASEKI_AGENT_GUARDRAILS" != "1" ]; then
    printf '%s' "$TASK_PROMPT"
    printf '%s' "$memory_section"
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
EOF
}

run_github_operations() {
  local app_id private_key_file owner repo feature_branch token token_data
  
  # Load GitHub App credentials
  app_id="$(cat /run/secrets/github_app_id)" || { printf 'Failed to read app ID\n' >&2; return 7; }
  cat /run/secrets/github_app_client_id >/dev/null || { printf 'Failed to read client ID\n' >&2; return 7; }
  private_key_file="/run/secrets/github_app_private_key"
  
  # Parse repo URL to extract owner and repo
  if [[ "$REPO_URL" =~ ^https?://github\.com/([^/]+)/([^/]+)(/|\.git)?$ ]]; then
    owner="${BASH_REMATCH[1]}"
    repo="${BASH_REMATCH[2]}"
  else
    printf -- 'Cannot parse GitHub repo URL: %s\n' "$REPO_URL" | tee -a /results/git-push.log >&2
    return 7
  fi
  
  printf -- 'GitHub operations: owner=%s, repo=%s\n' "$owner" "$repo" | tee -a /results/git-push.log
  
  # Set git user for commits
  git config user.name "GitHub App [$app_id]" || { printf 'Failed to set git user name\n' >&2; return 7; }
  git config user.email "${app_id}+kaseki@users.noreply.github.com" || { printf 'Failed to set git email\n' >&2; return 7; }
  
  # Generate GitHub App installation token
  printf 'Generating GitHub App installation token...\n' | tee -a /results/git-push.log
  token_data="$(node /usr/local/bin/github-app-token "$app_id" "$private_key_file" "$owner" "$repo")" || {
    printf 'Failed to generate token\n' | tee -a /results/git-push.log >&2
    GITHUB_PUSH_EXIT=7
    return 7
  }
  
  token="$(printf '%s' "$token_data" | node -e "const d = JSON.parse(require('fs').readFileSync(0, 'utf8')); process.stdout.write(d.token || '')" 2>/dev/null)"
  if [ -z "$token" ]; then
    printf -- 'Failed to extract token from response: %s\n' "$token_data" | tee -a /results/git-push.log >&2
    GITHUB_PUSH_EXIT=7
    return 7
  fi
  
  printf 'Token generated successfully\n' | tee -a /results/git-push.log
  
  # Create and push feature branch
  feature_branch="kaseki/$INSTANCE_NAME"
  printf -- 'Creating feature branch: %s\n' "$feature_branch" | tee -a /results/git-push.log
  git checkout -b "$feature_branch" || {
    printf 'Failed to create branch\n' | tee -a /results/git-push.log >&2
    GITHUB_PUSH_EXIT=7
    return 7
  }
  
  # Commit changes (git should already have changes from pi agent)
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
  printf 'Pushing branch to GitHub...\n' | tee -a /results/git-push.log
  local askpass_file
  askpass_file="$(mktemp /tmp/kaseki-github-askpass.XXXXXX)" || {
    printf 'Failed to create GitHub credential helper\n' | tee -a /results/git-push.log >&2
    GITHUB_PUSH_EXIT=8
    return 8
  }
  cat > "$askpass_file" <<'EOF_ASKPASS'
#!/usr/bin/env bash
case "$1" in
  *Username*) printf '%s\n' x-access-token ;;
  *) printf '%s\n' "$KASEKI_GITHUB_TOKEN" ;;
esac
EOF_ASKPASS
  chmod 0700 "$askpass_file"

  if KASEKI_GITHUB_TOKEN="$token" GIT_ASKPASS="$askpass_file" GIT_TERMINAL_PROMPT=0 \
    git push "https://github.com/$owner/$repo.git" "$feature_branch" --force-with-lease 2>&1 | tee -a /results/git-push.log; then
    printf 'Branch pushed successfully\n' | tee -a /results/git-push.log
  else
    rm -f "$askpass_file"
    printf 'Failed to push branch\n' | tee -a /results/git-push.log >&2
    GITHUB_PUSH_EXIT=8
    return 8
  fi
  rm -f "$askpass_file"

  if [ "$KASEKI_PUBLISH_MODE" = "branch" ]; then
    printf 'Publish mode branch: skipping pull request creation.\n' | tee -a /results/git-push.log
    GITHUB_PR_EXIT=0
    unset token
    return 0
  fi
  
  # Create pull request
  printf 'Creating pull request...\n' | tee -a /results/git-push.log
  local pr_title pr_body pr_response pr_url
  pr_title="Kaseki: $INSTANCE_NAME"
  pr_body=$(cat <<EOF
Generated by Kaseki agent (instance: $INSTANCE_NAME)

**Model:** $KASEKI_MODEL

**Duration:** $(($(date +%s) - START_EPOCH)) seconds

**Validation:** $([ "$VALIDATION_EXIT" -eq 0 ] && printf 'passed' || printf 'failed (exit %s)' "$VALIDATION_EXIT")

**Quality Checks:** $([ "$QUALITY_EXIT" -eq 0 ] && printf 'passed' || printf 'failed (exit %s)' "$QUALITY_EXIT")

This PR is in draft status. Please review before merging.
EOF
)
  
  pr_response=$(curl -s -X POST \
    -H "Authorization: token $token" \
    -H "Accept: application/vnd.github.v3+json" \
    "https://api.github.com/repos/$owner/$repo/pulls" \
    -d "{\"title\": $(printf '%s' "$pr_title" | node -e "console.log(JSON.stringify(require('fs').readFileSync(0, 'utf8')))"), \"body\": $(printf '%s' "$pr_body" | node -e "console.log(JSON.stringify(require('fs').readFileSync(0, 'utf8')))"), \"head\": \"$feature_branch\", \"base\": \"$GIT_REF\", \"draft\": true}" 2>&1)
  
  pr_url="$(printf '%s' "$pr_response" | node -e "const d = JSON.parse(require('fs').readFileSync(0, 'utf8')); process.stdout.write(d.html_url || '')" 2>/dev/null || true)"
  
  if [ -n "$pr_url" ]; then
    GITHUB_PR_URL="$pr_url"
    GITHUB_PR_EXIT=0
    printf 'Pull request created: %s\n' "$pr_url" | tee -a /results/git-push.log
  else
    printf 'Failed to create PR. Response: %s\n' "$pr_response" | tee -a /results/git-push.log >&2
    GITHUB_PR_EXIT=9
  fi
  
  # Clean up token
  unset token
}

printf 'Kaseki instance: %s\n' "$INSTANCE_NAME"
printf 'Repository: %s\n' "$REPO_URL"
printf 'Git ref: %s\n' "$GIT_REF"
printf 'Provider: %s\n' "$KASEKI_PROVIDER"
printf 'Model: %s\n' "$KASEKI_MODEL"
printf 'Pi version: %s\n' "$PI_VERSION"

openrouter_api_key=""
openrouter_api_key_source=""
if [ -n "${OPENROUTER_API_KEY:-}" ]; then
  openrouter_api_key="$OPENROUTER_API_KEY"
  openrouter_api_key_source="env"
elif [ -r /run/secrets/openrouter_api_key ]; then
  secret_content="$(cat /run/secrets/openrouter_api_key)"
  if [ -n "$secret_content" ]; then
    openrouter_api_key="$secret_content"
    openrouter_api_key_source="secret file"
  fi
fi
unset OPENROUTER_API_KEY secret_content

if [ -z "$openrouter_api_key" ]; then
  set_current_stage "agent setup"
  printf 'Missing OpenRouter API key. Set OPENROUTER_API_KEY or provide /run/secrets/openrouter_api_key.\n' | tee -a /results/pi-stderr.log >&2
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

printf '\n==> pi coding agent\n'
set_current_stage "pi coding agent"
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
  unset OPENROUTER_API_KEY openrouter_api_key openrouter_api_key_source
  set -e
  record_stage_timing "pi coding agent" "$PI_EXIT" "$PI_DURATION_SECONDS" "timeout_seconds=$KASEKI_AGENT_TIMEOUT_SECONDS"

  if [ "$KASEKI_DEBUG_RAW_EVENTS" = "1" ]; then
    cp "$RAW_EVENTS" /results/pi-events.raw.jsonl
  fi

  PI_EXTRACTION_DEPS_OK=1
  missing_executables=()
  missing_helpers=()
  for required_exec in kaseki-pi-event-filter kaseki-pi-progress-stream; do
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
    set -e
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

printf '\n==> validation\n'
set_current_stage "validation"
emit_progress "validation" "started"
stage_start="$(date +%s)"
if [ "$KASEKI_DRY_RUN" = "1" ]; then
  printf '🔄 DRY-RUN MODE: Validation commands would be executed (not running in dry-run mode):\n' | tee -a /results/validation.log
  IFS=';' read -r -a VALIDATION_COMMANDS <<< "$KASEKI_VALIDATION_COMMANDS"
  for command in "${VALIDATION_COMMANDS[@]}"; do
    trimmed="$(printf '%s' "$command" | sed 's/^ *//; s/ *$//')"
    [ -z "$trimmed" ] && continue
    printf '  - %s\n' "$trimmed" | tee -a /results/validation.log
  done
  VALIDATION_EXIT=0
  record_stage_timing "validation" "0" "$(($(date +%s) - stage_start))" "dry_run=true"
elif [ -z "$KASEKI_VALIDATION_COMMANDS" ] || [ "$KASEKI_VALIDATION_COMMANDS" = "none" ]; then
  printf 'Validation skipped because KASEKI_VALIDATION_COMMANDS=%s.\n' "${KASEKI_VALIDATION_COMMANDS:-<empty>}" | tee -a /results/validation.log
  record_stage_timing "validation" 0 0 "skipped_by_config"
elif [ "$QUALITY_EXIT" -ne 0 ]; then
  printf 'Validation skipped because quality gates failed with exit %s.\n' "$QUALITY_EXIT" | tee -a /results/validation.log
  VALIDATION_EXIT="$QUALITY_EXIT"
  if [ -z "$VALIDATION_FAILURE_REASON" ]; then
    VALIDATION_FAILURE_REASON="quality_gate_failed: $QUALITY_FAILURE_REASON"
  fi
  record_stage_timing "validation" "$QUALITY_EXIT" 0 "skipped_after_quality_failure"
elif [ "$PI_EXIT" -ne 0 ] && [ "$KASEKI_VALIDATE_AFTER_AGENT_FAILURE" != "1" ]; then
  printf 'Validation skipped because pi coding agent failed with exit %s. Set KASEKI_VALIDATE_AFTER_AGENT_FAILURE=1 to run validation anyway.\n' "$PI_EXIT" | tee -a /results/validation.log
  record_stage_timing "validation" "$PI_EXIT" 0 "skipped_after_agent_failure"
else
  # Checkpoint: Verify working directory exists before validation
  if ! [ -d /workspace/repo ]; then
    printf 'ERROR: Working directory /workspace/repo does not exist before validation\n' | tee -a /results/validation.log
    printf 'Current pwd: %s\n' "$(pwd 2>&1 || echo '<pwd failed>')" | tee -a /results/validation.log
    printf 'Filesystem state:\n' | tee -a /results/validation.log
    find /workspace -maxdepth 3 -type f 2>&1 | head -100 | tee -a /results/validation.log
    VALIDATION_EXIT=1
    VALIDATION_FAILED_COMMAND_DETAIL="Working directory /workspace/repo missing before validation"
    record_stage_timing "validation" "$VALIDATION_EXIT" "$(($(date +%s) - stage_start))" "directory_missing"
  else
    set +e
    IFS=';' read -r -a VALIDATION_COMMANDS <<< "$KASEKI_VALIDATION_COMMANDS"
  for command in "${VALIDATION_COMMANDS[@]}"; do
    trimmed="$(printf '%s' "$command" | sed 's/^ *//; s/ *$//')"
    [ -z "$trimmed" ] && continue
    validation_start="$(date +%s)"
    if missing_npm_script="$(missing_npm_script_for_validation_command "$trimmed")"; then
      validation_end="$(date +%s)"
      duration=$((validation_end - validation_start))
      record_skipped_validation_command "$trimmed" "$missing_npm_script" "$duration"
      emit_event "validation_command_skipped" "command=$trimmed" "reason=missing_npm_script" "script=$missing_npm_script" "duration_seconds=$duration"
      continue
    fi
    ((VALIDATION_COMMANDS_ATTEMPTED++))
    emit_event "validation_command_started" "command=$trimmed"
    {
      printf '\n==> %s\n' "$trimmed"
      unset OPENROUTER_API_KEY
      # Use non-login shell (bash -c) to avoid initialization issues in --read-only containers
      # Login shell (bash -l) sources /etc/profile and ~/.bashrc, which can fail with getcwd()
      # errors when running in constrained filesystem environments (read-only root, etc.)
      bash -c "$trimmed"
      command_exit=$?
      printf 'exit_code=%s\n' "$command_exit"
      exit "$command_exit"
    } 2>&1 | tee -a /results/validation.log
    command_exit="${PIPESTATUS[0]}"
    validation_end="$(date +%s)"
    duration=$((validation_end - validation_start))
    printf '%s\t%s\t%s\n' "$trimmed" "$command_exit" "$duration" >> "$VALIDATION_TIMINGS_FILE"
    emit_event "validation_command_finished" "command=$trimmed" "exit_code=$command_exit" "duration_seconds=$duration"
    if [ "$command_exit" -ne 0 ] && [ "$VALIDATION_EXIT" -eq 0 ]; then
      VALIDATION_EXIT="$command_exit"
      VALIDATION_FAILED_COMMAND_DETAIL="first failing command was \"$trimmed\" with exit $command_exit"
      VALIDATION_FAILURE_REASON="validation_command_failed: $trimmed (exit $command_exit)"
      # Enhanced diagnostics for getcwd-type errors
      if grep -q 'getcwd\|No such file or directory\|cannot access parent directories' /results/validation.log; then
        {
          printf '\n[DIAGNOSTICS] Validation command failed with directory access error:\n'
          printf 'Working directory status:\n'
          printf '  Current pwd: %s\n' "$(pwd 2>&1 || echo '<pwd failed>')"
          printf '  /workspace/repo exists: %s\n' "$([ -d /workspace/repo ] && echo 'yes' || echo 'no')"
          if [ -L /workspace/repo/node_modules ]; then
            printf '  node_modules is symlink → %s\n' "$(readlink /workspace/repo/node_modules 2>&1 || echo '<readlink failed>')"
          fi
          printf 'Last 20 lines of validation log:\n'
          tail -20 /results/validation.log
        } | tee -a /results/quality.log
      fi
      # Fail-fast: if enabled, stop validation loop at first failure
      if [ "$KASEKI_VALIDATION_FAIL_FAST" -eq 1 ]; then
        VALIDATION_STOPPED_EARLY=true
        printf 'Validation stopped at first failure (fail-fast mode enabled).\n' | tee -a /results/validation.log
        break
      fi
    fi
  done
    if [ -n "$VALIDATION_FAILED_COMMAND_DETAIL" ]; then
      printf 'Validation failed: %s\n' "$VALIDATION_FAILED_COMMAND_DETAIL" | tee -a /results/validation.log
    fi
    set -e
  fi
  record_stage_timing "validation" "$VALIDATION_EXIT" "$(($(date +%s) - stage_start))" ""
fi
emit_progress "validation" "finished with exit $VALIDATION_EXIT"

# Check validation-phase allowlist (if configured)
if [ "$VALIDATION_EXIT" -eq 0 ]; then
  collect_git_artifacts
  if ! check_validation_allowlist; then
    : # Exit code already set in check_validation_allowlist
  fi
fi

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
  if grep -R -n -E 'sk-or-[A-Za-z0-9_-]{20,}' /results /workspace/repo/.git /workspace/repo/src /workspace/repo/tests 2>/dev/null | grep -v '/secret-scan.log:' > /results/secret-scan.log; then
    SECRET_SCAN_EXIT=6
  fi
  record_stage_timing "secret scan" "$SECRET_SCAN_EXIT" "$(($(date +%s) - stage_start))" ""
fi
emit_progress "secret scan" "finished with exit $SECRET_SCAN_EXIT"

build_github_skip_reasons() {
  GITHUB_SKIP_REASONS=()
  [ "$GITHUB_APP_ENABLED" != "1" ] && GITHUB_SKIP_REASONS+=("github_app_disabled")
  [ "$PI_EXIT" -ne 0 ] && GITHUB_SKIP_REASONS+=("agent_failed")
  [ "$VALIDATION_EXIT" -ne 0 ] && GITHUB_SKIP_REASONS+=("validation_failed")
  [ "$QUALITY_EXIT" -ne 0 ] && GITHUB_SKIP_REASONS+=("quality_failed")
  [ "$SECRET_SCAN_EXIT" -ne 0 ] && GITHUB_SKIP_REASONS+=("secret_scan_failed")
  [ "$DIFF_NONEMPTY" != "true" ] && GITHUB_SKIP_REASONS+=("empty_diff")
}

printf '\n==> github operations\n'
set_current_stage "github operations"
emit_progress "github operations" "started"
stage_start="$(date +%s)"
: > /results/git-push.log
build_github_skip_reasons
if [ "${#GITHUB_SKIP_REASONS[@]}" -eq 0 ]; then
  if [ -r /run/secrets/github_app_id ] && [ -r /run/secrets/github_app_client_id ] && [ -r /run/secrets/github_app_private_key ]; then
    run_github_operations
  else
    GITHUB_SKIP_REASONS+=("github_app_secrets_missing")
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
  FAILED_COMMAND="github push"
  emit_error_event "github_operation_failed" "GitHub push or PR creation failed (exit code $GITHUB_PUSH_EXIT)" "exit"
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
