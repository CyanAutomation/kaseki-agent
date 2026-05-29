#!/usr/bin/env bash
# tests/github-operations-failures.test.sh
# Command-level tests for GitHub operation failure contracts.

set -uo pipefail

TESTS_PASSED=0
TESTS_FAILED=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

TEST_ROOT="$(mktemp -d /tmp/kaseki-github-ops-failures.XXXXXX)"
REAL_GIT="$(command -v git)"
ORIGINAL_TOKEN_HELPER_BACKUP=""
ORIGINAL_TOKEN_HELPER_PRESENT=0
CREATED_APP_LIB_FIXTURES=()

cleanup() {
  if [ "$ORIGINAL_TOKEN_HELPER_PRESENT" -eq 1 ] && [ -n "$ORIGINAL_TOKEN_HELPER_BACKUP" ] && [ -f "$ORIGINAL_TOKEN_HELPER_BACKUP" ]; then
    cp "$ORIGINAL_TOKEN_HELPER_BACKUP" /usr/local/bin/github-app-token 2>/dev/null || true
    chmod +x /usr/local/bin/github-app-token 2>/dev/null || true
  else
    rm -f /usr/local/bin/github-app-token 2>/dev/null || true
  fi
  for helper_file in "${CREATED_APP_LIB_FIXTURES[@]:-}"; do
    rm -f "$helper_file" 2>/dev/null || true
  done
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

if [ -e /usr/local/bin/github-app-token ]; then
  ORIGINAL_TOKEN_HELPER_PRESENT=1
  ORIGINAL_TOKEN_HELPER_BACKUP="$TEST_ROOT/original-github-app-token"
  cp /usr/local/bin/github-app-token "$ORIGINAL_TOKEN_HELPER_BACKUP"
fi

test_case() {
  printf '\n%b[TEST]%b %s\n' "$YELLOW" "$NC" "$1"
}

pass() {
  printf '%b✓%b %s\n' "$GREEN" "$NC" "$1"
  ((TESTS_PASSED++))
}

fail() {
  printf '%b✗%b %s\n' "$RED" "$NC" "$1"
  ((TESTS_FAILED++))
}

assert_eq() {
  local expected="$1" actual="$2" desc="$3"
  if [ "$actual" = "$expected" ]; then
    pass "$desc"
  else
    fail "$desc - expected '$expected', got '$actual'"
  fi
}

assert_file_contains() {
  local file="$1" pattern="$2" desc="$3"
  if [ -f "$file" ] && grep -Eq "$pattern" "$file"; then
    pass "$desc"
  else
    fail "$desc - pattern '$pattern' not found in $file"
    [ -f "$file" ] && sed -n '1,160p' "$file"
  fi
}

json_field() {
  local file="$1" expr="$2"
  node -e '
const fs = require("node:fs");
const [file, expr] = process.argv.slice(1);
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const fn = new Function("data", `return (${expr});`);
const value = fn(data);
if (value === undefined || value === null) process.exit(2);
process.stdout.write(String(value));
' "$file" "$expr"
}

assert_json_field_eq() {
  local file="$1" expr="$2" expected="$3" desc="$4" actual
  actual="$(json_field "$file" "$expr" 2>/dev/null || true)"
  assert_eq "$expected" "$actual" "$desc"
}

last_error_event_field() {
  local file="$1" error_type="$2" field="$3"
  node -e '
const fs = require("node:fs");
const [file, errorType, field] = process.argv.slice(1);
let match = null;
for (const line of fs.readFileSync(file, "utf8").trim().split(/\n/)) {
  if (!line) continue;
  const event = JSON.parse(line);
  if (event.event_type === "error" && event.error_type === errorType) match = event;
}
if (!match) process.exit(2);
process.stdout.write(String(match[field] ?? ""));
' "$file" "$error_type" "$field"
}

assert_error_event_field_eq() {
  local progress_file="$1" error_type="$2" field="$3" expected="$4" desc="$5" actual
  actual="$(last_error_event_field "$progress_file" "$error_type" "$field" 2>/dev/null || true)"
  assert_eq "$expected" "$actual" "$desc"
}

create_source_repo() {
  local repo_dir="$1"
  mkdir -p "$repo_dir"
  "$REAL_GIT" -C "$repo_dir" init -q -b main
  printf 'initial\n' > "$repo_dir/fixture.txt"
  "$REAL_GIT" -C "$repo_dir" add fixture.txt
  "$REAL_GIT" -C "$repo_dir" -c user.name='Fixture' -c user.email='fixture@example.test' commit -q -m 'initial fixture commit'
}

write_common_fake_bin() {
  local bin_dir="$1" source_repo="$2"
  mkdir -p "$bin_dir"

  cat > "$bin_dir/git" <<'EOF_GIT'
#!/usr/bin/env bash
set -uo pipefail
if [ "${1:-}" = "clone" ]; then
  dest="${@: -1}"
  rm -rf "$dest"
  exec "$KASEKI_TEST_REAL_GIT" clone --quiet "$KASEKI_TEST_SOURCE_REPO" "$dest"
fi
if [ "${1:-}" = "push" ]; then
  printf 'fixture git push accepted: %s\n' "$*"
  exit 0
fi
exec "$KASEKI_TEST_REAL_GIT" "$@"
EOF_GIT
  chmod +x "$bin_dir/git"

  cat > "$bin_dir/pi" <<'EOF_PI'
#!/usr/bin/env bash
set -uo pipefail
if [ "${1:-}" = "--version" ]; then
  printf 'fixture-pi 1.0.0\n'
  exit 0
fi
printf 'updated by fixture pi\n' >> /workspace/repo/fixture.txt
printf '{"type":"message","model":"fixture-model","content":"fixture change"}\n'
EOF_PI
  chmod +x "$bin_dir/pi"

  cat > "$bin_dir/kaseki-pi-progress-stream" <<'EOF_PROGRESS'
#!/usr/bin/env bash
cat >/dev/null
: > "${1:-/tmp/progress.jsonl}"
: > "${2:-/tmp/progress.log}"
EOF_PROGRESS
  chmod +x "$bin_dir/kaseki-pi-progress-stream"

  cat > "$bin_dir/kaseki-pi-event-filter" <<'EOF_FILTER'
#!/usr/bin/env bash
input="$1"
output="$2"
summary="$3"
cp "$input" "$output" 2>/dev/null || : > "$output"
printf '{"selected_model":"fixture-model","model":"fixture-model","counters":{"models":{"fixture-model":1}}}\n' > "$summary"
EOF_FILTER
  chmod +x "$bin_dir/kaseki-pi-event-filter"

  cat > "$bin_dir/validation-output-filter" <<'EOF_VALIDATION_FILTER'
#!/usr/bin/env bash
cat
EOF_VALIDATION_FILTER
  chmod +x "$bin_dir/validation-output-filter"

  if [ "${3:-}" = "api_failure" ]; then
    cat > "$bin_dir/curl" <<'EOF_CURL'
#!/usr/bin/env bash
printf '{"message":"Validation Failed: fixture duplicate pull request","errors":[{"resource":"PullRequest","code":"custom","message":"fixture duplicate"}]}422'
EOF_CURL
    chmod +x "$bin_dir/curl"
  fi

  export KASEKI_TEST_REAL_GIT="$REAL_GIT"
  export KASEKI_TEST_SOURCE_REPO="$source_repo"
}

ensure_app_lib_fixtures() {
  mkdir -p /app/lib
  local helper_file
  for helper_file in event-aggregator.js timestamp-tracker.js progress-stream-utils.js; do
    if [ ! -e "/app/lib/$helper_file" ]; then
      printf '// fixture helper for command-level tests\n' > "/app/lib/$helper_file"
      CREATED_APP_LIB_FIXTURES+=("/app/lib/$helper_file")
    fi
  done
}

write_token_helper() {
  local mode="$1"
  case "$mode" in
    structured_failure)
      cat > /usr/local/bin/github-app-token <<'EOF_TOKEN_FAIL'
if (process.argv.length <= 2) {
  console.log('Usage: github-app-token <app-id> <private-key-file> <owner> <repo>');
  process.exit(1);
}
console.error(JSON.stringify({ error: 'fixture helper refused installation token', status: 401 }));
process.exit(42);
EOF_TOKEN_FAIL
      ;;
    success)
      cat > /usr/local/bin/github-app-token <<'EOF_TOKEN_OK'
if (process.argv.length <= 2) {
  console.log('Usage: github-app-token <app-id> <private-key-file> <owner> <repo>');
  process.exit(1);
}
console.log(JSON.stringify({ token: 'fixture-token' }));
EOF_TOKEN_OK
      ;;
  esac
  chmod +x /usr/local/bin/github-app-token
}

write_secrets() {
  local secrets_dir="$1"
  mkdir -p "$secrets_dir"
  printf '123456\n' > "$secrets_dir/github_app_id"
  printf 'Iv1.fixtureclient\n' > "$secrets_dir/github_app_client_id"
  printf '%s\n' '-----BEGIN RSA PRIVATE KEY-----' 'fixture' '-----END RSA PRIVATE KEY-----' > "$secrets_dir/github_app_private_key"
}

run_agent_fixture() {
  local name="$1" token_mode="$2" curl_mode="${3:-none}" secrets_mode="${4:-present}"
  local case_dir="$TEST_ROOT/$name"
  local source_repo="$case_dir/source-repo"
  local bin_dir="$case_dir/bin"
  local secrets_dir="$case_dir/secrets"
  local stdout_log="$case_dir/stdout.log"
  local stderr_log="$case_dir/stderr.log"
  local exit_file="$case_dir/exit"
  mkdir -p "$case_dir"
  ensure_app_lib_fixtures
  create_source_repo "$source_repo"
  write_common_fake_bin "$bin_dir" "$source_repo" "$curl_mode"
  if [ "$secrets_mode" = "present" ]; then
    write_secrets "$secrets_dir"
  else
    mkdir -p "$secrets_dir"
  fi
  if [ "$token_mode" != "missing" ]; then
    write_token_helper "$token_mode"
  else
    rm -f /usr/local/bin/github-app-token
  fi

  rm -rf /results /workspace/repo
  mkdir -p /results /workspace

  (
    set +e
    export PATH="$bin_dir:$PATH"
    export REPO_URL="https://github.com/example/fixture-repo"
    export GIT_REF="main"
    export KASEKI_INSTANCE="fixture-$name"
    export OPENROUTER_API_KEY="fixture-openrouter-key"
    export KASEKI_SECRETS_DIR="$secrets_dir"
    export KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK=0
    export KASEKI_PRE_AGENT_VALIDATION=0
    export KASEKI_TS_PRE_CHECK=0
    export KASEKI_SCOUTING=0
    export KASEKI_GOAL_CHECK=0
    export KASEKI_RUN_EVALUATION=0
    export KASEKI_VALIDATION_COMMANDS=none
    export KASEKI_CHANGED_FILES_ALLOWLIST='fixture.txt'
    export KASEKI_GIT_CACHE_MODE=off
    export KASEKI_PUBLISH_MODE=pr
    export KASEKI_GITHUB_PR_RETRIES=0
    bash "$PROJECT_ROOT/kaseki-agent.sh" >"$stdout_log" 2>"$stderr_log"
    printf '%s\n' "$?" > "$exit_file"
  )

  mkdir -p "$case_dir/results"
  cp -a /results/. "$case_dir/results/" 2>/dev/null || true
  printf '%s' "$case_dir"
}

# ===== Command-level fixtures =====
test_case "missing GitHub App secrets"
missing_case="$(run_agent_fixture missing-secrets success none missing)"
assert_eq "7" "$(cat "$missing_case/exit")" "missing secrets use config failure exit code"
assert_file_contains "$missing_case/results/git-push.log" 'GitHub operations: skipped \(reasons: github_app_secrets_missing\)' "missing secrets emit user-facing skip reason"
assert_json_field_eq "$missing_case/results/metadata.json" 'data.github_push_exit_code' "7" "metadata records config category exit code"
assert_json_field_eq "$missing_case/results/metadata.json" 'data.github_operation_phase' "secrets" "metadata records secrets failure phase"
assert_error_event_field_eq "$missing_case/results/progress.jsonl" "github_operation_failed" "recovery_action" "exit" "missing secrets emit terminal error event recovery"
assert_error_event_field_eq "$missing_case/results/progress.jsonl" "github_operation_failed" "detail" "GitHub push or PR creation failed (exit code 7)" "missing secrets emit expected error event detail"

test_case "token helper non-zero with structured stderr"
token_case="$(run_agent_fixture token-helper-failure structured_failure)"
assert_eq "7" "$(cat "$token_case/exit")" "token helper failure uses config/auth failure exit code"
assert_file_contains "$token_case/results/git-push.log" 'Failed to generate token: fixture helper refused installation token' "token helper failure emits parsed user-facing error"
assert_json_field_eq "$token_case/results/metadata.json" 'data.github_api_error_type' "github_app_token_error" "metadata records token helper error type"
assert_json_field_eq "$token_case/results/metadata.json" 'data.github_api_error_message' "fixture helper refused installation token" "metadata records structured token helper message"
assert_json_field_eq "$token_case/results/metadata.json" 'data.github_api_http_status' "401" "metadata records structured token helper HTTP status"
assert_error_event_field_eq "$token_case/results/progress.jsonl" "github_app_token_failed" "detail" "GitHub App token generation failed (exit code 7)" "token helper failure emits expected terminal event detail"

test_case "GitHub Pulls API known payload failure"
api_case="$(run_agent_fixture api-payload-failure success api_failure)"
assert_eq "9" "$(cat "$api_case/exit")" "GitHub API failure uses API category exit code"
assert_file_contains "$api_case/results/git-push.log" 'GitHub API error \(HTTP 422\): validation_error - Validation Failed: fixture duplicate pull request' "API failure emits parsed user-facing error"
assert_file_contains "$api_case/results/git-push.log" 'Failed to create PR\. API error: Validation Failed: fixture duplicate pull request' "API failure emits PR creation failure summary"
assert_json_field_eq "$api_case/results/metadata.json" 'data.github_pr_exit_code' "9" "metadata records PR API exit code"
assert_json_field_eq "$api_case/results/metadata.json" 'data.github_api_error_type' "validation_error" "metadata records API error type"
assert_json_field_eq "$api_case/results/metadata.json" 'data.github_api_error_message' "Validation Failed: fixture duplicate pull request" "metadata records API error message"
assert_json_field_eq "$api_case/results/metadata.json" 'data.github_api_http_status' "422" "metadata records API HTTP status"
assert_error_event_field_eq "$api_case/results/progress.jsonl" "github_pr_api_failed" "detail" "GitHub API error (validation_error): Validation Failed: fixture duplicate pull request (HTTP 422)" "API failure emits structured error event detail"

# ===== Diagnostic script behavior remains command-level =====
test_case "diagnostic script distinguishes token and push phases"
DIAG_TMP_DIR="$TEST_ROOT/diagnostic"
mkdir -p "$DIAG_TMP_DIR/token/results" "$DIAG_TMP_DIR/push/results"
printf '7\n' > "$DIAG_TMP_DIR/token/results/exit_code"
cat > "$DIAG_TMP_DIR/token/results/metadata.json" <<'JSON'
{
  "instance": "fixture-token",
  "current_stage": "github operations",
  "exit_code": 7,
  "github_push_exit_code": 7,
  "github_pr_exit_code": 0,
  "github_operation_phase": "token_generation",
  "github_api_error_type": "github_app_token_error",
  "github_api_error_message": "fixture helper refused installation token",
  "github_api_http_status": "401"
}
JSON
cat > "$DIAG_TMP_DIR/token/results/failure.json" <<'JSON'
{"exit_code":7,"failed_command":"github token generation"}
JSON
cat > "$DIAG_TMP_DIR/token/results/git-push.log" <<'LOG'
Generating GitHub App installation token...
Failed to generate token: fixture helper refused installation token
LOG
printf '8\n' > "$DIAG_TMP_DIR/push/results/exit_code"
cat > "$DIAG_TMP_DIR/push/results/metadata.json" <<'JSON'
{
  "instance": "fixture-push",
  "current_stage": "github operations",
  "exit_code": 8,
  "github_push_exit_code": 8,
  "github_pr_exit_code": 0,
  "github_operation_phase": "push",
  "github_api_error_type": "",
  "github_api_error_message": "",
  "github_api_http_status": ""
}
JSON
cat > "$DIAG_TMP_DIR/push/results/failure.json" <<'JSON'
{"exit_code":8,"failed_command":"github push"}
JSON
cat > "$DIAG_TMP_DIR/push/results/git-push.log" <<'LOG'
Pushing branch to GitHub...
Failed to push branch (exit 8)
LOG
if "$PROJECT_ROOT/scripts/kaseki-diagnose-github-failure.sh" "$DIAG_TMP_DIR/token/results" > "$DIAG_TMP_DIR/token/report.md" && \
   grep -q 'GitHub App token generation failed' "$DIAG_TMP_DIR/token/report.md" && \
   ! grep -q 'Git push failed' "$DIAG_TMP_DIR/token/report.md"; then
  pass "diagnostic script reports token phase distinctly"
else
  fail "diagnostic script reports token phase distinctly"
fi
if "$PROJECT_ROOT/scripts/kaseki-diagnose-github-failure.sh" "$DIAG_TMP_DIR/push/results" > "$DIAG_TMP_DIR/push/report.md" && \
   grep -q 'Git push failed (exit code: 8)' "$DIAG_TMP_DIR/push/report.md" && \
   ! grep -q 'GitHub App token generation failed' "$DIAG_TMP_DIR/push/report.md"; then
  pass "diagnostic script reports push phase distinctly"
else
  fail "diagnostic script reports push phase distinctly"
fi

printf '\n%b=== Test Summary ===%b\n' "$YELLOW" "$NC"
printf 'Passed: %b%d%b\n' "$GREEN" "$TESTS_PASSED" "$NC"
printf 'Failed: %b%d%b\n' "$RED" "$TESTS_FAILED" "$NC"

if [ "$TESTS_FAILED" -eq 0 ]; then
  printf '\n%bAll tests passed!%b\n' "$GREEN" "$NC"
  exit 0
fi
printf '\n%bSome tests failed!%b\n' "$RED" "$NC"
exit 1
