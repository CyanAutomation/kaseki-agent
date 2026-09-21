#!/bin/sh
set -eu

version="${1:?tree-sitter-cli version is required}"
max_attempts="${TREE_SITTER_CLI_INSTALL_MAX_ATTEMPTS:-3}"
attempt=1

cleanup_install() {
  npm_root="$(npm root -g 2>/dev/null)" || npm_root=
  npm_prefix="$(npm prefix -g 2>/dev/null)" || npm_prefix=

  [ -z "$npm_root" ] || rm -rf "$npm_root/tree-sitter-cli" || true
  [ -z "$npm_prefix" ] || rm -rf "$npm_prefix/bin/tree-sitter" || true
}

while [ "$attempt" -le "$max_attempts" ]; do
  cleanup_install
  if npm install -g --no-audit "tree-sitter-cli@$version"; then
    exit 0
  fi

  cleanup_install
  if [ "$attempt" -eq "$max_attempts" ]; then
    printf 'tree-sitter-cli installation failed after %s attempts\n' "$max_attempts" >&2
    exit 1
  fi

  sleep "$attempt"
  attempt=$((attempt + 1))
done
