#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKERFILE="$ROOT_DIR/Dockerfile"
PUBLISH_WORKFLOW="$ROOT_DIR/.github/workflows/build-docker-image.yml"
EXPECTED_VERSION="0.25.10"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

declared_version="$(sed -n 's/^ARG TREE_SITTER_CLI_VERSION=//p' "$DOCKERFILE")"
[[ "$declared_version" = "$EXPECTED_VERSION" ]] \
  || fail "TREE_SITTER_CLI_VERSION must remain pinned to $EXPECTED_VERSION"

if grep -Fq 'tree-sitter --version' "$DOCKERFILE"; then
  fail 'The Docker build must not execute tree-sitter under multi-architecture emulation'
fi

if grep -Fq -- '--entrypoint tree-sitter' "$PUBLISH_WORKFLOW"; then
  fail 'The publish workflow must not execute the architecture-specific tree-sitter CLI'
fi

printf '✓ Dockerfile tree-sitter-cli policy assertions passed.\n'
