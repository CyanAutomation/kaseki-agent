#!/usr/bin/env bash
# Specification: provider-failure-short-circuit (terminal provider exit 88 orchestration contract).

set -euo pipefail

TEST_NAME="provider failure short-circuits downstream orchestration"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
SOURCE_REPO="$TMP_DIR/source-repo"
WORKSPACE_DIR="$TMP_DIR/workspace"
RESULTS_DIR="$TMP_DIR/results"
FAKE_BIN="$TMP_DIR/bin"
RUN_LOG="$TMP_DIR/kaseki-run.log"
PROVIDER_LOG="$TMP_DIR/provider.log"
VALIDATION_LOG="$TMP_DIR/validation-invocations.log"
EVALUATION_LOG="$TMP_DIR/evaluation-invocations.log"
GITHUB_LOG="$TMP_DIR/github-operation-invocations.log"
MODIFIED_SCRIPT="$TMP_DIR/kaseki-agent.sh"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  printf 'FAIL: %s: %s\n' "$TEST_NAME" "$*" >&2
  [ ! -f "$RUN_LOG" ] || tail -160 "$RUN_LOG" >&2
  exit 1
}

assert_empty() {
  [ ! -s "$1" ] || fail "expected $2 log to remain empty; recorded: $(tr '\n' ' ' < "$1")"
}

mkdir -p "$SOURCE_REPO" "$WORKSPACE_DIR" "$RESULTS_DIR" "$FAKE_BIN" "$TMP_DIR/app-lib"
cp -a "$REPO_ROOT/scripts" "$TMP_DIR/scripts"
touch "$TMP_DIR/app-lib/event-aggregator.js" "$TMP_DIR/app-lib/timestamp-tracker.js" \
  "$TMP_DIR/app-lib/progress-stream-utils.js"
: > "$PROVIDER_LOG"
: > "$VALIDATION_LOG"
: > "$EVALUATION_LOG"
: > "$GITHUB_LOG"

printf '%s\n' '# Provider failure fixture' > "$SOURCE_REPO/README.md"
git -C "$SOURCE_REPO" init -q -b main
git -C "$SOURCE_REPO" add README.md
git -C "$SOURCE_REPO" -c user.name='Kaseki Test' -c user.email=kaseki-test@example.invalid commit -q -m initial

cat > "$FAKE_BIN/pi" <<EOF_PI
#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then
  printf '%s\n' 'pi 0.0.0-provider-failure-test'
  exit 0
fi
printf '%s\n' "\$*" >> "$PROVIDER_LOG"
if printf '%s' "\$*" | grep -qi 'run evaluation'; then
  printf '%s\n' "\$*" >> "$EVALUATION_LOG"
fi
exit 88
EOF_PI

cat > "$FAKE_BIN/record-validation" <<EOF_VALIDATION
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$VALIDATION_LOG"
EOF_VALIDATION
cat > "$FAKE_BIN/kaseki-pi-progress-stream" <<'EOF_PROGRESS'
#!/usr/bin/env bash
cat
EOF_PROGRESS
cat > "$FAKE_BIN/kaseki-pi-event-filter" <<'EOF_FILTER'
#!/usr/bin/env bash
: > "$2"
printf '%s\n' '{"selected_model":"test-model"}' > "$3"
EOF_FILTER
cat > "$FAKE_BIN/validation-output-filter" <<'EOF_VALIDATION_FILTER'
#!/usr/bin/env bash
cat
EOF_VALIDATION_FILTER

# These shims delegate repository-local Git work, but record network-facing
# GitHub operations if the terminal short circuit ever permits them.
REAL_GIT="$(command -v git)"
cat > "$FAKE_BIN/git" <<EOF_GIT
#!/usr/bin/env bash
if [ "\${1:-}" = push ]; then
  printf '%s\n' "git \$*" >> "$GITHUB_LOG"
fi
exec "$REAL_GIT" "\$@"
EOF_GIT
cat > "$FAKE_BIN/curl" <<EOF_CURL
#!/usr/bin/env bash
printf '%s\n' "curl \$*" >> "$GITHUB_LOG"
exit 99
EOF_CURL
cat > "$FAKE_BIN/github-app-token" <<EOF_TOKEN
#!/usr/bin/env bash
printf '%s\n' "github-app-token \$*" >> "$GITHUB_LOG"
exit 99
EOF_TOKEN
chmod +x "$FAKE_BIN"/*

# Redirect image-default locations while retaining the production entry point
# and helpers, so this exercises orchestration rather than source ordering.
sed "s#/results#$RESULTS_DIR#g; s#/workspace#$WORKSPACE_DIR#g; s#/app/lib#$TMP_DIR/app-lib#g" \
  "$REPO_ROOT/kaseki-agent.sh" > "$MODIFIED_SCRIPT"
chmod +x "$MODIFIED_SCRIPT"

set +e
env \
  PATH="$FAKE_BIN:$PATH" \
  REPO_URL="$SOURCE_REPO" \
  GIT_REF=main \
  TASK_PROMPT='Inspect the fixture repository.' \
  OPENROUTER_API_KEY=test \
  KASEKI_PROVIDER=openrouter \
  KASEKI_TASK_MODE=inspect \
  KASEKI_GIT_CACHE_MODE=off \
  KASEKI_BASELINE_VALIDATION_ENABLED=0 \
  KASEKI_PRE_AGENT_VALIDATION=0 \
  KASEKI_GOAL_SETTING=0 \
  KASEKI_SCOUTING=0 \
  KASEKI_GOAL_CHECK=0 \
  KASEKI_HASHLINE_EDITS=0 \
  KASEKI_VALIDATION_COMMANDS='record-validation post-agent' \
  KASEKI_RUN_EVALUATION=1 \
  KASEKI_RUN_EVALUATION_ON_FAILURE=1 \
  GITHUB_APP_ENABLED=0 \
  bash "$MODIFIED_SCRIPT" > "$RUN_LOG" 2>&1
run_exit=$?
set -e

[ "$run_exit" -eq 88 ] || fail "expected terminal exit 88, got $run_exit"
[ -s "$PROVIDER_LOG" ] || fail 'expected the coding provider shim to be invoked'
grep -Fq 'skipping downstream validation, evaluation, and GitHub operations' "$RESULTS_DIR/progress.jsonl" || \
  fail 'missing user-facing downstream short-circuit diagnostic in progress.jsonl'

[ -f "$RESULTS_DIR/metadata.json" ] || fail 'metadata.json was not created'
[ -f "$RESULTS_DIR/failure.json" ] || fail 'failure.json was not created'
node - "$RESULTS_DIR/metadata.json" "$RESULTS_DIR/failure.json" <<'NODE' || fail 'terminal artifacts did not preserve provider failure status'
const fs = require('node:fs');
const [metadataPath, failurePath] = process.argv.slice(2);
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
const failure = JSON.parse(fs.readFileSync(failurePath, 'utf8'));
if (metadata.exit_code !== 88) throw new Error(`metadata exit_code was ${metadata.exit_code}`);
if (failure.exit_code !== 88) throw new Error(`failure exit_code was ${failure.exit_code}`);
if (failure.failed_command !== 'pi coding agent') {
  throw new Error(`failure failed_command was ${failure.failed_command}`);

assert_empty "$VALIDATION_LOG" validation
assert_empty "$EVALUATION_LOG" evaluation
assert_empty "$GITHUB_LOG" GitHub-operation

printf 'PASS: %s\n' "$TEST_NAME"
