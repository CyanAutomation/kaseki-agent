#!/usr/bin/env bash
set -uo pipefail

INSTANCE_NAME="${KASEKI_INSTANCE:-kaseki-unknown}"
REPO_URL="${REPO_URL:-https://github.com/CyanAutomation/crudmapper}"
GIT_REF="${GIT_REF:-main}"
KASEKI_PROVIDER="${KASEKI_PROVIDER:-openrouter}"
KASEKI_MODEL="${KASEKI_MODEL:-openrouter/free}"
KASEKI_AGENT_TIMEOUT_SECONDS="${KASEKI_AGENT_TIMEOUT_SECONDS:-1200}"
KASEKI_VALIDATION_COMMANDS="${KASEKI_VALIDATION_COMMANDS:-npm run check;npm run test;npm run build}"
KASEKI_DEBUG_RAW_EVENTS="${KASEKI_DEBUG_RAW_EVENTS:-0}"
KASEKI_CHANGED_FILES_ALLOWLIST="${KASEKI_CHANGED_FILES_ALLOWLIST:-src/lib/parser.ts tests/parser.validation.ts}"
KASEKI_MAX_DIFF_BYTES="${KASEKI_MAX_DIFF_BYTES:-200000}"
TASK_PROMPT="${TASK_PROMPT:-Make normalizeRole treat a non-string Name fallback safely when FriendlyName is empty or missing. It should fall back to \"Unnamed Role\" instead of preserving arbitrary truthy non-string values. Add or update a focused Vitest case in tests/parser.validation.ts. Do not print, inspect, or expose environment variables, secrets, credentials, or API keys. Keep changes limited to the source and test files needed for this fix.}"
START_EPOCH="$(date +%s)"
START_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PI_VERSION="$(pi --version 2>/dev/null || true)"
STATUS=0
FAILED_COMMAND=""
PI_EXIT=0
VALIDATION_EXIT=0
DIFF_NONEMPTY=false
QUALITY_EXIT=0
SECRET_SCAN_EXIT=0
ACTUAL_MODEL=""
VALIDATION_TIMINGS_FILE="/results/validation-timings.tsv"
RAW_EVENTS="/tmp/pi-events.raw.jsonl"
KASEKI_DEPENDENCY_CACHE_DIR="${KASEKI_DEPENDENCY_CACHE_DIR:-/workspace/.kaseki-cache}"
KASEKI_IMAGE_DEPENDENCY_CACHE_DIR="${KASEKI_IMAGE_DEPENDENCY_CACHE_DIR:-/opt/kaseki/workspace-cache}"

mkdir_paths=(/results)
if [ -n "${HOME:-}" ]; then
  mkdir_paths+=("${HOME}")
fi
if [ -n "${NPM_CONFIG_CACHE:-}" ]; then
  mkdir_paths+=("${NPM_CONFIG_CACHE}")
fi
if [ -n "${PI_CODING_AGENT_DIR:-}" ]; then
  mkdir_paths+=("${PI_CODING_AGENT_DIR}")
fi
mkdir -p "${mkdir_paths[@]}"
: > /results/stdout.log
: > /results/stderr.log
: > /results/pi-events.jsonl
: > /results/pi-summary.json
: > /results/validation.log
: > "$VALIDATION_TIMINGS_FILE"
exec > >(tee -a /results/stdout.log) 2> >(tee -a /results/stderr.log >&2)
unset OPENROUTER_API_KEY

json_encode() {
  # Self-check: encode via Python's JSON encoder to avoid malformed metadata on special characters.
  python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().rstrip("\n")), end="")'
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
  "started_at": $(printf '%s' "$START_ISO" | json_encode),
  "ended_at": $(printf '%s' "$end_iso" | json_encode),
  "duration_seconds": $duration,
  "exit_code": $exit_code,
  "failed_command": $(printf '%s' "$FAILED_COMMAND" | json_encode),
  "pi_exit_code": $PI_EXIT,
  "validation_exit_code": $VALIDATION_EXIT,
  "quality_exit_code": $QUALITY_EXIT,
  "secret_scan_exit_code": $SECRET_SCAN_EXIT,
  "diff_nonempty": $DIFF_NONEMPTY,
  "actual_model": $(printf '%s' "$ACTUAL_MODEL" | json_encode),
  "node_version": $(node --version 2>/dev/null | json_encode || printf 'null'),
  "npm_version": $(npm --version 2>/dev/null | json_encode || printf 'null'),
  "pi_version": $(printf '%s' "$PI_VERSION" | json_encode)
}
META
  printf '%s\n' "$exit_code" > /results/exit_code
}

write_result_summary() {
  local changed_files validation_status
  changed_files="$(cat /results/changed-files.txt 2>/dev/null || true)"
  validation_status="passed"
  [ "$VALIDATION_EXIT" -ne 0 ] && validation_status="failed"

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
- Diff non-empty: $DIFF_NONEMPTY
- Changed files:
$(printf '%s\n' "$changed_files" | sed 's/^/  - /')

Artifacts:
- metadata.json
- pi-summary.json
- pi-events.jsonl
- validation.log
- validation-timings.tsv
- git.diff
- git.status
SUMMARY
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
  write_result_summary
  write_metadata "$STATUS"
  exit "$STATUS"
}
trap finish EXIT

run_step() {
  local label="$1"
  shift
  printf '\n==> %s\n' "$label"
  "$@"
  local code=$?
  if [ "$code" -ne 0 ] && [ "$STATUS" -eq 0 ]; then
    STATUS="$code"
    FAILED_COMMAND="$label"
  fi
  return 0
}

printf 'Kaseki instance: %s\n' "$INSTANCE_NAME"
printf 'Repository: %s\n' "$REPO_URL"
printf 'Git ref: %s\n' "$GIT_REF"
printf 'Provider: %s\n' "$KASEKI_PROVIDER"
printf 'Model: %s\n' "$KASEKI_MODEL"
printf 'Pi version: %s\n' "$PI_VERSION"

run_step "clone repository" git clone --depth 1 --branch "$GIT_REF" "$REPO_URL" /workspace/repo
cd /workspace/repo || { STATUS=1; FAILED_COMMAND="enter repository"; exit 0; }

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

  local repo_key lock_hash cache_key repo_cache_dir workspace_cache_dir image_cache_dir
  repo_key="$(printf '%s@%s' "$REPO_URL" "$GIT_REF" | sha256sum | awk '{print $1}')"
  lock_hash="$(sha256sum "$lock_source" | awk '{print $1}')"
  cache_key="${repo_key}/${lock_hash}"
  repo_cache_dir=".kaseki-cache/${lock_hash}"
  workspace_cache_dir="${KASEKI_DEPENDENCY_CACHE_DIR}/${cache_key}/node_modules"
  image_cache_dir="${KASEKI_IMAGE_DEPENDENCY_CACHE_DIR}/${cache_key}/node_modules"

  mkdir -p ".kaseki-cache" "$KASEKI_DEPENDENCY_CACHE_DIR"

  if [ -d node_modules ] && [ -f "${repo_cache_dir}/stamp.txt" ]; then
    if grep -qx "$lock_hash" "${repo_cache_dir}/stamp.txt"; then
      printf 'Dependency cache status: using existing repo node_modules for lock hash %s.\n' "$lock_hash"
      return 0
    fi
  fi

  if [ ! -d node_modules ] && [ -d "$workspace_cache_dir" ]; then
    printf 'Dependency cache status: restoring node_modules from workspace cache (%s).\n' "$workspace_cache_dir"
    cp -a "$workspace_cache_dir" ./node_modules
  elif [ ! -d node_modules ] && [ -d "$image_cache_dir" ]; then
    printf 'Dependency cache status: restoring node_modules from image cache (%s).\n' "$image_cache_dir"
    cp -a "$image_cache_dir" ./node_modules
  fi

  if [ ! -d node_modules ]; then
    printf 'Dependency cache status: cache miss, running install.\n'
    npm ci --prefer-offline || npm install
  else
    printf 'Dependency cache status: install skipped due to cache hit.\n'
  fi

  mkdir -p "$repo_cache_dir" "$(dirname "$workspace_cache_dir")"
  printf '%s\n' "$lock_hash" > "${repo_cache_dir}/stamp.txt"
  rm -rf "$workspace_cache_dir"
  cp -a node_modules "$workspace_cache_dir"
}

run_step "prepare node dependencies" prepare_dependencies

printf '\n==> pi coding agent\n'
set +e
openrouter_api_key="${OPENROUTER_API_KEY:-}"
if [ -r /run/secrets/openrouter_api_key ]; then
  secret_content="$(cat /run/secrets/openrouter_api_key)"
  if [ -n "$secret_content" ]; then
    openrouter_api_key="$secret_content"
  fi
fi
OPENROUTER_API_KEY="$openrouter_api_key" \
  timeout "$KASEKI_AGENT_TIMEOUT_SECONDS" \
  pi --mode json --no-session --provider "$KASEKI_PROVIDER" --model "$KASEKI_MODEL" "$TASK_PROMPT" \
  > "$RAW_EVENTS" \
  2> >(tee -a /results/pi-stderr.log >&2)
PI_EXIT="$?"
unset OPENROUTER_API_KEY
set -e

if [ "$KASEKI_DEBUG_RAW_EVENTS" = "1" ]; then
  cp "$RAW_EVENTS" /results/pi-events.raw.jsonl
fi
kaseki-pi-event-filter "$RAW_EVENTS" /results/pi-events.jsonl /results/pi-summary.json || true
ACTUAL_MODEL="$(node -e "try{const s=require('/results/pi-summary.json'); console.log(s.selected_model||'')}catch{process.exit(0)}" 2>/dev/null)"

if [ "$PI_EXIT" -ne 0 ] && [ "$STATUS" -eq 0 ]; then
  STATUS="$PI_EXIT"
  FAILED_COMMAND="pi coding agent"
fi

printf '\n==> collect agent diff\n'
collect_git_artifacts

printf '\n==> quality checks\n'
diff_size="$(wc -c < /results/git.diff | tr -d ' ')"
if [ "$diff_size" -gt "$KASEKI_MAX_DIFF_BYTES" ]; then
  QUALITY_EXIT=4
  printf 'git.diff is too large: %s bytes > %s bytes\n' "$diff_size" "$KASEKI_MAX_DIFF_BYTES" | tee -a /results/quality.log
fi

allowlist_regex="$(printf '%s\n' "$KASEKI_CHANGED_FILES_ALLOWLIST" | tr ' ' '\n' | sed '/^$/d' | sed 's/[.[\*^$()+?{}|\\]/\\&/g' | paste -sd '|' -)"
if [ -n "$allowlist_regex" ]; then
  while IFS= read -r changed_file; do
    [ -z "$changed_file" ] && continue
    if ! printf '%s\n' "$changed_file" | grep -Eq "^(${allowlist_regex})$"; then
      QUALITY_EXIT=5
      printf 'changed file outside allowlist: %s\n' "$changed_file" | tee -a /results/quality.log
    fi
  done < /results/changed-files.txt
fi

if [ -f package.json ] && node -e "const p=require('./package.json'); process.exit(p.scripts && (p.scripts.format || p.scripts['format:check']) ? 0 : 1)" 2>/dev/null; then
  format_command="$(node -e "const p=require('./package.json'); console.log(p.scripts['format:check'] ? 'npm run format:check' : 'npm run format -- --check')" 2>/dev/null)"
  printf '%s\n' "$format_command" >> /results/format-check-command.txt
fi

printf '\n==> validation\n'
set +e
IFS=';' read -r -a VALIDATION_COMMANDS <<< "$KASEKI_VALIDATION_COMMANDS"
for command in "${VALIDATION_COMMANDS[@]}"; do
  trimmed="$(printf '%s' "$command" | sed 's/^ *//; s/ *$//')"
  [ -z "$trimmed" ] && continue
  validation_start="$(date +%s)"
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
  printf '%s\t%s\t%s\n' "$trimmed" "$command_exit" "$((validation_end - validation_start))" >> "$VALIDATION_TIMINGS_FILE"
  if [ "$command_exit" -ne 0 ] && [ "$VALIDATION_EXIT" -eq 0 ]; then
    VALIDATION_EXIT="$command_exit"
  fi
done
set -e

printf '\n==> secret scan\n'
: > /results/secret-scan.log
if grep -R -n -E 'sk-or-[A-Za-z0-9._-]+' /results /workspace/repo/.git /workspace/repo/src /workspace/repo/tests 2>/dev/null | grep -v '/secret-scan.log:' > /results/secret-scan.log; then
  SECRET_SCAN_EXIT=6
fi

if [ "$VALIDATION_EXIT" -ne 0 ] && [ "$STATUS" -eq 0 ]; then
  STATUS="$VALIDATION_EXIT"
  FAILED_COMMAND="validation"
fi

if [ "$QUALITY_EXIT" -ne 0 ] && [ "$STATUS" -eq 0 ]; then
  STATUS="$QUALITY_EXIT"
  FAILED_COMMAND="quality checks"
fi

if [ "$SECRET_SCAN_EXIT" -ne 0 ] && [ "$STATUS" -eq 0 ]; then
  STATUS="$SECRET_SCAN_EXIT"
  FAILED_COMMAND="secret scan"
fi

if [ "$DIFF_NONEMPTY" != "true" ] && [ "$STATUS" -eq 0 ]; then
  STATUS=3
  FAILED_COMMAND="empty git diff"
fi
