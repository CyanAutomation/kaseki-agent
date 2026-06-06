#!/usr/bin/env bash
# shellcheck disable=SC2016,SC2034
# Test for validation shell fix (non-login shell + directory checkpoint)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck disable=SC2034 # RUNNER is kept for potential test extensions
RUNNER="$REPO_ROOT/run-kaseki.sh"

pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }

# Test 1: Verify non-login shell syntax in kaseki-agent.sh
test_non_login_shell_syntax() {
  local line
  # shellcheck disable=SC2016 # The $ escape is intentional for grep pattern matching
  line=$(grep -n 'bash -c "\$trimmed"' "$REPO_ROOT/kaseki-agent.sh" | head -1 | cut -d: -f1)
  [ -n "$line" ] || fail "Non-login shell (bash -c) not found in kaseki-agent.sh"
  pass "Non-login shell syntax found at line $line"
  
  # Ensure old login shell is gone
  if grep -q 'bash -lc "\$trimmed"' "$REPO_ROOT/kaseki-agent.sh"; then
    fail "Old login shell syntax (bash -lc) still present in kaseki-agent.sh"
  fi
  pass "Old login shell syntax removed"
}

# Test 2: Verify directory checkpoint exists
test_directory_checkpoint() {
  if grep -q 'Working directory .*repo.*does not exist before %s' "$REPO_ROOT/kaseki-agent.sh"; then
    pass "Directory checkpoint found in kaseki-agent.sh"
  else
    fail "Directory checkpoint not found"
  fi
}

# Test 3: Verify enhanced diagnostics exist
test_enhanced_diagnostics() {
  if grep -q 'getcwd.*No such file or directory.*cannot access parent directories' "$REPO_ROOT/kaseki-agent.sh"; then
    pass "Enhanced diagnostics for getcwd errors found"
  else
    fail "Enhanced diagnostics not found"
  fi
}

# Test 4: Verify script syntax is still valid
test_script_syntax() {
  if bash -n "$REPO_ROOT/kaseki-agent.sh" >/dev/null 2>&1; then
    pass "kaseki-agent.sh bash syntax is valid"
  else
    fail "kaseki-agent.sh has syntax errors"
  fi
}

# Test 5: Verify validation commands run through non-login bash in the repo cwd.
test_validation_command_non_login_shell_and_cwd() {
  local tmpdir fake_repo fake_bin results_dir home_dir marker login_marker run_log run_exit
  tmpdir=$(mktemp -d)
  trap 'rm -rf "${tmpdir:-}"' EXIT

  fake_repo="$tmpdir/fake-repo"
  fake_bin="$tmpdir/bin"
  results_dir="$tmpdir/results"
  home_dir="$tmpdir/home"
  marker="$tmpdir/validation-marker.txt"
  login_marker="$home_dir/login-shell-marker.txt"
  run_log="$tmpdir/kaseki-agent.log"
  mkdir -p "$fake_repo" "$fake_bin" "$results_dir" "$home_dir"

  cat > "$home_dir/.bash_profile" <<'EOF_PROFILE'
printf 'login shell profile was sourced\n' > "$HOME/login-shell-marker.txt"
EOF_PROFILE

  mkdir -p "$fake_repo/deps/fake-dep"
  cat > "$fake_repo/package.json" <<'JSON'
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

  cat > "$fake_repo/deps/fake-dep/package.json" <<'JSON'
{
  "name": "fake-dep",
  "version": "1.0.0",
  "private": true
}
JSON

  cat > "$fake_repo/package-lock.json" <<'JSON'
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

  cat > "$fake_repo/validate.js" <<'NODE'
const fs = require('fs');

const failures = [];
if (process.cwd() !== process.env.EXPECTED_VALIDATION_CWD) {
  failures.push(`cwd=${process.cwd()} expected=${process.env.EXPECTED_VALIDATION_CWD}`);
}
if (fs.existsSync(process.env.LOGIN_MARKER)) {
  failures.push('login shell profile was sourced');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

fs.writeFileSync(process.env.VALIDATION_MARKER, `cwd=${process.cwd()}\n`);
NODE

  git -C "$fake_repo" init -q -b main
  git -C "$fake_repo" add package.json package-lock.json validate.js deps/fake-dep/package.json
  git -C "$fake_repo" \
    -c user.email=kaseki-test@example.invalid \
    -c user.name="Kaseki Test" \
    commit -q -m "initial fake validation repo"

  cat > "$fake_bin/pi" <<'EOF_PI'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then
  printf 'pi fake 0.0.0\n'
  exit 0
fi
printf 'unexpected pi invocation: %s\n' "$*" >&2
exit 97
EOF_PI
  chmod +x "$fake_bin/pi"

  cat > "$fake_bin/validation-output-filter" <<'EOF_FILTER'
#!/usr/bin/env bash
cat
EOF_FILTER
  chmod +x "$fake_bin/validation-output-filter"

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
    KASEKI_PRE_AGENT_VALIDATION_COMMANDS="npm run validate" \
    KASEKI_VALIDATION_COMMANDS="none" \
    KASEKI_TS_PRE_CHECK=0 \
    KASEKI_SCOUTING=0 \
    KASEKI_GOAL_SETTING=0 \
    KASEKI_HASHLINE_EDITS=0 \
    KASEKI_ALLOW_EMPTY_DIFF=1 \
    EXPECTED_VALIDATION_CWD="$tmpdir/workspace/repo" \
    VALIDATION_MARKER="$marker" \
    LOGIN_MARKER="$login_marker" \
    bash "$REPO_ROOT/kaseki-agent.sh" > "$run_log" 2>&1
  run_exit=$?
  set -e

  if [ "$run_exit" -ne 0 ]; then
    tail -80 "$run_log" >&2 || true
    fail "kaseki-agent.sh failed while running fake validation command (exit $run_exit)"
  fi

  if [ -e "$login_marker" ]; then
    fail "Validation command used a login shell and sourced $home_dir/.bash_profile"
  fi

  if ! [ -f "$marker" ]; then
    tail -80 "$run_log" >&2 || true
    fail "Validation marker was not written by the fake package script"
  fi

  if ! grep -qx "cwd=${tmpdir}/workspace/repo" "$marker"; then
    fail "Validation command did not run in the cloned repository cwd"
  fi

  if ! grep -q '^npm run validate[[:space:]]\+0[[:space:]]' "$results_dir/pre-validation-timings.tsv"; then
    fail "pre-validation timings did not record successful npm run validate command"
  fi

  pass "Validation command ran under non-login bash -c in the repository cwd"
}

# Run all tests
printf '==> Validation Fix Tests\n'
test_non_login_shell_syntax
test_directory_checkpoint
test_enhanced_diagnostics
test_script_syntax
test_validation_command_non_login_shell_and_cwd

printf '\n✓ All validation fix tests passed\n'
