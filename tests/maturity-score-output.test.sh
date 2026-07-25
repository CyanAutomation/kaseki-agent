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
test "$stdout" = "$(cat "$output_file")"
jq -e '
  (.timestamp | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")) and
  (del(.timestamp) == {
    total_score: 3, max_score: 50, percentage: 6, rating: "Developing",
    categories: {
      setup_and_installation: {score: 1, max: 7},
      testing_and_quality: {score: 0, max: 5},
      cicd_and_automation: {score: 0, max: 5},
      documentation: {score: 0, max: 5},
      governance: {score: 0, max: 3},
      security: {score: 1, max: 4},
      operability: {score: 0, max: 4},
      performance_and_efficiency: {score: 0, max: 4},
      maintenance_and_sustainability: {score: 1, max: 3}
    }
  })
' "$output_file" >/dev/null

quiet_output="$TMP_DIR/quiet-maturity-score.json"
quiet_stdout="$(KASEKI_MATURITY_SCORE_STDOUT=0 bash "$ROOT_DIR/scripts/kaseki-maturity-score.sh" "$repo_dir" "$quiet_output")"
test -s "$quiet_output"
test -z "$quiet_stdout"
jq -e 'del(.timestamp) == (input | del(.timestamp))' "$output_file" "$quiet_output" >/dev/null
printf '✓ Maturity score output and quiet-mode assertions passed.\n'
