#!/usr/bin/env bash
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

# Test 7: Integration test - simulate actual function behavior
info "Test 7: Simulate actual build_github_skip_reasons behavior"
{
  # Simulate the skip reasons array logic
  GITHUB_SKIP_REASONS=()
  PI_EXIT=1
  [ "$PI_EXIT" -eq 0 ] || GITHUB_SKIP_REASONS+=("agent_failed")
  
  VALIDATION_EXIT=5
  [ "$VALIDATION_EXIT" -eq 0 ] || GITHUB_SKIP_REASONS+=("validation_failed")
  
  # Log the skip reasons safely
  printf -- 'GitHub operations: skipped (reasons: %s)\n' \
    "$(IFS=,; printf '%s' "${GITHUB_SKIP_REASONS[*]}")" > "$RESULTS_DIR/test7.log"
} && pass "Simulated skip reasons logic succeeded" || fail "Simulated skip reasons logic failed"

if grep -q "agent_failed,validation_failed" "$RESULTS_DIR/test7.log"; then
  pass "Skip reasons correctly accumulated and logged"
else
  fail "Skip reasons not correctly accumulated: $(cat "$RESULTS_DIR/test7.log")"
fi

# Summary
info "All tests passed!"
printf '\n==> Summary\n'
printf 'Tests run: 7\n'
printf 'Passed: 7\n'
printf 'Failed: 0\n'
