#!/usr/bin/env bash
# Integration test: a zero-exit empty assistant turn is retried and patch mode can still progress.

set -euo pipefail

TEST_NAME="empty assistant turn retry"
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
  [ ! -f "$RUN_LOG" ] || tail -140 "$RUN_LOG" >&2
  exit 1
}

mkdir -p "$FAKE_REPO/deps/fake-dep" "$FAKE_REPO/docs" "$FAKE_BIN" "$RESULTS_DIR" "$WORKSPACE_REPO" "$APP_LIB" "$TMP_DIR/scripts" "$TMP_DIR/scripts/lib"
cp "$REPO_ROOT/scripts/allowlist-helper.sh" "$TMP_DIR/scripts/allowlist-helper.sh"
if [ -f "$REPO_ROOT/scripts/scouting-allowlist.js" ]; then
  cp "$REPO_ROOT/scripts/scouting-allowlist.js" "$TMP_DIR/scripts/scouting-allowlist.js"
else
  cp "$REPO_ROOT/dist/scouting-allowlist.js" "$TMP_DIR/scripts/scouting-allowlist.js"
fi
cp "$REPO_ROOT/scripts/dependency-cache-helpers.sh" "$TMP_DIR/scripts/dependency-cache-helpers.sh"
cp "$REPO_ROOT/scripts/npm-install-helpers.sh" "$TMP_DIR/scripts/npm-install-helpers.sh"
cp "$REPO_ROOT/scripts/agent-prompt.sh" "$TMP_DIR/scripts/agent-prompt.sh"
cp "$REPO_ROOT/scripts/lib/json.sh" "$TMP_DIR/scripts/lib/json.sh"
cp "$REPO_ROOT/scripts/lib/json-events.sh" "$TMP_DIR/scripts/lib/json-events.sh"
touch "$APP_LIB/event-aggregator.js" "$APP_LIB/timestamp-tracker.js" "$APP_LIB/progress-stream-utils.js"
MODIFIED_SCRIPT="$TMP_DIR/kaseki-agent-modified.sh"
sed "s#\"\${KASEKI_WORKSPACE_DIR}\"/repo#$WORKSPACE_REPO#g; s#\${KASEKI_WORKSPACE_DIR}/repo#$WORKSPACE_REPO#g; s#/workspace/repo#$WORKSPACE_REPO#g; s#/results#$RESULTS_DIR#g; s#/app/lib#$APP_LIB#g" "$REPO_ROOT/kaseki-agent.sh" > "$MODIFIED_SCRIPT"
chmod +x "$MODIFIED_SCRIPT"

printf '%s\n' '{"name":"fake-patch-repo","version":"1.0.0","private":true,"scripts":{"check":"exit 0"},"dependencies":{"fake-dep":"file:deps/fake-dep"}}' > "$FAKE_REPO/package.json"
printf '%s\n' '{"name":"fake-dep","version":"1.0.0","private":true}' > "$FAKE_REPO/deps/fake-dep/package.json"
cat > "$FAKE_REPO/package-lock.json" <<'JSON'
{"name":"fake-patch-repo","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"fake-patch-repo","version":"1.0.0","dependencies":{"fake-dep":"file:deps/fake-dep"}},"deps/fake-dep":{"version":"1.0.0"},"node_modules/fake-dep":{"resolved":"deps/fake-dep","link":true}}}
JSON
printf '# Documentation Index\n\n### � Monitoring & Observability\n' > "$FAKE_REPO/docs/INDEX.md"
git -C "$FAKE_REPO" init -q -b main
git -C "$FAKE_REPO" add package.json package-lock.json deps/fake-dep/package.json docs/INDEX.md
git -C "$FAKE_REPO" -c user.email=kaseki-test@example.invalid -c user.name="Kaseki Test" commit -q -m initial

cat > "$FAKE_BIN/pi" <<EOF_PI
#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo "pi 0.0.0-test"; exit 0; fi
prompt="\${*: -1}"
if printf '%s' "\$prompt" | grep -q 'goal-setting Pi agent'; then
  printf 'goal-setting\n' >> "$PI_CALLS"
  printf '%s\n' '{"original_prompt":"Please analyse docs/INDEX.md for correct content and formatting","upgraded_goal":"Fix docs/INDEX.md content and formatting issues","reasoning":"test","key_requirements":["Correct docs/INDEX.md formatting"],"success_criteria":[]}' > "$RESULTS_DIR/goal-setting-candidate.json"
  printf '%s\n' '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"goal set"}],"stopReason":"stop"}}'
elif printf '%s' "\$prompt" | grep -q 'scouting Pi agent'; then
  printf 'scouting\n' >> "$PI_CALLS"
  # Simulate missing scouting artifact so fallback must infer docs/INDEX.md from the prompt.
  printf '%s\n' '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"scouted"}],"stopReason":"stop"}}'
elif printf '%s' "\$prompt" | grep -q 'read-only goal-check Pi agent'; then
  printf 'goal-check\n' >> "$PI_CALLS"
  printf '%s\n' '{"met":true,"confidence":"high","summary":"docs index formatting corrected","evidence":[],"missing":[],"retry_prompt":"","validation_notes":[]}' > "$RESULTS_DIR/goal-check-candidate.json"
  printf '%s\n' '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"goal check passed"}],"stopReason":"stop"}}'
else
  count=\$(grep -c '^coding$' "$PI_CALLS" 2>/dev/null || true)
  printf 'coding\n' >> "$PI_CALLS"
  if [ "\$count" -eq 0 ]; then
    printf '%s\n' '{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"stop","responseId":"resp_empty_test"},"toolResults":[]}'
  else
    perl -0pi -e 's/### .+ Monitoring & Observability/### Monitoring & Observability/' "$WORKSPACE_REPO/docs/INDEX.md"
    printf '%s\n' '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Updated docs/INDEX.md formatting."}],"stopReason":"stop","responseId":"resp_recovered_test"},"toolResults":[]}'
  fi
fi
EOF_PI
cat > "$FAKE_BIN/kaseki-pi-progress-stream" <<'EOF_PROGRESS'
#!/usr/bin/env bash
cat
EOF_PROGRESS
cat > "$FAKE_BIN/kaseki-pi-event-filter" <<'EOF_FILTER'
#!/usr/bin/env bash
cat "$1" > "$2"
printf '{"selected_model":"test-model"}\n' > "$3"
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
  OPENROUTER_API_KEY=test KASEKI_PROVIDER=openrouter GITHUB_APP_ENABLED=0 KASEKI_GIT_CACHE_MODE=off KASEKI_TASK_MODE=patch \
  KASEKI_GOAL_SETTING=1 KASEKI_SCOUTING=1 KASEKI_GOAL_CHECK=1 KASEKI_GOAL_CHECK_MAX_RETRIES=1 \
  KASEKI_WORKSPACE_DIR="$TMP_DIR" \
  KASEKI_DEPENDENCY_CACHE_DIR="$TMP_DIR/dependency-cache" KASEKI_IMAGE_DEPENDENCY_CACHE_DIR="$TMP_DIR/image-cache" \
  KASEKI_PRE_AGENT_VALIDATION_COMMANDS="npm run check" KASEKI_VALIDATION_COMMANDS=":" \
  bash "$MODIFIED_SCRIPT" > "$RUN_LOG" 2>&1
run_exit=$?
set -e

[ "$run_exit" -eq 0 ] || fail "expected exit 0 after retry, got $run_exit"
expected_calls=$'goal-setting\nscouting\ncoding\ncoding\ngoal-check'
actual_calls="$(cat "$PI_CALLS" 2>/dev/null || true)"
[ "$actual_calls" = "$expected_calls" ] || fail "expected empty turn retry then goal-check, got: $(tr '\n' ',' < "$PI_CALLS")"
[ -s "$RESULTS_DIR/pi-agent-diagnostics.jsonl" ] || fail "missing empty-turn diagnostics"
grep -q 'provider_empty_assistant_turn' "$RESULTS_DIR/pi-agent-diagnostics.jsonl" || fail "diagnostics did not classify empty assistant turn"
grep -q 'empty assistant turn' "$RESULTS_DIR/pi-stderr.log" || fail "retry guidance did not mention empty assistant turn"
grep -Fq '"required_files": [' "$RESULTS_DIR/critical-change-expectations.json" || fail "critical expectations missing required_files"
grep -q '"docs/INDEX.md"' "$RESULTS_DIR/critical-change-expectations.json" || fail "fallback did not infer docs/INDEX.md as required file"
grep -q '^docs/INDEX.md$' "$RESULTS_DIR/changed-files.txt" || fail "docs/INDEX.md should be changed after retry"
grep -q '### Monitoring & Observability' "$RESULTS_DIR/git.diff" || fail "expected recovered docs formatting diff"

echo "PASS: $TEST_NAME"
