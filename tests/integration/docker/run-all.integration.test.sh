#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT_DIR"

if [ "${RUN_DOCKER_INTEGRATION_TESTS:-0}" != "1" ]; then
  printf 'SKIP: Docker integration tests require RUN_DOCKER_INTEGRATION_TESTS=1.\n'
  exit 78
fi

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  printf 'SKIP: Docker integration tests require an available Docker daemon.\n'
  exit 78
fi

SUITE_DIR="$ROOT_DIR/tests/integration/docker"
IMAGE_TAG="${KASEKI_DOCKER_INTEGRATION_IMAGE_TAG:-kaseki-docker-integration:test}"

if [ -n "${KASEKI_IMAGE:-}" ]; then
  IMAGE_TAG="$KASEKI_IMAGE"
  printf 'Using provided KASEKI_IMAGE: %s\n' "$IMAGE_TAG"
else
  printf 'Building shared Docker image for integration tests...\n'
  docker build -t "$IMAGE_TAG" .
fi

cleanup() {
  if [ -z "${KASEKI_IMAGE:-}" ]; then
    docker image rm "$IMAGE_TAG" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

run_suite() {
  local suite="$1"
  printf '\nRunning Docker integration suite: %s\n' "$suite"
  RUN_DOCKER_INTEGRATION_TESTS=1 KASEKI_IMAGE="$IMAGE_TAG" \
    bash "$SUITE_DIR/$suite"
}

run_suite startup-check-packaging.integration.test.sh
run_suite validation-tools.integration.test.sh

printf '\n✓ All Docker integration suites passed using shared image %s.\n' "$IMAGE_TAG"
