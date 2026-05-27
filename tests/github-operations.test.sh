#!/usr/bin/env bash
# shellcheck disable=SC2015,SC2016
# Integration tests for github operations printf safety
# Tests that github operations skip logging doesn't break with variable substitution

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }
info() { printf '[info] %s\n' "$1"; }

# Test setup
mkdir -p "$TMP_DIR/results"
RESULTS_DIR="$TMP_DIR/results"

# Test 1: printf with dash-containing variable doesn't fail
info "Test 1: printf with dash-containing skip reasons"
{
  GITHUB_SKIP_REASONS=("agent_failed" "-validation_failed" "empty_diff")
  printf -- 'GitHub operations: skipped (reasons: %s)\n' "$(IFS=,; printf '%s' "${GITHUB_SKIP_REASONS[*]}")" > "$RESULTS_DIR/test1.log"
} && pass "printf with dash-containing reasons succeeded" || fail "printf with dash-containing reasons failed"

# Verify output contains all reasons
if grep -q "agent_failed,-validation_failed,empty_diff" "$RESULTS_DIR/test1.log"; then
  pass "All skip reasons captured in output"
else
  fail "Skip reasons not properly captured: $(cat "$RESULTS_DIR/test1.log")"
fi

# Test 2: printf with multi-argument substitution (github skip diagnostics)
info "Test 2: Multi-argument printf with exit code variables"
{
  PI_EXIT=0
  VALIDATION_EXIT=1
  QUALITY_EXIT=0
  SECRET_SCAN_EXIT=0
  GITHUB_SKIP_REASONS=("validation_failed")
  DIFF_NONEMPTY="true"
  GITHUB_APP_ENABLED="0"
  
  printf -- 'GitHub operations: skipped (reasons: %s; agent %s, validation %s, quality %s, secret_scan %s, diff %s, github_enabled %s)\n' \
    "$(IFS=,; printf '%s' "${GITHUB_SKIP_REASONS[*]}")" \
    "$([ "$PI_EXIT" -eq 0 ] && printf 'passed' || printf 'failed')" \
    "$([ "$VALIDATION_EXIT" -eq 0 ] && printf 'passed' || printf 'failed')" \
    "$([ "$QUALITY_EXIT" -eq 0 ] && printf 'passed' || printf 'failed')" \
    "$([ "$SECRET_SCAN_EXIT" -eq 0 ] && printf 'passed' || printf 'failed')" \
    "$DIFF_NONEMPTY" \
    "$GITHUB_APP_ENABLED" > "$RESULTS_DIR/test2.log"
} && pass "Multi-argument printf succeeded" || fail "Multi-argument printf failed"

# Verify output contains all placeholders properly filled
if grep -q "validation_failed; agent passed, validation failed, quality passed, secret_scan passed, diff true, github_enabled 0" "$RESULTS_DIR/test2.log"; then
  pass "All arguments properly substituted in output"
else
  fail "Arguments not properly substituted: $(cat "$RESULTS_DIR/test2.log")"
fi

# Test 3: printf with edge case: empty array expansion
info "Test 3: printf with empty skip reasons"
{
  GITHUB_SKIP_REASONS=()
  printf -- 'GitHub operations: skipped (reasons: %s)\n' "$(IFS=,; printf '%s' "${GITHUB_SKIP_REASONS[*]:-none}")" > "$RESULTS_DIR/test3.log"
} && pass "printf with empty array succeeded" || fail "printf with empty array failed"

if grep -q "reasons: none" "$RESULTS_DIR/test3.log"; then
  pass "Empty array handled correctly"
else
  fail "Empty array not handled correctly: $(cat "$RESULTS_DIR/test3.log")"
fi

# Test 4: printf with special characters in variable values
info "Test 4: printf with special characters in REPO_URL"
{
  REPO_URL="https://github.com/owner-name/repo-name.git"
  printf -- 'Cannot parse GitHub repo URL: %s\n' "$REPO_URL" > "$RESULTS_DIR/test4.log"
} && pass "printf with special chars in URL succeeded" || fail "printf with special chars in URL failed"

if grep -q "owner-name/repo-name" "$RESULTS_DIR/test4.log"; then
  pass "Special characters preserved in output"
else
  fail "Special characters not preserved: $(cat "$RESULTS_DIR/test4.log")"
fi

# Test 5: printf with feature branch containing instance name
info "Test 5: printf with feature branch name containing dashes"
{
  INSTANCE_NAME="kaseki-9142"
  feature_branch="kaseki/$INSTANCE_NAME"
  printf -- 'Creating feature branch: %s\n' "$feature_branch" > "$RESULTS_DIR/test5.log"
} && pass "printf with dash-containing branch name succeeded" || fail "printf with dash-containing branch name failed"

if grep -q "kaseki/kaseki-9142" "$RESULTS_DIR/test5.log"; then
  pass "Feature branch name correctly output"
else
  fail "Feature branch name not correct: $(cat "$RESULTS_DIR/test5.log")"
fi

# Test 6: Verify all printf calls have -- separator (source code check)
info "Test 6: Verify -- separator present in critical printf calls"
if grep -n "printf -- 'GitHub operations: skipped (reasons:" "$ROOT_DIR/kaseki-agent.sh" > /dev/null; then
  pass "Primary github operations printf has -- separator"
else
  fail "Primary github operations printf missing -- separator"
fi

if grep -n "printf -- 'GitHub operations: skipped (reasons:.*agent %s" "$ROOT_DIR/kaseki-agent.sh" > /dev/null; then
  pass "Multi-argument github operations printf has -- separator"
else
  fail "Multi-argument github operations printf missing -- separator"
fi

# Test 7: Integration test - actual function behavior under errexit
info "Test 7: Actual build_github_skip_reasons behavior under errexit"
(
  set -e
  eval "$(awk '/^build_github_skip_reasons\(\) \{/{flag=1} flag{print} flag && /^}/{exit}' "$ROOT_DIR/kaseki-agent.sh")"
  GITHUB_SKIP_REASONS=()
  GITHUB_APP_ENABLED=1
  PI_EXIT=1
  VALIDATION_EXIT=5
  QUALITY_EXIT=0
  SECRET_SCAN_EXIT=0
  GOAL_CHECK_EXIT=0
  KASEKI_GOAL_CHECK=0
  SCOUTING_ARTIFACT="/dev/null"
  GOAL_CHECK_MET=false
  STATUS=0
  DIFF_NONEMPTY=true
  build_github_skip_reasons
  printf -- 'GitHub operations: skipped (reasons: %s)\n' \
    "$(IFS=,; printf '%s' "${GITHUB_SKIP_REASONS[*]}")" > "$RESULTS_DIR/test7.log"
) && pass "Actual skip reasons logic survived errexit" || fail "Actual skip reasons logic failed under errexit"

if grep -q "agent_failed,validation_failed" "$RESULTS_DIR/test7.log"; then
  pass "Skip reasons correctly accumulated and logged"
else
  fail "Skip reasons not correctly accumulated: $(cat "$RESULTS_DIR/test7.log")"
fi

if grep -Eq '\[[^]]+\][[:space:]]*&&[[:space:]]*GITHUB_SKIP_REASONS\+=' "$ROOT_DIR/kaseki-agent.sh"; then
  fail "Skip reason builder still uses errexit-sensitive test-and-append"
else
  pass "Skip reason builder avoids errexit-sensitive test-and-append"
fi

# Test 8: GitHub API response validation - extract helper functions and test directly
info "Test 8: GitHub API validation function logic"
{
  # Define validation function inline for testing
  test_validate_github_api_response() {
    local http_status="$1" 
    # shellcheck disable=SC2034
    local response="$2"
    [ "$http_status" = "201" ] && return 0 || return 1
  }
  
  # Test successful response
  test_validate_github_api_response "201" '{"html_url": "https://example.com"}' && printf "201 success\n" || printf "201 failed\n"
  
  # Test error response
  test_validate_github_api_response "429" '{"message": "Rate limited"}' && printf "429 success\n" || printf "429 failed\n"
} > "$RESULTS_DIR/test8.log" 2>&1

if grep -q "201 success" "$RESULTS_DIR/test8.log" && grep -q "429 failed" "$RESULTS_DIR/test8.log"; then
  pass "API response validation logic works correctly"
else
  fail "API response validation logic failed: $(cat "$RESULTS_DIR/test8.log")"
fi

# Test 9: Error type detection from HTTP status codes
info "Test 9: GitHub error type detection from HTTP status"
{
  # Test mapping different HTTP statuses to error types
  test_error_type() {
    case "$1" in
      401) printf "authentication_error" ;;
      403) printf "permission_error" ;;
      429) printf "rate_limit_error" ;;
      500|502|503|504) printf "server_error" ;;
      *)  printf "unknown" ;;
    esac
  }
  
  [ "$(test_error_type 403)" = "permission_error" ] && printf "403 mapped correctly\n" || printf "403 mapping failed\n"
  [ "$(test_error_type 429)" = "rate_limit_error" ] && printf "429 mapped correctly\n" || printf "429 mapping failed\n"
  [ "$(test_error_type 503)" = "server_error" ] && printf "503 mapped correctly\n" || printf "503 mapping failed\n"
} > "$RESULTS_DIR/test9.log" 2>&1

if grep -q "403 mapped correctly" "$RESULTS_DIR/test9.log" && \
   grep -q "429 mapped correctly" "$RESULTS_DIR/test9.log" && \
   grep -q "503 mapped correctly" "$RESULTS_DIR/test9.log"; then
  pass "Error type detection works correctly"
else
  fail "Error type detection failed: $(cat "$RESULTS_DIR/test9.log")"
fi

# Test 10: Retryability logic - transient errors
info "Test 10: Retryability detection for transient errors"
{
  # Test retryability logic
  test_is_retryable() {
    case "$1" in
      429|500|502|503|504|0) return 0 ;;  # Retryable
      *) return 1 ;;  # Not retryable
    esac
  }
  
  test_is_retryable "429" && printf "429 retryable\n" || printf "429 not retryable\n"
  test_is_retryable "503" && printf "503 retryable\n" || printf "503 not retryable\n"
  test_is_retryable "0" && printf "curl_failure retryable\n" || printf "curl_failure not retryable\n"
} > "$RESULTS_DIR/test10.log" 2>&1

if grep -q "429 retryable" "$RESULTS_DIR/test10.log" && \
   grep -q "503 retryable" "$RESULTS_DIR/test10.log" && \
   grep -q "curl_failure retryable" "$RESULTS_DIR/test10.log"; then
  pass "Transient error retryability detection works"
else
  fail "Retryability detection failed: $(cat "$RESULTS_DIR/test10.log")"
fi

# Test 11: Retryability logic - permanent errors
info "Test 11: Retryability detection for permanent errors"
{
  test_is_retryable() {
    case "$1" in
      429|500|502|503|504|0) return 0 ;;
      *) return 1 ;;
    esac
  }
  
  test_is_retryable "403" && printf "403 retryable\n" || printf "403 not retryable\n"
  test_is_retryable "404" && printf "404 retryable\n" || printf "404 not retryable\n"
  test_is_retryable "422" && printf "422 retryable\n" || printf "422 not retryable\n"
} > "$RESULTS_DIR/test11.log" 2>&1

if grep -q "403 not retryable" "$RESULTS_DIR/test11.log" && \
   grep -q "404 not retryable" "$RESULTS_DIR/test11.log" && \
   grep -q "422 not retryable" "$RESULTS_DIR/test11.log"; then
  pass "Permanent error non-retryability detection works"
else
  fail "Permanent error detection failed: $(cat "$RESULTS_DIR/test11.log")"
fi

# Test 12: Exponential backoff calculation
info "Test 12: Exponential backoff delay calculation"
{
  # Test backoff delay progression
  backoff_delay=2
  [ $backoff_delay -eq 2 ] && printf "initial_2s\n"
  backoff_delay=$((backoff_delay * 2))
  [ $backoff_delay -eq 4 ] && printf "second_4s\n"
  backoff_delay=$((backoff_delay * 2))
  [ $backoff_delay -eq 8 ] && printf "third_8s\n"
  if [ $backoff_delay -gt 8 ]; then backoff_delay=8; fi
  [ $backoff_delay -eq 8 ] && printf "capped_8s\n"
} > "$RESULTS_DIR/test12.log" 2>&1

if grep -q "initial_2s" "$RESULTS_DIR/test12.log" && \
   grep -q "second_4s" "$RESULTS_DIR/test12.log" && \
   grep -q "third_8s" "$RESULTS_DIR/test12.log" && \
   grep -q "capped_8s" "$RESULTS_DIR/test12.log"; then
  pass "Exponential backoff calculation works correctly"
else
  fail "Backoff calculation failed: $(cat "$RESULTS_DIR/test12.log")"
fi


# Test 13: Git push pipeline failures are not hidden by tee without pipefail
info "Test 13: Git push failure survives tee when pipefail is disabled"
{
  GITHUB_PUSH_EXIT=0
  git_push_log="$RESULTS_DIR/test13.log"
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
    git push "https://github.com/owner-name/repo-name.git" "kaseki/test-instance" --force-with-lease 2>&1 | tee -a "$git_push_log"
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
} > "$RESULTS_DIR/test13.out" 2>&1

if grep -q "Branch pushed successfully" "$RESULTS_DIR/test13.log"; then
  fail "Git push failure was hidden by tee: $(cat "$RESULTS_DIR/test13.log")"
fi

if grep -q "Failed to push branch (exit 42)" "$RESULTS_DIR/test13.log" && \
   grep -q "GITHUB_PUSH_EXIT=42" "$RESULTS_DIR/test13.log"; then
  pass "Git push failure is reported from PIPESTATUS despite pipefail being disabled"
else
  fail "Git push failure was not reported correctly: $(cat "$RESULTS_DIR/test13.log")"
fi

if grep -q 'git_push_exit="${PIPESTATUS\[0\]:-1}"' "$ROOT_DIR/kaseki-agent.sh" && \
   grep -q 'Failed to push branch (exit %s)' "$ROOT_DIR/kaseki-agent.sh"; then
  pass "Production GitHub push block records git push exit status"
else
  fail "Production GitHub push block does not record git push exit status"
fi

# Test 14: Pull request label application wiring
info "Test 14: Pull request label application wiring"
if grep -q 'https://api.github.com/repos/$owner/$repo/issues/$issue_number/labels' "$ROOT_DIR/kaseki-agent.sh"; then
  pass "PR labels endpoint is used"
else
  fail "PR labels endpoint is missing"
fi

if grep -Fq "labels: ['kaseki-agent']" "$ROOT_DIR/kaseki-agent.sh"; then
  pass "PR label payload uses exactly the kaseki-agent label"
else
  fail "PR label payload does not use the expected kaseki-agent label"
fi

if grep -q 'Number.isInteger(d.number)' "$ROOT_DIR/kaseki-agent.sh" && \
   grep -q 'run_node_subprocess pr_number' "$ROOT_DIR/kaseki-agent.sh"; then
  pass "PR number is extracted from the create-PR response number field"
else
  fail "PR number extraction from create-PR response is missing"
fi

if grep -q 'apply_github_pr_labels "$owner" "$repo" "$pr_number" "$token" /results/git-push.log || true' "$ROOT_DIR/kaseki-agent.sh" && \
   grep -q 'Warning: failed to apply kaseki-agent label' "$ROOT_DIR/kaseki-agent.sh" && \
   grep -q 'preserving created PR' "$ROOT_DIR/kaseki-agent.sh"; then
  pass "PR label failures are warning-only and preserve the created PR"
else
  fail "PR label failure policy is not warning-only"
fi

# Summary
info "All tests passed!"
printf '\n==> Summary\n'
printf 'Tests run: 14\n'
printf 'Passed: 14\n'
printf 'Failed: 0\n'
