#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

assert_file_contains() {
  local file="$1"
  local pattern="$2"
  local message="$3"

  if ! grep -Eq "$pattern" "$file"; then
    printf '%s\n' "$message" >&2
    exit 1
  fi
}

# These checks intentionally cover only the static packaging boundary. Runtime
# defaults, link targets, and mode forwarding belong in startup-check-packaging.test.sh.
bash -n scripts/startup-check-packaging.sh
bash -n scripts/docker-entrypoint.sh

assert_file_contains scripts/docker-entrypoint.sh '/app/scripts/startup-check-packaging\.sh' \
  'docker entrypoint no longer references the packaged startup-check contract'
assert_file_contains scripts/docker-entrypoint.sh 'kaseki_run_startup_checks' \
  'docker entrypoint no longer dispatches through the shared startup-check contract'

printf '\n✓ Startup-check packaging layout assertions passed.\n'
