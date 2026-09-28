#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kaseki-validation-preflight.XXXXXX")"
cleanup() {
  local status=$?
  trap - EXIT
  PATH="$ORIGINAL_PATH" rm -rf -- "$TMP_DIR"
  exit "$status"
}
ORIGINAL_PATH="$PATH"
trap cleanup EXIT

. "$ROOT_DIR/scripts/validation-command-preflight.sh"

mkdir -p "$TMP_DIR/bin"
cat > "$TMP_DIR/bin/npm" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$TMP_DIR/bin/npm"
PATH="$TMP_DIR/bin"

assert_missing() {
  local expected="$1" commands="$2" actual
  actual="$(validation_command_missing_executable "$commands")" || {
    printf '✗ expected missing executable %s for %s\n' "$expected" "$commands" >&2
    exit 1
  }
  [ "$actual" = "$expected" ] || {
    printf '✗ expected %s, got %s for %s\n' "$expected" "$actual" "$commands" >&2
    exit 1
  }
}

assert_available() {
  local commands="$1" actual
  if actual="$(validation_command_missing_executable "$commands")"; then
    printf '✗ expected commands to be available, found missing %s for %s\n' "$actual" "$commands" >&2
    exit 1
  fi
}

assert_missing go 'go test ./...'
assert_missing make 'npm test; make ci'
assert_missing go 'KASEKI_MODE=ci go test ./...'
assert_available 'npm run build'
assert_available "npm run 'test|build'"
assert_available 'none'
assert_available ''

printf '✓ validation command preflight identifies missing direct executables\n'
