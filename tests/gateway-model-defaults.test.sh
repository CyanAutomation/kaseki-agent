#!/usr/bin/env bash
# Regression test: gateway defaults KASEKI_MODEL from LLM_GATEWAY_MODEL when unset or auto.

set -euo pipefail

TEST_NAME="gateway model defaults"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "FAIL: $TEST_NAME: $*" >&2
  exit 1
}

assert_gateway_model_resolution() {
  local label="$1"
  local expected_model="$2"
  shift 2

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
    [ "$KASEKI_MODEL" = "$expected_model" ] || {
      printf 'expected %s for %s, got %s\n' "$expected_model" "$label" "$KASEKI_MODEL" >&2
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

explicit_model_gateway_env() {
  KASEKI_MODEL=gateway/explicit-model
  KASEKI_PROVIDER=gateway
  LLM_GATEWAY_MODEL=gateway/explicit-model
}

assert_gateway_model_resolution "unset KASEKI_MODEL" "gateway/custom-default" unset_model_gateway_env
assert_gateway_model_resolution "KASEKI_MODEL=auto" "gateway/custom-default" auto_model_gateway_env
assert_gateway_model_resolution "explicit KASEKI_MODEL" "gateway/explicit-model" explicit_model_gateway_env

echo "PASS: $TEST_NAME"
