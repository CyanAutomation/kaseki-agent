#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Source only the allowlist matcher helpers, without running a full Kaseki job.
# shellcheck source=scripts/allowlist-helper.sh
. "$ROOT_DIR/scripts/allowlist-helper.sh"

matches_allowlist() {
  local allowlist="$1" file="$2" regex
  regex="$(build_allowlist_regex "$allowlist")"
  [ -n "$regex" ] && printf '%s\n' "$file" | grep -Eq "^(${regex})$"
}

assert_matches() {
  local allowlist="$1" file="$2"
  if ! matches_allowlist "$allowlist" "$file"; then
    printf 'Expected allowlist pattern to match file:\n  pattern: %s\n  file:    %s\n' "$allowlist" "$file" >&2
    exit 1
  fi
}

assert_not_matches() {
  local allowlist="$1" file="$2"
  if matches_allowlist "$allowlist" "$file"; then
    printf 'Expected allowlist pattern not to match file:\n  pattern: %s\n  file:    %s\n' "$allowlist" "$file" >&2
    exit 1
  fi
}

assert_matches 'src/lib/parser.ts' 'src/lib/parser.ts'
assert_not_matches 'src/lib/parser.ts' 'src/lib/parser.tsx'
assert_not_matches 'src/lib/parser.ts' 'src/lib/parserats'
assert_not_matches 'src/lib/parser.ts' 'README.md'
assert_not_matches 'src/lib/parser.ts' 'package.json'

assert_matches 'src/**/*.ts' 'src/index.ts'
assert_matches 'src/**/*.ts' 'src/lib/file-storage.ts'
assert_not_matches 'src/**/*.ts' 'src/lib/file-storage.tsx'
assert_not_matches 'src/**/*.ts' 'README.md'
assert_not_matches 'src/**/*.ts' 'package.json'

assert_matches 'src/**/*.tsx' 'src/app/page.tsx'
assert_matches 'src/**/*.tsx' 'src/components/plugin-manager.tsx'
assert_not_matches 'src/**/*.tsx' 'src/components/plugin-manager.ts'
assert_not_matches 'src/**/*.tsx' 'README.md'
assert_not_matches 'src/**/*.tsx' 'package.json'

assert_matches 'docs/v?.md' 'docs/v1.md'
assert_not_matches 'docs/v?.md' 'docs/v10.md'
assert_not_matches 'docs/v?.md' 'docs/nested/v1.md'

assert_matches 'src/file+(test).ts' 'src/file+(test).ts'
assert_not_matches 'src/file+(test).ts' 'src/fileeeeeeeee.ts'
assert_not_matches 'src/file+(test).ts' 'src/filetest.ts'
assert_matches 'src/{literal}|^$.ts' 'src/{literal}|^$.ts'
assert_not_matches 'src/{literal}|^$.ts' 'src/literal.ts'
assert_matches 'src/[draft]/file.name(1).ts' 'src/[draft]/file.name(1).ts'
assert_not_matches 'src/[draft]/file.name(1).ts' 'src/d/filexname1.ts'
