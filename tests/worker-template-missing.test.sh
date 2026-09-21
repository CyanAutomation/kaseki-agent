#!/usr/bin/env bash
set -euo pipefail

TEST_NAME="worker template missing fails before provider retry"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
WORKER_DIR="$TMP_DIR/worker"
FIXTURE_REPO="$TMP_DIR/fixture-repo"
RUNTIME_ROOT="$TMP_DIR/runtime"
RESULTS_DIR="$RUNTIME_ROOT/results"
FAKE_BIN="$TMP_DIR/bin"
PROVIDER_CALLS="$TMP_DIR/provider-calls.log"
RUN_LOG="$TMP_DIR/run.log"

cleanup() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    printf '%s\n' "--- $TEST_NAME run log ---" >&2
    tail -120 "$RUN_LOG" 2>/dev/null >&2 || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s: %s\n' "$TEST_NAME" "$*" >&2
  exit 1
}

# Model the installed worker filesystem rather than evaluating selected
# functions from the source. Leave exactly one required scouting template out.
mkdir -p "$WORKER_DIR" "$FIXTURE_REPO" "$FAKE_BIN"
cp "$ROOT_DIR/kaseki-agent.sh" "$WORKER_DIR/kaseki-agent.sh"
cp -a "$ROOT_DIR/scripts" "$WORKER_DIR/scripts"
cp -a "$ROOT_DIR/templates" "$WORKER_DIR/templates"
rm "$WORKER_DIR/templates/scouting/compact.txt"
chmod +x "$WORKER_DIR/kaseki-agent.sh"

# A local repository keeps this boundary test hermetic and has no dependencies
# to install before the scouting phase.
printf '%s\n' 'fixture' > "$FIXTURE_REPO/README.md"
git -C "$FIXTURE_REPO" init -q -b main
git -C "$FIXTURE_REPO" add README.md
git -C "$FIXTURE_REPO" \
  -c user.name='Kaseki Test' \
  -c user.email='kaseki-test@example.invalid' \
  commit -q -m initial

# Pi is the sole external provider boundary. Version/model discovery is
# allowed, but any agent-phase call would show that execution crossed the
# template guard.
: > "$PROVIDER_CALLS"
cat > "$FAKE_BIN/pi" <<EOF_PI
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$PROVIDER_CALLS"
if [ "\${1:-}" = "--version" ]; then
  printf '%s\n' 'pi 0.0.0-test'
  exit 0
fi
if [ "\${1:-}" = "--list-models" ]; then
  printf '%s\n' 'gateway/dynamic/kaseki-agent'
  exit 0
fi
printf '%s\n' 'provider phase must not be invoked' >&2
exit 97
EOF_PI
chmod +x "$FAKE_BIN/pi"

set +e
env \
  PATH="$FAKE_BIN:$PATH" \
  REPO_URL="$FIXTURE_REPO" \
  GIT_REF=main \
  TASK_PROMPT='Inspect the fixture repository.' \
  KASEKI_PROVIDER=gateway \
  LLM_GATEWAY_URL=https://gateway.example.invalid/v1 \
  LLM_GATEWAY_API_KEY=test \
  GITHUB_APP_ENABLED=0 \
  KASEKI_TEST_DEFAULT_PATH_ROOT="$RUNTIME_ROOT" \
  KASEKI_GIT_CACHE_MODE=off \
  KASEKI_TASK_MODE=inspect \
  KASEKI_SCOUTING=1 \
  KASEKI_GOAL_SETTING=0 \
  KASEKI_GOAL_CHECK=0 \
  KASEKI_RUN_EVALUATION=0 \
  KASEKI_BASELINE_VALIDATION_ENABLED=0 \
  KASEKI_PRE_AGENT_VALIDATION_COMMANDS=none \
  KASEKI_VALIDATION_COMMANDS=none \
  bash "$WORKER_DIR/kaseki-agent.sh" > "$RUN_LOG" 2>&1
run_exit=$?
set -e

[ "$run_exit" -eq 87 ] || fail "expected exit code 87, got $run_exit"

node - "$RESULTS_DIR/metadata.json" "$RESULTS_DIR/failure.json" <<'NODE' \
  || fail 'persisted artifacts did not retain the worker failure classification'
const fs = require('node:fs');
const [metadataPath, failurePath] = process.argv.slice(2);
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
const failure = JSON.parse(fs.readFileSync(failurePath, 'utf8'));
for (const [name, artifact] of [['metadata', metadata], ['failure', failure]]) {
  if (artifact.exit_code !== 87) throw new Error(`${name}.exit_code=${artifact.exit_code}`);
  if (artifact.worker_error_type !== 'worker_template_missing') {
    throw new Error(`${name}.worker_error_type=${JSON.stringify(artifact.worker_error_type)}`);
  }
  if (artifact.worker_error_phase !== 'scouting') {
    throw new Error(`${name}.worker_error_phase=${JSON.stringify(artifact.worker_error_phase)}`);
  }
}
if (metadata.scouting_attempts !== 1) {
  throw new Error(`expected one non-retryable scouting attempt, got ${metadata.scouting_attempts}`);
}
if (metadata.scouting_succeeded_on_attempt !== null) {
  throw new Error(`unexpected scouting success attempt ${metadata.scouting_succeeded_on_attempt}`);
}
NODE

provider_phase_calls="$(awk '$0 != "--version" && $0 != "--list-models" { count += 1 } END { print count + 0 }' "$PROVIDER_CALLS")"
[ "$provider_phase_calls" -eq 0 ] \
  || fail "provider received $provider_phase_calls phase invocation(s): $(cat "$PROVIDER_CALLS")"

printf 'PASS: %s\n' "$TEST_NAME"
