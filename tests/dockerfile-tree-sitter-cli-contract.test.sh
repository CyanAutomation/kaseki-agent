#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKERFILE="$ROOT_DIR/Dockerfile"
EXPECTED_VERSION="0.25.10"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

declared_version="$(sed -n 's/^ARG TREE_SITTER_CLI_VERSION=//p' "$DOCKERFILE")"
[[ "$declared_version" = "$EXPECTED_VERSION" ]] \
  || fail "TREE_SITTER_CLI_VERSION must remain pinned to $EXPECTED_VERSION"

printf '✓ Dockerfile tree-sitter-cli version policy assertion passed.\n'
