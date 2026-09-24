#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# macOS provides shasum while Linux workers provide sha256sum.
sha256sum() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$@"
  else
    command sha256sum "$@"
  fi
}
eval "$(awk '
  /^validation_fingerprint\(\)/ { emit=1 }
  /^run_validation_commands\(\)/ { emit=0 }
  emit { print }
' "$ROOT_DIR/kaseki-agent.sh")"

results_dir="$TMP_DIR/results"
workspace="$TMP_DIR/repo"
mkdir -p "$results_dir"
mkdir -p "$workspace"
git -C "$workspace" init -q
git -C "$workspace" config user.email kaseki-test@example.invalid
git -C "$workspace" config user.name "Kaseki Test"
printf 'tracked baseline\n' > "$workspace/tracked.txt"
git -C "$workspace" add tracked.txt
git -C "$workspace" commit -q -m baseline
cd "$workspace"
printf 'diff A\n' > "$results_dir/git.diff"
printf 'src/a.ts\n' > "$results_dir/changed-files.txt"
VALIDATION_EXIT=0
LAST_SUCCESSFUL_VALIDATION_FINGERPRINT=""
remember_successful_validation "$results_dir" 'npm test; npm run type-check' 2
reuse_validation_if_unchanged "$results_dir" 'npm test; npm run type-check' || {
  printf 'FAIL: identical diff and commands were not reusable\n' >&2
  exit 1
}
if reuse_validation_if_unchanged "$results_dir" 'npm test'; then
  printf 'FAIL: validation was reusable after its command set changed\n' >&2
  exit 1
fi
printf 'diff B\n' > "$results_dir/git.diff"
if reuse_validation_if_unchanged "$results_dir" 'npm test; npm run type-check'; then
  printf 'FAIL: validation was reusable after the diff changed\n' >&2
  exit 1
fi
printf 'generated A\n' > generated.txt
VALIDATION_EXIT=0
remember_successful_validation "$results_dir" 'npm test; npm run type-check' 2
printf 'generated B\n' > generated.txt
if reuse_validation_if_unchanged "$results_dir" 'npm test; npm run type-check'; then
  printf 'FAIL: validation was reusable after an untracked file changed\n' >&2
  exit 1
fi

VALIDATION_EXIT=1
remember_successful_validation "$results_dir" 'failing command' 1
printf 'generated A\n' > generated.txt
reuse_validation_if_unchanged "$results_dir" 'npm test; npm run type-check' || {
  printf 'FAIL: failed validation replaced the last successful fingerprint\n' >&2
  exit 1
}

printf 'validation-reuse-fingerprint.test.sh PASS\n'
