#!/usr/bin/env bash
# Integration test: failing pre-agent validation exits before any Pi executable is invoked.

set -euo pipefail

TEST_NAME="pre-agent validation ordering contract"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_UNDER_TEST="$REPO_ROOT/kaseki-agent.sh"
DIST_FILTER="$REPO_ROOT/dist/validation-output-filter.js"
TMP_DIR="$(mktemp -d)"
FAKE_REPO="$TMP_DIR/fake-repo"
FAKE_BIN="$TMP_DIR/bin"
PI_MARKER="$TMP_DIR/pi-invoked.log"
VALIDATION_MARKER="$TMP_DIR/pre-agent-validation-invoked.log"
RUN_LOG="$TMP_DIR/kaseki-run.log"
RESULTS_DIR="$TMP_DIR/results"

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

mkdir -p "$FAKE_REPO" "$FAKE_BIN"

cat > "$FAKE_REPO/README.md" <<'EOF_README'
# Fake validation-order repository
EOF_README

git -C "$FAKE_REPO" init -q -b main
git -C "$FAKE_REPO" add README.md
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

cat > "$FAKE_BIN/fake-pre-agent-validation" <<EOF_VALIDATION
#!/usr/bin/env bash
echo "validation invoked" >> "$VALIDATION_MARKER"
echo "PUBLIC CONTRACT FAILURE: pre-agent validation stopped the run"
exit 23
EOF_VALIDATION
chmod +x "$FAKE_BIN/fake-pre-agent-validation"

cat > "$FAKE_BIN/validation-output-filter" <<EOF_FILTER
#!/usr/bin/env bash
exec node "$DIST_FILTER"
EOF_FILTER
chmod +x "$FAKE_BIN/validation-output-filter"

set +e
env \
  KASEKI_TEST_DEFAULT_PATH_ROOT="$TMP_DIR" \
  PATH="$FAKE_BIN:$PATH" \
  REPO_URL="$FAKE_REPO" \
  GIT_REF="main" \
  KASEKI_PROVIDER="openrouter" \
  OPENROUTER_API_KEY="test-key-not-used" \
  GITHUB_APP_ENABLED=0 \
  KASEKI_GIT_CACHE_MODE=off \
  KASEKI_BASELINE_VALIDATION_ENABLED=0 \
  KASEKI_PRE_AGENT_VALIDATION=1 \
  KASEKI_PRE_AGENT_VALIDATION_COMMANDS="fake-pre-agent-validation" \
  KASEKI_VALIDATION_COMMANDS="fake-post-agent-validation" \
  KASEKI_VALIDATION_FAIL_FAST=1 \
  bash "$SCRIPT_UNDER_TEST" > "$RUN_LOG" 2>&1
run_exit=$?
set -e

if [ "$run_exit" -ne 23 ]; then
  fail "expected kaseki-agent.sh to exit with pre-agent validation status 23, got $run_exit"
fi

[ -f "$VALIDATION_MARKER" ] || fail "fake pre-agent validation command was not invoked"
[ -f "$RESULTS_DIR/stage-timings.tsv" ] || fail "stage timings were not written"
[ -f "$RESULTS_DIR/pre-validation-timings.tsv" ] || fail "pre-validation timings were not written"
[ -f "$RESULTS_DIR/metadata.json" ] || fail "metadata.json was not written"

assert_file_contains "$RESULTS_DIR/stage-timings.tsv" '^pre-agent validation[[:space:]]+23[[:space:]]+'
assert_file_contains "$RESULTS_DIR/pre-validation-timings.tsv" '^fake-pre-agent-validation[[:space:]]+23[[:space:]]+'
assert_file_contains "$RESULTS_DIR/pre-validation.log" 'Raw validation output tail'
assert_file_contains "$RESULTS_DIR/pre-validation.log" 'PUBLIC CONTRACT FAILURE: pre-agent validation stopped the run'

if [ -s "$PI_MARKER" ]; then
  fail "fake pi executable was invoked even though pre-agent validation failed"
fi

node - "$RESULTS_DIR/metadata.json" <<'NODE' || fail "metadata did not identify pre-agent validation failure fields"
const fs = require('fs');
const metadata = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const failures = [];
if (metadata.exit_code !== 23) {
  failures.push(`exit_code=${metadata.exit_code}`);
}
if (metadata.failed_command !== 'pre-agent validation') {
  failures.push(`failed_command=${JSON.stringify(metadata.failed_command)}`);
}
if (metadata.pre_validation_exit_code !== 23) {
  failures.push(`pre_validation_exit_code=${metadata.pre_validation_exit_code}`);
}
if (!String(metadata.pre_validation_failed_command || '').includes('fake-pre-agent-validation')) {
  failures.push(`pre_validation_failed_command=${JSON.stringify(metadata.pre_validation_failed_command)}`);
}
if (metadata.pre_validation_failure_reason !== 'pre_agent_validation_failed: fake-pre-agent-validation (exit 23)') {
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
  fail "pi coding agent stage should not be timed when pre-agent validation fails"
fi

echo "✓ PASS: $TEST_NAME"
