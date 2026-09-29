#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
mkdir -p "$TMP_DIR/verbose" "$TMP_DIR/terse"

cat > "$TMP_DIR/verbose/token-ledger.jsonl" <<'JSONL'
{"phase":"scouting","input_tokens":800,"cache_creation_tokens":100,"cache_read_tokens":0,"output_tokens":100,"total_tokens":1000,"estimated_cost_usd":0.001,"pricing_model":"model-a"}
{"phase":"coding","input_tokens":900,"cache_creation_tokens":0,"cache_read_tokens":300,"output_tokens":200,"total_tokens":1400,"estimated_cost_usd":0.002,"pricing_model":"model-b"}
JSONL
cat > "$TMP_DIR/terse/token-ledger.jsonl" <<'JSONL'
{"phase":"scouting","input_tokens":700,"cache_creation_tokens":0,"cache_read_tokens":0,"output_tokens":80,"total_tokens":780,"estimated_cost_usd":0.0008,"pricing_model":"model-a"}
JSONL

node "$ROOT_DIR/scripts/render-caveman-impact-report.mjs" \
  "$TMP_DIR/verbose" "$TMP_DIR/terse" 'Fix parser' 'owner/repo' 'main' '2026-09-29T10:00:00.000Z' 0 0 \
  > "$TMP_DIR/report.md"

grep -Fq 'Context tokens | 2,100 | 700' "$TMP_DIR/report.md"
grep -Fq 'Estimated cost | $0.0030 | $0.0008' "$TMP_DIR/report.md"
grep -Fq 'Both run exit codes: 0 / 0' "$TMP_DIR/report.md"
grep -Fq 'does not establish that outcomes are equivalent' "$TMP_DIR/report.md"
if grep -Fq '${TASK_PROMPT}' "$TMP_DIR/report.md" || grep -Fq '$0.50/1M' "$TMP_DIR/report.md"; then
  echo 'Impact report contains an unexpanded placeholder or guessed flat pricing.' >&2
  exit 1
fi

echo '✓ Caveman impact report uses all-phase ledger, configured cost, and cautious outcome wording'
