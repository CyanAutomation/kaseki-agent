#!/usr/bin/env bash
# Regression test: Pi provider/model errors should fail as provider errors, not empty diffs.

set -euo pipefail

TEST_NAME="provider model error classification"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
FAKE_REPO="$TMP_DIR/fake-repo"
FAKE_BIN="$TMP_DIR/bin"
RESULTS_DIR="$TMP_DIR/results"
WORKSPACE_REPO="$TMP_DIR/repo"
APP_LIB="$TMP_DIR/app/lib"
PI_CALLS="$TMP_DIR/pi-calls.log"
RUN_LOG="$TMP_DIR/kaseki-run.log"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "FAIL: $TEST_NAME: $*" >&2
  [ ! -f "$RUN_LOG" ] || tail -120 "$RUN_LOG" >&2
  exit 1
}

mkdir -p "$FAKE_REPO/deps/fake-dep" "$FAKE_BIN" "$RESULTS_DIR" "$WORKSPACE_REPO" "$APP_LIB" "$TMP_DIR/scripts" "$TMP_DIR/scripts/lib"
cp "$REPO_ROOT/scripts/allowlist-helper.sh" "$TMP_DIR/scripts/allowlist-helper.sh"
cp "$REPO_ROOT/scripts/scouting-allowlist.js" "$TMP_DIR/scripts/scouting-allowlist.js"
cp "$REPO_ROOT/scripts/lib/json.sh" "$TMP_DIR/scripts/lib/json.sh"
touch "$APP_LIB/event-aggregator.js" "$APP_LIB/timestamp-tracker.js" "$APP_LIB/progress-stream-utils.js"
MODIFIED_SCRIPT="$TMP_DIR/kaseki-agent-modified.sh"
sed "s#\"\${KASEKI_WORKSPACE_DIR}\"/repo#$WORKSPACE_REPO#g; s#\${KASEKI_WORKSPACE_DIR}/repo#$WORKSPACE_REPO#g; s#/workspace/repo#$WORKSPACE_REPO#g; s#/results#$RESULTS_DIR#g; s#/app/lib#$APP_LIB#g" "$REPO_ROOT/kaseki-agent.sh" > "$MODIFIED_SCRIPT"
chmod +x "$MODIFIED_SCRIPT"

printf '%s\n' 'initial content' > "$FAKE_REPO/README.md"
git -C "$FAKE_REPO" init -q -b main
git -C "$FAKE_REPO" add README.md
git -C "$FAKE_REPO" -c user.email=kaseki-test@example.invalid -c user.name="Kaseki Test" commit -q -m initial

cat > "$FAKE_BIN/pi" <<EOF_PI
#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo "pi 0.0.0-test"; exit 0; fi
printf 'coding\n' >> "$PI_CALLS"
printf '%s\n' '{"type":"message","timestamp":"2026-01-01T00:00:00.000Z","message":{"provider":"openrouter","api":"responses","model":"z-ai/glm-4.5-air:free","stopReason":"error","errorMessage":"404 This model is unavailable for free."}}'
EOF_PI
cat > "$FAKE_BIN/kaseki-pi-progress-stream" <<'EOF_PROGRESS'
#!/usr/bin/env bash
cat
EOF_PROGRESS
cat > "$FAKE_BIN/kaseki-pi-event-filter" <<'EOF_FILTER'
#!/usr/bin/env bash
cat "$1" > "$2"
cat > "$3" <<'JSON'
{
  "selected_model": "z-ai/glm-4.5-air:free",
  "selected_api": "responses",
  "primary_provider_error": {
    "type": "model_unavailable",
    "provider": "openrouter",
    "api": "responses",
    "model": "z-ai/glm-4.5-air:free",
    "stop_reason": "error",
    "message": "404 This model is unavailable for free."
  },
  "provider_errors": [
    {
      "type": "model_unavailable",
      "provider": "openrouter",
      "api": "responses",
      "model": "z-ai/glm-4.5-air:free",
      "stop_reason": "error",
      "message": "404 This model is unavailable for free."
    }
  ]
}
JSON
EOF_FILTER
cat > "$FAKE_BIN/timeout" <<'EOF_TIMEOUT'
#!/usr/bin/env bash
shift 2
"$@"
EOF_TIMEOUT
cat > "$FAKE_BIN/validation-output-filter" <<'EOF_VALIDATION_FILTER'
#!/usr/bin/env bash
cat
EOF_VALIDATION_FILTER
chmod +x "$FAKE_BIN"/*

set +e
env PATH="$FAKE_BIN:$PATH" REPO_URL="$FAKE_REPO" GIT_REF=main TASK_PROMPT="make a required change" \
  OPENROUTER_API_KEY=test GITHUB_APP_ENABLED=0 KASEKI_GIT_CACHE_MODE=off KASEKI_TASK_MODE=patch \
  KASEKI_GOAL_SETTING=0 KASEKI_SCOUTING=0 KASEKI_GOAL_CHECK=1 KASEKI_GOAL_CHECK_MAX_RETRIES=0 \
  KASEKI_HASHLINE_EDITS=0 KASEKI_RUN_EVALUATION=0 KASEKI_BASELINE_VALIDATION_ENABLED=0 \
  KASEKI_WORKSPACE_DIR="$TMP_DIR" \
  KASEKI_DEPENDENCY_CACHE_DIR="$TMP_DIR/dependency-cache" KASEKI_IMAGE_DEPENDENCY_CACHE_DIR="$TMP_DIR/image-cache" \
  KASEKI_PRE_AGENT_VALIDATION_COMMANDS=":" KASEKI_VALIDATION_COMMANDS=":" \
  bash "$MODIFIED_SCRIPT" > "$RUN_LOG" 2>&1
run_exit=$?
set -e

[ "$run_exit" -eq 88 ] || fail "expected exit 88, got $run_exit"
[ "$(cat "$PI_CALLS" 2>/dev/null || true)" = "coding" ] || fail "expected exactly one coding attempt"
node -e 'const fs=require("node:fs");const f=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(f.failed_command!=="pi provider error") throw new Error(f.failed_command);if(f.provider_error_type!=="model_unavailable") throw new Error(f.provider_error_type);if(!String(f.diagnostic_reason).includes("model_unavailable")) throw new Error(f.diagnostic_reason);if(String(f.diagnostic_reason).includes("empty diff")) throw new Error("misclassified as empty diff: "+f.diagnostic_reason);' "$RESULTS_DIR/failure.json" || fail "failure.json did not preserve provider error"
grep -q 'model_unavailable' "$RESULTS_DIR/progress.jsonl" || fail "progress did not include provider error event"

echo "PASS: $TEST_NAME"
