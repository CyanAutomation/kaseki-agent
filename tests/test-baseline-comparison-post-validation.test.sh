#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

eval "$(awk '
  /^analyze_test_failures_baseline\(\)/ { emit=1 }
  /^analyze_validation_failure_causality\(\)/ { emit=0 }
  emit { print }
' "$ROOT_DIR/kaseki-agent.sh")"

export KASEKI_RESULTS_DIR="$TMP_DIR/results"
mkdir -p "$KASEKI_RESULTS_DIR" "$TMP_DIR/bin"
export PATH="$TMP_DIR/bin:$PATH"

emit_progress() { printf '%s\n' "$*" >> "$KASEKI_RESULTS_DIR/progress.log"; }
emit_error_event() { printf '%s\n' "$*" >> "$KASEKI_RESULTS_DIR/events.log"; }

cat > "$TMP_DIR/bin/analyze-test-failures" <<'SH'
#!/usr/bin/env bash
printf '%s\n%s\n%s\n%s\n' "$1" "$2" "$3" "$4" > "$KASEKI_RESULTS_DIR/analyzer-args.txt"
printf '{"summary":{"total_newly_introduced":1}}\n' > "$3"
SH
chmod +x "$TMP_DIR/bin/analyze-test-failures"

printf 'PASS baseline.test.ts\nexit_code=0\n' > "$KASEKI_RESULTS_DIR/validation-baseline.log"
printf 'PASS pre.test.ts\nexit_code=0\n' > "$KASEKI_RESULTS_DIR/pre-validation.log"
printf 'FAIL post.test.ts\nexit_code=1\n' > "$KASEKI_RESULTS_DIR/validation.log"

analyze_test_failures_baseline "$KASEKI_RESULTS_DIR/validation.log"

expected_args="$KASEKI_RESULTS_DIR/validation-baseline.log
$KASEKI_RESULTS_DIR/validation.log
$KASEKI_RESULTS_DIR/test-baseline-comparison.json
$KASEKI_RESULTS_DIR"

if ! cmp -s "$KASEKI_RESULTS_DIR/analyzer-args.txt" <(printf '%s\n' "$expected_args"); then
  echo "Expected analyzer to compare baseline against post-validation log" >&2
  cat "$KASEKI_RESULTS_DIR/analyzer-args.txt" >&2
  exit 1
fi

jq -e '.summary.total_newly_introduced == 1' "$KASEKI_RESULTS_DIR/test-baseline-comparison.json" >/dev/null

echo "post-validation baseline comparison test passed"
