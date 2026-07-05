#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../scripts/validation-helpers.sh
source "$REPO_ROOT/scripts/validation-helpers.sh"

fail() { printf '✗ %s\n' "$1" >&2; exit 1; }
pass() { printf '✓ %s\n' "$1"; }

assert_equals() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  [ "$actual" = "$expected" ] || fail "$label: expected '$expected', got '$actual'"
  pass "$label"
}

assert_success() {
  local label="$1"
  shift
  if "$@"; then
    pass "$label"
  else
    fail "$label: expected success"
  fi
}

assert_failure() {
  local label="$1"
  shift
  if "$@"; then
    fail "$label: expected failure"
  else
    pass "$label"
  fi
}

write_package_json() {
  cat > package.json
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
mkdir -p "$tmp_dir/results"
cd "$tmp_dir"

STAGE_TIMINGS_FILE="$tmp_dir/results/stage-timings.tsv"
PROGRESS_LOG="$tmp_dir/results/progress.log"
ERROR_LOG="$tmp_dir/results/errors.log"
KASEKI_RESULTS_DIR="$tmp_dir/results"
export KASEKI_RESULTS_DIR STAGE_TIMINGS_FILE

: > "$STAGE_TIMINGS_FILE"
: > "$PROGRESS_LOG"
: > "$ERROR_LOG"
: > "$tmp_dir/results/pre-validation-ts-check.log"

echo "=== Decision: TypeScript precheck enabled by tsconfig.json ==="
write_package_json <<'JSON'
{}
JSON
cat > tsconfig.json <<'JSON'
{}
JSON
assert_success "has_typescript_project() detects tsconfig.json" has_typescript_project
assert_equals "construct_default_validation_commands() chooses tsc for tsconfig.json" \
  "tsc --noEmit" \
  "$(construct_default_validation_commands)"
rm tsconfig.json

echo "=== Decision: TypeScript precheck enabled by TypeScript dependency ==="
write_package_json <<'JSON'
{"devDependencies":{"typescript":"^5.0.0"}}
JSON
assert_success "has_typescript_project() detects TypeScript dependency" has_typescript_project
assert_equals "construct_default_validation_commands() chooses tsc for TypeScript dependency" \
  "tsc --noEmit" \
  "$(construct_default_validation_commands)"

echo "=== Decision: TypeScript precheck skipped for non-TypeScript package ==="
write_package_json <<'JSON'
{}
JSON
assert_failure "has_typescript_project() rejects package without TypeScript signals" has_typescript_project
assert_equals "construct_default_validation_commands() falls back when no scripts or TypeScript signals exist" \
  "npm run build;npm run type-check;npm run test" \
  "$(construct_default_validation_commands)"

echo "=== Decision: Build command enabled by package script ==="
write_package_json <<'JSON'
{"scripts":{"build":"tsc"}}
JSON
assert_success "package_json_has_npm_script() detects build script" package_json_has_npm_script build
assert_equals "construct_default_validation_commands() chooses npm build script" \
  "npm run build" \
  "$(construct_default_validation_commands)"

echo "=== Decision: Build command skipped because npm script is missing ==="
write_package_json <<'JSON'
{"scripts":{}}
JSON
assert_failure "package_json_has_npm_script() rejects missing build script" package_json_has_npm_script build
missing_script="$(missing_npm_script_for_validation_command 'npm run build')" || \
  fail "missing_npm_script_for_validation_command should report missing build script"
assert_equals "missing_npm_script_for_validation_command() reports observable missing script" \
  "build" \
  "$missing_script"

echo "=== Decision: Npm validation command maps to its package script ==="
script_name="$(npm_run_script_name 'npm run test -- --runInBand')" || \
  fail "npm_run_script_name should parse npm run command with arguments"
assert_equals "npm_run_script_name() extracts script name before trailing args" "test" "$script_name"
assert_failure "npm_run_script_name() rejects non-npm-run command" npm_run_script_name 'npx tsc --noEmit'

echo ""
echo "✅ TypeScript precheck auto-detection tests passed!"
