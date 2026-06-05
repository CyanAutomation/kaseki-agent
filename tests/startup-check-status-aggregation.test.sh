#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Force check_kaseki_root to fail with blocking exit 2: mkdir -p cannot
# create a child directory beneath a regular file. The default subdirectory
# checks then return warning exit 3 beneath the same blocked root, and the
# missing bootstrap script also returns warning exit 3.
blocking_parent="$TMP_DIR/not-a-directory"
touch "$blocking_parent"
blocking_root="$blocking_parent/kaseki-root"

set +e
output="$({
  HOME="$TMP_DIR/home" \
  KASEKI_ROOT="$blocking_root" \
  KASEKI_SECRETS_DIR="$TMP_DIR/secrets" \
  OPENROUTER_API_KEY="test-key" \
  GITHUB_APP_ENABLED=0 \
  KASEKI_STARTUP_CHECK_AUTO_REMEDIATE=0 \
    bash "$ROOT_DIR/scripts/startup-checks.sh" all
} 2>&1)"
status=$?
set -e

if [ "$status" -ne 2 ]; then
  printf 'Expected startup checks to exit 2 when a blocking error is followed by warnings, got %s.\nOutput:\n%s\n' "$status" "$output" >&2
  exit 1
fi

printf '%s\n' "$output" | grep -Fq 'does not exist and could not be created'
printf '%s\n' "$output" | grep -Fq 'Could not create'
printf '%s\n' "$output" | grep -Fq 'Bootstrap incomplete: run-kaseki.sh not yet present'
printf '%s\n' "$output" | grep -Fq 'Error detected; startup blocked'

printf '✓ Startup-check blocking status aggregation assertions passed.\n'
