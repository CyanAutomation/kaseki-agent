#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

repo_dir="$TMP_DIR/repo"
output_file="$TMP_DIR/maturity-score.json"
mkdir -p "$repo_dir"
cat > "$repo_dir/package.json" <<'JSON'
{"version":"1.0.0"}
JSON

stdout="$(
  bash "$ROOT_DIR/scripts/kaseki-maturity-score.sh" "$repo_dir" "$output_file"
)"

test -s "$output_file"
printf '%s\n' "$stdout" | grep -Fq '"total_score"'
printf '%s\n' "$stdout" | grep -Fq '"categories"'

quiet_stdout="$(
  KASEKI_MATURITY_SCORE_STDOUT=0 bash "$ROOT_DIR/scripts/kaseki-maturity-score.sh" "$repo_dir" "$TMP_DIR/quiet-maturity-score.json"
)"

test -s "$TMP_DIR/quiet-maturity-score.json"
if [ -n "$quiet_stdout" ]; then
  printf 'Expected quiet maturity score invocation to suppress stdout, got:\n%s\n' "$quiet_stdout" >&2
  exit 1
fi

grep -Fq 'KASEKI_MATURITY_SCORE_STDOUT=0 /app/scripts/kaseki-maturity-score.sh' "$ROOT_DIR/kaseki-agent.sh"
grep -Fq 'maturity-score: skipped because repo checkout is missing' "$ROOT_DIR/kaseki-agent.sh"

printf '✓ Maturity score stdout behavior assertions passed.\n'
