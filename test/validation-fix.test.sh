#!/usr/bin/env bash
# shellcheck disable=SC2016,SC2034
# Test validation shell behavior, directory checkpointing, and diagnostics.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
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
  git -C "$repo_dir" add package.json package-lock.json validate.js deps/fake-dep/package.json
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

assert_agent_completed() {
  local run_exit="$1"
  local log_file="$2"
  local message="$3"
  if [ "$run_exit" -ne 0 ]; then
    tail -80 "$log_file" >&2 || true
    fail "$message (exit $run_exit)"
  fi
}

# Test 1: Validation commands run through a non-login shell in the cloned repo.
test_non_login_shell_syntax() {
  local tmpdir fake_repo home_dir marker login_marker run_log run_exit
  new_test_context tmpdir
  fake_repo="$tmpdir/fake-repo"
  home_dir="$tmpdir/home"
  marker="$tmpdir/validation-marker.txt"
  login_marker="$home_dir/login-shell-marker.txt"
  run_log="$tmpdir/kaseki-agent.log"
  mkdir -p "$home_dir"
  create_controlled_repo "$fake_repo"

  cat > "$home_dir/.bash_profile" <<'EOF_PROFILE'
printf 'login shell profile was sourced\n' > "$HOME/login-shell-marker.txt"
EOF_PROFILE

  if run_kaseki_agent_for_validation \
    "$tmpdir" \
    "$fake_repo" \
    "npm run validate" \
    "$run_log" \
    VALIDATION_MARKER="$marker" \
    LOGIN_MARKER="$login_marker"; then
    run_exit=0
  else
    run_exit=$?
  fi

  assert_agent_completed "$run_exit" "$run_log" "kaseki-agent.sh failed while running the fake validation command"

  if [ -e "$login_marker" ]; then
    fail "Validation command used a login shell and sourced $home_dir/.bash_profile"
  fi

  if ! [ -f "$marker" ]; then
    tail -80 "$run_log" >&2 || true
    fail "Validation marker was not written by the fake package script"
  fi

  assert_file_contains "$marker" "^cwd=${tmpdir}/workspace/repo$" "Validation command did not run in the cloned repository cwd"
  assert_file_contains "$tmpdir/results/pre-validation-timings.tsv" '^npm run validate[[:space:]]+0[[:space:]]' "pre-validation timings did not record successful npm run validate command"

  pass "Validation command ran under a non-login shell in the repository cwd"
}

# Test 2: A missing cloned working directory is reported before validation commands run.
test_directory_checkpoint() {
  local tmpdir fake_repo run_log run_exit progress_log validation_log real_date
  new_test_context tmpdir
  fake_repo="$tmpdir/fake-repo"
  run_log="$tmpdir/kaseki-agent.log"
  progress_log="$tmpdir/results/progress.log"
  validation_log="$tmpdir/results/pre-validation.log"
  real_date="$(command -v date)"
  create_controlled_repo "$fake_repo"

  mkdir -p "$tmpdir/bin"
  cat > "$tmpdir/bin/date" <<EOF_DATE
#!/usr/bin/env bash
if [ -n "\${KASEKI_WORKSPACE_DIR:-}" ] && \
   [ ! -e "\$KASEKI_WORKSPACE_DIR/.repo-renamed-before-validation" ] && \
   [ -f "\${KASEKI_RESULTS_DIR:-}/progress.log" ] && \
   grep -q 'pre-agent validation' "\$KASEKI_RESULTS_DIR/progress.log" 2>/dev/null; then
  touch "\$KASEKI_WORKSPACE_DIR/.repo-renamed-before-validation"
  mv "\$KASEKI_WORKSPACE_DIR/repo" "\$KASEKI_WORKSPACE_DIR/repo.missing-before-validation"
fi
exec "$real_date" "\$@"
EOF_DATE
  chmod +x "$tmpdir/bin/date"

  if run_kaseki_agent_for_validation \
    "$tmpdir" \
    "$fake_repo" \
    "npm run validate" \
    "$run_log"; then
    run_exit=0
  else
    run_exit=$?
  fi

  if [ "$run_exit" -ne 1 ]; then
    tail -80 "$run_log" >&2 || true
    fail "kaseki-agent.sh should return exit 1 when validation cannot start because the working directory is missing (exit $run_exit)"
  fi
  assert_file_contains "$validation_log" 'ERROR: Working directory .*/repo does not exist before pre-agent validation' "Missing-directory checkpoint did not write the validation error message"
  assert_file_contains "$progress_log" '\[error\] pre_agent_validation_failed: .*Working directory .*/repo missing before pre-agent validation .*\(recovery: exit\)' "Missing-directory checkpoint did not emit the expected exit error event"
  assert_file_contains "$tmpdir/results/stage-timings.tsv" '^pre-agent validation[[:space:]]+1[[:space:]]+[0-9]+[[:space:]]+directory_missing$' "Missing-directory checkpoint did not record directory_missing exit behavior"

  pass "Missing working directory before validation emitted an exit error event"
}

# Test 3: Directory-access failures show user-facing diagnostics without relying on source text.
test_enhanced_diagnostics() {
  local tmpdir fake_repo run_log run_exit quality_log validation_log progress_log diagnostic_command
  new_test_context tmpdir
  fake_repo="$tmpdir/fake-repo"
  run_log="$tmpdir/kaseki-agent.log"
  quality_log="$tmpdir/results/quality.log"
  validation_log="$tmpdir/results/pre-validation.log"
  progress_log="$tmpdir/results/progress.log"
  create_controlled_repo "$fake_repo"

  diagnostic_command='npm run validate'
  if run_kaseki_agent_for_validation \
    "$tmpdir" \
    "$fake_repo" \
    "$diagnostic_command" \
    "$run_log" \
    SIMULATE_GETCWD_FAILURE=1; then
    run_exit=0
  else
    run_exit=$?
  fi

  if [ "$run_exit" -ne 1 ]; then
    tail -80 "$run_log" >&2 || true
    fail "kaseki-agent.sh should return exit 1 when validation hits the simulated getcwd failure (exit $run_exit)"
  fi
  assert_file_contains "$quality_log" '\[DIAGNOSTICS\] Validation command failed with directory access error:' "Directory-access failure did not emit user-facing diagnostics"
  assert_file_contains "$quality_log" 'Working directory status:' "Directory-access diagnostics did not summarize working directory status"
  assert_file_contains "$quality_log" '.*/repo exists: no' "Directory-access diagnostics did not report the missing repo directory"
  assert_file_contains "$validation_log" 'Validation failed: first failing command was' "Validation log did not summarize the failing validation command"
  assert_file_contains "$progress_log" '\[error\] pre_agent_validation_failed: .*first failing command was .*\(recovery: exit\)' "Directory-access failure did not emit the expected exit error event"

  pass "Directory-access validation failure emitted user-facing diagnostics"
}

# Test 4: Verify script syntax is still valid.
test_script_syntax() {
  if bash -n "$REPO_ROOT/kaseki-agent.sh" >/dev/null 2>&1; then
    pass "kaseki-agent.sh bash syntax is valid"
  else
    fail "kaseki-agent.sh has syntax errors"
  fi
}


# Run all tests
printf '==> Validation Fix Tests\n'
test_non_login_shell_syntax
test_directory_checkpoint
test_enhanced_diagnostics
test_script_syntax

printf '\n✓ All validation fix tests passed\n'
