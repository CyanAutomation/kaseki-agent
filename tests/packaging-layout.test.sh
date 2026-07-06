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

assert_file_match_count() {
  local file="$1"
  local pattern="$2"
  local expected_count="$3"
  local message="$4"
  local actual_count

  actual_count="$(grep -Ec "$pattern" "$file")"
  if [ "$actual_count" != "$expected_count" ]; then
    printf '%s (expected %s, found %s)\n' "$message" "$expected_count" "$actual_count" >&2
    exit 1
  fi
}

assert_dockerfile_copies_to_build_context() {
  local source_path="$1"
  local destination_path="$2"
  local message="$3"

  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const [sourcePath, destinationPath] = process.argv.slice(1);
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const copyInstructions = dockerfile
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("COPY "));

    const matches = copyInstructions.some((line) => {
      const parts = line.split(/\s+/).slice(1);
      const destination = parts.at(-1);
      const sources = parts.slice(0, -1).filter((part) => !part.startsWith("--"));
      return destination === destinationPath && sources.includes(sourcePath);
    });

    if (!matches) {
      process.exit(1);
    }
  ' "$source_path" "$destination_path" || {
    printf '%s\n' "$message" >&2
    exit 1
  }
}

assert_dockerfile_copy_from_stage() {
  local stage="$1"
  local source_path="$2"
  local destination_path="$3"
  local message="$4"

  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const [stage, sourcePath, destinationPath] = process.argv.slice(1);
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const copyInstructions = dockerfile
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("COPY "));

    const matches = copyInstructions.some((line) => {
      const parts = line.split(/\s+/).slice(1);
      const fromIndex = parts.indexOf(`--from=${stage}`);
      const destination = parts.at(-1);
      const sources = parts.slice(0, -1).filter((part) => !part.startsWith("--"));
      return fromIndex !== -1 && destination === destinationPath && sources.includes(sourcePath);
    });

    if (!matches) {
      process.exit(1);
    }
  ' "$stage" "$source_path" "$destination_path" || {
    printf '%s\n' "$message" >&2
    exit 1
  }
}

assert_dockerfile_installs_executable() {
  local source_path="$1"
  local destination_path="$2"
  local expected_count="$3"
  local message="$4"

  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const [sourcePath, destinationPath, expectedCountText] = process.argv.slice(1);
    const expectedCount = Number(expectedCountText);
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const installPattern = new RegExp(`install\\s+-m\\s+0755\\s+${escapeRegExp(sourcePath)}\\s+${escapeRegExp(destinationPath)}(?=\\s|$)`, "g");
    const actualCount = [...dockerfile.matchAll(installPattern)].length;
    if (actualCount !== expectedCount) {
      console.error(`expected ${expectedCount}, found ${actualCount}`);
      process.exit(1);
    }
  ' "$source_path" "$destination_path" "$expected_count" || {
    printf '%s\n' "$message" >&2
    exit 1
  }
}

assert_dockerfile_preserves_runtime_file() {
  local source_path="$1"
  local app_lib_path="$2"
  local installed_path="$3"
  local message="$4"

  assert_file_contains Dockerfile "cp([[:space:]]+-r)?[[:space:]]+${source_path//./\.}[[:space:]]+${app_lib_path//./\.}" "$message"
  assert_dockerfile_installs_executable "$app_lib_path" "$installed_path" 2 "$message"
}

bash -n scripts/startup-check-packaging.sh || { printf 'startup-check packaging config has invalid shell syntax\n' >&2; exit 1; }
bash -n scripts/docker-entrypoint.sh || { printf 'docker entrypoint has invalid shell syntax\n' >&2; exit 1; }

assert_file_contains .dockerignore '^!tsconfig\.scripts\.json$' \
  '.dockerignore does not allow tsconfig.scripts.json into the Docker build context'
assert_dockerfile_copies_to_build_context tsconfig.scripts.json ./ \
  'Dockerfile does not copy tsconfig.scripts.json before npm run build'
assert_dockerfile_copies_to_build_context scripts ./scripts \
  'Dockerfile does not copy scripts into /app for startup-check packaging'
assert_file_contains Dockerfile '^[[:space:]]+/app/scripts/startup-check-packaging\.sh \\$' \
  'Dockerfile does not mark startup-check-packaging.sh executable'
assert_file_match_count Dockerfile '^[[:space:]]+&& /app/scripts/startup-check-packaging\.sh install \\$' 2 \
  'Dockerfile must install startup-check symlinks in both runtime and final stages'
assert_dockerfile_copy_from_stage runtime /app/scripts ./scripts \
  'Dockerfile final stage does not copy packaged scripts from runtime stage'

assert_dockerfile_preserves_runtime_file dist/pi-event-filter-helpers.js /app/lib/pi-event-filter-helpers.js /usr/local/bin/pi-event-filter-helpers.js \
  'Dockerfile does not preserve and install the pi-event-filter helper module'
assert_file_contains Dockerfile 'cp -r[[:space:]]+dist/pi-event-aggregation[[:space:]]+/app/lib/pi-event-aggregation' \
  'Dockerfile does not preserve pi-event-filter runtime dependencies'
assert_file_match_count Dockerfile 'cp -r /app/lib/pi-event-aggregation/\* /usr/local/bin/pi-event-aggregation/' 2 \
  'Dockerfile must install pi-event aggregation modules in runtime and final stages'
assert_file_match_count Dockerfile '/usr/local/bin/kaseki-pi-event-filter "\$empty_events" "\$filtered_events" "\$event_summary"' 2 \
  'Dockerfile must execute the packaged pi-event filter in runtime and final stages'

assert_file_contains Dockerfile '^ENTRYPOINT \["/usr/bin/tini", "--", "/usr/local/bin/kaseki-entrypoint"\]$' \
  'Dockerfile entrypoint does not dispatch through kaseki-entrypoint'
assert_file_contains Dockerfile 'apt-get install[^&]*shellcheck' \
  'Dockerfile runtime image must include shellcheck because repository lint scripts invoke it'

assert_dockerfile_installs_executable /app/dist/scouting-allowlist.js /usr/local/bin/scripts/scouting-allowlist.js 2 \
  'Dockerfile must install the scouting validator at its packaged runtime path in both image stages'
assert_file_contains kaseki-agent.sh '/app/dist/scouting-allowlist\.js' \
  'runner does not fall back to the built scouting validator in the image'
assert_file_contains kaseki-agent.sh '/usr/local/bin/scripts/scouting-allowlist\.js' \
  'runner does not recognize the installed scouting validator runtime path'
assert_file_contains scripts/startup-checks.sh '"scouting-allowlist\.js"' \
  'worker preflight does not verify the packaged scouting validator'

assert_file_match_count Dockerfile 'install -m 0644 /app/scripts/lib/provider-retry\.sh /usr/local/bin/scripts/lib/provider-retry\.sh' 2 \
  'Dockerfile must install provider-retry.sh at its sourced runtime path in both image stages'
assert_file_contains scripts/startup-checks.sh '"lib/provider-retry\.sh"' \
  'worker preflight must reject images missing the provider retry helper'
assert_file_match_count Dockerfile 'install -m 0755 /app/scripts/auto-lint-cleanup-classification\.sh /usr/local/bin/scripts/auto-lint-cleanup-classification\.sh' 2 \
  'Dockerfile must install auto-lint cleanup classification at its sourced runtime path in both image stages'
assert_file_contains scripts/startup-checks.sh '"auto-lint-cleanup-classification\.sh"' \
  'worker preflight must reject images missing the auto-lint cleanup classification helper'

for helper in \
  instance-status-derivation.js \
  instance-stage-derivation.js \
  instance-failure-extraction.js \
  provider-error-classifier.js
do
  assert_dockerfile_preserves_runtime_file "dist/$helper" "/app/lib/$helper" "/usr/local/bin/$helper" \
    "Dockerfile does not preserve and install transitive instance-state helper: $helper"
done

printf '\n✓ Static packaging layout assertions passed.\n'
