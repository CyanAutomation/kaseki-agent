#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v shellcheck >/dev/null 2>&1; then
  printf 'ERROR: shellcheck is required but was not found on PATH.\n' >&2
  exit 127
fi

production_files=(
  run-kaseki.sh
  test-artifact-recovery.sh
  scripts/*.sh
  scripts/lib/*.sh
)

test_files=()
while IFS= read -r -d '' file; do
  test_files+=("$file")
done < <(find test tests -type f \( -name '*.sh' -o -name '*.bash' -o -name '*.bats' \) -print0 | sort -z)

# kaseki-agent.sh is a 10k-line orchestration entrypoint. ShellCheck's whole-file
# analysis grows superlinearly for this script and can consume gigabytes of RAM
# before being terminated by CI. Keep a syntax check for it here while the
# independently maintained helpers receive the full ShellCheck pass below.
bash -n kaseki-agent.sh

shellcheck -x -P . -P scripts -P scripts/lib "${production_files[@]}"

if [ "${#test_files[@]}" -gt 0 ]; then
  shellcheck -x -S warning -e SC1090,SC2034 "${test_files[@]}"
fi
