#!/bin/bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck source=../scripts/lib/artifact-consolidation.sh
source "$REPO_ROOT/scripts/lib/artifact-consolidation.sh"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

summary_file="$TMP_DIR/gateway-summary.json"
attempts_file="$TMP_DIR/provider-attempts.jsonl"
printf '{invalid json\n' > "$summary_file"
printf '{"error":{"message":"temporary failure"}}\n' > "$attempts_file"

if reconcile_gateway_summary "$summary_file" "$attempts_file" 2>/dev/null; then
  echo "Expected invalid gateway summary reconciliation to fail" >&2
  exit 1
fi
cmp -s "$summary_file" <(printf '{invalid json\n') || {
  echo "Failed reconciliation modified the original gateway summary" >&2
  exit 1
}
[ ! -e "${summary_file}.tmp" ] || {
  echo "Failed reconciliation left a temporary gateway summary" >&2
  exit 1
}

stage_timings="$TMP_DIR/stage-timings.tsv"
timings_manifest="$TMP_DIR/timings-manifest.json"
printf 'stage\texit_code\telapsed_seconds\tdetails\nvalidate\t0\t12\n' > "$stage_timings"
consolidate_timings_to_json "$timings_manifest" "$TMP_DIR/missing-validation.tsv" "$TMP_DIR/missing-pre-validation.tsv" "$stage_timings"
jq -e '.stage_timings == [{stage: "validate", exit_code: 0, elapsed_seconds: 12, details: ""}]' "$timings_manifest" >/dev/null

validation_timings="$TMP_DIR/validation-timings.tsv"
pre_validation_timings="$TMP_DIR/pre-validation-timings.tsv"
printf 'command\texit_code\telapsed_seconds\tdetails\nnpm run check\t0\t137\ttee_exit=0 filter_exit=0\nnpm run test\t1\t152\ttee_exit=0 filter_exit=0\n' > "$validation_timings"
printf 'command\texit_code\telapsed_seconds\tdetails\nnpm run check\t0\t141\ttee_exit=0 filter_exit=0\n' > "$pre_validation_timings"
consolidate_timings_to_json "$timings_manifest" "$validation_timings" "$pre_validation_timings" "$stage_timings"
jq -e '.validation_timings == [
  {command: "npm run check", exit_code: 0, elapsed_seconds: 137, details: "tee_exit=0 filter_exit=0"},
  {command: "npm run test", exit_code: 1, elapsed_seconds: 152, details: "tee_exit=0 filter_exit=0"}
]' "$timings_manifest" >/dev/null
jq -e '.pre_validation_timings == [
  {command: "npm run check", exit_code: 0, elapsed_seconds: 141, details: "tee_exit=0 filter_exit=0"}
]' "$timings_manifest" >/dev/null

echo "artifact consolidation tests passed"
