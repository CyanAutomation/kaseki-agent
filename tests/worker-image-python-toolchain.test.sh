#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKERFILE="$ROOT_DIR/Dockerfile"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

final_stage="$(awk '/^FROM base AS final$/{copy=1} copy{print}' "$DOCKERFILE")"
for package in python3 python3-pip python3-venv; do
  grep -Eq "(^|[[:space:]])${package}([[:space:]\\\\]|$)" <<< "$final_stage" \
    || fail "final worker image does not install $package"
done

printf '✓ final worker image contains Python and isolated virtual-environment tooling\n'
