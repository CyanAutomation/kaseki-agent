#!/usr/bin/env bash
# Regression test: KASEKI-173 fix
# When LLM_GATEWAY_URL is set and KASEKI_PROVIDER is not explicit,
# infer KASEKI_PROVIDER=gateway and KASEKI_MODEL=dynamic/kaseki-agent

set -euo pipefail

TEST_NAME="gateway provider inference from URL"
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
cp "$REPO_ROOT/scripts/lib/artifact-consolidation.sh" "$TMP_DIR/scripts/lib/artifact-consolidation.sh"
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
# Simulate the API service scenario: LLM_GATEWAY_URL is set, but KASEKI_PROVIDER is not.
# This should infer KASEKI_PROVIDER=gateway and use KASEKI_MODEL=dynamic/kaseki-agent
env -u KASEKI_PROVIDER \
  -u KASEKI_MODEL \
  LLM_GATEWAY_URL=https://gateway.ai.cloudflare.com/v1/compat \
  LLM_GATEWAY_API_KEY=sk-test-key \
  GITHUB_APP_ENABLED=0 \
  KASEKI_GIT_CACHE_MODE=off \
  REPO_URL=https://example.invalid/repo.git \
  GIT_REF=main \
  TASK_PROMPT="inspect then code" \
  bash "$MODIFIED_SCRIPT" > "$RUN_LOG" 2>&1
run_exit=$?
set -e

# Should fail with missing gateway credentials (exit 2), not with provider/model issues
[ "$run_exit" -eq 2 ] || fail "expected missing gateway configuration exit 2, got $run_exit"

# Verify the inferred provider and model were used
grep -Fq 'Provider: gateway' "$RUN_LOG" || fail "provider was not inferred as 'gateway' from LLM_GATEWAY_URL"
grep -Fq 'Model: dynamic/kaseki-agent' "$RUN_LOG" || fail "model was not inferred as 'dynamic/kaseki-agent' for gateway provider"

echo "PASS: $TEST_NAME"
