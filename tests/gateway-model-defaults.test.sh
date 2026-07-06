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

assert_gateway_model_resolution() {
  local label="$1"
  shift

  (
    set -euo pipefail
    # shellcheck source=../scripts/lib/model-resolution.sh
    . "$REPO_ROOT/scripts/lib/model-resolution.sh"
    "$@"
    kaseki_resolve_provider_model
    [ "$KASEKI_PROVIDER" = "gateway" ] || {
      printf 'expected provider gateway for %s, got %s\n' "$label" "$KASEKI_PROVIDER" >&2
      exit 1
    }
    [ "$KASEKI_MODEL" = "gateway/custom-default" ] || {
      printf 'expected gateway/custom-default for %s, got %s\n' "$label" "$KASEKI_MODEL" >&2
      exit 1
    }
  ) || fail "$label did not resolve to LLM_GATEWAY_MODEL"
}

unset_model_gateway_env() {
  unset KASEKI_MODEL
  KASEKI_PROVIDER=gateway
  LLM_GATEWAY_MODEL=gateway/custom-default
}

auto_model_gateway_env() {
  KASEKI_MODEL=auto
  KASEKI_PROVIDER=gateway
  LLM_GATEWAY_MODEL=gateway/custom-default
}

assert_gateway_model_resolution "unset KASEKI_MODEL" unset_model_gateway_env
assert_gateway_model_resolution "KASEKI_MODEL=auto" auto_model_gateway_env

# Keep missing gateway configuration coverage separate from model defaulting: use
# an explicit, already-resolved gateway model so exit code 2 only proves config
# validation rejects missing LLM_GATEWAY_URL.
mkdir -p "$TMP_DIR/results" "$TMP_DIR/workspace" "$TMP_DIR/cache" "$TMP_DIR/app/lib" "$TMP_DIR/scripts/lib" "$TMP_DIR/dist"
cp "$REPO_ROOT/scripts/lib/json.sh" "$TMP_DIR/scripts/lib/json.sh"
cp "$REPO_ROOT/scripts/lib/json-events.sh" "$TMP_DIR/scripts/lib/json-events.sh"
cp "$REPO_ROOT/scripts/lib/model-resolution.sh" "$TMP_DIR/scripts/lib/model-resolution.sh"
cp "$REPO_ROOT/scripts/lib/provider-retry.sh" "$TMP_DIR/scripts/lib/provider-retry.sh"
cp "$REPO_ROOT/scripts/dependency-cache-helpers.sh" "$TMP_DIR/scripts/dependency-cache-helpers.sh"
cp "$REPO_ROOT/scripts/npm-install-helpers.sh" "$TMP_DIR/scripts/npm-install-helpers.sh"
cp "$REPO_ROOT/scripts/allowlist-helper.sh" "$TMP_DIR/scripts/allowlist-helper.sh"
cp "$REPO_ROOT/scripts/agent-prompt.sh" "$TMP_DIR/scripts/agent-prompt.sh"
cp "$REPO_ROOT/scripts/inspect-mode-defaults.sh" "$TMP_DIR/scripts/inspect-mode-defaults.sh"
cp "$REPO_ROOT/scripts/auto-lint-cleanup-classification.sh" "$TMP_DIR/scripts/auto-lint-cleanup-classification.sh"
cp "$REPO_ROOT/scripts/github-preflight-auth.sh" "$TMP_DIR/scripts/github-preflight-auth.sh"
[ ! -f "$REPO_ROOT/dist/scouting-allowlist.js" ] || cp "$REPO_ROOT/dist/scouting-allowlist.js" "$TMP_DIR/dist/scouting-allowlist.js"
touch "$TMP_DIR/dist/scouting-allowlist.js"
touch "$TMP_DIR/app/lib/event-aggregator.js" "$TMP_DIR/app/lib/timestamp-tracker.js" "$TMP_DIR/app/lib/progress-stream-utils.js"

MODIFIED_SCRIPT="$TMP_DIR/kaseki-agent-modified.sh"
sed "s#/results#$TMP_DIR/results#g; s#/workspace#$TMP_DIR/workspace#g; s#/app/lib#$TMP_DIR/app/lib#g; s#/cache#$TMP_DIR/cache#g" \
  "$REPO_ROOT/kaseki-agent.sh" > "$MODIFIED_SCRIPT"
chmod +x "$MODIFIED_SCRIPT"

set +e
env KASEKI_MODEL=gateway/custom-default \
  KASEKI_PROVIDER=gateway \
  GITHUB_APP_ENABLED=0 \
  KASEKI_GIT_CACHE_MODE=off \
  REPO_URL=https://example.invalid/repo.git \
  GIT_REF=main \
  TASK_PROMPT="inspect then code" \
  bash "$MODIFIED_SCRIPT" > "$RUN_LOG" 2>&1
run_exit=$?
set -e

[ "$run_exit" -eq 2 ] || fail "expected missing gateway configuration exit 2, got $run_exit"
grep -Fq 'Missing LLM Gateway configuration for provider=gateway.' "$RUN_LOG" || fail "missing gateway configuration message was not emitted"
grep -Fq 'Provider: gateway' "$RUN_LOG" || fail "missing config run did not use gateway provider"
grep -Fq 'Model: gateway/custom-default' "$RUN_LOG" || fail "missing config run did not preserve explicit gateway model"

echo "PASS: $TEST_NAME"
