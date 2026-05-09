#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMPDIR="$(mktemp -d "${TMPDIR:-/tmp}/kaseki-pack.XXXXXX")"
EXTRACT_DIR="$(mktemp -d "${TMPDIR}/extract.XXXXXX")"
trap 'rm -rf "$TMPDIR"' EXIT

cd "$ROOT_DIR"

npm pack --pack-destination "$TMPDIR" >/dev/null

mapfile -t tgz_files < <(find "$TMPDIR" -maxdepth 1 -type f -name '*.tgz' -print)
if [[ "${#tgz_files[@]}" -ne 1 ]]; then
  printf 'Expected npm pack to create exactly one .tgz in %s, found %s\n' "$TMPDIR" "${#tgz_files[@]}" >&2
  exit 1
fi

package_tgz="${tgz_files[0]}"
tar -xzf "$package_tgz" -C "$EXTRACT_DIR"

cli_file="$EXTRACT_DIR/package/dist/cli/KasekiCLI.js"
if [[ ! -f "$cli_file" ]]; then
  printf 'Packed artifact is missing expected file: package/dist/cli/KasekiCLI.js\n' >&2
  exit 1
fi

if grep -Fq "import('./commands/SetupCommand')" "$cli_file"; then
  printf 'Packed artifact contains extensionless SetupCommand dynamic import in package/dist/cli/KasekiCLI.js\n' >&2
  exit 1
fi

if ! grep -Fq "import('./commands/SetupCommand.js')" "$cli_file"; then
  printf 'Packed artifact is missing required SetupCommand.js dynamic import in package/dist/cli/KasekiCLI.js\n' >&2
  exit 1
fi

PACKED_DIST_DIR="$EXTRACT_DIR/package/dist" node <<'NODE'
const fs = require('fs');
const path = require('path');

const distDir = process.env.PACKED_DIST_DIR;
const pattern = /import\(\s*(['"])(\.{1,2}\/(?:[^'"]*?(?:\/|^))?[^'".\/]+)\1\s*\)/g;
const matches = [];

function findJavaScriptFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findJavaScriptFiles(entryPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      scanFile(entryPath);
    }
  }
}

function getLineAndColumn(content, index) {
  const beforeMatch = content.slice(0, index);
  const lines = beforeMatch.split('\n');
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  for (const match of content.matchAll(pattern)) {
    const { line, column } = getLineAndColumn(content, match.index || 0);
    matches.push({
      filePath: path.relative(distDir, filePath),
      line,
      column,
      specifier: match[2],
    });
  }
}

if (!distDir || !fs.existsSync(distDir)) {
  console.error(`Packed dist directory does not exist: ${distDir}`);
  process.exit(1);
}

findJavaScriptFiles(distDir);

if (matches.length > 0) {
  console.error('Found extensionless relative dynamic imports in packed artifact:');
  for (const match of matches) {
    console.error(`${match.filePath}:${match.line}:${match.column} import('${match.specifier}')`);
  }
  process.exit(1);
}
NODE

printf '✓ Packed artifact contains SetupCommand.js dynamic import and no extensionless relative dynamic imports.\n'
