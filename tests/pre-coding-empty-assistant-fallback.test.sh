#!/usr/bin/env bash
# Integration test: empty assistant turns in goal-setting/scouting degrade to fallback artifacts.

set -euo pipefail

TEST_NAME="pre-coding empty assistant fallback"
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
  [ ! -f "$RUN_LOG" ] || tail -160 "$RUN_LOG" >&2
  exit 1
}

mkdir -p "$FAKE_REPO/deps/fake-dep" "$FAKE_REPO/docs" "$FAKE_BIN" "$RESULTS_DIR" "$WORKSPACE_REPO" "$APP_LIB" "$TMP_DIR/scripts" "$TMP_DIR/scripts/lib"
cp "$REPO_ROOT/scripts/allowlist-helper.sh" "$TMP_DIR/scripts/allowlist-helper.sh"
if [ -f "$REPO_ROOT/scripts/scouting-allowlist.js" ]; then
  cp "$REPO_ROOT/scripts/scouting-allowlist.js" "$TMP_DIR/scripts/scouting-allowlist.js"
else
  cp "$REPO_ROOT/dist/scripts/scouting-allowlist.js" "$TMP_DIR/scripts/scouting-allowlist.js"
fi
cp "$REPO_ROOT/scripts/dependency-cache-helpers.sh" "$TMP_DIR/scripts/dependency-cache-helpers.sh"
cp "$REPO_ROOT/scripts/npm-install-helpers.sh" "$TMP_DIR/scripts/npm-install-helpers.sh"
cp "$REPO_ROOT/scripts/agent-prompt.sh" "$TMP_DIR/scripts/agent-prompt.sh"
cp "$REPO_ROOT/scripts/lib/json.sh" "$TMP_DIR/scripts/lib/json.sh"
cp "$REPO_ROOT/scripts/lib/json-events.sh" "$TMP_DIR/scripts/lib/json-events.sh"
touch "$APP_LIB/event-aggregator.js" "$APP_LIB/timestamp-tracker.js" "$APP_LIB/progress-stream-utils.js"
: > "$PI_CALLS"

MODIFIED_SCRIPT="$TMP_DIR/kaseki-agent-modified.sh"
sed "s#\"\${KASEKI_WORKSPACE_DIR}\"/repo#$WORKSPACE_REPO#g; s#\${KASEKI_WORKSPACE_DIR}/repo#$WORKSPACE_REPO#g; s#/workspace/repo#$WORKSPACE_REPO#g; s#/results#$RESULTS_DIR#g; s#/app/lib#$APP_LIB#g" "$REPO_ROOT/kaseki-agent.sh" > "$MODIFIED_SCRIPT"
chmod +x "$MODIFIED_SCRIPT"

printf '%s\n' '{"name":"fake-pre-coding-empty-repo","version":"1.0.0","private":true,"scripts":{"check":"exit 0"},"dependencies":{"fake-dep":"file:deps/fake-dep"}}' > "$FAKE_REPO/package.json"
printf '%s\n' '{"name":"fake-dep","version":"1.0.0","private":true}' > "$FAKE_REPO/deps/fake-dep/package.json"
cat > "$FAKE_REPO/package-lock.json" <<'JSON'
{"name":"fake-pre-coding-empty-repo","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"fake-pre-coding-empty-repo","version":"1.0.0","dependencies":{"fake-dep":"file:deps/fake-dep"}},"deps/fake-dep":{"version":"1.0.0"},"node_modules/fake-dep":{"resolved":"deps/fake-dep","link":true}}}
JSON
printf '# Documentation Index\n\n### � Monitoring & Observability\n' > "$FAKE_REPO/docs/INDEX.md"
git -C "$FAKE_REPO" init -q -b main
git -C "$FAKE_REPO" add package.json package-lock.json deps/fake-dep/package.json docs/INDEX.md
git -C "$FAKE_REPO" -c user.email=kaseki-test@example.invalid -c user.name="Kaseki Test" commit -q -m initial

cat > "$FAKE_BIN/pi" <<EOF_PI
#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo "pi 0.0.0-test"; exit 0; fi
if [ "\${1:-}" = "--list-models" ]; then echo "gateway/auto"; exit 0; fi
prompt="\${*: -1}"
if printf '%s' "\$prompt" | grep -q 'goal-setting Pi agent'; then
  printf 'goal-setting\n' >> "$PI_CALLS"
  printf '%s\n' '{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"stop","responseId":"resp_goal_empty"},"toolResults":[]}'
elif printf '%s' "\$prompt" | grep -q 'read-only scouting Pi agent'; then
  printf 'scouting\n' >> "$PI_CALLS"
  printf '%s\n' '{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"stop","responseId":"resp_scout_empty"},"toolResults":[]}'
elif printf '%s' "\$prompt" | grep -q 'read-only goal-check Pi agent'; then
  printf 'goal-check\n' >> "$PI_CALLS"
  printf '%s\n' '{"met":true,"confidence":"high","summary":"docs index formatting corrected","evidence":[],"missing":[],"retry_prompt":"","validation_notes":[]}' > "$RESULTS_DIR/goal-check-candidate.json"
  printf '%s\n' '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"goal check passed"}],"stopReason":"stop"}}'
else
  printf 'coding\n' >> "$PI_CALLS"
  perl -0pi -e 's/### .+ Monitoring & Observability/### Monitoring & Observability/' "$WORKSPACE_REPO/docs/INDEX.md"
  printf '%s\n' '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Updated docs index."}],"stopReason":"stop"}}'
fi
EOF_PI
cat > "$FAKE_BIN/kaseki-pi-progress-stream" <<'EOF_PROGRESS'
#!/usr/bin/env bash
cat
EOF_PROGRESS
cat > "$FAKE_BIN/kaseki-pi-event-filter" <<'EOF_FILTER'
#!/usr/bin/env bash
raw="$1"
events="$2"
summary="$3"
cat "$raw" > "$events"
if grep -q '"content":\[\]' "$raw"; then
  phase="coding"
  case "$summary" in
    *goal-setting-summary.json) phase="goal-setting" ;;
    *scouting-summary.json) phase="scouting" ;;
  esac
  cat > "$summary" <<JSON
{"selected_model":"auto","selected_api":"openai-responses","primary_provider_error":{"type":"provider_empty_assistant_turn","provider":"gateway","api":"openai-responses","model":"auto","stop_reason":"stop","response_id":"resp_empty_${phase}","input_tokens":100,"output_tokens":7,"total_tokens":107,"message":"Provider returned a successful stop response with output tokens but no assistant text or tool calls. provider=gateway api=openai-responses model=auto response_id=resp_empty_${phase} input_tokens=100 output_tokens=7 total_tokens=107"}}
JSON
else
  printf '{"selected_model":"auto"}\n' > "$summary"
fi
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
env PATH="$FAKE_BIN:$PATH" REPO_URL="$FAKE_REPO" GIT_REF=main TASK_PROMPT="Please analyse docs/INDEX.md for correct content and formatting" \
  OPENROUTER_API_KEY=test KASEKI_PROVIDER=gateway LLM_GATEWAY_API_KEY=test LLM_GATEWAY_URL=https://gateway.example/v1 \
  GITHUB_APP_ENABLED=0 KASEKI_GIT_CACHE_MODE=off KASEKI_TASK_MODE=patch \
  KASEKI_GOAL_SETTING=1 KASEKI_SCOUTING=1 KASEKI_GOAL_CHECK=1 KASEKI_GOAL_CHECK_MAX_RETRIES=1 \
  KASEKI_WORKSPACE_DIR="$TMP_DIR" \
  KASEKI_DEPENDENCY_CACHE_DIR="$TMP_DIR/dependency-cache" KASEKI_IMAGE_DEPENDENCY_CACHE_DIR="$TMP_DIR/image-cache" \
  KASEKI_PRE_AGENT_VALIDATION_COMMANDS="npm run check" KASEKI_VALIDATION_COMMANDS=":" \
  bash "$MODIFIED_SCRIPT" > "$RUN_LOG" 2>&1
run_exit=$?
set -e

[ "$run_exit" -eq 0 ] || fail "expected exit 0 with pre-coding fallbacks, got $run_exit"
[ "$(cat "$PI_CALLS")" = $'goal-setting\nscouting\ncoding\ngoal-check' ] || fail "unexpected Pi calls: $(tr '\n' ',' < "$PI_CALLS")"
grep -q 'provider_empty_assistant_turn' "$RESULTS_DIR/goal-setting-validation-errors.jsonl" || fail "goal-setting fallback did not record empty assistant provider error"
grep -q 'provider_empty_assistant_turn' "$RESULTS_DIR/scouting-validation-errors.jsonl" || fail "scouting fallback did not record empty assistant provider error"
grep -q '"fallback_reason": "missing_scouting_candidate_for_patch_mode"' "$RESULTS_DIR/scouting.json" || fail "scouting patch fallback artifact missing"
grep -q '^docs/INDEX.md$' "$RESULTS_DIR/changed-files.txt" || fail "coding should still update docs/INDEX.md"
node - "$RESULTS_DIR/metadata.json" <<'NODE' || fail "metadata did not preserve provider fallback details"
const fs = require('node:fs');
const metadata = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (metadata.exit_code !== 0) throw new Error(`expected final exit 0, got ${metadata.exit_code}`);
if (metadata.goal_setting_fallback_used !== true) throw new Error('goal_setting_fallback_used should be true');
if (metadata.goal_setting_exit_code !== 0) throw new Error(`goal_setting_exit_code should be 0 after fallback, got ${metadata.goal_setting_exit_code}`);
if (metadata.scouting_exit_code !== 0) throw new Error(`scouting_exit_code should be 0 after fallback, got ${metadata.scouting_exit_code}`);
NODE

echo "PASS: $TEST_NAME"
