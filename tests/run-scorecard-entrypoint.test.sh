#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kaseki-run-scorecard.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

printf '{}\n' > "$TMP_DIR/metadata.json"
ln -s "$ROOT_DIR/dist/run-scorecard.js" "$TMP_DIR/kaseki-run-scorecard"

KASEKI_RESULTS_DIR="$TMP_DIR" "$TMP_DIR/kaseki-run-scorecard"
test -s "$TMP_DIR/run-scorecard.json"

printf '✓ Packaged scorecard entrypoint alias generated an artifact.\n'
