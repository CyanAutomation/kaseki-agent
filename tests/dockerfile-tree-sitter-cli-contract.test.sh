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

grep -Fq 'COPY --from=runtime /usr/local/bin/tree-sitter /usr/local/bin/tree-sitter' "$DOCKERFILE" || fail 'The final image must copy the tree-sitter executable from the runtime stage'
grep -Fq 'test -x /usr/local/bin/tree-sitter' "$DOCKERFILE" || fail 'The final image must validate that tree-sitter is executable during build'
if grep -Fq 'tree-sitter --version' "$DOCKERFILE"; then
  fail 'The Docker build must not execute tree-sitter under multi-architecture emulation'
fi

if grep -Fq -- '--entrypoint tree-sitter' "$PUBLISH_WORKFLOW"; then
  fail 'The publish workflow must not execute the architecture-specific tree-sitter CLI'
fi

tree_sitter_packaging_check="-c 'test -x /usr/local/bin/tree-sitter'"
workflow_packaging_checks="$(grep -Fc -- "$tree_sitter_packaging_check" "$PUBLISH_WORKFLOW")"
test "$workflow_packaging_checks" = 2 \
  || fail 'The publish workflow must verify tree-sitter packaging for both candidate registries'

printf '✓ Dockerfile tree-sitter-cli version policy assertion passed.\n'
