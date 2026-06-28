#!/usr/bin/env bash
# Regression test: gateway defaults KASEKI_MODEL from LLM_GATEWAY_MODEL when unset or auto.

set -euo pipefail

TEST_NAME="gateway model defaults"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
RUN_LOG="$TMP_DIR/kaseki-run.log"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "FAIL: $TEST_NAME: $*" >&2
  [ ! -f "$RUN_LOG" ] || cat "$RUN_LOG" >&2
  exit 1
}

mkdir -p "$TMP_DIR/results" "$TMP_DIR/workspace" "$TMP_DIR/cache" "$TMP_DIR/app/lib" "$TMP_DIR/scripts/lib"
cp "$REPO_ROOT/scripts/lib/json.sh" "$TMP_DIR/scripts/lib/json.sh"
cp "$REPO_ROOT/scripts/lib/json-events.sh" "$TMP_DIR/scripts/lib/json-events.sh"
cp "$REPO_ROOT/scripts/dependency-cache-helpers.sh" "$TMP_DIR/scripts/dependency-cache-helpers.sh"
cp "$REPO_ROOT/scripts/npm-install-helpers.sh" "$TMP_DIR/scripts/npm-install-helpers.sh"
cp "$REPO_ROOT/scripts/allowlist-helper.sh" "$TMP_DIR/scripts/allowlist-helper.sh"
cp "$REPO_ROOT/scripts/agent-prompt.sh" "$TMP_DIR/scripts/agent-prompt.sh"
touch "$TMP_DIR/app/lib/event-aggregator.js" "$TMP_DIR/app/lib/timestamp-tracker.js" "$TMP_DIR/app/lib/progress-stream-utils.js"

MODIFIED_SCRIPT="$TMP_DIR/kaseki-agent-modified.sh"
sed "s#/results#$TMP_DIR/results#g; s#/workspace#$TMP_DIR/workspace#g; s#/app/lib#$TMP_DIR/app/lib#g; s#/cache#$TMP_DIR/cache#g" \
  "$REPO_ROOT/kaseki-agent.sh" > "$MODIFIED_SCRIPT"
chmod +x "$MODIFIED_SCRIPT"

set +e
env -u KASEKI_MODEL \
  KASEKI_PROVIDER=gateway \
  LLM_GATEWAY_MODEL=gateway/custom-default \
  GITHUB_APP_ENABLED=0 \
  KASEKI_GIT_CACHE_MODE=off \
  REPO_URL=https://example.invalid/repo.git \
  GIT_REF=main \
  TASK_PROMPT="inspect then code" \
  bash "$MODIFIED_SCRIPT" > "$RUN_LOG" 2>&1
run_exit=$?
set -e

[ "$run_exit" -eq 2 ] || fail "expected missing gateway configuration exit 2, got $run_exit"
grep -Fq 'Provider: gateway' "$RUN_LOG" || fail "run did not use gateway provider"
grep -Fq 'Model: gateway/custom-default' "$RUN_LOG" || fail "LLM_GATEWAY_MODEL did not become the default KASEKI_MODEL"

: > "$RUN_LOG"
set +e
env KASEKI_MODEL=auto \
  KASEKI_PROVIDER=gateway \
  LLM_GATEWAY_MODEL=gateway/custom-default \
  GITHUB_APP_ENABLED=0 \
  KASEKI_GIT_CACHE_MODE=off \
  REPO_URL=https://example.invalid/repo.git \
  GIT_REF=main \
  TASK_PROMPT="inspect then code" \
  bash "$MODIFIED_SCRIPT" > "$RUN_LOG" 2>&1
run_exit=$?
set -e

[ "$run_exit" -eq 2 ] || fail "expected missing gateway configuration exit 2 for explicit auto, got $run_exit"
grep -Fq 'Provider: gateway' "$RUN_LOG" || fail "explicit auto run did not use gateway provider"
grep -Fq 'Model: gateway/custom-default' "$RUN_LOG" || fail "explicit KASEKI_MODEL=auto was not normalized to the gateway default"

echo "PASS: $TEST_NAME"
