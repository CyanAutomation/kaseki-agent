#!/usr/bin/env bash
# Integration test: pre-agent validation fails before any Pi executable is invoked.

set -euo pipefail

TEST_NAME="pre-agent validation order"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_UNDER_TEST="$REPO_ROOT/kaseki-agent.sh"
DIST_FILTER="$REPO_ROOT/dist/validation-output-filter.js"
TMP_DIR="$(mktemp -d)"
FAKE_REPO="$TMP_DIR/fake-repo"
FAKE_BIN="$TMP_DIR/bin"
PI_MARKER="$TMP_DIR/pi-invoked.log"
RUN_LOG="$TMP_DIR/kaseki-run.log"
RESULTS_DIR="$TMP_DIR/results"
WORKSPACE_REPO="$TMP_DIR/repo"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  echo "✗ FAIL: $TEST_NAME: $*" >&2
  if [ -f "$RUN_LOG" ]; then
    echo "--- kaseki run log ---" >&2
    tail -80 "$RUN_LOG" >&2 || true
  fi
  exit 1
}

assert_file_contains() {
  local file="$1"
  local pattern="$2"
  if ! [ -f "$file" ]; then
    fail "expected file $file does not exist"
  fi
  if ! grep -qE "$pattern" "$file"; then
    fail "expected $file to contain pattern: $pattern"
  fi
}

if [ ! -f "$DIST_FILTER" ]; then
  fail "dist/validation-output-filter.js is missing; run npm run build before this test"
fi

mkdir -p "$RESULTS_DIR" "$FAKE_REPO" "$FAKE_BIN" "$WORKSPACE_REPO"

# Create a temporary version of the script with paths redirected to $TMP_DIR
MODIFIED_SCRIPT="$TMP_DIR/kaseki-agent-modified.sh"
sed "s#/workspace/repo#$WORKSPACE_REPO#g; s#/results#$RESULTS_DIR#g" "$SCRIPT_UNDER_TEST" > "$MODIFIED_SCRIPT"
chmod +x "$MODIFIED_SCRIPT"

mkdir -p "$FAKE_REPO/deps/fake-dep"
cat > "$FAKE_REPO/package.json" <<'JSON'
{
  "name": "fake-baseline-validation-repo",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "check": "exit 1",
    "test": "exit 0"
  },
  "dependencies": {
    "fake-dep": "file:deps/fake-dep"
  }
}
JSON

cat > "$FAKE_REPO/deps/fake-dep/package.json" <<'JSON'
{
  "name": "fake-dep",
  "version": "1.0.0",
  "private": true
}
JSON

cat > "$FAKE_REPO/package-lock.json" <<'JSON'
{
  "name": "fake-baseline-validation-repo",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "fake-baseline-validation-repo",
      "version": "1.0.0",
      "dependencies": {
        "fake-dep": "file:deps/fake-dep"
      }
    },
    "deps/fake-dep": {
      "version": "1.0.0"
    },
    "node_modules/fake-dep": {
      "resolved": "deps/fake-dep",
      "link": true
    }
  }
}
JSON

git -C "$FAKE_REPO" init -q -b main
git -C "$FAKE_REPO" add package.json package-lock.json deps/fake-dep/package.json
git -C "$FAKE_REPO" \
  -c user.email=kaseki-test@example.invalid \
  -c user.name="Kaseki Test" \
  commit -q -m "initial fake repo"

cat > "$FAKE_BIN/pi" <<EOF_PI
#!/usr/bin/env bash
echo "pi invoked: \$*" >> "$PI_MARKER"
exit 97
EOF_PI
chmod +x "$FAKE_BIN/pi"

cat > "$FAKE_BIN/validation-output-filter" <<EOF_FILTER
#!/usr/bin/env bash
exec node "$DIST_FILTER"
EOF_FILTER
chmod +x "$FAKE_BIN/validation-output-filter"

set +e
env \
  PATH="$FAKE_BIN:$PATH" \
  REPO_URL="$FAKE_REPO" \
  GIT_REF="main" \
  OPENROUTER_API_KEY="test-key-not-used" \
  GITHUB_APP_ENABLED=0 \
  KASEKI_GIT_CACHE_MODE=off \
  KASEKI_DEPENDENCY_CACHE_DIR="$TMP_DIR/dependency-cache" \
  KASEKI_IMAGE_DEPENDENCY_CACHE_DIR="$TMP_DIR/image-cache" \
  KASEKI_INSTALL_IGNORE_SCRIPTS=1 \
  KASEKI_PRE_AGENT_VALIDATION=1 \
  KASEKI_PRE_AGENT_VALIDATION_COMMANDS="npm run check;npm run test" \
  KASEKI_VALIDATION_COMMANDS="npm run check;npm run test" \
  KASEKI_VALIDATION_FAIL_FAST=1 \
  bash "$MODIFIED_SCRIPT" > "$RUN_LOG" 2>&1
run_exit=$?
set -e

if [ "$run_exit" -eq 0 ]; then
  fail "expected kaseki-agent.sh to fail on baseline validation"
fi

[ -f "$RESULTS_DIR/stage-timings.tsv" ] || fail "stage timings were not written"
[ -f "$RESULTS_DIR/pre-validation-timings.tsv" ] || fail "pre-validation timings were not written"
[ -f "$RESULTS_DIR/metadata.json" ] || fail "metadata.json was not written"

assert_file_contains "$RESULTS_DIR/stage-timings.tsv" '^pre-agent validation[[:space:]]+1[[:space:]]+'
assert_file_contains "$RESULTS_DIR/pre-validation-timings.tsv" '^npm run check[[:space:]]+1[[:space:]]+'

if [ -s "$PI_MARKER" ]; then
  fail "fake pi executable was invoked before baseline validation blocked the run"
fi

node - "$RESULTS_DIR/metadata.json" <<'NODE' || fail "metadata did not identify pre-agent baseline validation failure"
const fs = require('fs');
const metadata = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const failures = [];
if (metadata.failed_command !== 'pre-agent validation') {
  failures.push(`failed_command=${JSON.stringify(metadata.failed_command)}`);
}
if (metadata.pre_validation_exit_code !== 1) {
  failures.push(`pre_validation_exit_code=${metadata.pre_validation_exit_code}`);
}
if (!String(metadata.pre_validation_failed_command || '').includes('npm run check')) {
  failures.push(`pre_validation_failed_command=${JSON.stringify(metadata.pre_validation_failed_command)}`);
}
if (!String(metadata.pre_validation_failure_reason || '').includes('pre_agent_validation_failed: npm run check (exit 1)')) {
  failures.push(`pre_validation_failure_reason=${JSON.stringify(metadata.pre_validation_failure_reason)}`);
}
if (metadata.validation_exit_code !== 0) {
  failures.push(`validation_exit_code=${metadata.validation_exit_code}`);
}
if (metadata.validation_failure_reason !== '') {
  failures.push(`validation_failure_reason=${JSON.stringify(metadata.validation_failure_reason)}`);
}
if (metadata.pi_exit_code !== 0) {
  failures.push(`pi_exit_code=${metadata.pi_exit_code}`);
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
NODE

if grep -q '^pi coding agent[[:space:]]' "$RESULTS_DIR/stage-timings.tsv"; then
  fail "pi coding agent stage should not be timed when baseline validation fails"
fi

echo "✓ PASS: $TEST_NAME"
