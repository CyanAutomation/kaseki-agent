#!/usr/bin/env bash
# Docker packaging/integration test for validation tooling in a published image.
#
# This test verifies that npm validation tools (tsc, eslint, jest) and npm run check
# are properly packaged in the Docker image.
#
# Execution modes:
#   1. KASEKI_IMAGE set to immutable digest (docker.io/org/image@sha256:...): uses published image
#   2. KASEKI_IMAGE set to tag (docker.io/org/image:tag or local-tag:version): uses specified image
#   3. KASEKI_IMAGE not set: builds a local test image from current Dockerfile
#
# Background: kaseki-32 failed with exit code 141 because npm prune --production
# removed typescript, eslint, and other devDependencies from the final image,
# causing npm run check to fail when run inside the container.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT_DIR"

TEST_NAME="Docker validation tools packaging integration"

printf 'Starting test: %s\n' "$TEST_NAME"

if [ "${RUN_DOCKER_INTEGRATION_TESTS:-0}" != "1" ]; then
  printf 'SKIP: Docker validation tools integration test requires RUN_DOCKER_INTEGRATION_TESTS=1.\n'
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    printf '::notice title=Docker validation tools integration skipped::Set RUN_DOCKER_INTEGRATION_TESTS=1 to run this opt-in Docker suite.\n'
  fi
  exit 78
fi

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  printf 'SKIP: Docker validation tools integration test requires an available Docker daemon.\n'
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    printf '::notice title=Docker validation tools integration skipped::Docker is not available on this runner.\n'
  fi
  exit 78
fi

# Determine the image to test
if [ -n "${KASEKI_IMAGE:-}" ]; then
  # Use provided image (can be published digest, tag, or local tag)
  VALIDATION_TEST_IMAGE="$KASEKI_IMAGE"
  printf 'Using provided KASEKI_IMAGE: %s\n' "$VALIDATION_TEST_IMAGE"
else
  # No image provided: build a local test image (like startup-check does)
  VALIDATION_TEST_IMAGE="${KASEKI_VALIDATION_TEST_IMAGE_TAG:-kaseki-validation-tools-packaging:test}"
  printf 'Building local Docker image for validation tools packaging verification...\n'
  docker build -t "$VALIDATION_TEST_IMAGE" .
fi

printf 'Image: %s\n\n' "$VALIDATION_TEST_IMAGE"
printf 'Checking validation tools and npm run check in a single container invocation...\n'

# Keep stdin attached: Bash reads the validation program from the heredoc below.
# Without -i Docker closes stdin and Bash exits successfully without testing it.
docker run --rm -i --workdir /app --entrypoint /bin/bash "$VALIDATION_TEST_IMAGE" -s <<'CONTAINER_SCRIPT'
set -euo pipefail

for tool in tsc eslint jest; do
  tool_path="/app/node_modules/.bin/${tool}"
  if [ ! -f "$tool_path" ]; then
    printf 'FAIL: %s not found at %s\n' "$tool" "$tool_path" >&2
    exit 1
  fi
  if [ ! -x "$tool_path" ]; then
    printf 'FAIL: %s exists but is not executable at %s\n' "$tool" "$tool_path" >&2
    exit 1
  fi
  printf '✓ %s available at %s\n' "$tool" "$tool_path"
done

tsc --version

# Stream the check output to the CI log. Capturing it in a command substitution
# leaves long-running type-check or lint runs silent, which lets CI inactivity
# watchdogs cancel the enclosing Docker integration job.
CHECK_OUTPUT_FILE="$(mktemp)"
trap 'rm -f "$CHECK_OUTPUT_FILE"' EXIT
set +e
npm run check 2>&1 | tee "$CHECK_OUTPUT_FILE"
CHECK_EXIT="${PIPESTATUS[0]}"
set -e

printf 'npm run check exit code: %s\n' "$CHECK_EXIT"

case "$CHECK_EXIT" in
  0)
    printf '✓ npm run check completed successfully.\n'
    ;;
  1|2)
    # Documented acceptable non-zero outcomes: TypeScript or ESLint reported
    # validation findings. These are acceptable only when npm output proves the
    # validation commands actually launched; silent warnings, missing binaries,
    # or SIGPIPE-style truncation are not acceptable.
    if ! grep -Eq '(tsc --noEmit|eslint[[:space:]].*src/)' "$CHECK_OUTPUT_FILE"; then
      printf 'FAIL: npm run check exited %s without evidence that tsc or eslint launched.\n' "$CHECK_EXIT" >&2
      exit 1
    fi
    if grep -Eqi '(not found|command not found|missing script)' "$CHECK_OUTPUT_FILE"; then
      printf 'FAIL: npm run check exited %s because validation tooling did not launch cleanly.\n' "$CHECK_EXIT" >&2
      exit 1
    fi
    printf '✓ npm run check produced acceptable validation findings after launching tools.\n'
    ;;
  13|141)
    printf 'FAIL: npm run check exited with SIGPIPE-style code %s.\n' "$CHECK_EXIT" >&2
    exit 1
    ;;
  *)
    printf 'FAIL: npm run check exited with undocumented code %s.\n' "$CHECK_EXIT" >&2
    exit 1
    ;;
esac
CONTAINER_SCRIPT

printf '\n✓ All validation tools are available in the Docker image.\n'
