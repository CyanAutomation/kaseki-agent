#!/usr/bin/env bash
# Regression test: provider resolution prefers the LLM Gateway while allowing OpenRouter override.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  printf '✗ %s\n' "$1" >&2
  if [ -n "${2:-}" ] && [ -f "$2" ]; then
    printf '\nOutput from %s:\n' "$2" >&2
    cat "$2" >&2
  fi
  exit 1
}

run_startup_check() {
  local provider_value="$1"
  local output_file="$2"
  local case_dir="$TMP_DIR/$provider_value"
  mkdir -p "$case_dir/root" "$case_dir/results" "$case_dir/secrets" "$case_dir/home"

  set +e
  if [ "$provider_value" = "__unset__" ]; then
    env \
      -u KASEKI_PROVIDER \
      -u LLM_GATEWAY_URL \
      -u LLM_GATEWAY_API_KEY \
      -u LLM_GATEWAY_API_KEY_FILE \
      -u OPENROUTER_API_KEY \
      -u OPENROUTER_API_KEY_FILE \
      HOME="$case_dir/home" \
      KASEKI_ROOT="$case_dir/root" \
      KASEKI_RESULTS_DIR="$case_dir/results" \
      KASEKI_SECRETS_DIR="$case_dir/secrets" \
      bash "$PROJECT_ROOT/scripts/startup-checks.sh" all >"$output_file" 2>&1
  else
    env \
      KASEKI_PROVIDER="$provider_value" \
      LLM_GATEWAY_URL= \
      LLM_GATEWAY_API_KEY= \
      LLM_GATEWAY_API_KEY_FILE= \
      OPENROUTER_API_KEY= \
      OPENROUTER_API_KEY_FILE= \
      HOME="$case_dir/home" \
      KASEKI_ROOT="$case_dir/root" \
      KASEKI_RESULTS_DIR="$case_dir/results" \
      KASEKI_SECRETS_DIR="$case_dir/secrets" \
      bash "$PROJECT_ROOT/scripts/startup-checks.sh" all >"$output_file" 2>&1
  fi
  local status=$?
  set -e

  # These cases intentionally omit credentials. Exit 2 or 3 is acceptable as long as
  # the provider-specific diagnostics below prove the resolved provider behavior.
  if [ "$status" -ne 2 ] && [ "$status" -ne 3 ]; then
    fail "startup check exited with unexpected status $status for KASEKI_PROVIDER=$provider_value" "$output_file"
  fi
}

unset_output="$TMP_DIR/unset-provider.out"
openrouter_output="$TMP_DIR/openrouter-provider.out"

run_startup_check "__unset__" "$unset_output"
run_startup_check "openrouter" "$openrouter_output"

if ! grep -Fq 'Active LLM provider: gateway' "$unset_output"; then
  fail 'unset KASEKI_PROVIDER did not resolve to gateway' "$unset_output"
fi

if ! grep -Fq 'LLM_GATEWAY_URL is required for KASEKI_PROVIDER=gateway' "$unset_output"; then
  fail 'missing gateway configuration did not report gateway-specific validation when provider resolved to gateway' "$unset_output"
fi

if ! grep -Fq 'Active LLM provider: openrouter' "$openrouter_output"; then
  fail 'explicit KASEKI_PROVIDER=openrouter was not preserved' "$openrouter_output"
fi

if grep -Fq 'LLM_GATEWAY_URL is required for KASEKI_PROVIDER=gateway' "$openrouter_output"; then
  fail 'missing gateway configuration was reported even though provider resolved to openrouter' "$openrouter_output"
fi

printf '✓ provider resolution defaults and provider-specific validation passed\n'
