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

EXPECTED_VERSION="$(sed -n 's/^ARG TREE_SITTER_CLI_VERSION=//p' Dockerfile)"
test -n "$EXPECTED_VERSION"

if [ -n "${KASEKI_IMAGE:-}" ]; then
  IMAGE_TAG="$KASEKI_IMAGE"
  printf 'Using provided KASEKI_IMAGE: %s\n' "$IMAGE_TAG"
else
  IMAGE_TAG="${KASEKI_TREE_SITTER_IMAGE_TAG:-kaseki-tree-sitter-cli-packaging:test}"
  printf 'Building Docker image for tree-sitter CLI packaging verification...\n'
  docker build -t "$IMAGE_TAG" .
fi

printf 'Checking tree-sitter executable and version in the final image...\n'
if ! command -v timeout >/dev/null 2>&1; then
  printf 'FAIL: tree-sitter CLI integration test requires the timeout command.\n' >&2
  exit 1
fi

TREE_SITTER_TIMEOUT_SECONDS="${TREE_SITTER_CLI_PROBE_TIMEOUT_SECONDS:-60}"
set +e
VERSION_OUTPUT="$(timeout --foreground "${TREE_SITTER_TIMEOUT_SECONDS}s" docker run --rm --entrypoint tree-sitter "$IMAGE_TAG" --version)"
TREE_SITTER_EXIT=$?
set -e

if [ "$TREE_SITTER_EXIT" -eq 124 ]; then
  printf 'FAIL: tree-sitter --version did not complete within %ss.\n' "$TREE_SITTER_TIMEOUT_SECONDS" >&2
  exit 1
fi
if [ "$TREE_SITTER_EXIT" -ne 0 ]; then
  printf 'FAIL: tree-sitter --version exited with %s.\n' "$TREE_SITTER_EXIT" >&2
  exit "$TREE_SITTER_EXIT"
fi

printf '%s\n' "$VERSION_OUTPUT"
printf '%s\n' "$VERSION_OUTPUT" | grep -Eq "^tree-sitter ${EXPECTED_VERSION}([[:space:]]|$)"

printf '✓ tree-sitter CLI Docker packaging integration assertions passed.\n'
