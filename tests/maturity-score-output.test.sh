#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
created_app_script=0
trap 'rm -rf "$TMP_DIR"; if [ "$created_app_script" = "1" ]; then rm -f /app/scripts/kaseki-maturity-score.sh; fi' EXIT

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

if [ -e /app/scripts/kaseki-maturity-score.sh ]; then
  printf 'Refusing to replace existing /app/scripts/kaseki-maturity-score.sh during test.\n' >&2
  exit 1
fi

mkdir -p /app/scripts
cat > /app/scripts/kaseki-maturity-score.sh <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "${KASEKI_MATURITY_SCORE_STDOUT:-unset}" >"${KASEKI_TEST_INVOCATION_ENV_FILE:?}"
printf '%s\n%s\n' "${1:-}" "${2:-}" >"${KASEKI_TEST_INVOCATION_ARGS_FILE:?}"
printf '{"total_score":100,"categories":{}}\n' >"${2:?}"
SH
chmod +x /app/scripts/kaseki-maturity-score.sh
created_app_script=1

agent_maturity_block="$(
  awk '
    /# Calculate and record maturity score without leaking artifact JSON into live logs\./ { collecting=1 }
    collecting && /# Calculate and record performance metrics/ { exit }
    collecting { print }
  ' "$ROOT_DIR/kaseki-agent.sh"
)"

if [ -z "$agent_maturity_block" ]; then
  printf 'Failed to extract maturity block from kaseki-agent.sh\n' >&2
  exit 1
fi

workspace_dir="$TMP_DIR/workspace"
results_dir="$TMP_DIR/results"
mkdir -p "$workspace_dir/repo" "$results_dir"

KASEKI_TEST_INVOCATION_ENV_FILE="$TMP_DIR/invocation-env" \
KASEKI_TEST_INVOCATION_ARGS_FILE="$TMP_DIR/invocation-args" \
KASEKI_WORKSPACE_DIR="$workspace_dir" \
KASEKI_RESULTS_DIR="$results_dir" \
bash -c "$agent_maturity_block"

test "$(cat "$TMP_DIR/invocation-env")" = "0"
test -s "$results_dir/maturity-score.json"
grep -Fq "maturity-score: wrote $results_dir/maturity-score.json" "$results_dir/maturity-score.log"
grep -Fxq "$workspace_dir/repo" "$TMP_DIR/invocation-args"
grep -Fxq "$results_dir/maturity-score.json" "$TMP_DIR/invocation-args"

missing_workspace_dir="$TMP_DIR/missing-workspace"
missing_results_dir="$TMP_DIR/missing-results"
mkdir -p "$missing_workspace_dir" "$missing_results_dir"
rm -f "$TMP_DIR/invocation-env" "$TMP_DIR/invocation-args"

KASEKI_TEST_INVOCATION_ENV_FILE="$TMP_DIR/invocation-env" \
KASEKI_TEST_INVOCATION_ARGS_FILE="$TMP_DIR/invocation-args" \
KASEKI_WORKSPACE_DIR="$missing_workspace_dir" \
KASEKI_RESULTS_DIR="$missing_results_dir" \
bash -c "$agent_maturity_block"

grep -Fq "maturity-score: skipped because repo checkout is missing: $missing_workspace_dir/repo" "$missing_results_dir/maturity-score.log"
test ! -e "$missing_results_dir/maturity-score.json"
test ! -e "$TMP_DIR/invocation-env"

printf '✓ Maturity score stdout behavior assertions passed.\n'
