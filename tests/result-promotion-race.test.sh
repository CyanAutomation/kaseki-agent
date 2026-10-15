#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
eval "$(awk '/^promote_staging_dirs\(\)/ { emit=1 } /^initialize_result_artifacts$/ { exit } emit { print }' "$ROOT_DIR/run-kaseki.sh")"
RUNS="$tmp_dir/runs" RESULTS="$tmp_dir/results" INSTANCE=kaseki-450
RESULT_STAGE_DIR="$RESULTS/.staging-result-$INSTANCE-fixture"
FINAL_RESULT_DIR="$RESULTS/$INSTANCE"
PROMOTED_RESULT_DIR=0 KASEKI_KEEP_WORKSPACE=0
mkdir -p "$RESULT_STAGE_DIR" "$FINAL_RESULT_DIR"
printf 'timeout remains authoritative' > "$FINAL_RESULT_DIR/metadata.json"
printf 'partial worker metadata' > "$RESULT_STAGE_DIR/metadata.json"
printf 'worker validation evidence' > "$RESULT_STAGE_DIR/validation.log"
promote_staging_dirs
grep -q 'worker validation evidence' "$FINAL_RESULT_DIR/validation.log"
grep -q 'timeout remains authoritative' "$FINAL_RESULT_DIR/metadata.json"
[ ! -d "$FINAL_RESULT_DIR/$(basename "$RESULT_STAGE_DIR")" ]
[ "$PROMOTED_RESULT_DIR" -eq 1 ]
printf '✓ API timeout result directory cannot strand promoted worker evidence\n'
