#!/usr/bin/env bash
# shellcheck disable=SC2016,SC1091
# Fast dry-run artifact tests for the helper boundary used by run-kaseki.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HELPERS="$REPO_ROOT/scripts/dry-run-artifacts.sh"

pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }

assert_json_field_equals() {
  local file="$1" field="$2" expected="$3"
  node -e 'const fs=require("fs");const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const v=o[process.argv[2]];if(String(v)!==process.argv[3]){throw new Error(`${process.argv[1]} ${process.argv[2]} expected ${process.argv[3]} got ${String(v)}`)}' "$file" "$field" "$expected" \
    || fail "Expected $file field $field to equal $expected"
}

assert_file_empty() {
  local file="$1"
  [ -f "$file" ] || fail "Expected file to exist: $file"
  [ ! -s "$file" ] || fail "Expected empty file: $file"
}

assert_file_contains() {
  local file="$1" expected="$2"
  [ -f "$file" ] || fail "Expected file to exist: $file"
  rg --fixed-strings --quiet "$expected" "$file" || fail "Expected $file to contain: $expected"
}

command -v rg >/dev/null 2>&1 || fail "ripgrep is required for file content assertions"

command -v node >/dev/null 2>&1 || fail "Node.js is required for JSON assertions"
[ -x "$HELPERS" ] || fail "Expected executable helper: $HELPERS"

tmp_root="$(mktemp -d)"
trap 'rm -rf "$tmp_root"' EXIT

case_host_start_sets_dry_run() (
  set -euo pipefail
  # shellcheck source=../scripts/dry-run-artifacts.sh
  . "$HELPERS"

  local result_dir="$tmp_root/host-start"
  KASEKI_DRY_RUN=1 write_dry_run_host_start_artifact "$result_dir"

  assert_json_field_equals "$result_dir/host-start.json" dry_run 1
)

case_startup_check_initializes_artifacts() (
  set -euo pipefail
  # shellcheck source=../scripts/dry-run-artifacts.sh
  . "$HELPERS"

  local result_dir="$tmp_root/startup/results"
  local fake_bin="$tmp_root/startup/bin"
  local workspace_dir="$tmp_root/startup/workspace"
  local cache_dir="$tmp_root/startup/cache"
  mkdir -p "$fake_bin" "$workspace_dir" "$cache_dir"

  cat > "$fake_bin/pi" <<'PI'
#!/usr/bin/env bash
printf 'pi fake 0.0.0\n'
PI
  chmod +x "$fake_bin/pi"

  PATH="$fake_bin:$PATH" \
    KASEKI_DRY_RUN=1 \
    KASEKI_WORKSPACE_DIR="$workspace_dir" \
    KASEKI_CACHE_DIR="$cache_dir" \
    write_dry_run_startup_check_artifacts "$result_dir" >/dev/null

  assert_json_field_equals "$result_dir/metadata.json" startupCheck true
  assert_json_field_equals "$result_dir/metadata.json" startup_check true
  assert_json_field_equals "$result_dir/metadata.json" dryRun true
  assert_json_field_equals "$result_dir/metadata.json" dry_run 1
  assert_json_field_equals "$result_dir/metadata.json" exit_code 0
  assert_json_field_equals "$result_dir/metadata.json" current_stage "startup check"
  assert_json_field_equals "$result_dir/metadata.json" pi_version "pi fake 0.0.0"
  assert_file_contains "$result_dir/startup-check.txt" "startup_check=ok"
  assert_file_empty "$result_dir/pi-events.jsonl"
  assert_file_empty "$result_dir/pi-summary.json"
  assert_file_empty "$result_dir/validation-timings.tsv"
  assert_file_empty "$result_dir/validation.log"
)

case_validation_commands_are_not_executed() (
  set -euo pipefail
  # shellcheck source=../scripts/dry-run-artifacts.sh
  . "$HELPERS"

  local result_dir="$tmp_root/no-validation/results"
  local fake_bin="$tmp_root/no-validation/bin"
  local validation_marker="$tmp_root/no-validation/validation-ran"
  mkdir -p "$fake_bin" "$tmp_root/no-validation/workspace" "$tmp_root/no-validation/cache"

  cat > "$fake_bin/pi" <<'PI'
#!/usr/bin/env bash
printf 'pi fake 0.0.0\n'
PI
  chmod +x "$fake_bin/pi"

  KASEKI_DRY_RUN=1 \
    KASEKI_VALIDATION_COMMANDS="printf SHOULD_NOT_RUN > '$validation_marker'" \
    write_dry_run_host_start_artifact "$result_dir"

  PATH="$fake_bin:$PATH" \
    KASEKI_DRY_RUN=1 \
    KASEKI_VALIDATION_COMMANDS="printf SHOULD_NOT_RUN > '$validation_marker'" \
    KASEKI_WORKSPACE_DIR="$tmp_root/no-validation/workspace" \
    KASEKI_CACHE_DIR="$tmp_root/no-validation/cache" \
    write_dry_run_startup_check_artifacts "$result_dir" >/dev/null

  [ ! -e "$validation_marker" ] || fail "Validation command should not execute in dry-run helper paths"
)

case_host_start_sets_dry_run
pass "write_dry_run_host_start_artifact writes host-start.json with dry_run=1"

case_startup_check_initializes_artifacts
pass "write_dry_run_startup_check_artifacts initializes startup artifacts"

case_validation_commands_are_not_executed
pass "validation commands are not executed by dry-run helper paths"

printf '\n✅ Fast dry-run artifact tests passed!\n'
