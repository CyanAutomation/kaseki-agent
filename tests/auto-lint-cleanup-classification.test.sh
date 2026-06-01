#!/usr/bin/env bash
# shellcheck disable=SC1091,SC2034
# Tests cleanup command classification for missing tooling and npm scripts.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/kaseki-agent.sh"
if [[ ! -f "$SCRIPT_PATH" ]]; then
  echo "Error: kaseki-agent.sh not found at $SCRIPT_PATH" >&2
  exit 1
fi
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }
assert_file_contains() {
  local label="$1"
  local needle="$2"
  local file="$3"
  if grep -Fq -- "$needle" "$file"; then
    pass "$label"
  else
    printf '--- %s ---\n' "$file" >&2
    cat "$file" >&2 || true
    fail "$label: expected to find '$needle'"
  fi
}
assert_equals() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  [ "$actual" = "$expected" ] || fail "$label: expected '$expected', got '$actual'"
  pass "$label"
}

# Load the npm helpers and auto-lint cleanup function under test, redirecting
# container paths into this test's temporary workspace.
eval "$(awk '
  /^npm_run_script_name\(\)/ { emit=1 }
  /^has_typescript_project\(\)/ { emit=0 }
  emit { print }
  /^run_auto_lint_cleanup\(\)/ { cleanup=1 }
  /^run_validation_commands\(\)/ { cleanup=0 }
  cleanup { print }
' "$SCRIPT_PATH" | sed "s#/workspace/repo#$TMP_DIR/repo#g; s#/results#$TMP_DIR/results#g")"

auto_lint_cleanup_enabled_for_mode() { [ "$KASEKI_AUTO_LINT_CLEANUP" = "1" ] && [ "$KASEKI_DRY_RUN" != "1" ]; }
collect_changed_file_set() { : > "$1"; }
set_current_stage() { :; }
emit_progress() { printf 'progress %s %s\n' "$1" "$2" >> "$TMP_DIR/results/progress.log"; }
emit_event() {
  printf '%s' "$1" >> "$TMP_DIR/results/events.log"
  shift
  while [ "$#" -gt 0 ]; do
    printf ' %s' "$1" >> "$TMP_DIR/results/events.log"
    shift
  done
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
}

reset_workspace
cat > package.json <<'JSON'
{
  "scripts": {
    "test": "node -e 'process.exit(0)'"
  }
}
JSON
KASEKI_SKIP_MISSING_NPM_SCRIPTS=1
KASEKI_AUTO_LINT_CLEANUP_COMMANDS='npm run lint:fix'
run_auto_lint_cleanup

assert_equals 'missing lint:fix exits successfully' '0' "$AUTO_LINT_CLEANUP_EXIT"
assert_equals 'missing lint:fix result is warning' 'warning' "$AUTO_LINT_CLEANUP_RESULT"
assert_equals 'missing lint:fix classification is missing_cleanup_command' 'missing_cleanup_command' "$AUTO_LINT_CLEANUP_CLASSIFICATION"
assert_equals 'missing lint:fix attempted no cleanup commands' '0' "$AUTO_LINT_CLEANUP_COMMANDS_ATTEMPTED"
assert_equals 'missing lint:fix recorded one skipped cleanup command' '1' "$AUTO_LINT_CLEANUP_COMMANDS_SKIPPED"
assert_file_contains 'cleanup log records skipped lint:fix' 'skipped cleanup: package.json does not define npm script "lint:fix"' "$AUTO_LINT_CLEANUP_LOG"
assert_file_contains 'cleanup log records missing cleanup classification' 'classification=missing_cleanup_command' "$AUTO_LINT_CLEANUP_LOG"
assert_file_contains 'cleanup timings classify missing cleanup command' $'npm run lint:fix\tskipped\t' "$AUTO_LINT_CLEANUP_TIMINGS_FILE"
assert_file_contains 'cleanup timings include missing cleanup classification' 'classification=missing_cleanup_command' "$AUTO_LINT_CLEANUP_TIMINGS_FILE"
assert_file_contains 'events classify skipped lint:fix' 'auto_lint_cleanup_command_skipped command=npm run lint:fix reason=missing_cleanup_command' "$TMP_DIR/results/events.log"
assert_file_contains 'finished event reports warning classification' 'auto_lint_cleanup_finished exit_code=0 result=warning classification=missing_cleanup_command attempted_commands=0 skipped_commands=1' "$TMP_DIR/results/events.log"

reset_workspace
cat > package.json <<'JSON'
{
  "scripts": {
    "test": "node -e 'process.exit(0)'"
  }
}
JSON
KASEKI_SKIP_MISSING_NPM_SCRIPTS=1
KASEKI_AUTO_LINT_CLEANUP_COMMANDS='false;npm run lint:fix'
run_auto_lint_cleanup

assert_equals 'failed cleanup followed by missing script preserves exit' '1' "$AUTO_LINT_CLEANUP_EXIT"
assert_equals 'failed cleanup followed by missing script preserves result' 'failed' "$AUTO_LINT_CLEANUP_RESULT"
assert_equals 'failed cleanup followed by missing script preserves classification' 'lint_fix_error' "$AUTO_LINT_CLEANUP_CLASSIFICATION"
assert_equals 'failed cleanup followed by missing script records skipped command' '1' "$AUTO_LINT_CLEANUP_COMMANDS_SKIPPED"
assert_file_contains 'finished event preserves earlier failure classification' 'auto_lint_cleanup_finished exit_code=1 result=failed classification=lint_fix_error attempted_commands=1 skipped_commands=1' "$TMP_DIR/results/events.log"

reset_workspace
KASEKI_SKIP_MISSING_NPM_SCRIPTS=1
KASEKI_AUTO_LINT_CLEANUP_COMMANDS='__definitely_missing_cleanup_command__'
run_auto_lint_cleanup

assert_equals 'command-not-found cleanup preserves exit 127' '127' "$AUTO_LINT_CLEANUP_EXIT"
assert_equals 'command-not-found cleanup result is failed' 'failed' "$AUTO_LINT_CLEANUP_RESULT"
assert_equals 'command-not-found cleanup classification' 'command_not_found' "$AUTO_LINT_CLEANUP_CLASSIFICATION"
assert_equals 'command-not-found cleanup attempted one command' '1' "$AUTO_LINT_CLEANUP_COMMANDS_ATTEMPTED"
assert_file_contains 'cleanup log records command-not-found classification' 'classification=command_not_found' "$AUTO_LINT_CLEANUP_LOG"
assert_file_contains 'cleanup timings include command-not-found classification' 'classification=command_not_found' "$AUTO_LINT_CLEANUP_TIMINGS_FILE"
assert_file_contains 'events classify command-not-found failure' 'auto_lint_cleanup_command_finished command=__definitely_missing_cleanup_command__ exit_code=127 classification=command_not_found' "$TMP_DIR/results/events.log"

printf '\n✅ auto-lint cleanup classification tests passed\n'
