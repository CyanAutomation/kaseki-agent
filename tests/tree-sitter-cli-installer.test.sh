#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/bin" "$TMP_DIR/npm-root" "$TMP_DIR/npm-prefix/bin"
cat >"$TMP_DIR/bin/npm" <<'FAKE_NPM'
#!/bin/sh
case "$1 $2" in
  "root -g") printf '%s\n' "$FAKE_NPM_ROOT" ;;
  "prefix -g") printf '%s\n' "$FAKE_NPM_PREFIX" ;;
  "install -g")
    attempt="$(cat "$FAKE_NPM_ATTEMPTS" 2>/dev/null || printf 0)"
    attempt=$((attempt + 1))
    printf '%s\n' "$attempt" >"$FAKE_NPM_ATTEMPTS"
    printf '%s\n' "$*" >>"$FAKE_NPM_LOG"
    [ "$attempt" -ge "$FAKE_NPM_SUCCEED_ON" ]
    ;;
  *) exit 2 ;;
esac
FAKE_NPM
cat >"$TMP_DIR/bin/sleep" <<'FAKE_SLEEP'
#!/bin/sh
exit 0
FAKE_SLEEP
chmod +x "$TMP_DIR/bin/npm" "$TMP_DIR/bin/sleep"

export PATH="$TMP_DIR/bin:$PATH"
export FAKE_NPM_ROOT="$TMP_DIR/npm-root"
export FAKE_NPM_PREFIX="$TMP_DIR/npm-prefix"
export FAKE_NPM_ATTEMPTS="$TMP_DIR/attempts"
export FAKE_NPM_LOG="$TMP_DIR/npm.log"

export FAKE_NPM_SUCCEED_ON=2
"$ROOT_DIR/docker/install-tree-sitter-cli.sh" 0.25.10
test "$(cat "$FAKE_NPM_ATTEMPTS")" = 2
test "$(wc -l < "$FAKE_NPM_LOG")" = 2
grep -Fxq 'install -g --no-audit tree-sitter-cli@0.25.10' "$FAKE_NPM_LOG"

printf '0\n' >"$FAKE_NPM_ATTEMPTS"
: >"$FAKE_NPM_LOG"
export FAKE_NPM_SUCCEED_ON=4
if TREE_SITTER_CLI_INSTALL_MAX_ATTEMPTS=3 \
  "$ROOT_DIR/docker/install-tree-sitter-cli.sh" 0.25.10 2>"$TMP_DIR/failure.log"; then
  printf 'FAIL: installer unexpectedly succeeded after exhausting retries\n' >&2
  exit 1
fi
test "$(cat "$FAKE_NPM_ATTEMPTS")" = 3
grep -Fq 'installation failed after 3 attempts' "$TMP_DIR/failure.log"

printf '✓ tree-sitter-cli installer retry behavior passed.\n'
