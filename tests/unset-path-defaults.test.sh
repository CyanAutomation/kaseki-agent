#!/usr/bin/env bash
# Integration test: default path variables are safe when caller leaves them unset under set -u.

set -euo pipefail

TEST_NAME="unset path variable defaults"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_UNDER_TEST="$REPO_ROOT/kaseki-agent.sh"
TMP_DIR="$(mktemp -d)"
RESULTS_DIR="$TMP_DIR/results"
WORKSPACE_DIR="$TMP_DIR/workspace"
RUN_LOG="$TMP_DIR/kaseki-run.log"
MODIFIED_SCRIPT="$TMP_DIR/kaseki-agent.sh"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  echo "✗ FAIL: $TEST_NAME: $*" >&2
    # Set PATH to minimal defaults to simulate a restricted environment
    export PATH="/usr/local/bin:/usr/bin:/bin"
    echo "--- kaseki run log ---" >&2
    tail -80 "$RUN_LOG" >&2 || true
  fi
  exit 1
}

assert_file_contains() {
  local file="$1"
test_set_path_preserves_custom_path() {
    export KASEKI_PATH="/custom/bin"
    set_path_if_unset
    assertEquals "Custom KASEKI_PATH should remain unchanged" "/custom/bin" "${KASEKI_PATH}"
}

  fi
}

mkdir -p "$RESULTS_DIR" "$WORKSPACE_DIR"
cp -a "$REPO_ROOT/scripts" "$TMP_DIR/scripts"

# Redirect container-default paths to a writable temp directory while leaving
# KASEKI_RESULTS_DIR and KASEKI_WORKSPACE_BASELINE_DIR unset for the invocation.
sed "s#/results#$RESULTS_DIR#g; s#/workspace#$WORKSPACE_DIR#g; s#/app/lib#$TMP_DIR/app-lib#g" \
  "$SCRIPT_UNDER_TEST" > "$MODIFIED_SCRIPT"
chmod +x "$MODIFIED_SCRIPT"

set +e
env \
  -u KASEKI_RESULTS_DIR \
  -u KASEKI_WORKSPACE_BASELINE_DIR \
  -u OPENROUTER_API_KEY \
  KASEKI_DRY_RUN=1 \
  KASEKI_STARTUP_CHECK_MODE=boot \
  GITHUB_APP_ENABLED=0 \
  OPENROUTER_API_KEY_FILE="$TMP_DIR/missing-openrouter-key" \
  bash "$MODIFIED_SCRIPT" > "$RUN_LOG" 2>&1
run_exit=$?
set -e

if [ "$run_exit" -ne 2 ]; then
  fail "expected missing OpenRouter configuration exit code 2, got $run_exit"
fi

if grep -q 'unbound variable' "$RUN_LOG"; then
  fail "startup failed with an unbound variable instead of missing configuration"
fi

assert_file_contains "$RUN_LOG" 'Missing OpenRouter API key'
assert_file_contains "$RESULTS_DIR/result-summary.md" 'missing OPENROUTER_API_KEY'
assert_file_contains "$RESULTS_DIR/failure.json" 'Missing OpenRouter API key'

printf '✓ %s\n' "$TEST_NAME"
