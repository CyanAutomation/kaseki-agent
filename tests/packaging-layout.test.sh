#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kaseki-packaging-layout.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT
cd "$ROOT_DIR"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

file_mode() {
  local path="$1"

  # GNU stat and BSD/macOS stat expose file modes through different flags.
  if stat -c '%a' "$path" 2>/dev/null; then
    return
  fi
  stat -f '%Lp' "$path"
}

printf '\n## Produced npm package contents\n'
npm pack --pack-destination "$TMP_DIR" >/dev/null 2>&1
mapfile -t archives < <(find "$TMP_DIR" -maxdepth 1 -type f -name '*.tgz' -print)
[[ "${#archives[@]}" -eq 1 ]] || fail "npm pack did not produce exactly one archive"

PACKAGE_DIR="$TMP_DIR/staged-package"
mkdir -p "$PACKAGE_DIR"
tar -xzf "${archives[0]}" --strip-components=1 -C "$PACKAGE_DIR"

# path|mode (an empty mode means that only presence is required). This is the
# publish contract: assertions are made against the cleanly staged tarball,
# not package.json's declaration of what npm ought to include.
package_manifest=(
  'dist/cli.js|755'
  'dist/pi-event-filter.js|755'
  'dist/pi-event-filter-helpers.js|755'
  'dist/pi-event-aggregation|'
  'dist/hashline-event-handler.js|755'
  'dist/hashline-validator.js|755'
  'dist/scouting-allowlist.js|755'
  'dist/instance-status-derivation.js|755'
  'dist/instance-stage-derivation.js|755'
  'dist/instance-failure-extraction.js|755'
  'dist/provider-error-classifier.js|755'
  'kaseki-agent.sh|644'
  'scripts/startup-checks.sh|755'
  'scripts/startup-check-packaging.sh|755'
  'scripts/docker-entrypoint.sh|755'
  'scripts/lib/provider-retry.sh|644'
  'scripts/lib/repo-memory.sh|644'
  'scripts/restore-disallowed-changes.sh|755'
  'scripts/evaluation-prompts.sh|755'
  'scripts/auto-lint-cleanup-classification.sh|755'
  'templates/scouting/compact.txt|'
  'templates/scouting/detailed-test-impact.txt|'
  'README.md|'
  'LICENSE|'
)

for item in "${package_manifest[@]}"; do
  IFS='|' read -r path mode <<<"$item"
  [[ -e "$PACKAGE_DIR/$path" ]] || fail "installed npm package is missing $path"
  if [[ -n "$mode" ]]; then
    actual_mode="$(file_mode "$PACKAGE_DIR/$path")"
    [[ "$actual_mode" == "$mode" ]] || fail "installed npm package $path has mode $actual_mode, expected $mode"
  fi
done

printf '\n## Importable package entry points\n'
PACKAGE_DIR="$PACKAGE_DIR" node --input-type=module <<'NODE'
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const entryPoints = [
  'dist/pi-event-filter-helpers.js',
  'dist/hashline-event-handler.js',
  'dist/hashline-validator.js',
  'dist/instance-status-derivation.js',
  'dist/instance-stage-derivation.js',
  'dist/instance-failure-extraction.js',
  'dist/provider-error-classifier.js',
];

for (const entryPoint of entryPoints) {
  await import(pathToFileURL(path.join(process.env.PACKAGE_DIR, entryPoint)).href);
}
NODE

# These are source-level constraints with no faithful artifact-level probe in
# this non-Docker test. Image paths, modes, links, entrypoint configuration, and
# startup-check execution are covered by the Docker packaging integration test.
printf '\n## Unobservable build-context constraints\n'
grep -Eq '^!tsconfig\.scripts\.json$' .dockerignore ||
  fail '.dockerignore does not allow tsconfig.scripts.json into the Docker build context'

printf '\n✓ Produced npm package layout and import contracts passed.\n'
