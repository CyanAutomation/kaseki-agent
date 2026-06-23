#!/usr/bin/env bash
# Integration test: default path variables are safe when caller leaves them unset under set -u.

set -euo pipefail

TEST_NAME="unset path variable defaults"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_UNDER_TEST="$REPO_ROOT/kaseki-agent.sh"
TMP_DIR="$(mktemp -d)"
RESULTS_DIR="$TMP_DIR/results"
RUN_LOG="$TMP_DIR/kaseki-run.log"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  echo "✗ FAIL: $TEST_NAME: $*" >&2
  if [ -f "$RUN_LOG" ]; then
    echo "--- kaseki run log ---" >&2
    tail -80 "$RUN_LOG" >&2 || true
  fi
  exit 1
}

assert_file_contains() {
  local file="$1"
  local pattern="$2"
  if ! [ -f "$file" ]; then
    fail "expected file $file does not exist"
  fi
  if ! grep -qE "$pattern" "$file"; then
    fail "expected $file to contain pattern: $pattern"
  fi
}

mkdir -p "$RESULTS_DIR"

# Redirect container-default paths to a writable temp directory while leaving
# KASEKI_RESULTS_DIR and KASEKI_WORKSPACE_BASELINE_DIR unset for the invocation.
# This uses the script's documented test-only default path hook instead of
# rewriting the script body, so the test still executes the real entrypoint.

set +e
env \
  -u KASEKI_RESULTS_DIR \
  -u KASEKI_WORKSPACE_BASELINE_DIR \
  -u LLM_GATEWAY_API_KEY \
  -u LLM_GATEWAY_URL \
  KASEKI_DRY_RUN=1 \
  KASEKI_TEST_DEFAULT_PATH_ROOT="$TMP_DIR" \
  KASEKI_STARTUP_CHECK_MODE=boot \
  GITHUB_APP_ENABLED=0 \
  LLM_GATEWAY_API_KEY_FILE="$TMP_DIR/missing-gateway-key" \
  bash "$SCRIPT_UNDER_TEST" > "$RUN_LOG" 2>&1
run_exit=$?
set -e

if [ "$run_exit" -ne 2 ]; then
  fail "expected missing configuration exit code 2, got $run_exit"
fi

if grep -q 'unbound variable' "$RUN_LOG"; then
  fail "startup failed with an unbound variable instead of missing configuration"
fi

assert_file_contains "$RUN_LOG" 'Missing LLM Gateway configuration'
assert_file_contains "$RESULTS_DIR/result-summary.md" 'missing LLM_GATEWAY_URL'
assert_file_contains "$RESULTS_DIR/failure.json" '"failed_command": "missing LLM_GATEWAY_URL"'

printf '✓ %s\n' "$TEST_NAME"
