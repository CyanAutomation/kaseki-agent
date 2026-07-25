#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT_DIR"

if [ "${RUN_DOCKER_INTEGRATION_TESTS:-0}" != "1" ]; then
  printf 'SKIP: Docker startup-check packaging integration test requires RUN_DOCKER_INTEGRATION_TESTS=1.\n'
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    printf '::notice title=Docker startup-check integration skipped::Set RUN_DOCKER_INTEGRATION_TESTS=1 to run this opt-in Docker suite.\n'
  fi
  exit 78
fi

IMAGE_TAG="${KASEKI_STARTUP_CHECK_IMAGE_TAG:-kaseki-startup-check-packaging:test}"

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  printf 'SKIP: Docker startup-check packaging integration test requires an available Docker daemon.\n'
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    printf '::notice title=Docker startup-check integration skipped::Docker is not available on this runner.\n'
  fi
  exit 78
fi

printf 'Building Docker image for startup-check packaging verification...\n'
docker build -t "$IMAGE_TAG" .

printf 'Checking required final-image destinations and modes...\n'
docker run --rm --entrypoint /bin/sh "$IMAGE_TAG" -c '
  set -eu
  # destination|mode. Keep this focused on the installed image contract rather
  # than the Dockerfile instructions used to produce it.
  manifest="
    /usr/local/bin/kaseki-agent|755
    /usr/local/bin/kaseki-entrypoint|755
    /usr/local/bin/kaseki-pi-event-filter|755
    /usr/local/bin/pi-event-filter-helpers.js|755
    /usr/local/bin/instance-status-derivation.js|755
    /usr/local/bin/instance-stage-derivation.js|755
    /usr/local/bin/instance-failure-extraction.js|755
    /usr/local/bin/provider-error-classifier.js|755
    /usr/local/bin/scripts/scouting-allowlist.js|755
    /usr/local/bin/scripts/lib/provider-retry.sh|644
    /usr/local/bin/scripts/restore-disallowed-changes.sh|755
    /usr/local/bin/scripts/evaluation-prompts.sh|755
    /usr/local/bin/scripts/auto-lint-cleanup-classification.sh|755
    /usr/local/bin/templates/scouting/compact.txt|644
    /usr/local/bin/templates/scouting/detailed-test-impact.txt|644
    /app/scripts/startup-check-packaging.sh|755
  "
  echo "$manifest" | while IFS="|" read -r path mode; do
    [ -n "$path" ] || continue
    path="$(printf "%s" "$path" | sed "s/^[[:space:]]*//")"
    test -e "$path"
    actual_mode="$(stat -c "%a" "$path")"
    test "$actual_mode" = "$mode"
  done

  test -L /scripts/startup-checks.sh
  test -L /scripts/kaseki-init-container.sh
  test -x /scripts/startup-checks.sh
  test -x /scripts/kaseki-init-container.sh
  test "$(readlink /scripts/startup-checks.sh)" = "/app/scripts/startup-checks.sh"
  test "$(readlink /scripts/kaseki-init-container.sh)" = "/app/scripts/startup-checks.sh"
  test "$(readlink -f /scripts/startup-checks.sh)" = "/app/scripts/startup-checks.sh"
  test "$(readlink -f /scripts/kaseki-init-container.sh)" = "/app/scripts/startup-checks.sh"
'

printf 'Checking installed JavaScript entry points are importable...\n'
docker run --rm --entrypoint node "$IMAGE_TAG" --input-type=module -e '
  const entries = [
    "/usr/local/bin/pi-event-filter-helpers.js",
    "/usr/local/bin/instance-status-derivation.js",
    "/usr/local/bin/instance-stage-derivation.js",
    "/usr/local/bin/instance-failure-extraction.js",
    "/usr/local/bin/provider-error-classifier.js",
  ];
  for (const entry of entries) await import(`file://${entry}`);
'

printf 'Checking installed entrypoint and default command configuration...\n'
test "$(docker image inspect --format '{{json .Config.Entrypoint}}' "$IMAGE_TAG")" = '["/usr/bin/tini","--","/usr/local/bin/kaseki-entrypoint"]'
test "$(docker image inspect --format '{{json .Config.Cmd}}' "$IMAGE_TAG")" = '["agent"]'

printf 'Checking entrypoint invokes the packaged startup-check path successfully...\n'
ENTRYPOINT_OUTPUT="$({
  docker run --rm \
    -e KASEKI_ROOT=/tmp/kaseki-startup-check-root \
    -e KASEKI_STARTUP_CHECK_MODE=quick \
    "$IMAGE_TAG" /bin/true
} 2>&1)"

printf '%s\n' "$ENTRYPOINT_OUTPUT" | grep -Fq 'Kaseki startup checks (mode: quick)'
printf '%s\n' "$ENTRYPOINT_OUTPUT" | grep -Fq 'All checks passed'
if printf '%s\n' "$ENTRYPOINT_OUTPUT" | grep -Fq 'Startup checks failed: blocking startup issue detected'; then
  printf 'Entrypoint reported a blocking startup-check failure unexpectedly.\n' >&2
  exit 1
fi

printf 'Checking the built image starts with its default agent contract...\n'
DEFAULT_START_OUTPUT="$({
  docker run --rm \
    -e KASEKI_SKIP_STARTUP_CHECKS=1 \
    -e KASEKI_AGENT_HELPER_RESOLUTION_CHECK=1 \
    "$IMAGE_TAG"
} 2>&1)"
printf '%s\n' "$DEFAULT_START_OUTPUT" | grep -Fq \
  'allowlist_helper=/usr/local/bin/scripts/allowlist-helper.sh'

printf '✓ Startup-check Docker packaging integration assertions passed.\n'
