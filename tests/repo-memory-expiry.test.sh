#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=helpers/repo-memory-test-helpers.sh
. "$(dirname "$0")/helpers/repo-memory-test-helpers.sh"
setup_repo_memory_fixture
trap 'rm -rf "$TMP_DIR"' EXIT
mkdir -p "$REPO_MEMORY_DIR"
printf 'cached context\n' > "$REPO_MEMORY_FILE"
modified="$(stat -c %Y "$REPO_MEMORY_FILE")"
repo_memory_is_fresh "$REPO_MEMORY_FILE" 4096 30 "$((modified + 30 * 86400))"
if repo_memory_is_fresh "$REPO_MEMORY_FILE" 4096 30 "$((modified + 30 * 86400 + 1))"; then
  printf 'Expected memory older than the fixed TTL boundary to expire.\n' >&2; exit 1
fi
printf '✅ Repository memory expiry test passed\n'
