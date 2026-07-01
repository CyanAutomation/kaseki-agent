#!/usr/bin/env bash
# shellcheck disable=SC2016,SC2034
# Test validation shell behavior, directory checkpointing, and diagnostics.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck disable=SC2034 # RUNNER is kept for potential test extensions
RUNNER="$REPO_ROOT/run-kaseki.sh"

CLEANUP_DIRS=()
cleanup() {
  local dir
  for dir in "${CLEANUP_DIRS[@]:-}"; do
    rm -rf "$dir" 2>/dev/null || true
  done
}
trap cleanup EXIT

pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }

new_test_context() {
  local -n __result_ref="$1"
  local created_tmpdir
  created_tmpdir=$(mktemp -d) || fail "Failed to create temporary directory"
  CLEANUP_DIRS+=("$created_tmpdir")
  __result_ref="$created_tmpdir"
}

write_fake_tools() {
  local fake_bin="$1"
  mkdir -p "$fake_bin"

  cat > "$fake_bin/pi" <<'EOF_PI'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then
  printf 'pi fake 0.0.0\n'
  exit 0
fi
printf 'unexpected pi invocation: %s\n' "$*" >&2
exit 1
EOF_PI
  chmod +x "$fake_bin/pi"

  cat > "$fake_bin/validation-output-filter" <<'EOF_FILTER'
#!/usr/bin/env bash
cat
EOF_FILTER
  chmod +x "$fake_bin/validation-output-filter"
}

create_controlled_repo() {
  local repo_dir="$1"
  local include_dependency_fixture="${2:-0}"
  mkdir -p "$repo_dir"

  if [ "$include_dependency_fixture" = "1" ]; then
    mkdir -p "$repo_dir/deps/fake-dep"
    cat > "$repo_dir/package.json" <<'JSON'
{
  "name": "fake-validation-command-repo",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "validate": "node validate.js"
  },
  "dependencies": {
    "fake-dep": "file:deps/fake-dep"
  }
}
JSON

    cat > "$repo_dir/deps/fake-dep/package.json" <<'JSON'
{
  "name": "fake-dep",
  "version": "1.0.0",
  "private": true
}
JSON

    cat > "$repo_dir/package-lock.json" <<'JSON'
{
  "name": "fake-validation-command-repo",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "fake-validation-command-repo",
      "version": "1.0.0",
      "dependencies": {
        "fake-dep": "file:deps/fake-dep"
      }
    },
    "deps/fake-dep": {
      "name": "fake-dep",
      "version": "1.0.0"
    },
    "node_modules/fake-dep": {
      "resolved": "deps/fake-dep",
      "link": true
    }
  }
}
JSON
  else
    cat > "$repo_dir/package.json" <<'JSON'
{
  "name": "fake-validation-command-repo",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "validate": "node validate.js"
  }
}
JSON

    cat > "$repo_dir/package-lock.json" <<'JSON'
{
  "name": "fake-validation-command-repo",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "fake-validation-command-repo",
      "version": "1.0.0"
    }
  }
}
JSON
  fi

  cat > "$repo_dir/validate.js" <<'NODE'
const fs = require('fs');

if (process.env.SIMULATE_GETCWD_FAILURE === '1') {
  const childProcess = require('child_process');
  console.error('getcwd failure while resolving validation workspace');
  fs.rmSync(process.cwd(), { recursive: true, force: true });
  childProcess.execFileSync(process.execPath, ['-e', 'process.cwd()'], { stdio: 'inherit' });
}

const failures = [];
if (process.cwd() !== process.env.EXPECTED_VALIDATION_CWD) {
  failures.push(`cwd=${process.cwd()} expected=${process.env.EXPECTED_VALIDATION_CWD}`);
}
if (process.env.LOGIN_MARKER && fs.existsSync(process.env.LOGIN_MARKER)) {
  failures.push('login shell profile was sourced');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

if (process.env.VALIDATION_MARKER) {
  fs.writeFileSync(process.env.VALIDATION_MARKER, `cwd=${process.cwd()}\n`);
}
NODE

  git -C "$repo_dir" init -q -b main
  if [ "$include_dependency_fixture" = "1" ]; then
    git -C "$repo_dir" add package.json package-lock.json validate.js deps/fake-dep/package.json
  else
    git -C "$repo_dir" add package.json package-lock.json validate.js
  fi
  git -C "$repo_dir" \
    -c user.email=kaseki-test@example.invalid \
    -c user.name="Kaseki Test" \
    commit -q -m "initial fake validation repo"
}

run_kaseki_agent_for_validation() {
  local tmpdir="$1"
  local fake_repo="$2"
  local commands="$3"
  local log_file="$4"
  shift 4

  local fake_bin="$tmpdir/bin"
  local home_dir="$tmpdir/home"
  local results_dir="$tmpdir/results"
  mkdir -p "$home_dir" "$results_dir"
  write_fake_tools "$fake_bin"

  set +e
  env \
    HOME="$home_dir" \
    PATH="$fake_bin:$PATH" \
    REPO_URL="$fake_repo" \
    GIT_REF="main" \
    OPENROUTER_API_KEY="test-key-not-used" \
    KASEKI_PROVIDER="openrouter" \
    LLM_GATEWAY_URL="http://127.0.0.1:9/v1" \
    LLM_GATEWAY_API_KEY="test-key-not-used" \
    GITHUB_APP_ENABLED=0 \
    KASEKI_DRY_RUN=1 \
    KASEKI_BASELINE_VALIDATION_DRY_RUN=1 \
    KASEKI_BASELINE_VALIDATION_ENABLED=0 \
    KASEKI_GIT_CACHE_MODE=off \
    KASEKI_WORKSPACE_DIR="$tmpdir/workspace" \
    KASEKI_RESULTS_DIR="$results_dir" \
    KASEKI_CACHE_DIR="$tmpdir/cache" \
    KASEKI_LOG_DIR="$tmpdir/logs" \
    KASEKI_DEPENDENCY_CACHE_DIR="$tmpdir/dependency-cache" \
    KASEKI_IMAGE_DEPENDENCY_CACHE_DIR="$tmpdir/image-cache" \
    KASEKI_PRE_AGENT_VALIDATION=1 \
    KASEKI_PRE_AGENT_VALIDATION_COMMANDS="$commands" \
    KASEKI_VALIDATION_COMMANDS="none" \
    KASEKI_TS_PRE_CHECK=0 \
    KASEKI_SCOUTING=0 \
    KASEKI_GOAL_SETTING=0 \
    KASEKI_HASHLINE_EDITS=0 \
    KASEKI_ALLOW_EMPTY_DIFF=1 \
    EXPECTED_VALIDATION_CWD="$tmpdir/workspace/repo" \
    "$@" \
    bash "$REPO_ROOT/kaseki-agent.sh" > "$log_file" 2>&1
  local run_exit=$?
  set -e
  return "$run_exit"
}

assert_file_contains() {
  local file="$1"
  local pattern="$2"
  local message="$3"
  if ! grep -Eq "$pattern" "$file"; then
    printf 'Expected pattern not found in %s: %s\n' "$file" "$pattern" >&2
    tail -80 "$file" >&2 || true
    fail "$message"
  fi
}


assert_diagnostic_log_contains() {
  local log_path="$1"
  local pattern="$2"
  local diagnostic_string="$3"
  if ! grep -Eq "$pattern" "$log_path"; then
    printf 'Expected diagnostic not found in %s: %s\n' "$log_path" "$diagnostic_string" >&2
    tail -80 "$log_path" >&2 || true
    fail "Missing diagnostic in $log_path: $diagnostic_string"
  fi
}

assert_agent_completed() {
  local run_exit="$1"
  local log_file="$2"
  local message="$3"
  if [ "$run_exit" -ne 0 ]; then
    tail -80 "$log_file" >&2 || true
    fail "$message (exit $run_exit)"
  fi
}

