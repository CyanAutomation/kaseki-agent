#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=helpers/repo-memory-test-helpers.sh
. "$(dirname "$0")/helpers/repo-memory-test-helpers.sh"
setup_repo_memory_fixture
trap 'rm -rf "$TMP_DIR"' EXIT
build_result_artifacts
write_repo_memory_summary '2026-05-06T12:00:00Z'
grep -q 'Updated at: 2026-05-06T12:00:00Z' "$REPO_MEMORY_FILE"
grep -q 'Useful architecture note' "$REPO_MEMORY_FILE"
grep -q 'npm test: exit 0, 3s' "$REPO_MEMORY_FILE"
printf '✅ Repository memory summary generation test passed\n'
