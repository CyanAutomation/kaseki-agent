#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
repo_dir="$TMP_DIR/repo"
output_file="$TMP_DIR/maturity-score.json"
mkdir -p "$repo_dir"
printf '{"version":"1.0.0"}\n' >"$repo_dir/package.json"
stdout="$(bash "$ROOT_DIR/scripts/kaseki-maturity-score.sh" "$repo_dir" "$output_file")"
test -s "$output_file"
node - "$output_file" "$stdout" <<'JS'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const artifact = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.deepEqual(JSON.parse(process.argv[3]), artifact);
assert.equal(artifact.total_score, 3);
assert.equal(artifact.max_score, 50);
assert.equal(artifact.percentage, 6);
assert.equal(artifact.rating, 'Developing');
assert.deepEqual(artifact.categories, {
  setup_and_installation: {score: 1, max: 7}, testing_and_quality: {score: 0, max: 5},
  cicd_and_automation: {score: 0, max: 5}, documentation: {score: 0, max: 5},
  governance: {score: 0, max: 3}, security: {score: 1, max: 4}, operability: {score: 0, max: 4},
  performance_and_efficiency: {score: 0, max: 4}, maintenance_and_sustainability: {score: 1, max: 3},
});
assert.match(artifact.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
JS
quiet_output="$TMP_DIR/quiet-maturity-score.json"
quiet_stdout="$(KASEKI_MATURITY_SCORE_STDOUT=0 bash "$ROOT_DIR/scripts/kaseki-maturity-score.sh" "$repo_dir" "$quiet_output")"
test -s "$quiet_output"
test -z "$quiet_stdout"
node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$quiet_output"
printf '✓ Maturity score output and quiet-mode assertions passed.\n'
