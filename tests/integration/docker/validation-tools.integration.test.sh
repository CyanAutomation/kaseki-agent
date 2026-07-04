#!/usr/bin/env bash
# Opt-in Docker packaging/integration test for validation tooling in a published image.
#
# This test intentionally requires KASEKI_IMAGE to be set to an immutable image
# digest (for example: docker.io/cyanautomation/kaseki-agent@sha256:<digest>) so
# normal fast test paths do not pull or execute a moving :latest image.
#
# Background: kaseki-32 failed with exit code 141 because npm prune --production
# removed typescript, eslint, and other devDependencies from the final image,
# causing npm run check to fail when run inside the container.

set -euo pipefail

TEST_NAME="Docker validation tools packaging integration"

printf 'Starting test: %s\n' "$TEST_NAME"

if [ "${RUN_DOCKER_INTEGRATION_TESTS:-0}" != "1" ]; then
  printf 'SKIP: Docker validation tools integration test requires RUN_DOCKER_INTEGRATION_TESTS=1.\n'
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    printf '::notice title=Docker validation tools integration skipped::Set RUN_DOCKER_INTEGRATION_TESTS=1 to run this opt-in Docker suite.\n'
  fi
  exit 78
fi

if [ -z "${KASEKI_IMAGE:-}" ]; then
  printf 'SKIP: KASEKI_IMAGE must be set to an immutable image digest, for example docker.io/cyanautomation/kaseki-agent@sha256:<digest>.\n'
  exit 78
fi

if [[ "$KASEKI_IMAGE" != *@sha256:* ]]; then
  printf 'FAIL: KASEKI_IMAGE must be an immutable @sha256 digest, got: %s\n' "$KASEKI_IMAGE" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  printf 'SKIP: Docker validation tools integration test requires an available Docker daemon.\n'
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    printf '::notice title=Docker validation tools integration skipped::Docker is not available on this runner.\n'
  fi
  exit 78
fi

printf 'Image: %s\n\n' "$KASEKI_IMAGE"
printf 'Checking validation tools and npm run check in a single container invocation...\n'

docker run --rm --workdir /app --entrypoint /bin/bash "$KASEKI_IMAGE" -s <<'CONTAINER_SCRIPT'
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

set +e
CHECK_OUTPUT="$(npm run check 2>&1)"
CHECK_EXIT=$?
set -e

printf '%s\n' "$CHECK_OUTPUT"
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
    if ! printf '%s\n' "$CHECK_OUTPUT" | grep -Eq '(tsc --noEmit|eslint[[:space:]].*src/)'; then
      printf 'FAIL: npm run check exited %s without evidence that tsc or eslint launched.\n' "$CHECK_EXIT" >&2
      exit 1
    fi
    if printf '%s\n' "$CHECK_OUTPUT" | grep -Eqi '(not found|command not found|missing script)'; then
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
