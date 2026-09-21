#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=../scripts/validation-timeout-policy.sh
source "$ROOT_DIR/scripts/validation-timeout-policy.sh"

# Timeout selection is a standalone policy and must not depend on unrelated
# worker process state being initialized by kaseki-agent.sh.
unset PROCESS_TIMEOUT pid

assert_timeout() {
  local description="$1"
  local command="$2"
  local general_timeout="$3"
  local build_timeout="$4"
  local expected="$5"
  local actual

  if [ "$general_timeout" = '<unset>' ]; then
    unset KASEKI_VALIDATION_TIMEOUT_SECONDS
  else
    KASEKI_VALIDATION_TIMEOUT_SECONDS="$general_timeout"
  fi
  if [ "$build_timeout" = '<unset>' ]; then
    unset KASEKI_BUILD_VALIDATION_TIMEOUT_SECONDS
  else
    KASEKI_BUILD_VALIDATION_TIMEOUT_SECONDS="$build_timeout"
  fi

  actual="$(validation_timeout_for_command "$command")"
  [ "$actual" = "$expected" ] || {
    printf 'FAIL: %s: expected %s, got %s\n' "$description" "$expected" "$actual" >&2
    exit 1
  }
}

while IFS='|' read -r description command general_timeout build_timeout expected; do
  assert_timeout "$description" "$command" "$general_timeout" "$build_timeout" "$expected"
done <<'CASES'
npm build uses override|npm run build|45|1200|1200
framework build uses override|next build|45|1200|1200
standalone build uses override|build|45|1200|1200
ordinary test uses override|npm run test|45|1200|45
ordinary check uses override|npm run check|45|1200|45
unset build override uses default|npm run build|45|<unset>|900
unset general override uses default|npm run test|<unset>|1200|300
non-integer build timeout uses default|npm run build|45|not-a-number|900
zero general timeout uses default|npm run test|0|1200|300
negative build timeout uses default|next build|45|-1|900
fractional general timeout uses default|npm run test|2.5|1200|300
CASES

if invalid_default_output="$(validation_timeout_or_default 45 invalid 2>&1)"; then
  echo 'FAIL: invalid fallback timeout was accepted' >&2
  exit 1
fi
[ "$invalid_default_output" = 'ERROR: validation timeout default must be a positive integer, got: invalid' ] || {
  printf 'FAIL: unexpected invalid fallback diagnostic: %s\n' "$invalid_default_output" >&2
  exit 1
}

echo '✓ validation timeout policy covers build and ordinary commands, defaults, and invalid values'
