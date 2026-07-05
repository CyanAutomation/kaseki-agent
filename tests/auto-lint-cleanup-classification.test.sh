#!/usr/bin/env bash
# shellcheck disable=SC1091,SC2034
# Tests cleanup command classification by sourcing the helper directly.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" || { echo "Error: Failed to determine repository root" >&2; exit 1; }
HELPER_PATH="$ROOT_DIR/scripts/auto-lint-cleanup-classification.sh"
if [[ ! -f "$HELPER_PATH" ]]; then
  echo "Error: auto-lint cleanup helper not found at $HELPER_PATH" >&2
  exit 1
fi
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

export KASEKI_WORKSPACE_DIR="$TMP_DIR"
export KASEKI_RESULTS_DIR="$TMP_DIR/results"

pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }
assert_file_contains() {
  local label="$1" needle="$2" file="$3"
  if grep -Fq -- "$needle" "$file"; then pass "$label"; else printf '--- %s ---\n' "$file" >&2; cat "$file" >&2 || true; fail "$label: expected to find '$needle'"; fi
}
assert_file_not_contains() {
  local label="$1" needle="$2" file="$3"
  if grep -Fq -- "$needle" "$file"; then printf '%s\n' "--- $file ---" >&2; cat "$file" >&2 || true; fail "$label: did not expect to find '$needle'"; else pass "$label"; fi
}
assert_equals() {
  local label="$1" expected="$2" actual="$3"
  [ "$actual" = "$expected" ] || fail "$label: expected '$expected', got '$actual'"
  pass "$label"
}

# Minimal npm helpers normally provided by kaseki-agent.sh before the helper is sourced.
npm_run_script_name() {
  local command="$1"
  local npm_run_regex='^npm[[:space:]]+run[[:space:]]+([^[:space:]-][^[:space:]-]*)($|[[:space:]])'
  if [[ "$command" =~ $npm_run_regex ]]; then printf '%s' "${BASH_REMATCH[1]}"; return 0; fi
  return 1
}
package_json_has_npm_script() {
  local script_name="$1"
  [ -f package.json ] || return 1
  node - "$script_name" <<'NODE'
const fs = require('fs');
const scriptName = process.argv[2];
try {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const scripts = pkg && typeof pkg.scripts === 'object' && pkg.scripts ? pkg.scripts : {};
  process.exit(Object.prototype.hasOwnProperty.call(scripts, scriptName) ? 0 : 1);
} catch { process.exit(1); }
NODE
}
missing_npm_script_for_validation_command() {
  local command="$1" script_name
  script_name="$(npm_run_script_name "$command")" || return 1
  package_json_has_npm_script "$script_name" && return 1
  printf '%s' "$script_name"
  return 0
}

# Source the helper under test directly.
# shellcheck source=scripts/auto-lint-cleanup-classification.sh
. "$HELPER_PATH"

set_current_stage() { :; }
emit_progress() { printf 'progress %s %s\n' "$1" "$2" >> "$TMP_DIR/results/progress.log"; }
emit_event() {
  printf '%s' "$1" >> "$TMP_DIR/results/events.log"; shift
  while [ "$#" -gt 0 ]; do printf ' %s' "$1" >> "$TMP_DIR/results/events.log"; shift; done
  printf '\n' >> "$TMP_DIR/results/events.log"
}
emit_error_event() { emit_event "error" "error_type=$1" "detail=$2" "recovery_action=${3:-continue}"; }
record_stage_timing() { printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "${4:-}" >> "$TMP_DIR/results/stage-timings.tsv"; }
check_auto_lint_cleanup_allowlist() { return 0; }

reset_workspace() {
  rm -rf "$TMP_DIR/repo" "$TMP_DIR/results"
  mkdir -p "$TMP_DIR/repo" "$TMP_DIR/results"
  : > "$TMP_DIR/results/auto-lint-cleanup.log"
  : > "$TMP_DIR/results/auto-lint-cleanup-timings.tsv"
  : > "$TMP_DIR/results/events.log"
  : > "$TMP_DIR/results/stage-timings.tsv"
  cd "$TMP_DIR/repo"
  git init --initial-branch=main -q
  git config user.email "test@kaseki.local"
  git config user.name "Test User"
  printf 'initial\n' > README.md
  git add README.md
  git commit -q -m initial

  AUTO_LINT_CLEANUP_LOG="$TMP_DIR/results/auto-lint-cleanup.log"
  AUTO_LINT_CLEANUP_TIMINGS_FILE="$TMP_DIR/results/auto-lint-cleanup-timings.tsv"
  KASEKI_AUTO_LINT_CLEANUP=1
  KASEKI_DRY_RUN=0
  KASEKI_TASK_MODE=implement
  KASEKI_SKIP_MISSING_NPM_SCRIPTS=1
}

case_skipped_cleanup() {
  reset_workspace
  cat > package.json <<'JSON'
{ "scripts": { "test": "node -e 'process.exit(0)'" } }
JSON
  : > "$TMP_DIR/results/git.diff"
  KASEKI_TASK_MODE="patch"
  KASEKI_AUTO_LINT_CLEANUP_COMMANDS='npm run lint:fix'
  run_auto_lint_cleanup_after_core_change_verified

  assert_equals 'skipped cleanup exits successfully' '0' "$AUTO_LINT_CLEANUP_EXIT"
  assert_equals 'skipped cleanup result' 'skipped' "$AUTO_LINT_CLEANUP_RESULT"
  assert_equals 'skipped cleanup classification' 'skipped_before_core_change_verified' "$AUTO_LINT_CLEANUP_CLASSIFICATION"
  assert_file_contains 'events classify cleanup skip before core change' 'auto_lint_cleanup_finished exit_code=0 result=skipped classification=skipped_before_core_change_verified reason=patch_diff_empty attempted_commands=0 skipped_commands=0' "$TMP_DIR/results/events.log"
  assert_file_not_contains 'skipped cleanup does not classify missing cleanup script' 'classification=missing_cleanup_command' "$AUTO_LINT_CLEANUP_LOG"
}

case_missing_npm_script() {
  reset_workspace
  cat > package.json <<'JSON'
{ "scripts": { "test": "node -e 'process.exit(0)'" } }
JSON
  KASEKI_AUTO_LINT_CLEANUP_COMMANDS='npm run lint:fix'
  run_auto_lint_cleanup

  assert_equals 'missing npm script exits successfully' '0' "$AUTO_LINT_CLEANUP_EXIT"
  assert_equals 'missing npm script result is warning' 'warning' "$AUTO_LINT_CLEANUP_RESULT"
  assert_equals 'missing npm script classification' 'missing_cleanup_command' "$AUTO_LINT_CLEANUP_CLASSIFICATION"
  assert_equals 'missing npm script recorded one skipped cleanup command' '1' "$AUTO_LINT_CLEANUP_COMMANDS_SKIPPED"
  assert_file_contains 'cleanup log records skipped lint:fix' 'skipped cleanup: package.json does not define npm script "lint:fix"' "$AUTO_LINT_CLEANUP_LOG"
  assert_file_contains 'events classify skipped lint:fix' 'auto_lint_cleanup_command_skipped command=npm run lint:fix reason=missing_cleanup_command' "$TMP_DIR/results/events.log"
}

case_missing_cleanup_tooling() {
  reset_workspace
  KASEKI_AUTO_LINT_CLEANUP_COMMANDS='__definitely_missing_cleanup_command__'
  run_auto_lint_cleanup

  assert_equals 'missing cleanup tooling preserves exit 127' '127' "$AUTO_LINT_CLEANUP_EXIT"
  assert_equals 'missing cleanup tooling result is failed' 'failed' "$AUTO_LINT_CLEANUP_RESULT"
  assert_equals 'missing cleanup tooling classification' 'command_not_found' "$AUTO_LINT_CLEANUP_CLASSIFICATION"
  assert_file_contains 'cleanup timings include command-not-found classification' 'classification=command_not_found' "$AUTO_LINT_CLEANUP_TIMINGS_FILE"
  assert_file_contains 'events classify command-not-found failure' 'auto_lint_cleanup_command_finished command=__definitely_missing_cleanup_command__ exit_code=127 classification=command_not_found' "$TMP_DIR/results/events.log"
}

case_successful_cleanup() {
  reset_workspace
  KASEKI_AUTO_LINT_CLEANUP_COMMANDS='true'
  run_auto_lint_cleanup

  assert_equals 'successful cleanup exits successfully' '0' "$AUTO_LINT_CLEANUP_EXIT"
  assert_equals 'successful cleanup result is passed' 'passed' "$AUTO_LINT_CLEANUP_RESULT"
  assert_equals 'successful cleanup classification' 'passed' "$AUTO_LINT_CLEANUP_CLASSIFICATION"
  assert_equals 'successful cleanup attempted one command' '1' "$AUTO_LINT_CLEANUP_COMMANDS_ATTEMPTED"
  assert_file_contains 'events classify successful cleanup command' 'auto_lint_cleanup_command_finished command=true exit_code=0 classification=passed' "$TMP_DIR/results/events.log"
}

case_artifact_event_classification() {
  reset_workspace
  cat > package.json <<'JSON'
{ "scripts": { "test": "node -e 'process.exit(0)'" } }
JSON
  KASEKI_AUTO_LINT_CLEANUP_COMMANDS='false;npm run lint:fix'
  run_auto_lint_cleanup

  assert_equals 'artifact event classification preserves failure exit' '1' "$AUTO_LINT_CLEANUP_EXIT"
  assert_equals 'artifact event classification preserves failure result' 'failed' "$AUTO_LINT_CLEANUP_RESULT"
  assert_equals 'artifact event classification preserves failure classification' 'lint_fix_error' "$AUTO_LINT_CLEANUP_CLASSIFICATION"
  assert_file_contains 'finished event preserves earlier failure classification' 'auto_lint_cleanup_finished exit_code=1 result=failed classification=lint_fix_error attempted_commands=1 skipped_commands=1' "$TMP_DIR/results/events.log"
  assert_file_contains 'cleanup timings include lint fix error classification' $'false\t1\t' "$AUTO_LINT_CLEANUP_TIMINGS_FILE"
  assert_file_contains 'cleanup timings include missing cleanup classification' 'classification=missing_cleanup_command' "$AUTO_LINT_CLEANUP_TIMINGS_FILE"
}

case_missing_cleanup_tooling
case_missing_npm_script
case_skipped_cleanup
case_successful_cleanup
case_artifact_event_classification

printf '\n✅ auto-lint cleanup classification tests passed\n'
