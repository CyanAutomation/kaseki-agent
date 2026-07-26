#!/usr/bin/env bash
# Regression test: gateway defaults KASEKI_MODEL from LLM_GATEWAY_MODEL when unset or auto.

set -euo pipefail

TEST_NAME="gateway model defaults"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail() {
  echo "FAIL: $TEST_NAME: $*" >&2
  exit 1
}

assert_gateway_model_resolution() {
  local label="$1"
  local expected_model="$2"

  (
    set -euo pipefail
    # shellcheck source=../scripts/lib/model-resolution.sh
    . "$REPO_ROOT/scripts/lib/model-resolution.sh"
    case "$label" in
      "unset KASEKI_MODEL") unset KASEKI_MODEL ;;
      "KASEKI_MODEL=auto") KASEKI_MODEL=auto ;;
      "explicit KASEKI_MODEL") KASEKI_MODEL=gateway/explicit-model ;;
    esac
    KASEKI_PROVIDER=gateway
    LLM_GATEWAY_MODEL=gateway/custom-default
    kaseki_resolve_provider_model
    [ "$KASEKI_PROVIDER" = "gateway" ] || {
      printf 'expected provider gateway for %s, got %s\n' "$label" "$KASEKI_PROVIDER" >&2
      exit 1
    }
    [ "$KASEKI_MODEL" = "$expected_model" ] || {
      printf 'expected %s for %s, got %s\n' "$expected_model" "$label" "$KASEKI_MODEL" >&2
      exit 1
    }
  ) || fail "$label did not preserve the expected provider and model"
}

while IFS='|' read -r label expected_model; do
  assert_gateway_model_resolution "$label" "$expected_model"
done <<'CASES'
unset KASEKI_MODEL|gateway/custom-default
KASEKI_MODEL=auto|gateway/custom-default
explicit KASEKI_MODEL|gateway/explicit-model
CASES

echo "PASS: $TEST_NAME"
