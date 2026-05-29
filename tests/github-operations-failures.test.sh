#!/usr/bin/env bash
# shellcheck disable=SC2016
# tests/github-operations-failures.test.sh
# Command-level GitHub operation failure tests. These tests execute
# kaseki-agent.sh with fixture binaries/secrets instead of asserting internal
# helper names, variable names, or implementation text.

set -uo pipefail

TESTS_PASSED=0
TESTS_FAILED=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_ROOT="$(mktemp -d /tmp/kaseki-github-failures.XXXXXX)"
TOKEN_HELPER_PATH="/usr/local/bin/github-app-token"
TOKEN_HELPER_BACKUP=""
TOKEN_HELPER_EXISTED=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

cleanup() {
  if [ "$TOKEN_HELPER_EXISTED" -eq 1 ] && [ -n "$TOKEN_HELPER_BACKUP" ] && [ -f "$TOKEN_HELPER_BACKUP" ]; then
    cp "$TOKEN_HELPER_BACKUP" "$TOKEN_HELPER_PATH" 2>/dev/null || true
    chmod +x "$TOKEN_HELPER_PATH" 2>/dev/null || true
  else
    rm -f "$TOKEN_HELPER_PATH" 2>/dev/null || true
  fi
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

if [ -e "$TOKEN_HELPER_PATH" ]; then
  TOKEN_HELPER_EXISTED=1
  TOKEN_HELPER_BACKUP="$TMP_ROOT/github-app-token.backup"
  cp "$TOKEN_HELPER_PATH" "$TOKEN_HELPER_BACKUP"
fi

pass() {
  printf '%b✓%b %s\n' "$GREEN" "$NC" "$1"
  ((TESTS_PASSED++))
}

fail() {
  printf '%b✗%b %s\n' "$RED" "$NC" "$1" >&2
  if [ $# -gt 1 ]; then
    printf '%s\n' "$2" >&2
  fi
  ((TESTS_FAILED++))
}

test_case() {
  printf '\n%b[TEST]%b %s\n' "$YELLOW" "$NC" "$1"
}

assert_eq() {
  local expected="$1" actual="$2" desc="$3"
  if [ "$actual" = "$expected" ]; then
    pass "$desc ($actual)"
  else
    fail "$desc" "expected: $expected\nactual:   $actual"
  fi
}

assert_file_contains() {
  local file="$1" pattern="$2" desc="$3"
  if [ ! -f "$file" ]; then
    fail "$desc" "missing file: $file"
    return 0
  fi
  if grep -Eq "$pattern" "$file"; then
    pass "$desc"
  else
    fail "$desc" "pattern not found: $pattern\n--- $file ---\n$(sed -n '1,220p' "$file")"
  fi
}

assert_json_value() {
  local file="$1" filter="$2" expected="$3" desc="$4" actual
  if [ ! -f "$file" ]; then
    fail "$desc" "missing JSON file: $file"
    return 0
  fi
  actual="$(jq -r "$filter" "$file" 2>&1)"
  if [ "$actual" = "$expected" ]; then
    pass "$desc ($actual)"
  else
    fail "$desc" "filter: $filter\nexpected: $expected\nactual:   $actual\n--- $file ---\n$(cat "$file")"
  fi
}

assert_progress_event() {
  local results_dir="$1" jq_filter="$2" desc="$3"
  local file="$results_dir/progress.jsonl"
  if [ ! -f "$file" ]; then
    fail "$desc" "missing progress event log: $file"
    return 0
  fi
  if jq -e "$jq_filter" "$file" >/dev/null 2>&1; then
    pass "$desc"
  else
    fail "$desc" "event filter did not match: $jq_filter\n--- progress.jsonl ---\n$(sed -n '1,240p' "$file")"
  fi
}

install_common_fixtures() {
  local fixture_dir="$1"
  mkdir -p "$fixture_dir/bin" "$fixture_dir/secrets" "$fixture_dir/home" "$fixture_dir/cache" "$fixture_dir/askpass"

  cat > "$fixture_dir/bin/git" <<'GIT'
#!/usr/bin/env bash
set -u
if [ "${1:-}" = "--version" ]; then
  printf 'git version fixture\n'
  exit 0
fi
if [ "${1:-}" = "-C" ]; then
  shift 2
fi
cmd="${1:-}"
shift || true
case "$cmd" in
  clone)
    target="${@: -1}"
    rm -rf "$target"
    mkdir -p "$target/.git"
    printf 'original\n' > "$target/fixture.txt"
    ;;
  config|checkout|add|commit|push|reset|clean)
    ;;
  status)
    if [ "${1:-}" = "--short" ] || [ "${1:-}" = "--porcelain" ]; then
      printf ' M fixture.txt\n'
    fi
    ;;
  diff)
    if [ "${1:-}" = "--name-only" ]; then
      printf 'fixture.txt\n'
    else
      printf 'diff --git a/fixture.txt b/fixture.txt\n--- a/fixture.txt\n+++ b/fixture.txt\n@@ -1 +1 @@\n-original\n+changed\n'
    fi
    ;;
  ls-files)
    ;;
  rev-parse)
    printf 'true\n'
    ;;
  remote)
    ;;
  *)
    ;;
esac
exit 0
GIT
  chmod +x "$fixture_dir/bin/git"

  cat > "$fixture_dir/bin/pi" <<'PI'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then
  printf 'pi fixture 1.0.0\n'
fi
exit 0
PI
  chmod +x "$fixture_dir/bin/pi"

  cat > "$fixture_dir/bin/kaseki-pi-progress-stream" <<'STREAM'
#!/usr/bin/env bash
cat >/dev/null
exit 0
STREAM
  chmod +x "$fixture_dir/bin/kaseki-pi-progress-stream"

  cat > "$fixture_dir/bin/kaseki-pi-event-filter" <<'FILTER'
#!/usr/bin/env bash
input="$1"
events="$2"
summary="$3"
cp "$input" "$events" 2>/dev/null || : > "$events"
printf '{"selected_model":"fixture-model","counters":{"models":{"fixture-model":1}}}\n' > "$summary"
exit 0
FILTER
  chmod +x "$fixture_dir/bin/kaseki-pi-event-filter"

  cat > "$fixture_dir/bin/validation-output-filter" <<'VALIDATION'
#!/usr/bin/env bash
cat
exit 0
VALIDATION
  chmod +x "$fixture_dir/bin/validation-output-filter"

  cat > "$fixture_dir/bin/npm" <<'NPM'
#!/usr/bin/env bash
case "${1:-}" in
  --version) printf '10.0.0\n' ;;
  config) printf 'https://registry.npmjs.org/\n' ;;
esac
exit 0
NPM
  chmod +x "$fixture_dir/bin/npm"

  ln -sf "$(command -v node)" "$fixture_dir/bin/node"

  cat > "$fixture_dir/bin/curl" <<'CURL'
#!/usr/bin/env bash
case "${KASEKI_CURL_FIXTURE:-success}" in
  pr_api_422)
    printf '{"message":"fixture validation failed","errors":[{"resource":"PullRequest","code":"custom"}]}422'
    ;;
  *)
    printf '{"html_url":"https://github.com/octo/hello/pull/42","number":42}201'
    ;;
esac
exit 0
CURL
  chmod +x "$fixture_dir/bin/curl"

  # Finish helpers are optional in production images; create no-op versions so
  # the command-level fixtures focus only on GitHub operation failures.
  mkdir -p /app/lib /app/scripts 2>/dev/null || true
  : > /app/lib/event-aggregator.js 2>/dev/null || true
  : > /app/lib/timestamp-tracker.js 2>/dev/null || true
  : > /app/lib/progress-stream-utils.js 2>/dev/null || true
}

install_token_helper() {
  local mode="$1"
  cat > "$TOKEN_HELPER_PATH" <<'NODE'
#!/usr/bin/env node
const mode = process.env.KASEKI_TOKEN_HELPER_FIXTURE || 'success';
if (process.argv.length <= 2) {
  console.error('Usage: github-app-token <app-id> <private-key-file> <owner> <repo>');
  process.exit(1);
}
if (mode === 'structured_stderr_failure') {
  console.error(JSON.stringify({
    error: 'fixture installation token denied',
    status: 401,
    request_id: 'token-fixture-123'
  }));
  process.exit(42);
}
process.stdout.write(JSON.stringify({ token: 'ghu_fixture_token', expires_at: '2026-06-01T00:00:00Z' }));
NODE
  chmod +x "$TOKEN_HELPER_PATH"
  export KASEKI_TOKEN_HELPER_FIXTURE="$mode"
}

write_valid_secrets() {
  local secrets_dir="$1"
  mkdir -p "$secrets_dir"
  printf '12345\n' > "$secrets_dir/github_app_id"
  printf 'Iv1.fixture\n' > "$secrets_dir/github_app_client_id"
  cat > "$secrets_dir/github_app_private_key" <<'KEY'
-----BEGIN PRIVATE KEY-----
MIIEfixture
-----END PRIVATE KEY-----
KEY
}

run_agent_fixture() {
  local name="$1" token_mode="$2" curl_mode="$3" secrets_mode="$4"
  local fixture_dir="$TMP_ROOT/$name"
  install_common_fixtures "$fixture_dir"
  install_token_helper "$token_mode"
  local skip_preflight=0
  if [ "$secrets_mode" = "present" ]; then
    write_valid_secrets "$fixture_dir/secrets"
    skip_preflight=1
  fi

  rm -rf /results /workspace/repo
  mkdir -p /results /workspace

  local stdout_file="$fixture_dir/stdout.log"
  local stderr_file="$fixture_dir/stderr.log"
  (
    cd "$PROJECT_ROOT" || exit 99
    env \
      PATH="$fixture_dir/bin:$PATH" \
      HOME="$fixture_dir/home" \
      KASEKI_LOG_DIR="/dev/null/kaseki-host-logs" \
      KASEKI_STRICT_HOST_LOGGING=0 \
      KASEKI_INSTANCE="fixture-$name" \
      REPO_URL="https://github.com/octo/hello" \
      GIT_REF="main" \
      OPENROUTER_API_KEY="fixture-openrouter-key" \
      KASEKI_DRY_RUN=1 \
      KASEKI_MAX_DIFF_BYTES=999999999 \
      KASEKI_VALIDATION_FAIL_FAST=0 \
      KASEKI_SCOUTING=0 \
      KASEKI_GOAL_CHECK=0 \
      KASEKI_RUN_EVALUATION=0 \
      KASEKI_PRE_AGENT_VALIDATION=0 \
      KASEKI_TS_PRE_CHECK=0 \
      KASEKI_VALIDATION_COMMANDS=none \
      KASEKI_CHANGED_FILES_ALLOWLIST="fixture.txt" \
      KASEKI_RESTORE_DISALLOWED_CHANGES=0 \
      KASEKI_GIT_CACHE_MODE=off \
      KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK=0 \
      KASEKI_SKIP_GITHUB_PREFLIGHT="$skip_preflight" \
      KASEKI_GITHUB_PR_RETRIES=0 \
      KASEKI_GITHUB_ASKPASS_DIR="$fixture_dir/askpass" \
      KASEKI_SECRETS_DIR="$fixture_dir/secrets" \
      GITHUB_APP_ID_FILE="$fixture_dir/secrets/github_app_id" \
      GITHUB_APP_CLIENT_ID_FILE="$fixture_dir/secrets/github_app_client_id" \
      GITHUB_APP_PRIVATE_KEY_FILE="$fixture_dir/secrets/github_app_private_key" \
      KASEKI_GITHUB_APP_TOKEN_HELPER="$TOKEN_HELPER_PATH" \
      KASEKI_TOKEN_HELPER_FIXTURE="$token_mode" \
      KASEKI_CURL_FIXTURE="$curl_mode" \
      bash "$PROJECT_ROOT/kaseki-agent.sh"
  ) >"$stdout_file" 2>"$stderr_file"
  local status=$?
  cp -a /results "$fixture_dir/results"
  printf '%s\n' "$status" > "$fixture_dir/status"
  LAST_FIXTURE_DIR="$fixture_dir"
}

# ===== Fixture 1: Missing GitHub App secrets =====
test_case "missing GitHub App secrets are reported as configuration failures"
run_agent_fixture missing-secrets success success missing
missing_dir="$LAST_FIXTURE_DIR"
missing_status="$(cat "$missing_dir/status")"
assert_eq "7" "$missing_status" "agent process exits with the GitHub configuration error category"
assert_json_value "$missing_dir/results/metadata.json" '.exit_code' "7" "metadata records the configuration exit code"
assert_json_value "$missing_dir/results/metadata.json" '.github_push_exit_code' "7" "metadata records GitHub push/config failure code"
assert_json_value "$missing_dir/results/metadata.json" '.github_skip_reasons | index("github_app_secrets_missing") != null' "true" "metadata records missing-secret skip reason"
assert_file_contains "$missing_dir/results/github-health-check.log" 'Cannot read GitHub App ID' "health check emits a user-facing missing-secret message"
assert_file_contains "$missing_dir/results/git-push.log" 'github_app_secrets_missing' "GitHub operation log emits a user-facing missing-secret skip reason"
assert_progress_event "$missing_dir/results" 'select(.event_type == "error" and .error_type == "github_preflight_failed" and .recovery_action == "continue")' "structured event records preflight failure with recovery action"
assert_progress_event "$missing_dir/results" 'select(.event_type == "error" and .error_type == "github_operation_failed" and .recovery_action == "exit")' "structured event records terminal GitHub operation failure"

# ===== Fixture 2: Token helper structured stderr failure =====
test_case "token helper structured stderr is surfaced without relying on helper internals"
run_agent_fixture token-helper-structured-stderr structured_stderr_failure success present
token_dir="$LAST_FIXTURE_DIR"
token_status="$(cat "$token_dir/status")"
assert_eq "7" "$token_status" "agent process exits with the GitHub token/config error category"
assert_json_value "$token_dir/results/metadata.json" '.exit_code' "7" "metadata records token failure exit code"
assert_json_value "$token_dir/results/metadata.json" '.github_push_exit_code' "7" "metadata records GitHub push/token failure code"
assert_json_value "$token_dir/results/metadata.json" '.github_operation_phase' "token_generation" "metadata records token generation phase"
assert_json_value "$token_dir/results/metadata.json" '.github_api_error_type' "github_app_token_error" "metadata records token-specific API error type"
assert_json_value "$token_dir/results/metadata.json" '.github_api_error_message' "fixture installation token denied" "metadata records parsed structured token-helper error"
assert_json_value "$token_dir/results/metadata.json" '.github_api_http_status' "401" "metadata records parsed token-helper HTTP status"
assert_file_contains "$token_dir/results/git-push.log" 'Failed to generate token: fixture installation token denied' "GitHub operation log emits parsed token-helper message"
assert_progress_event "$token_dir/results" 'select(.event_type == "error" and .error_type == "github_app_token_failed" and (.detail | contains("fixture installation token denied")) and .recovery_action == "exit")' "structured event records parsed token-helper failure fields"

# ===== Fixture 3: GitHub PR API known failure payload =====
test_case "GitHub PR API payload failures are reported as API failures"
run_agent_fixture pr-api-422 success pr_api_422 present
api_dir="$LAST_FIXTURE_DIR"
api_status="$(cat "$api_dir/status")"
assert_eq "9" "$api_status" "agent process exits with the GitHub API error category"
assert_json_value "$api_dir/results/metadata.json" '.exit_code' "9" "metadata records API failure exit code"
assert_json_value "$api_dir/results/metadata.json" '.github_push_exit_code' "0" "metadata records successful push before API failure"
assert_json_value "$api_dir/results/metadata.json" '.github_pr_exit_code' "9" "metadata records PR API failure code"
assert_json_value "$api_dir/results/metadata.json" '.github_operation_phase' "pr_creation" "metadata records PR creation phase"
assert_json_value "$api_dir/results/metadata.json" '.github_api_error_type' "validation_error" "metadata records API error type mapped from HTTP status"
assert_json_value "$api_dir/results/metadata.json" '.github_api_error_message' "fixture validation failed" "metadata records API payload message"
assert_json_value "$api_dir/results/metadata.json" '.github_api_http_status' "422" "metadata records API HTTP status"
assert_file_contains "$api_dir/results/git-push.log" 'Failed to create PR\. API error: fixture validation failed' "GitHub operation log emits user-facing API failure message"
assert_progress_event "$api_dir/results" 'select(.event_type == "error" and .error_type == "github_pr_api_failed" and (.detail | contains("validation_error")) and (.detail | contains("fixture validation failed")) and .recovery_action == "exit")' "structured event records API error type, message, and recovery action"
assert_progress_event "$api_dir/results" 'select(.event_type == "error" and .error_type == "github_operation_failed" and (.detail | contains("exit code 9")) and .recovery_action == "exit")' "structured event records terminal API category exit"

printf '\n%b=== Test Summary ===%b\n' "$YELLOW" "$NC"
printf 'Passed: %b%d%b\n' "$GREEN" "$TESTS_PASSED" "$NC"
printf 'Failed: %b%d%b\n' "$RED" "$TESTS_FAILED" "$NC"

if [ "$TESTS_FAILED" -eq 0 ]; then
  printf '\n%bAll tests passed!%b\n' "$GREEN" "$NC"
  exit 0
fi

printf '\n%bSome tests failed!%b\n' "$RED" "$NC"
exit 1
