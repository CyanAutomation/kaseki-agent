#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
# shellcheck source=../scripts/lib/maturity-score.sh
source "$ROOT_DIR/scripts/lib/maturity-score.sh"

fake_executable="$TMP_DIR/kaseki-maturity-score"
cat >"$fake_executable" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "${KASEKI_MATURITY_SCORE_STDOUT:-unset}" >"${KASEKI_TEST_INVOCATION_ENV_FILE:?}"
printf '%s\n%s\n' "${1:-}" "${2:-}" >"${KASEKI_TEST_INVOCATION_ARGS_FILE:?}"
printf '{"total_score":100,"categories":{}}\n' >"${2:?}"
SH
chmod +x "$fake_executable"
workspace_dir="$TMP_DIR/workspace"
results_dir="$TMP_DIR/results"
mkdir -p "$workspace_dir/repo" "$results_dir"

KASEKI_MATURITY_SCORE_EXECUTABLE="$fake_executable" \
KASEKI_TEST_INVOCATION_ENV_FILE="$TMP_DIR/invocation-env" \
KASEKI_TEST_INVOCATION_ARGS_FILE="$TMP_DIR/invocation-args" \
record_maturity_score "$workspace_dir" "$results_dir"
test "$(cat "$TMP_DIR/invocation-env")" = 0
jq -e '. == {total_score: 100, categories: {}}' "$results_dir/maturity-score.json" >/dev/null
grep -Fxq "maturity-score: wrote $results_dir/maturity-score.json" "$results_dir/maturity-score.log"
grep -Fxq "$workspace_dir/repo" "$TMP_DIR/invocation-args"
grep -Fxq "$results_dir/maturity-score.json" "$TMP_DIR/invocation-args"

missing_workspace_dir="$TMP_DIR/missing-workspace"
missing_results_dir="$TMP_DIR/missing-results"
mkdir -p "$missing_workspace_dir" "$missing_results_dir"
rm -f "$TMP_DIR/invocation-env" "$TMP_DIR/invocation-args"
KASEKI_MATURITY_SCORE_EXECUTABLE="$fake_executable" \
KASEKI_TEST_INVOCATION_ENV_FILE="$TMP_DIR/invocation-env" \
KASEKI_TEST_INVOCATION_ARGS_FILE="$TMP_DIR/invocation-args" \
record_maturity_score "$missing_workspace_dir" "$missing_results_dir"
grep -Fxq "maturity-score: skipped because repo checkout is missing: $missing_workspace_dir/repo" "$missing_results_dir/maturity-score.log"
test ! -e "$missing_results_dir/maturity-score.json"
test ! -e "$TMP_DIR/invocation-env"
printf '✓ Maturity score orchestration assertions passed.\n'
