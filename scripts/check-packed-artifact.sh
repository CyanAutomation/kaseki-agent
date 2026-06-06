#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Canonical packed-artifact smoke coverage for the publish path. This replaces
# the legacy Docker-focused dist/lib packaging entry point by validating the
# produced npm artifact after build, installed in isolation with production
# dependencies only.
TMPDIR="$(mktemp -d "${TMPDIR:-/tmp}/kaseki-pack.XXXXXX")"
INSTALL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kaseki-install.XXXXXX")"
trap 'rm -rf "$TMPDIR"' EXIT

cd "$ROOT_DIR"

npm pack --pack-destination "$TMPDIR" >/dev/null

mapfile -t tgz_files < <(find "$TMPDIR" -maxdepth 1 -type f -name '*.tgz' -print)
if [[ "${#tgz_files[@]}" -ne 1 ]]; then
  printf 'Expected npm pack to create exactly one .tgz in %s, found %s\n' "$TMPDIR" "${#tgz_files[@]}" >&2
  exit 1
fi

package_tgz="${tgz_files[0]}"
# Install the tarball and only its declared production dependencies into a clean
# prefix so validation cannot accidentally use the repository's node_modules.
npm install \
  --prefix "$INSTALL_DIR" \
  --ignore-scripts \
  --omit=dev \
  --no-audit \
  --no-fund \
  "$package_tgz" >/dev/null

package_dir="$INSTALL_DIR/node_modules/@cyanautomation/kaseki-agent"
cli_file="$package_dir/dist/cli/KasekiCLI.js"
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

PACKED_PACKAGE_DIR="$package_dir" node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const packageDir = process.env.PACKED_PACKAGE_DIR;
const distDir = path.join(packageDir, 'dist');
const distLibDir = path.join(distDir, 'lib');
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

if (!packageDir || !fs.existsSync(distDir)) {
  console.error(`Packed dist directory does not exist: ${distDir}`);
  process.exit(1);
}

if (!fs.existsSync(distLibDir)) {
  console.error(`Packed artifact is missing expected directory: ${path.relative(packageDir, distLibDir)}`);
  process.exit(1);
}

const distLibModules = fs.readdirSync(distLibDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
  .map((entry) => path.join(distLibDir, entry.name));

if (distLibModules.length === 0) {
  console.error('Packed artifact contains no runtime modules in dist/lib/');
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

for (const modulePath of distLibModules) {
  try {
    await import(pathToFileURL(modulePath).href);
  } catch (error) {
    console.error(`Unable to import packed runtime module ${path.relative(packageDir, modulePath)}:`);
    console.error(error);
    throw error;
  }
}

console.log(`✓ Imported ${distLibModules.length} packed dist/lib runtime modules.`);
NODE

printf '✓ Packed artifact contains dist/lib runtime modules, SetupCommand.js dynamic import, and no extensionless relative dynamic imports.\n'
