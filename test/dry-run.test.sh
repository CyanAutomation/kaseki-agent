#!/usr/bin/env bash
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

command -v node >/dev/null 2>&1 || fail "Node.js is required for JSON assertions"
[ -x "$HELPERS" ] || fail "Expected executable helper: $HELPERS"

tmp_root="$(mktemp -d)"
trap 'rm -rf "$tmp_root"' EXIT
result_dir="$tmp_root/results"
fake_bin="$tmp_root/bin"
validation_marker="$tmp_root/validation-ran"
mkdir -p "$result_dir" "$fake_bin" "$tmp_root/workspace" "$tmp_root/cache"

cat > "$fake_bin/pi" <<'PI'
#!/usr/bin/env bash
printf 'pi fake 0.0.0\n'
PI
chmod +x "$fake_bin/pi"

export PATH="$fake_bin:$PATH"
export INSTANCE="kaseki-fast-dry-run"
export REPO_URL="https://example.test/repo.git"
export GIT_REF="main"
export KASEKI_PROVIDER="gateway"
export KASEKI_MODEL="auto"
export KASEKI_TASK_MODE="patch"
export KASEKI_ALLOW_EMPTY_DIFF="0"
export KASEKI_DRY_RUN="1"
export KASEKI_STARTUP_CHECK_MODE="boot"
export KASEKI_CONTAINER_USER="$(id -u):$(id -g)"
export KASEKI_CHANGED_FILES_ALLOWLIST="src/** test/**"
export MAX_DIFF_BYTES_VALUE="400000"
export AGENT_TIMEOUT_SECONDS_VALUE="10800"
export IMAGE="dry-run-fast-test:latest"
export CACHE="$tmp_root/cache"
export KASEKI_RESULTS_DIR="$result_dir"
export KASEKI_WORKSPACE_DIR="$tmp_root/workspace"
export KASEKI_CACHE_DIR="$tmp_root/cache"
export KASEKI_VALIDATION_COMMANDS="printf SHOULD_NOT_RUN > '$validation_marker'"

# shellcheck source=../scripts/dry-run-artifacts.sh
. "$HELPERS"
write_dry_run_host_start_artifact "$result_dir"
write_dry_run_startup_check_artifacts "$result_dir" >/dev/null

assert_json_field_equals "$result_dir/host-start.json" dry_run 1
assert_json_field_equals "$result_dir/metadata.json" dry_run 1
pass "host-start.json and metadata.json include dry_run=1"

assert_file_empty "$result_dir/pi-events.jsonl"
assert_file_empty "$result_dir/pi-summary.json"
assert_file_empty "$result_dir/validation-timings.tsv"
assert_file_empty "$result_dir/validation.log"
pass "agent and validation output files are initialized empty"

[ ! -e "$validation_marker" ] || fail "Validation command should not execute in dry-run artifact helper"
pass "validation commands are not executed by the dry-run artifact helper"

printf '\n✅ Fast dry-run artifact tests passed!\n'
