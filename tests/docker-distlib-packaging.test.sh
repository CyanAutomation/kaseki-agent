#!/usr/bin/env bash
set -euo pipefail

# Keep this legacy Docker-focused entry point lightweight: the publish smoke test
# validates the same dist/lib runtime modules from the produced npm artifact.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

printf 'Building the package before checking its installed runtime layout...\n'
npm run build

printf 'Checking dist/lib runtime imports from the packed artifact...\n'
npm run test:pack-artifact
