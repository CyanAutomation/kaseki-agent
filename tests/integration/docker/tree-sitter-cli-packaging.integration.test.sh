#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT_DIR"

if [ "${RUN_DOCKER_INTEGRATION_TESTS:-0}" != "1" ]; then
  printf 'SKIP: tree-sitter CLI packaging integration test requires RUN_DOCKER_INTEGRATION_TESTS=1.\n'
  exit 78
fi

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  printf 'SKIP: tree-sitter CLI packaging integration test requires an available Docker daemon.\n'
  exit 78
fi

if [ -n "${KASEKI_IMAGE:-}" ]; then
  IMAGE_TAG="$KASEKI_IMAGE"
  printf 'Using provided KASEKI_IMAGE: %s\n' "$IMAGE_TAG"
else
  IMAGE_TAG="${KASEKI_TREE_SITTER_IMAGE_TAG:-kaseki-tree-sitter-cli-packaging:test}"
  printf 'Building Docker image for tree-sitter CLI packaging verification...\n'
  docker build -t "$IMAGE_TAG" .
fi

printf 'Checking the tree-sitter executable path and behavior in the final image...\n'
# This integration suite runs the image for the Docker host's native platform,
# so it can validate the installed CLI without relying on Dockerfile layout.
docker run --rm --entrypoint /bin/sh "$IMAGE_TAG" -c \
  'set -eu
   test "$(command -v tree-sitter)" = /usr/local/bin/tree-sitter
   test -x /usr/local/bin/tree-sitter
   tree-sitter --version | grep -Eq "^tree-sitter 0[.]25[.]10([[:space:]].*)?$"'

printf '✓ tree-sitter CLI Docker packaging integration assertions passed.\n'
