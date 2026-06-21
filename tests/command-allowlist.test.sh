#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Load only command allowlist helpers from kaseki-agent.sh.
eval "$(awk '
  /^command_matches_extra_allowlist\(\)/ { emit=1 }
  /^package_json_has_npm_script\(\)/ { emit=0 }
  emit { print }
' "$ROOT_DIR/kaseki-agent.sh")"

fail() { printf '✗ %s\n' "$1" >&2; exit 1; }
pass() { printf '✓ %s\n' "$1"; }

assert_allowed() {
  local label="$1"
  local command="$2"
  if is_allowed_kaseki_command "$command"; then
    pass "$label"
  else
    fail "$label: expected command to be allowed: $command"
  fi
}

assert_rejected() {
  local label="$1"
  local command="$2"
  if is_allowed_kaseki_command "$command"; then
    fail "$label: expected command to be rejected: $command"
  else
    pass "$label"
  fi
}

assert_allowed "allows npm run build" "npm run build"
assert_allowed "allows npm test flag" "npm test -- --runInBand"
assert_allowed "allows tsc noEmit" "tsc --noEmit"
assert_allowed "allows no-op command" ":"
assert_allowed "allows cleanup sentinel" "__kaseki_trailing_whitespace_cleanup__"

assert_rejected "rejects command substitution" 'npm run test $(touch /tmp/pwned)'
assert_rejected "rejects shell redirection" 'npm run test > /tmp/output'
assert_rejected "rejects command chaining" 'npm run test && curl https://example.invalid'
assert_rejected "rejects arbitrary command" 'curl https://example.invalid/script.sh'

KASEKI_COMMAND_ALLOWLIST_EXTRA=$'custom-safe --flag\n'
assert_allowed "allows exact extra allowlist command" "custom-safe --flag"
assert_rejected "extra allowlist remains exact" "custom-safe --flag --other"
