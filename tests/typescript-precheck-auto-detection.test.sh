#!/usr/bin/env bash
set -euo pipefail

fail() { printf '✗ %s\n' "$1" >&2; exit 1; }
pass() { printf '✓ %s\n' "$1"; }

# Define helper functions needed for detection
npm_run_script_name() {
  local command="$1"
  local npm_run_regex='^npm[[:space:]]+run[[:space:]]+([^[:space:]-][^[:space:]-]*)($|[[:space:]])'
  if [[ "$command" =~ $npm_run_regex ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return 0
  fi
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
} catch {
  process.exit(1);
}
NODE
}

has_typescript_project() {
  # Auto-detect TypeScript presence in the project
  [ -f tsconfig.json ] && return 0
  [ -f package.json ] || return 1
  node - <<'NODE'
try {
  const pkg = require('./package.json');
  const isDep = pkg.dependencies?.typescript || 
                pkg.devDependencies?.typescript ||
                pkg.optionalDependencies?.typescript;
  process.exit(isDep ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

has_npm_build_command() {
  local command="$1"
  local script_name
  script_name="$(npm_run_script_name "$command")" || return 1
  package_json_has_npm_script "$script_name" && return 0
  return 1
}

assert_equals() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  [ "$actual" = "$expected" ] || fail "$label: expected '$expected', got '$actual'"
  pass "$label"
}

assert_exit_code() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  [ "$actual" = "$expected" ] || fail "$label: expected exit code $expected, got $actual"
  pass "$label"
}

assert_detail_in_timings() {
  local label="$1"
  local expected_detail="$2"
  local timings_file="$3"
  if grep -q "$expected_detail" "$timings_file"; then
    pass "$label"
  else
    fail "$label: expected detail '$expected_detail' not found in timings file"
  fi
}

# Override record_stage_timing to capture in test file
record_stage_timing() {
  local stage="$1"
  local exit_code="$2"
  local duration_seconds="$3"
  local detail="${4:-}"
  printf '%s\t%s\t%s\t%s\n' "$stage" "$exit_code" "$duration_seconds" "$detail" >> "$STAGE_TIMINGS_FILE"
}

# Override emit_progress to capture messages
emit_progress() {
  local stage="$1"
  local message="$2"
  printf '[progress] %s: %s\n' "$stage" "$message" >> "$PROGRESS_LOG"
}

# Override emit_error_event to capture error events
emit_error_event() {
  local event_type="$1"
  local message="$2"
  local severity="${3:-}"
  printf '[error] %s: %s (severity=%s)\n' "$event_type" "$message" "$severity" >> "$ERROR_LOG"
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

# Initialize log files
: > "$STAGE_TIMINGS_FILE"
: > "$PROGRESS_LOG"
: > "$ERROR_LOG"
: > "$tmp_dir/results/pre-validation-ts-check.log"

echo "=== Test 1: has_typescript_project() detects tsconfig.json ==="
cat > package.json <<'JSON'
{
  "scripts": {}
}
JSON
cat > tsconfig.json <<'JSON'
{
  "compilerOptions": {
    "target": "ES2020"
  }
}
JSON

if has_typescript_project; then
  pass "Test 1: has_typescript_project() detects tsconfig.json"
else
  fail "Test 1: has_typescript_project() should detect tsconfig.json"
fi

echo "=== Test 2: has_typescript_project() detects typescript dependency ==="
rm tsconfig.json
cat > package.json <<'JSON'
{
  "devDependencies": {
    "typescript": "^5.0.0"
  },
  "scripts": {}
}
JSON

if has_typescript_project; then
  pass "Test 2: has_typescript_project() detects typescript dependency"
else
  fail "Test 2: has_typescript_project() should detect typescript dependency"
fi

echo "=== Test 3: has_typescript_project() returns 1 for non-TS project ==="
cat > package.json <<'JSON'
{
  "scripts": {}
}
JSON

if has_typescript_project; then
  fail "Test 3: has_typescript_project() should return 1 for non-TS project"
else
  pass "Test 3: has_typescript_project() correctly identifies non-TS project"
fi

echo "=== Test 4: has_npm_build_command() detects existing script ==="
cat > package.json <<'JSON'
{
  "scripts": {
    "build": "echo 'Build success'"
  }
}
JSON

if has_npm_build_command "npm run build"; then
  pass "Test 4: has_npm_build_command() detects existing script"
else
  fail "Test 4: has_npm_build_command() should detect existing script"
fi

echo "=== Test 5: has_npm_build_command() returns 1 for missing script ==="
cat > package.json <<'JSON'
{
  "scripts": {}
}
JSON

if has_npm_build_command "npm run build"; then
  fail "Test 5: has_npm_build_command() should return 1 for missing script"
else
  pass "Test 5: has_npm_build_command() correctly identifies missing script"
fi

echo "=== Test 6: npm_run_script_name() extracts script name ==="
result="$(npm_run_script_name 'npm run build')" || fail "Test 6: npm_run_script_name should succeed"
assert_equals "Test 6: extracts 'build'" "build" "$result"

echo "=== Test 7: npm_run_script_name() extracts with trailing args ==="
result="$(npm_run_script_name 'npm run test -- --runInBand')" || fail "Test 7: npm_run_script_name should succeed"
assert_equals "Test 7: extracts 'test' with trailing args" "test" "$result"

echo ""
echo "✅ TypeScript detection functions tests passed!"
