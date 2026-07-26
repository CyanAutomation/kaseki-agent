#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=helpers/repo-memory-test-helpers.sh
. "$(dirname "$0")/helpers/repo-memory-test-helpers.sh"
setup_repo_memory_fixture
trap 'rm -rf "$TMP_DIR"' EXIT
build_result_artifacts
write_repo_memory_summary '2026-05-06T12:00:00Z'
if grep -Eiq 'OPENROUTER|sk-or|Task Prompt|do not persist' "$REPO_MEMORY_FILE"; then
  printf 'Expected repository memory to redact prompts and secrets.\n' >&2; exit 1
fi
printf '✅ Repository memory redaction test passed\n'
