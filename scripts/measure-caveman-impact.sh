#!/usr/bin/env bash
# Compare Caveman-off and configured Caveman-on runs using all-phase ledgers.
#
# Usage:
#   TASK_PROMPT="Fix bug in auth" REPO_URL=org/repo ./scripts/measure-caveman-impact.sh
#   ./scripts/measure-caveman-impact.sh --task "Fix bug" --repo "org/repo"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TASK_PROMPT="${TASK_PROMPT:-Fix parser bug in src/parser.ts}"
REPO_URL="${REPO_URL:-CyanAutomation/crudmapper}"
GIT_REF="${GIT_REF:-main}"
OUTPUT_DIR="${OUTPUT_DIR:-/tmp/caveman-impact-$(date +%s)}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --task) TASK_PROMPT="$2"; shift 2 ;;
    --repo) REPO_URL="$2"; shift 2 ;;
    --ref) GIT_REF="$2"; shift 2 ;;
    --output) OUTPUT_DIR="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

mkdir -p "$OUTPUT_DIR"
VERBOSE_RESULTS="$OUTPUT_DIR/verbose"
TERSE_RESULTS="$OUTPUT_DIR/terse"
mkdir -p "$VERBOSE_RESULTS" "$TERSE_RESULTS"

run_arm() {
  local caveman="$1" results_dir="$2" label="$3"
  set +e
  KASEKI_CAVEMAN="$caveman" \
  TASK_PROMPT="$TASK_PROMPT" \
  REPO_URL="$REPO_URL" \
  GIT_REF="$GIT_REF" \
  KASEKI_RESULTS_DIR="$results_dir" \
    "$PROJECT_ROOT/run-kaseki.sh"
  RUN_EXIT_CODE=$?
  set -e
  if [ "$RUN_EXIT_CODE" -ne 0 ]; then
    echo "Warning: $label run failed (exit $RUN_EXIT_CODE)" >&2
  fi
}

echo "==> Running with KASEKI_CAVEMAN=0 (verbose mode)..."
run_arm 0 "$VERBOSE_RESULTS" verbose
VERBOSE_EXIT_CODE="$RUN_EXIT_CODE"

echo "==> Running with KASEKI_CAVEMAN=1 (configured Caveman mode)..."
run_arm 1 "$TERSE_RESULTS" terse
TERSE_EXIT_CODE="$RUN_EXIT_CODE"

REPORT_PATH="$OUTPUT_DIR/caveman-impact-report.md"
node "$PROJECT_ROOT/scripts/render-caveman-impact-report.mjs" \
  "$VERBOSE_RESULTS" "$TERSE_RESULTS" "$TASK_PROMPT" "$REPO_URL" "$GIT_REF" "$(date -Iseconds)" \
  "$VERBOSE_EXIT_CODE" "$TERSE_EXIT_CODE" \
  > "$REPORT_PATH"

echo "✓ Report generated: $REPORT_PATH"
echo
cat "$REPORT_PATH"
