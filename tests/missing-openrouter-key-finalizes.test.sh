#!/usr/bin/env bash
# Integration test: missing OpenRouter credentials finalize before Pi-dependent phases.

set -euo pipefail

TEST_NAME="missing OpenRouter key finalizes before Pi agents"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_UNDER_TEST="$REPO_ROOT/kaseki-agent.sh"
TMP_DIR="$(mktemp -d)"
RESULTS_DIR="$TMP_DIR/results"
WORKSPACE_DIR="$TMP_DIR/workspace"
FAKE_BIN="$TMP_DIR/bin"
RUN_LOG="$TMP_DIR/kaseki-run.log"
PI_CALLS="$TMP_DIR/pi-calls.log"
KEY_FILE="$TMP_DIR/missing-openrouter-key"
MODIFIED_SCRIPT="$TMP_DIR/kaseki-agent.sh"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  echo "✗ FAIL: $TEST_NAME: $*" >&2
  if [ -f "$RUN_LOG" ]; then
    echo "--- kaseki run log ---" >&2
    tail -120 "$RUN_LOG" >&2 || true
  fi
  if [ -f "$PI_CALLS" ]; then
    echo "--- pi calls ---" >&2
    cat "$PI_CALLS" >&2 || true
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

mkdir -p "$RESULTS_DIR" "$WORKSPACE_DIR" "$FAKE_BIN"
cp -a "$REPO_ROOT/scripts" "$TMP_DIR/scripts"
: > "$PI_CALLS"

cat > "$FAKE_BIN/pi" <<EOF_PI
#!/usr/bin/env bash
printf '%s\\n' "\$*" >> "$PI_CALLS"
if [ "\${1:-}" = "--version" ]; then
  echo "pi 0.0.0-test"
  exit 0
fi
exit 97
EOF_PI
chmod +x "$FAKE_BIN/pi"

# Redirect container-default paths to temp directories. Leave KEY_FILE absent so it is not readable.
sed "s#/results#$RESULTS_DIR#g; s#/workspace#$WORKSPACE_DIR#g; s#/app/lib#$TMP_DIR/app-lib#g" \
  "$SCRIPT_UNDER_TEST" > "$MODIFIED_SCRIPT"
chmod +x "$MODIFIED_SCRIPT"

set +e
env \
  -u OPENROUTER_API_KEY \
  PATH="$FAKE_BIN:$PATH" \
  OPENROUTER_API_KEY_FILE="$KEY_FILE" \
  GITHUB_APP_ENABLED=0 \
  KASEKI_GIT_CACHE_MODE=off \
  KASEKI_BASELINE_VALIDATION_ENABLED=0 \
  KASEKI_GOAL_SETTING=1 \
  KASEKI_SCOUTING=1 \
  KASEKI_GOAL_CHECK=1 \
  bash "$MODIFIED_SCRIPT" > "$RUN_LOG" 2>&1
run_exit=$?
set -e

if [ "$run_exit" -ne 2 ]; then
  fail "expected missing OpenRouter configuration exit code 2, got $run_exit"
fi

if grep -Eq 'goal-setting|scouting' "$PI_CALLS"; then
  fail "Pi goal-setting or scouting command was attempted despite missing credentials"
fi

node - "$RESULTS_DIR/metadata.json" <<'NODE' || fail "metadata did not preserve config/auth failure status"
const fs = require('node:fs');
const metadata = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (metadata.exit_code !== 2) throw new Error(`expected exit_code 2, got ${metadata.exit_code}`);
if (metadata.failed_command !== 'missing OPENROUTER_API_KEY') throw new Error(`expected missing OPENROUTER_API_KEY, got ${metadata.failed_command}`);
NODE

node - "$RESULTS_DIR/failure.json" <<'NODE' || fail "failure artifact did not preserve config/auth failure status"
const fs = require('node:fs');
const failure = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (failure.exit_code !== 2) throw new Error(`expected exit_code 2, got ${failure.exit_code}`);
if (failure.failed_command !== 'missing OPENROUTER_API_KEY') throw new Error(`expected missing OPENROUTER_API_KEY, got ${failure.failed_command}`);
NODE

assert_file_contains "$RUN_LOG" "Missing OpenRouter API key"
assert_file_contains "$RUN_LOG" "OPENROUTER_API_KEY_FILE at $KEY_FILE"
assert_file_contains "$RESULTS_DIR/pi-stderr.log" "OPENROUTER_API_KEY_FILE at $KEY_FILE"
assert_file_contains "$RESULTS_DIR/progress.jsonl" "openrouter_auth_config_missing"
assert_file_contains "$RESULTS_DIR/progress.jsonl" "OPENROUTER_API_KEY_FILE=$KEY_FILE"
assert_file_contains "$RESULTS_DIR/result-summary.md" "Exit Code: 2"
assert_file_contains "$RESULTS_DIR/result-summary.md" "missing OPENROUTER_API_KEY"

printf '✓ %s\n' "$TEST_NAME"
