#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ "${RUN_DOCKER_INTEGRATION_TESTS:-0}" != "1" ]; then
  printf 'Skipping Docker startup-check packaging integration test; set RUN_DOCKER_INTEGRATION_TESTS=1 to run.\n'
  exit 0
fi

IMAGE_TAG="${KASEKI_STARTUP_CHECK_IMAGE_TAG:-kaseki-startup-check-packaging:test}"

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  printf 'Docker integration tests requested but Docker is not available.\n' >&2
  exit 1
fi

printf 'Building Docker image for startup-check packaging verification...\n'
docker build -t "$IMAGE_TAG" .

printf 'Checking final image contains executable startup-check and init-container paths...\n'
docker run --rm --entrypoint /bin/sh "$IMAGE_TAG" -c '
  set -eu
  test -x /scripts/startup-checks.sh
  test -x /scripts/kaseki-init-container.sh
  test "$(readlink -f /scripts/startup-checks.sh)" = "/app/scripts/startup-checks.sh"
  test "$(readlink -f /scripts/kaseki-init-container.sh)" = "/app/scripts/startup-checks.sh"
'

printf 'Checking entrypoint invokes the packaged startup-check path successfully...\n'
ENTRYPOINT_OUTPUT="$({
  docker run --rm \
    -e KASEKI_ROOT=/tmp/kaseki-startup-check-root \
    -e KASEKI_STARTUP_CHECK_MODE=quick \
    "$IMAGE_TAG" /bin/true
} 2>&1)"

printf '%s\n' "$ENTRYPOINT_OUTPUT" | grep -Fq 'Kaseki startup checks (mode: quick)'
printf '%s\n' "$ENTRYPOINT_OUTPUT" | grep -Fq 'All checks passed'

printf '✓ Startup-check Docker packaging integration assertions passed.\n'
