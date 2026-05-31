#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$ROOT_DIR/scripts/cleanup-trailing-whitespace.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() { printf '✗ %s\n' "$1" >&2; exit 1; }
pass() { printf '✓ %s\n' "$1"; }

assert_contains() {
  local file="$1" pattern="$2" label="$3"
  if grep -Fq -- "$pattern" "$file"; then
    pass "$label"
  else
    printf '%s\n' "--- $file ---" >&2
    cat "$file" >&2 || true
    fail "$label: expected to find '$pattern'"
  fi
}

cd "$TMP_DIR"
git init --initial-branch=main -q
git config user.email test@kaseki.local
git config user.name 'Test User'

mkdir -p src docs
printf 'const value = 1;\n' > src/app.ts
printf 'clean docs\n' > docs/guide.md
printf 'unchanged with spaces   \n' > docs/unchanged.md
printf 'remove me\n' > docs/deleted.md
printf 'opaque\n' > data.custom
python3 - <<'PY'
from pathlib import Path
Path('image.png').write_bytes(b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00')
PY

git add src/app.ts docs/guide.md docs/unchanged.md docs/deleted.md data.custom image.png
git commit -q -m initial

unchanged_before="$(git hash-object docs/unchanged.md)"

printf 'const value = 2;  \nconst other = 3;\t\n' > src/app.ts
printf 'changed docs   \n' > docs/guide.md
printf 'new text with spaces   \n' > data.custom
python3 - <<'PY'
from pathlib import Path
Path('image.png').write_bytes(b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00binary-change\x00')
PY
rm docs/deleted.md

export AUTO_LINT_CLEANUP_LOG="$TMP_DIR/auto-lint-cleanup.log"
bash "$HELPER" > "$TMP_DIR/helper.out"

if grep -Eq '[[:blank:]]$' src/app.ts docs/guide.md; then
  fail 'changed .ts and .md files should have trailing whitespace removed'
else
  pass 'changed .ts and .md files have trailing whitespace removed'
fi

unchanged_after="$(git hash-object docs/unchanged.md)"
[ "$unchanged_before" = "$unchanged_after" ] || fail 'unchanged file should not be rewritten'
pass 'unchanged file is not rewritten'

assert_contains "$AUTO_LINT_CLEANUP_LOG" 'Cleaned trailing whitespace: src/app.ts' 'logs cleaned TypeScript path'
assert_contains "$AUTO_LINT_CLEANUP_LOG" 'Cleaned trailing whitespace: docs/guide.md' 'logs cleaned Markdown path'
assert_contains "$AUTO_LINT_CLEANUP_LOG" 'Skipping binary diff: image.png' 'binary files are skipped'

if [ -e docs/deleted.md ]; then
  fail 'deleted file should remain deleted'
fi
if grep -Fq 'docs/deleted.md' "$AUTO_LINT_CLEANUP_LOG"; then
  fail 'deleted files should not be inspected or logged as touched'
fi
pass 'deleted files are skipped'

if grep -Eq '[[:blank:]]$' data.custom; then
  pass 'allowlist-disallowed changed text file is reported and left unchanged'
else
  fail 'allowlist-disallowed changed text file should not be cleaned'
fi
assert_contains "$AUTO_LINT_CLEANUP_LOG" 'Skipping disallowed text file extension: data.custom' 'allowlist-disallowed changed file is reported'

printf '\n✅ trailing whitespace cleanup tests passed\n'
