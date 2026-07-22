#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# These checks intentionally cover only the static packaging boundary. Runtime
# defaults, link targets, and mode forwarding belong in startup-check-packaging.test.sh.
bash -n scripts/startup-check-packaging.sh
bash -n scripts/docker-entrypoint.sh

printf '\n✓ Startup-check packaging layout assertions passed.\n'
