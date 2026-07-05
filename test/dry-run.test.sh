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
VALIDATION_HELPERS="$REPO_ROOT/scripts/validation-helpers.sh"

pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }

assert_json_field_equals() {
  local file="$1" field="$2" expected="$3" contract_message="$4"
  node -e 'const fs=require("fs");const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const v=o[process.argv[2]];if(String(v)!==process.argv[3]){throw new Error(`${process.argv[1]} ${process.argv[2]} expected ${process.argv[3]} got ${String(v)}`)}' "$file" "$field" "$expected" \
    || fail "$contract_message: expected JSON field '$field' to equal '$expected' in $file"
}

assert_file_empty() {
  local file="$1" contract_message="$2"
  [ -f "$file" ] || fail "$contract_message: expected helper-owned artifact to exist at $file"
  [ ! -s "$file" ] || fail "$contract_message: expected helper-owned artifact to be empty at $file"
}

assert_file_contains() {
  local file="$1" expected="$2" contract_message="$3"
  [ -f "$file" ] || fail "$contract_message: expected public artifact to exist at $file"
  rg --fixed-strings --quiet "$expected" "$file" || fail "$contract_message: expected public artifact to contain '$expected' at $file"
}

run_test() {
  local test_name="$1" description="$2"
  "$test_name"
  pass "$description"
}

command -v rg >/dev/null 2>&1 || fail "ripgrep is required for file content assertions"
command -v node >/dev/null 2>&1 || fail "Node.js is required for JSON assertions"
[ -x "$HELPERS" ] || fail "Expected executable helper: $HELPERS"
[ -r "$VALIDATION_HELPERS" ] || fail "Expected readable helper: $VALIDATION_HELPERS"

tmp_root="$(mktemp -d)"
trap 'rm -rf "$tmp_root"' EXIT

test_host_start_serializes_public_contract() (
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

  # The Docker-backed integration test already proves a dry-run invocation writes
  # host-start.json. Keep this unit case focused on helper-only serialization
  # details that are not otherwise exercised end-to-end.
  assert_json_field_equals "$result_dir/host-start.json" instance "kaseki-helper-test" "host-start helper contract preserves instance"
  assert_json_field_equals "$result_dir/host-start.json" repo_url "https://example.invalid/repo.git" "host-start helper contract preserves repository URL"
  assert_json_field_equals "$result_dir/host-start.json" git_ref "feature/dry-run-helper" "host-start helper contract preserves git ref"
  assert_json_field_equals "$result_dir/host-start.json" startup_check_mode "all" "host-start helper contract preserves startup-check mode"
)

test_initialize_dry_run_agent_artifacts_truncates_helper_files() (
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

  # End-to-end dry-run coverage already asserts pi-events.jsonl and
  # validation-timings.tsv are initialized. Retain the helper-owned placeholders
  # that only this initialization helper test covers directly.
  for artifact in \
    pi-summary.json \
    validation.log \
    validation-raw.log \
    validation-env.log; do
    assert_file_empty "$result_dir/$artifact" "dry-run initialization contract resets helper-owned artifacts"
  done
)

test_startup_check_writes_stable_public_fields() (
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

  # The integration test covers metadata.json dry_run. This helper-level
  # contract protects the additional startup metadata fields and marker emitted
  # by scripts/dry-run-artifacts.sh itself.
  assert_json_field_equals "$result_dir/metadata.json" startupCheck true "metadata helper contract exposes legacy startupCheck flag"
  assert_json_field_equals "$result_dir/metadata.json" startup_check true "metadata helper contract exposes startup_check flag"
  assert_json_field_equals "$result_dir/metadata.json" dryRun true "metadata helper contract exposes legacy dryRun flag"
  assert_json_field_equals "$result_dir/metadata.json" exit_code 0 "metadata helper contract reports successful startup-check exit"
  assert_json_field_equals "$result_dir/metadata.json" current_stage "startup check" "metadata helper contract reports startup-check stage"
  assert_json_field_equals "$result_dir/metadata.json" pi_version "pi fake 0.0.0" "metadata helper contract reports detected Pi CLI version"
  assert_file_contains "$result_dir/startup-check.txt" "startup_check=ok" "startup-check helper contract writes ok marker"
)

test_validation_commands_skip_side_effects_in_dry_run() (
  set -euo pipefail
  # shellcheck source=../scripts/validation-helpers.sh
  . "$VALIDATION_HELPERS"

  local result_dir="$tmp_root/validation/results"
  local workspace_dir="$tmp_root/validation/workspace"
  local marker="$tmp_root/validation/validation-ran"
  mkdir -p "$result_dir" "$workspace_dir/repo"

  set_current_stage() { printf '%s\n' "$1" > "$result_dir/current-stage.txt"; }
  emit_progress() { :; }
  record_stage_timing() { printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "${4:-}" >> "$result_dir/validation-timings.tsv"; }

  local validation_exit=99
  local validation_detail="unexpected-detail"
  local validation_reason="unexpected-reason"
  local validation_stopped="unexpected-stopped"
  local validation_attempted="unexpected-attempted"

  KASEKI_DRY_RUN=1 run_validation_commands \
    "post-agent validation" \
    "printf SHOULD_NOT_RUN > '$marker'" \
    "$result_dir/validation.log" \
    "$result_dir/validation-raw.log" \
    "$result_dir/validation-timings.tsv" \
    "$result_dir/validation-env.log" \
    "validation_command_failed" \
    validation_exit \
    validation_detail \
    validation_reason \
    validation_stopped \
    validation_attempted \
    "$workspace_dir" \
    "$result_dir"

  [ "$validation_exit" = "0" ] || fail "dry-run validation helper contract reports success without executing commands"
  [ ! -e "$marker" ] || fail "dry-run validation helper contract skips command side effects"
  assert_file_contains "$result_dir/validation.log" "DRY-RUN MODE" "dry-run validation helper contract announces skipped execution"
  assert_file_contains "$result_dir/validation-timings.tsv" "dry_run=true" "dry-run validation helper contract records skipped execution timing"
)

run_test test_host_start_serializes_public_contract \
  "host-start.json: write_dry_run_host_start_artifact serializes helper-only contract fields"
run_test test_initialize_dry_run_agent_artifacts_truncates_helper_files \
  "initialized helper files: initialize_dry_run_agent_artifacts resets helper-only placeholders"
run_test test_startup_check_writes_stable_public_fields \
  "startup metadata: write_dry_run_startup_check_artifacts writes helper-only metadata fields"
run_test test_validation_commands_skip_side_effects_in_dry_run \
  "validation-command side effects: run_validation_commands suppresses execution in dry-run mode"

printf '\n✅ Fast dry-run helper tests passed!\n'
