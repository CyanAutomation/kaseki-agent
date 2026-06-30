#!/usr/bin/env bash
# shellcheck disable=SC2016,SC1091
# Fast unit tests for pure helpers in scripts/dry-run-artifacts.sh.
# Broader run-kaseki.sh/startup integration tests assert the dry-run artifact set
# end-to-end (metadata.json, host-start.json, and empty placeholder files), so
# this file only protects helper-level contracts and stable public fields.
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

case_host_start_serializes_helper_inputs() (
  set -euo pipefail
  # shellcheck source=../scripts/dry-run-artifacts.sh
  . "$HELPERS"

  local result_dir="$tmp_root/host-start"
  mkdir -p "$result_dir"

  INSTANCE="kaseki-helper-test" \
    REPO_URL="https://example.invalid/repo.git" \
    GIT_REF="feature/dry-run-helper" \
    KASEKI_DRY_RUN=1 \
    KASEKI_STARTUP_CHECK_MODE="all" \
    write_dry_run_host_start_artifact "$result_dir"

  assert_json_field_equals "$result_dir/host-start.json" instance "kaseki-helper-test"
  assert_json_field_equals "$result_dir/host-start.json" repo_url "https://example.invalid/repo.git"
  assert_json_field_equals "$result_dir/host-start.json" git_ref "feature/dry-run-helper"
  assert_json_field_equals "$result_dir/host-start.json" dry_run 1
  assert_json_field_equals "$result_dir/host-start.json" startup_check_mode "all"
)

case_initialize_dry_run_agent_artifacts_truncates_helper_files() (
  set -euo pipefail
  # shellcheck source=../scripts/dry-run-artifacts.sh
  . "$HELPERS"

  local result_dir="$tmp_root/init-artifacts"
  mkdir -p "$result_dir"
  for artifact in \
    pi-events.jsonl \
    pi-summary.json \
    validation-timings.tsv \
    validation.log \
    validation-raw.log \
    validation-env.log; do
    printf 'stale content\n' > "$result_dir/$artifact"
  done

  initialize_dry_run_agent_artifacts "$result_dir"

  for artifact in \
    pi-events.jsonl \
    pi-summary.json \
    validation-timings.tsv \
    validation.log \
    validation-raw.log \
    validation-env.log; do
    assert_file_empty "$result_dir/$artifact"
  done
)

case_startup_check_writes_stable_public_fields() (
  set -euo pipefail
  # shellcheck source=../scripts/dry-run-artifacts.sh
  . "$HELPERS"

  local result_dir="$tmp_root/startup/results"
  local fake_bin="$tmp_root/startup/bin"
  local workspace_dir="$tmp_root/startup/workspace"
  local cache_dir="$tmp_root/startup/cache"
  mkdir -p "$result_dir" "$fake_bin" "$workspace_dir" "$cache_dir"

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

  # Stable public dry-run startup outputs: metadata exposes both legacy camelCase
  # and snake_case flags, a successful startup-check exit/stage, and the detected
  # Pi CLI version; startup-check.txt exposes the machine-readable ok marker.
  assert_json_field_equals "$result_dir/metadata.json" startupCheck true
  assert_json_field_equals "$result_dir/metadata.json" startup_check true
  assert_json_field_equals "$result_dir/metadata.json" dryRun true
  assert_json_field_equals "$result_dir/metadata.json" dry_run 1
  assert_json_field_equals "$result_dir/metadata.json" exit_code 0
  assert_json_field_equals "$result_dir/metadata.json" current_stage "startup check"
  assert_json_field_equals "$result_dir/metadata.json" pi_version "pi fake 0.0.0"
  assert_file_contains "$result_dir/startup-check.txt" "startup_check=ok"
)

case_host_start_serializes_helper_inputs
pass "write_dry_run_host_start_artifact serializes helper inputs"

case_initialize_dry_run_agent_artifacts_truncates_helper_files
pass "initialize_dry_run_agent_artifacts creates empty helper-owned files"

case_startup_check_writes_stable_public_fields
pass "write_dry_run_startup_check_artifacts writes stable public fields"

printf '\n✅ Fast dry-run helper tests passed!\n'
