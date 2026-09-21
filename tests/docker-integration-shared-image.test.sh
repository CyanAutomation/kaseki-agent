#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ORCHESTRATOR="$ROOT_DIR/tests/integration/docker/run-all.integration.test.sh"
STARTUP_SUITE="$ROOT_DIR/tests/integration/docker/startup-check-packaging.integration.test.sh"
VALIDATION_SUITE="$ROOT_DIR/tests/integration/docker/validation-tools.integration.test.sh"
TREE_SITTER_SUITE="$ROOT_DIR/tests/integration/docker/tree-sitter-cli-packaging.integration.test.sh"
PACKAGE_JSON="$ROOT_DIR/package.json"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

test -x "$ORCHESTRATOR" || fail 'Docker integration orchestrator must be executable'

# Static shell snippets are intentionally matched literally in this contract test.
# shellcheck disable=SC2016
build_command='docker build -t "$IMAGE_TAG" .'
grep -Fq "$build_command" "$ORCHESTRATOR" \
  || fail 'Docker integration orchestrator must build the shared image'

build_count="$(grep -Fc "$build_command" "$ORCHESTRATOR")"
test "$build_count" = 1 \
  || fail 'Docker integration orchestrator must contain exactly one image build'

# shellcheck disable=SC2016
shared_image_assignment='KASEKI_IMAGE="$IMAGE_TAG"'
grep -Fq "$shared_image_assignment" "$ORCHESTRATOR" \
  || fail 'Docker integration orchestrator must pass the shared image to suites'

grep -Fq 'KASEKI_IMAGE' "$STARTUP_SUITE" \
  || fail 'Startup-check suite must support a provided KASEKI_IMAGE'
grep -Fq 'KASEKI_IMAGE' "$VALIDATION_SUITE" \
  || fail 'Validation-tools suite must support a provided KASEKI_IMAGE'
grep -Fq 'KASEKI_IMAGE' "$TREE_SITTER_SUITE" \
  || fail 'Tree-sitter suite must support a provided KASEKI_IMAGE'

# Long-running validation must continue emitting output so a CI inactivity
# watchdog does not terminate the surrounding integration job.
grep -Fq 'npm run check 2>&1 | tee "$CHECK_OUTPUT_FILE"' "$VALIDATION_SUITE" \
  || fail 'Validation suite must stream npm run check output to the CI log'
if grep -Fq 'CHECK_OUTPUT="$(npm run check 2>&1)"' "$VALIDATION_SUITE"; then
  fail 'Validation suite must not suppress npm run check output in a command substitution'
fi
# The validation program is a heredoc, so Docker must keep stdin open for Bash.
grep -Fq 'docker run --rm -i --workdir /app --entrypoint /bin/bash "$VALIDATION_TEST_IMAGE" -s' "$VALIDATION_SUITE" \
  || fail 'Validation suite must attach stdin when executing its heredoc'

node - "$PACKAGE_JSON" <<'NODE'
const fs = require('node:fs');
const packageJson = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const command = packageJson.scripts?.['test:integration:docker'] ?? '';
if (!command.includes('run-all.integration.test.sh')) {
  console.error('FAIL: test:integration:docker must use the shared-image orchestrator');
  process.exit(1);
}
NODE

printf '✓ Docker integration shared-image contract passed.\n'
