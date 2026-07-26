#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v shellcheck >/dev/null 2>&1; then
  printf 'ERROR: shellcheck is required but was not found on PATH.\n' >&2
  exit 127
fi

production_files=(
  kaseki-agent.sh
  run-kaseki.sh
  test-artifact-recovery.sh
  scripts/*.sh
  scripts/lib/*.sh
)

test_files=()
while IFS= read -r -d '' file; do
  test_files+=("$file")
done < <(find test tests -type f \( -name '*.sh' -o -name '*.bash' -o -name '*.bats' \) -print0 | sort -z)

shellcheck -x -P . -P scripts -P scripts/lib "${production_files[@]}"

if [ "${#test_files[@]}" -gt 0 ]; then
  shellcheck -x -S warning -e SC1090,SC2034 "${test_files[@]}"
fi
