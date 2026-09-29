#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

eval "$(awk '
  /^write_run_evaluation_fallback\(\)/ { capture=1; depth=0 }
  capture {
    print
    for (i = 1; i <= length($0); i++) {
      ch = substr($0, i, 1)
      if (ch == "{") depth++
      if (ch == "}") depth--
    }
    if (capture && depth == 0) exit
  }
' "$ROOT_DIR/kaseki-agent.sh")"

KASEKI_RESULTS_DIR="$TMP_DIR/results"
RUN_EVALUATION_ARTIFACT="$KASEKI_RESULTS_DIR/run-evaluation.json"
KASEKI_RUN_EVALUATION_MODEL="evaluator-model"
RUN_EVALUATION_ACTUAL_MODEL="unknown"
mkdir -p "$KASEKI_RESULTS_DIR"

write_run_evaluation_fallback 'typed_evaluation_unavailable' 'Error: missing required goal-check evidence'

grep -q 'typed_evaluation_unavailable' "$KASEKI_RESULTS_DIR/run-evaluation-stderr.log"
grep -q 'missing required goal-check evidence' "$KASEKI_RESULTS_DIR/run-evaluation-stderr.log"
node - "$RUN_EVALUATION_ARTIFACT" <<'NODE'
const fs = require('node:fs');
const result = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!result.warnings.includes('typed_evaluation_unavailable')) throw new Error('fallback warning was not retained');
NODE

printf 'run-evaluation-fallback-diagnostics.test.sh PASS\n'
