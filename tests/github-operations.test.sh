#!/usr/bin/env bash
# Integration/contract tests for GitHub-operation user-visible behavior.
# These tests exercise commands with controlled environments and assert exit
# codes, messages, and artifact side effects instead of checking implementation
# text in kaseki-agent.sh.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }
info() { printf '[info] %s\n' "$1"; }

assert_file_contains() {
  local file="$1" expected="$2" description="$3"
  if grep -Fq -- "$expected" "$file"; then
    pass "$description"
  else
    printf -- '--- %s ---\n' "$file" >&2
    cat "$file" >&2 2>/dev/null || true
    fail "$description"
  fi
}

assert_file_not_contains() {
  local file="$1" unexpected="$2" description="$3"
  if grep -Fq -- "$unexpected" "$file"; then
    printf -- '--- %s ---\n' "$file" >&2
    cat "$file" >&2 2>/dev/null || true
    fail "$description"
  else
    pass "$description"
  fi
}

extract_function() {
  local name="$1"
  awk -v name="$name" '
    $0 ~ "^" name "\\(\\)[[:space:]]*\\{" { emit=1 }
    emit { print }
    emit && /^}$/ { exit }
  ' "$ROOT_DIR/kaseki-agent.sh"
}

build_github_function_harness() {
  local harness="$1"
  {
    printf '#!/usr/bin/env bash\nset -euo pipefail\n'
    extract_function run_node_subprocess
    extract_function validate_github_api_response
    extract_function apply_github_pr_labels
    extract_function is_github_pr_error_retryable
    cat <<'HARNESS'
case "${1:-}" in
  validate)
    shift
    GITHUB_API_ERROR_TYPE=""
    GITHUB_API_ERROR_MESSAGE=""
    GITHUB_API_HTTP_STATUS=""
    set +e
    validate_github_api_response "$@"
    rc=$?
    set -e
    if [ "$rc" -eq 0 ]; then
      printf 'VALID=1\n'
      exit 0
    fi
    printf 'VALID=0\nTYPE=%s\nMESSAGE=%s\nHTTP=%s\n' "$GITHUB_API_ERROR_TYPE" "$GITHUB_API_ERROR_MESSAGE" "$GITHUB_API_HTTP_STATUS"
    exit "$rc"
    ;;
  retryable)
    shift
    if is_github_pr_error_retryable "$@"; then
      printf 'retryable\n'
      exit 0
    fi
    printf 'not retryable\n'
    exit 1
    ;;
  label)
    shift
    apply_github_pr_labels "$@"
    exit "$?"
    ;;
  node-assignment-failure)
    shift
    local_log="$1"
    readonly captured_output=''
    if run_node_subprocess captured_output "process.stdout.write('alpha sk-abcdefghijklmnopqrstuvwxyz0123456789 omega tail that should be truncated after the diagnostic preview budget')" "" "$local_log"; then
      printf 'unexpected success\n'
      exit 1
    fi
    printf 'assignment failure captured\n'
    exit 0
    ;;
  node-assignment-failure-pem)
    shift
    local_log="$1"
    readonly captured_output=''
    if run_node_subprocess captured_output 'process.stdout.write(process.env.PEM_OUTPUT)' "" "$local_log"; then
      printf 'unexpected success\n'
      exit 1
    fi
    printf 'pem assignment failure captured\n'
    exit 0
    ;;
  *)
    printf 'unknown harness command: %s\n' "${1:-}" >&2
    exit 64
    ;;
esac
HARNESS
  } > "$harness"
  chmod +x "$harness"
}

create_minimal_repo() {
  local repo="$1"
  mkdir -p "$repo/deps/fake-dep"
  git -C "$repo" init -q -b main
  printf '{"name":"github-operations-contract","version":"1.0.0","private":true,"dependencies":{"fake-dep":"file:deps/fake-dep"}}\n' > "$repo/package.json"
  printf '{"name":"fake-dep","version":"1.0.0","private":true}\n' > "$repo/deps/fake-dep/package.json"
  printf '{"name":"github-operations-contract","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"github-operations-contract","version":"1.0.0","dependencies":{"fake-dep":"file:deps/fake-dep"}},"deps/fake-dep":{"name":"fake-dep","version":"1.0.0"},"node_modules/fake-dep":{"resolved":"deps/fake-dep","link":true}}}\n' > "$repo/package-lock.json"
  git -C "$repo" add package.json package-lock.json deps/fake-dep/package.json
  git -C "$repo" -c user.email=kaseki-test@example.invalid -c user.name='Kaseki Test' commit -q -m initial
}

prepare_agent_copy() {
  local case_dir="$1" source_repo="$2" results_dir="$3" workspace_repo="$4" app_lib="$5"
  mkdir -p "$case_dir/scripts" "$results_dir" "$workspace_repo" "$app_lib"
  cp "$ROOT_DIR/scripts/allowlist-helper.sh" "$case_dir/scripts/allowlist-helper.sh"
  touch "$app_lib/event-aggregator.js" "$app_lib/timestamp-tracker.js" "$app_lib/progress-stream-utils.js"
  sed "s#/workspace/repo#$workspace_repo#g; s#/results#$results_dir#g; s#/app/lib#$app_lib#g" \
    "$ROOT_DIR/kaseki-agent.sh" > "$case_dir/kaseki-agent.sh"
  chmod +x "$case_dir/kaseki-agent.sh"
  create_minimal_repo "$source_repo"
}

run_agent_case() {
  local case_name="$1" expected_exit="$2"
  shift 2
  local case_dir="$TMP_DIR/$case_name"
  local source_repo="$case_dir/source-repo"
  local results_dir="$case_dir/results"
  local workspace_repo="$case_dir/workspace-repo"
  local app_lib="$case_dir/app/lib"
  local run_log="$case_dir/run.log"

  prepare_agent_copy "$case_dir" "$source_repo" "$results_dir" "$workspace_repo" "$app_lib"

  set +e
  env \
    REPO_URL="$source_repo" \
    GIT_REF=main \
    KASEKI_DRY_RUN=1 \
    KASEKI_GIT_CACHE_MODE=off \
    KASEKI_SCOUTING=0 \
    KASEKI_GOAL_CHECK=0 \
    KASEKI_RUN_EVALUATION=0 \
    KASEKI_PRE_AGENT_VALIDATION=0 \
    KASEKI_TS_PRE_CHECK=0 \
    KASEKI_VALIDATION_COMMANDS=":" \
    KASEKI_ALLOW_EMPTY_DIFF=1 \
    KASEKI_DEPENDENCY_CACHE_DIR="$case_dir/dependency-cache" \
    KASEKI_IMAGE_DEPENDENCY_CACHE_DIR="$case_dir/image-cache" \
    OPENROUTER_API_KEY=test-key \
    PATH="$PATH" \
    "$@" bash "$case_dir/kaseki-agent.sh" > "$run_log" 2>&1
  local run_exit=$?
  set -e

  if [ "$run_exit" -eq "$expected_exit" ]; then
    pass "$case_name exits with $expected_exit"
  else
    cat "$run_log" >&2
    fail "$case_name exited with $run_exit, expected $expected_exit"
  fi

  RUN_AGENT_RESULTS_DIR="$results_dir"
  RUN_AGENT_LOG="$run_log"
}

RESULTS_DIR="$TMP_DIR/results"
mkdir -p "$RESULTS_DIR"
HARNESS="$TMP_DIR/github-function-harness.sh"
build_github_function_harness "$HARNESS"

# Test 1: disabled GitHub integration is reported as a skipped operation with artifacts.
info 'Test 1: disabled GitHub integration skip contract'
run_agent_case disabled_github 0 GITHUB_APP_ENABLED=0
assert_file_contains "$RUN_AGENT_LOG" 'GitHub operations: skipped (reasons: github_app_disabled,empty_diff; agent passed, validation passed, quality passed, secret_scan passed, diff false, github_enabled 0)' 'Disabled GitHub skip message is user-visible on stdout/stderr'
assert_file_contains "$RUN_AGENT_RESULTS_DIR/git-push.log" 'GitHub operations: skipped (reasons: github_app_disabled,empty_diff; agent passed, validation passed, quality passed, secret_scan passed, diff false, github_enabled 0)' 'Disabled GitHub skip message is recorded in git-push.log'
assert_file_contains "$RUN_AGENT_RESULTS_DIR/progress.log" 'github operations info: skipped: github_app_disabled,empty_diff' 'Disabled GitHub skip reason is recorded in progress log'

# Test 2: enabled GitHub integration with missing auth material reports preflight guidance,
# then still records the later GitHub skip reason that is user-visible for this run.
info 'Test 2: missing GitHub App preflight contract'
run_agent_case missing_github_secrets 0 GITHUB_APP_ENABLED=1 KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK=0
assert_file_contains "$RUN_AGENT_LOG" 'ERROR: GitHub operations preflight health check failed' 'Missing GitHub secrets produce an operator-visible preflight warning'
assert_file_contains "$RUN_AGENT_RESULTS_DIR/github-health-check.log" 'CLASSIFICATION: missing_github_app_id' 'Missing GitHub App ID classification is recorded in health-check artifact'
assert_file_contains "$RUN_AGENT_RESULTS_DIR/git-push.log" 'GitHub operations: skipped (reasons: empty_diff; agent passed, validation passed, quality passed, secret_scan passed, diff false, github_enabled 1)' 'GitHub skip summary is recorded after a preflight warning'
assert_file_contains "$RUN_AGENT_RESULTS_DIR/progress.log" 'github operations info: skipped: empty_diff' 'GitHub skip progress is recorded after a preflight warning'

# Test 3: API response validation returns contract exit codes, messages, and log side effects.
info 'Test 3: GitHub API validation response contract'
set +e
"$HARNESS" validate 201 '{"html_url":"https://github.com/acme/widgets/pull/1"}' "$RESULTS_DIR/api-success.log" > "$RESULTS_DIR/api-success.out" 2>&1
api_success_exit=$?
"$HARNESS" validate 403 '{"message":"Resource not accessible by integration"}' "$RESULTS_DIR/api-403.log" > "$RESULTS_DIR/api-403.out" 2>&1
api_403_exit=$?
"$HARNESS" validate 429 '{"message":"API rate limit exceeded"}' "$RESULTS_DIR/api-429.log" > "$RESULTS_DIR/api-429.out" 2>&1
api_429_exit=$?
set -e
[ "$api_success_exit" -eq 0 ] || fail "201 validation exited $api_success_exit"
[ "$api_403_exit" -eq 1 ] || fail "403 validation exited $api_403_exit"
[ "$api_429_exit" -eq 1 ] || fail "429 validation exited $api_429_exit"
pass 'API validation exit codes match success/error contract'
assert_file_contains "$RESULTS_DIR/api-success.out" 'VALID=1' '201 API response is accepted'
assert_file_contains "$RESULTS_DIR/api-403.out" 'TYPE=permission_error' '403 API response exposes permission_error type'
assert_file_contains "$RESULTS_DIR/api-403.log" 'GitHub API error (HTTP 403): permission_error - Resource not accessible by integration' '403 API validation writes operator log message'
assert_file_contains "$RESULTS_DIR/api-429.out" 'TYPE=rate_limit_error' '429 API response exposes rate_limit_error type'
assert_file_contains "$RESULTS_DIR/api-429.log" 'GitHub API error (HTTP 429): rate_limit_error - API rate limit exceeded' '429 API validation writes operator log message'

# Test 4: retryability is expressed through command exit status and output.
info 'Test 4: GitHub PR retryability contract'
set +e
"$HARNESS" retryable 429 rate_limit_error > "$RESULTS_DIR/retry-429.out" 2>&1; retry_429_exit=$?
"$HARNESS" retryable 503 server_error > "$RESULTS_DIR/retry-503.out" 2>&1; retry_503_exit=$?
"$HARNESS" retryable 0 curl_error > "$RESULTS_DIR/retry-curl.out" 2>&1; retry_curl_exit=$?
"$HARNESS" retryable 403 permission_error > "$RESULTS_DIR/retry-403.out" 2>&1; retry_403_exit=$?
"$HARNESS" retryable 422 validation_error > "$RESULTS_DIR/retry-422.out" 2>&1; retry_422_exit=$?
set -e
if ! { [ "$retry_429_exit" -eq 0 ] && [ "$retry_503_exit" -eq 0 ] && [ "$retry_curl_exit" -eq 0 ]; }; then
  fail 'Transient GitHub PR failures should be retryable'
fi
if ! { [ "$retry_403_exit" -eq 1 ] && [ "$retry_422_exit" -eq 1 ]; }; then
  fail 'Permanent GitHub PR failures should not be retryable'
fi
pass 'Retryability exit codes match transient/permanent contract'
assert_file_contains "$RESULTS_DIR/retry-429.out" 'retryable' '429 retryability output is user-readable'
assert_file_contains "$RESULTS_DIR/retry-403.out" 'not retryable' '403 retryability output is user-readable'

# Test 5: PR label application calls GitHub with the documented label and records success.
info 'Test 5: PR label application success contract'
LABEL_SUCCESS_BIN="$TMP_DIR/label-success-bin"
mkdir -p "$LABEL_SUCCESS_BIN"
cat > "$LABEL_SUCCESS_BIN/curl" <<'EOF_CURL_SUCCESS'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$CURL_ARGS_FILE"
payload=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-d" ]; then
    shift
    payload="${1:-}"
  fi
  shift || true
done
printf '%s' "$payload" > "$CURL_PAYLOAD_FILE"
printf '[{"name":"kaseki-agent"}]201'
EOF_CURL_SUCCESS
chmod +x "$LABEL_SUCCESS_BIN/curl"
set +e
env PATH="$LABEL_SUCCESS_BIN:$PATH" CURL_ARGS_FILE="$RESULTS_DIR/label-success.args" CURL_PAYLOAD_FILE="$RESULTS_DIR/label-success.payload" \
  "$HARNESS" label acme widgets 17 test-token "$RESULTS_DIR/label-success.log" > "$RESULTS_DIR/label-success.out" 2>&1
label_success_exit=$?
set -e
[ "$label_success_exit" -eq 0 ] || fail "Label success exited $label_success_exit"
pass 'PR label success exits 0'
assert_file_contains "$RESULTS_DIR/label-success.args" 'https://api.github.com/repos/acme/widgets/issues/17/labels' 'Label application targets the PR issue labels endpoint'
assert_file_contains "$RESULTS_DIR/label-success.payload" '{"labels":["kaseki-agent"]}' 'Label application sends the documented kaseki-agent label payload'
assert_file_contains "$RESULTS_DIR/label-success.log" 'Applied kaseki-agent label to PR #17' 'Label application records success in git-push log'

# Test 6: PR label application failures are warning-only for the created PR and leave an artifact trail.
info 'Test 6: PR label application failure contract'
LABEL_FAILURE_BIN="$TMP_DIR/label-failure-bin"
mkdir -p "$LABEL_FAILURE_BIN"
cat > "$LABEL_FAILURE_BIN/curl" <<'EOF_CURL_FAILURE'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$CURL_ARGS_FILE"
printf '{"message":"Validation Failed"}422'
EOF_CURL_FAILURE
chmod +x "$LABEL_FAILURE_BIN/curl"
set +e
env PATH="$LABEL_FAILURE_BIN:$PATH" CURL_ARGS_FILE="$RESULTS_DIR/label-failure.args" \
  "$HARNESS" label acme widgets 18 test-token "$RESULTS_DIR/label-failure.log" > "$RESULTS_DIR/label-failure.out" 2>&1
label_failure_exit=$?
set -e
[ "$label_failure_exit" -eq 1 ] || fail "Label failure exited $label_failure_exit"
pass 'PR label failure exits non-zero for caller policy handling'
assert_file_contains "$RESULTS_DIR/label-failure.log" 'Warning: failed to apply kaseki-agent label to PR #18 (HTTP 422); preserving created PR' 'Label failure log preserves created PR contract'
assert_file_not_contains "$RESULTS_DIR/label-failure.log" 'Applied kaseki-agent label' 'Label failure does not report a false success'

# Test 7: Git push failures piped through tee surface the git exit code and log a failure.
info 'Test 7: Git push pipeline failure contract'
{
  GITHUB_PUSH_EXIT=0
  git_push_log="$RESULTS_DIR/git-push-failure.log"
  : > "$git_push_log"

  simulate_github_push_with_tee() {
    local git_push_exit

    git() {
      if [ "${1:-}" = "push" ]; then
        printf 'simulated git push failure\n' >&2
        return 42
      fi
      return 0
    }

    set +o pipefail
    git push "https://github.com/acme/widgets.git" "kaseki/test-instance" --force-with-lease 2>&1 | tee -a "$git_push_log"
    git_push_exit="${PIPESTATUS[0]:-1}"
    if [ "$git_push_exit" -eq 0 ]; then
      printf 'Branch pushed successfully\n' | tee -a "$git_push_log"
    else
      printf 'Failed to push branch (exit %s)\n' "$git_push_exit" | tee -a "$git_push_log" >&2
      GITHUB_PUSH_EXIT="$git_push_exit"
      return "$git_push_exit"
    fi
  }

  simulate_github_push_with_tee || printf 'simulate_exit=%s\n' "$?" >> "$git_push_log"
  printf 'GITHUB_PUSH_EXIT=%s\n' "$GITHUB_PUSH_EXIT" >> "$git_push_log"
} > "$RESULTS_DIR/git-push-failure.out" 2>&1
assert_file_not_contains "$RESULTS_DIR/git-push-failure.log" 'Branch pushed successfully' 'Git push failure is not reported as success'
assert_file_contains "$RESULTS_DIR/git-push-failure.log" 'Failed to push branch (exit 42)' 'Git push failure records the git exit code despite tee'
assert_file_contains "$RESULTS_DIR/git-push-failure.log" 'GITHUB_PUSH_EXIT=42' 'Git push failure updates the caller-visible push exit artifact'

# Test 8: Node subprocess output assignment failures are part of the helper contract.
info 'Test 8: Node subprocess assignment failure contract'
set +e
"$HARNESS" node-assignment-failure "$RESULTS_DIR/node-assignment-failure.log" > "$RESULTS_DIR/node-assignment-failure.out" 2>&1
node_assignment_exit=$?
set -e
[ "$node_assignment_exit" -eq 0 ] || fail "Node assignment harness exited $node_assignment_exit"
pass 'Node subprocess assignment failure is caller-visible as non-zero from the helper'
assert_file_contains "$RESULTS_DIR/node-assignment-failure.out" 'assignment failure captured' 'Harness observed run_node_subprocess assignment failure'
assert_file_contains "$RESULTS_DIR/node-assignment-failure.log" 'Failed to assign Node.js output to variable: captured_output' 'Assignment failure diagnostic names the output variable'
assert_file_contains "$RESULTS_DIR/node-assignment-failure.log" 'output preview (redacted, first 150 chars): alpha [redacted token] omega tail' 'Assignment failure diagnostic includes a redacted output preview'
assert_file_not_contains "$RESULTS_DIR/node-assignment-failure.log" 'sk-abcdefghijklmnopqrstuvwxyz0123456789' 'Assignment failure diagnostic redacts token-like output'

# Test 9: Multi-line PEM/private-key output is redacted before diagnostic previews are logged.
info 'Test 9: Node subprocess assignment failure redacts multi-line private key previews'
set +e
env PEM_OUTPUT=$'alpha\n-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSj\nvery-secret-private-key-body\n-----END PRIVATE KEY-----\nomega' \
  "$HARNESS" node-assignment-failure-pem "$RESULTS_DIR/node-assignment-failure-pem.log" > "$RESULTS_DIR/node-assignment-failure-pem.out" 2>&1
node_assignment_pem_exit=$?
set -e
[ "$node_assignment_pem_exit" -eq 0 ] || fail "Node PEM assignment harness exited $node_assignment_pem_exit"
pass 'Node subprocess assignment failure redacts multi-line PEM private key previews'
assert_file_contains "$RESULTS_DIR/node-assignment-failure-pem.out" 'pem assignment failure captured' 'Harness observed PEM assignment failure'
assert_file_contains "$RESULTS_DIR/node-assignment-failure-pem.log" 'output preview (redacted, first 150 chars): alpha [redacted private key] omega' 'Assignment failure diagnostic redacts multi-line private key output'
assert_file_not_contains "$RESULTS_DIR/node-assignment-failure-pem.log" '-----BEGIN PRIVATE KEY-----' 'Assignment failure diagnostic does not leak PEM header'
assert_file_not_contains "$RESULTS_DIR/node-assignment-failure-pem.log" 'very-secret-private-key-body' 'Assignment failure diagnostic does not leak PEM body'

info 'All tests passed!'
printf '\n==> Summary\n'
printf 'Tests run: 9\n'
printf 'Passed: 9\n'
printf 'Failed: 0\n'
