#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

assert_json_array_contains() {
  local file="$1"
  local expression="$2"
  local message="$3"

  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const [file, expression] = process.argv.slice(1);
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(pkg.files) || !pkg.files.includes(expression)) {
      process.exit(1);
    }
  ' "$file" "$expression" || {
    printf '%s\n' "$message" >&2
    exit 1
  }
}

# npm consumers need scripts/ because startup-check-packaging.sh declares runtime paths and symlink behavior.
assert_json_array_contains package.json scripts/ \
  'package.json files does not include scripts/ for npm package startup-check declarations'

printf '\n✓ Package manifest assertions passed.\n'
