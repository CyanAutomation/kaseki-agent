#!/usr/bin/env bash
# Verifies GitHub askpass helpers fail fast when the helper cannot be made executable or run.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

FUNCTIONS_FILE="$TMP_DIR/github-askpass-functions.sh"
awk '
  /^github_askpass_runtime_dir\(\)/ { emit=1 }
  /^check_github_operations_health\(\)/ { emit=0 }
  emit { print }
' "$PROJECT_ROOT/kaseki-agent.sh" > "$FUNCTIONS_FILE"
# shellcheck disable=SC1090
. "$FUNCTIONS_FILE"

pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }

ASKPASS_DIR="$TMP_DIR/askpass"
LOG_FILE="$TMP_DIR/askpass.log"
mkdir -p "$ASKPASS_DIR"

# chmod failures must become explicit GitHub push setup failures with exit 8.
(
  chmod() { return 1; }
  GITHUB_PUSH_EXIT=0
  KASEKI_GITHUB_ASKPASS_DIR="$ASKPASS_DIR"
  export KASEKI_GITHUB_ASKPASS_DIR
  if create_github_askpass_helper "$LOG_FILE" '[test-chmod]'; then
    fail 'askpass helper setup unexpectedly passed when chmod failed'
  fi
  [ "$GITHUB_PUSH_EXIT" -eq 8 ] || fail "chmod failure set GITHUB_PUSH_EXIT=$GITHUB_PUSH_EXIT instead of 8"
) || exit 1

if grep -q 'Failed to make GitHub credential helper executable' "$LOG_FILE"; then
  pass 'chmod failure is reported before push setup can continue'
else
  fail "chmod failure log missing: $(cat "$LOG_FILE" 2>/dev/null || true)"
fi

# Simulate a noexec-style runtime by making /usr/bin/env bash resolve to a failing bash.
FAKE_BIN="$TMP_DIR/fake-bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/bash" <<'EOF_FAKE_BASH'
#!/bin/sh
printf 'simulated askpass execution failure\n' >&2
exit 126
EOF_FAKE_BASH
chmod +x "$FAKE_BIN/bash"
: > "$LOG_FILE"

(
  GITHUB_PUSH_EXIT=0
  KASEKI_GITHUB_ASKPASS_DIR="$ASKPASS_DIR"
  export KASEKI_GITHUB_ASKPASS_DIR
  PATH="$FAKE_BIN:$PATH"
  export PATH
  if create_github_askpass_helper "$LOG_FILE" '[test-exec]'; then
    fail 'askpass helper setup unexpectedly passed when helper execution failed'
  fi
  [ "$GITHUB_PUSH_EXIT" -eq 8 ] || fail "execution failure set GITHUB_PUSH_EXIT=$GITHUB_PUSH_EXIT instead of 8"
) || exit 1

if grep -q 'GitHub askpass helper is not executable from' "$LOG_FILE"; then
  pass 'askpass execution failure is detected during smoke check before push'
else
  fail "askpass execution failure log missing: $(cat "$LOG_FILE" 2>/dev/null || true)"
fi

if grep -q '__kaseki_askpass_smoke_token__' "$LOG_FILE"; then
  fail 'askpass smoke check leaked the non-secret smoke token into logs'
fi
pass 'askpass smoke check does not log token material'
