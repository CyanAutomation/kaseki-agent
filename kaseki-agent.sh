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
KASEKI_VALIDATION_COMMANDS="${KASEKI_VALIDATION_COMMANDS-npm run check;npm run test;npm run build}"
KASEKI_DEBUG_RAW_EVENTS="${KASEKI_DEBUG_RAW_EVENTS:-0}"
KASEKI_STREAM_PROGRESS="${KASEKI_STREAM_PROGRESS:-1}"
KASEKI_VALIDATE_AFTER_AGENT_FAILURE="${KASEKI_VALIDATE_AFTER_AGENT_FAILURE:-0}"
KASEKI_TASK_MODE="${KASEKI_TASK_MODE:-patch}"
KASEKI_ALLOW_EMPTY_DIFF="${KASEKI_ALLOW_EMPTY_DIFF:-0}"
KASEKI_CHANGED_FILES_ALLOWLIST="${KASEKI_CHANGED_FILES_ALLOWLIST:-src/lib/parser.ts tests/parser.validation.ts}"
KASEKI_MAX_DIFF_BYTES="${KASEKI_MAX_DIFF_BYTES:-200000}"
TASK_PROMPT="${TASK_PROMPT:-Make normalizeRole treat a non-string Name fallback safely when FriendlyName is empty or missing. It should fall back to \"Unnamed Role\" instead of preserving arbitrary truthy non-string values. Add or update exactly one compact table-driven Vitest case in tests/parser.validation.ts, with a neutral static test title and no per-case assertion messages or explanatory comments. Do not add broad repeated test blocks. Do not print, inspect, or expose environment variables, secrets, credentials, or API keys. Keep changes limited to the source and test files needed for this fix.}"
GITHUB_APP_ENABLED="${GITHUB_APP_ENABLED:-0}"
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
DIFF_NONEMPTY=false
QUALITY_EXIT=0
SECRET_SCAN_EXIT=0
GITHUB_PUSH_EXIT=0
GITHUB_PR_EXIT=0
ACTUAL_MODEL=""
GITHUB_PR_URL=""
VALIDATION_TIMINGS_FILE="/results/validation-timings.tsv"
STAGE_TIMINGS_FILE="/results/stage-timings.tsv"
DEPENDENCY_CACHE_LOG="/results/dependency-cache.log"
RAW_EVENTS="/tmp/pi-events.raw.jsonl"
KASEKI_DEPENDENCY_CACHE_DIR="${KASEKI_DEPENDENCY_CACHE_DIR:-/workspace/.kaseki-cache}"
KASEKI_IMAGE_DEPENDENCY_CACHE_DIR="${KASEKI_IMAGE_DEPENDENCY_CACHE_DIR:-/opt/kaseki/workspace-cache}"
KASEKI_LOG_DIR="${KASEKI_LOG_DIR:-/var/log/kaseki}"
KASEKI_STRICT_HOST_LOGGING="${KASEKI_STRICT_HOST_LOGGING:-0}"

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

json_encode() {
  node -e 'const chunks=[]; process.stdin.on("data", c => chunks.push(c)); process.stdin.on("end", () => process.stdout.write(JSON.stringify(Buffer.concat(chunks).toString().replace(/\n$/, ""))));'
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
  "pi_exit_code": $PI_EXIT,
  "validation_exit_code": $VALIDATION_EXIT,
  "quality_exit_code": $QUALITY_EXIT,
  "secret_scan_exit_code": $SECRET_SCAN_EXIT,
  "github_push_exit_code": $GITHUB_PUSH_EXIT,
  "github_pr_exit_code": $GITHUB_PR_EXIT,
  "diff_nonempty": $DIFF_NONEMPTY,
  "actual_model": $(printf '%s' "$ACTUAL_MODEL" | json_encode),
  "github_pr_url": $(printf '%s' "$GITHUB_PR_URL" | json_encode),
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
  local changed_files changed_files_markdown validation_status pr_status
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
  pr_status="not attempted"
  if [ "$GITHUB_APP_ENABLED" = "1" ]; then
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

- Status: $([ "$STATUS" -eq 0 ] && printf 'passed' || printf 'failed')
- Failed command: ${FAILED_COMMAND:-none}
- Requested model: $KASEKI_MODEL
- Actual model: ${ACTUAL_MODEL:-unknown}
- Pi exit code: $PI_EXIT
- Validation: $validation_status ($VALIDATION_EXIT)
- Quality checks: $QUALITY_EXIT
- Secret scan: $SECRET_SCAN_EXIT
- GitHub PR: $pr_status
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
  if [ -d /workspace/repo/.git ]; then
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

finish() {
  local code=$?
  if [ "$code" -ne 0 ] && [ "$STATUS" -eq 0 ]; then
    STATUS="$code"
    FAILED_COMMAND="unexpected shell failure"
  fi
  # Authoritative call site: this runs at EXIT so artifacts reflect final repo state.
  collect_git_artifacts
  
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
    printf 'Cannot parse GitHub repo URL: %s\n' "$REPO_URL" | tee -a /results/git-push.log >&2
    return 7
  fi
  
  printf 'GitHub operations: owner=%s, repo=%s\n' "$owner" "$repo" | tee -a /results/git-push.log
  
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
    printf 'Failed to extract token from response: %s\n' "$token_data" | tee -a /results/git-push.log >&2
    GITHUB_PUSH_EXIT=7
    return 7
  fi
  
  printf 'Token generated successfully\n' | tee -a /results/git-push.log
  
  # Create and push feature branch
  feature_branch="kaseki/$INSTANCE_NAME"
  printf 'Creating feature branch: %s\n' "$feature_branch" | tee -a /results/git-push.log
  git checkout -b "$feature_branch" || {
    printf 'Failed to create branch\n' | tee -a /results/git-push.log >&2
    GITHUB_PUSH_EXIT=7
    return 7
  }
  
  # Commit changes (git should already have changes from pi agent)
  printf 'Committing changes...\n' | tee -a /results/git-push.log
  git add -A
  if ! git commit -m "Kaseki: $INSTANCE_NAME"; then
    printf 'No changes to commit or commit failed\n' | tee -a /results/git-push.log >&2
    GITHUB_PUSH_EXIT=7
    return 7
  fi
  
  # Configure git credential helper for pushing
  git config credential.helper store
  mkdir -p ~/.git-credentials-temp
  printf 'https://%s:%s@github.com\n' "x-access-token" "$token" > ~/.git-credentials-temp/credentials
  export GIT_ASKPASS=:
  export GIT_ASKPASS_ALWAYS=1
  
  # Push branch
  printf 'Pushing branch to GitHub...\n' | tee -a /results/git-push.log
  if git push https://x-access-token:"$token"@github.com/"$owner"/"$repo".git "$feature_branch" --force-with-lease 2>&1 | tee -a /results/git-push.log; then
    printf 'Branch pushed successfully\n' | tee -a /results/git-push.log
  else
    printf 'Failed to push branch\n' | tee -a /results/git-push.log >&2
    GITHUB_PUSH_EXIT=8
    return 8
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
  rm -f ~/.git-credentials-temp/credentials
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

if ! run_step "clone repository" git clone --depth 1 --branch "$GIT_REF" "$REPO_URL" /workspace/repo; then
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
    lock_source="package.json"
  fi

  local repo_key lock_hash cache_key workspace_cache_root workspace_cache_dir image_cache_dir stamp_file
  local lock_file cache_lock_fd tmp_cache_dir old_cache_dir
  repo_key="$(printf '%s@%s' "$REPO_URL" "$GIT_REF" | sha256sum | awk '{print $1}')"
  lock_hash="$(sha256sum "$lock_source" | awk '{print $1}')"
  cache_key="${repo_key}/${lock_hash}"
  workspace_cache_root="${KASEKI_DEPENDENCY_CACHE_DIR}/${cache_key}"
  workspace_cache_dir="${workspace_cache_root}/node_modules"
  image_cache_dir="${KASEKI_IMAGE_DEPENDENCY_CACHE_DIR}/${cache_key}/node_modules"
  stamp_file="${workspace_cache_root}/stamp.txt"
  lock_file="${workspace_cache_root}.lock"

  if ! mkdir -p "$(dirname "$workspace_cache_root")"; then
    return 1
  fi
  if ! exec {cache_lock_fd}>"$lock_file"; then
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
      printf 'Dependency cache status: using existing repo node_modules for lock hash %s.\n' "$lock_hash"
      set_dependency_cache_status "existing-node-modules" "lock_hash=$lock_hash cache_key=$cache_key"
      emit_event "dependency_cache_decision" "strategy=existing_node_modules" "reason=lock_hash_match" "location=repo"
      exec {cache_lock_fd}>&-
      return 0
    fi
  fi

  if [ ! -d node_modules ] && [ -d "$workspace_cache_dir" ]; then
    printf 'Dependency cache status: restoring node_modules from workspace cache (%s).\n' "$workspace_cache_dir"
    set_dependency_cache_status "workspace-cache-hit" "lock_hash=$lock_hash cache_key=$cache_key"
    emit_event "dependency_cache_decision" "strategy=workspace_cache_hit" "reason=cache_available" "location=$workspace_cache_dir"
    if ! cp -a "$workspace_cache_dir" ./node_modules; then
      exec {cache_lock_fd}>&-
      return 1
    fi
  elif [ ! -d node_modules ] && [ -d "$image_cache_dir" ]; then
    printf 'Dependency cache status: restoring node_modules from image cache (%s).\n' "$image_cache_dir"
    set_dependency_cache_status "image-cache-hit" "lock_hash=$lock_hash cache_key=$cache_key"
    emit_event "dependency_cache_decision" "strategy=image_cache_hit" "reason=cache_available" "location=$image_cache_dir"
    if ! cp -a "$image_cache_dir" ./node_modules; then
      exec {cache_lock_fd}>&-
      return 1
    fi
  fi

  if [ ! -d node_modules ]; then
    printf 'Dependency cache status: cache miss, running install.\n'
    set_dependency_cache_status "cache-miss" "lock_hash=$lock_hash cache_key=$cache_key"
    emit_event "dependency_cache_decision" "strategy=fresh_install" "reason=no_cache_available" "location=none"
    if ! npm ci --prefer-offline; then
      if ! npm install; then
        exec {cache_lock_fd}>&-
        return 1
      fi
    fi
  else
    printf 'Dependency cache status: install skipped due to cache hit.\n'
    set_dependency_cache_status "install-skipped" "lock_hash=$lock_hash cache_key=$cache_key"
    emit_event "dependency_cache_decision" "strategy=skip_install" "reason=cache_hit" "location=local"
  fi

  if ! mkdir -p "$workspace_cache_root"; then
    exec {cache_lock_fd}>&-
    return 1
  fi
  tmp_cache_dir="${workspace_cache_dir}.tmp.$$"
  old_cache_dir="${workspace_cache_dir}.old.$$"
  rm -rf "$tmp_cache_dir" "$old_cache_dir"
  if ! cp -a node_modules "$tmp_cache_dir"; then
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
  PI_START_EPOCH="$(date +%s)"
  OPENROUTER_API_KEY="$openrouter_api_key" \
    timeout --signal=SIGTERM "$KASEKI_AGENT_TIMEOUT_SECONDS" \
    pi --mode json --no-session --provider "$KASEKI_PROVIDER" --model "$KASEKI_MODEL" "$TASK_PROMPT" \
    2> >(tee -a /results/pi-stderr.log >&2) \
    | tee "$RAW_EVENTS" \
    | kaseki-pi-progress-stream /results/progress.jsonl /results/progress.log
  PI_EXIT="${PIPESTATUS[0]}"
  PI_DURATION_SECONDS=$(($(date +%s) - PI_START_EPOCH))
  unset OPENROUTER_API_KEY openrouter_api_key openrouter_api_key_source
  set -e
  record_stage_timing "pi coding agent" "$PI_EXIT" "$PI_DURATION_SECONDS" "timeout_seconds=$KASEKI_AGENT_TIMEOUT_SECONDS"

  if [ "$KASEKI_DEBUG_RAW_EVENTS" = "1" ]; then
    cp "$RAW_EVENTS" /results/pi-events.raw.jsonl
  fi
  kaseki-pi-event-filter "$RAW_EVENTS" /results/pi-events.jsonl /results/pi-summary.json || true
  ACTUAL_MODEL="$(node -e "try{const s=require('/results/pi-summary.json'); console.log(s.selected_model||'')}catch{process.exit(0)}" 2>/dev/null)"
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
record_stage_timing "collect agent diff" 0 "$(($(date +%s) - stage_start))" "diff_nonempty=$DIFF_NONEMPTY"
emit_progress "collect agent diff" "finished"

printf '\n==> quality checks\n'
set_current_stage "quality checks"
emit_progress "quality checks" "started"
stage_start="$(date +%s)"
diff_size="$(wc -c < /results/git.diff | tr -d ' ')"
if [ "$diff_size" -gt "$KASEKI_MAX_DIFF_BYTES" ]; then
  QUALITY_EXIT=4
  printf 'git.diff is too large: %s bytes > %s bytes\n' "$diff_size" "$KASEKI_MAX_DIFF_BYTES" | tee -a /results/quality.log
  emit_event "quality_gate_rule_evaluated" "rule=max_diff_bytes" "passed=false" "actual=$diff_size" "limit=$KASEKI_MAX_DIFF_BYTES"
else
  emit_event "quality_gate_rule_evaluated" "rule=max_diff_bytes" "passed=true" "actual=$diff_size" "limit=$KASEKI_MAX_DIFF_BYTES"
fi
emit_progress "quality checks" "finished with exit $QUALITY_EXIT"

# The sed expression is a literal regex character class used to escape allowlist entries.
# shellcheck disable=SC2016
allowlist_regex="$(printf '%s\n' "$KASEKI_CHANGED_FILES_ALLOWLIST" | tr ' ' '\n' | sed '/^$/d' | sed 's/[.[\*^$()+?{}|\\]/\\&/g' | paste -sd '|' -)"
if [ -n "$allowlist_regex" ]; then
  while IFS= read -r changed_file || [ -n "$changed_file" ]; do
    [ -z "$changed_file" ] && continue
    if ! printf '%s\n' "$changed_file" | grep -Eq "^(${allowlist_regex})$"; then
      QUALITY_EXIT=5
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
elif [ "$PI_EXIT" -ne 0 ] && [ "$KASEKI_VALIDATE_AFTER_AGENT_FAILURE" != "1" ]; then
  printf 'Validation skipped because pi coding agent failed with exit %s. Set KASEKI_VALIDATE_AFTER_AGENT_FAILURE=1 to run validation anyway.\n' "$PI_EXIT" | tee -a /results/validation.log
  record_stage_timing "validation" "$PI_EXIT" 0 "skipped_after_agent_failure"
else
  set +e
  IFS=';' read -r -a VALIDATION_COMMANDS <<< "$KASEKI_VALIDATION_COMMANDS"
  for command in "${VALIDATION_COMMANDS[@]}"; do
    trimmed="$(printf '%s' "$command" | sed 's/^ *//; s/ *$//')"
    [ -z "$trimmed" ] && continue
    validation_start="$(date +%s)"
    emit_event "validation_command_started" "command=$trimmed"
    {
      printf '\n==> %s\n' "$trimmed"
      unset OPENROUTER_API_KEY
      bash -lc "$trimmed"
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
    fi
  done
  set -e
  record_stage_timing "validation" "$VALIDATION_EXIT" "$(($(date +%s) - stage_start))" ""
fi
emit_progress "validation" "finished with exit $VALIDATION_EXIT"

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

printf '\n==> github operations\n'
set_current_stage "github operations"
emit_progress "github operations" "started"
stage_start="$(date +%s)"
: > /results/git-push.log
if [ "$GITHUB_APP_ENABLED" = "1" ] &&
  [ "$PI_EXIT" -eq 0 ] &&
  [ "$VALIDATION_EXIT" -eq 0 ] &&
  [ "$QUALITY_EXIT" -eq 0 ] &&
  [ "$SECRET_SCAN_EXIT" -eq 0 ] &&
  [ "$DIFF_NONEMPTY" = "true" ]; then
  if [ -r /run/secrets/github_app_id ] && [ -r /run/secrets/github_app_client_id ] && [ -r /run/secrets/github_app_private_key ]; then
    run_github_operations
  else
    printf 'GitHub App enabled but secrets not found\n' | tee -a /results/git-push.log >&2
    GITHUB_PUSH_EXIT=7
  fi
else
  printf 'GitHub operations: skipped (agent %s, validation %s, quality %s, secret_scan %s, diff %s, github_enabled %s)\n' \
    "$([ "$PI_EXIT" -eq 0 ] && printf 'passed' || printf 'failed')" \
    "$([ "$VALIDATION_EXIT" -eq 0 ] && printf 'passed' || printf 'failed')" \
    "$([ "$QUALITY_EXIT" -eq 0 ] && printf 'passed' || printf 'failed')" \
    "$([ "$SECRET_SCAN_EXIT" -eq 0 ] && printf 'passed' || printf 'failed')" \
    "$DIFF_NONEMPTY" \
    "$GITHUB_APP_ENABLED" | tee -a /results/git-push.log
  emit_progress "github operations" "skipped"
fi
if [ "$GITHUB_APP_ENABLED" = "1" ]; then
  emit_progress "github operations" "finished with push exit $GITHUB_PUSH_EXIT and pr exit $GITHUB_PR_EXIT"
fi
record_stage_timing "github operations" "$GITHUB_PUSH_EXIT" "$(($(date +%s) - stage_start))" "pr_exit=$GITHUB_PR_EXIT enabled=$GITHUB_APP_ENABLED"

if [ "$VALIDATION_EXIT" -ne 0 ] && [ "$STATUS" -eq 0 ]; then
  STATUS="$VALIDATION_EXIT"
  FAILED_COMMAND="validation"
  emit_error_event "validation_failed" "Validation command exited with code $VALIDATION_EXIT" "exit"
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
