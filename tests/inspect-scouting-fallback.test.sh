#!/usr/bin/env bash
# Integration test: inspect mode continues with a warning when scouting omits its candidate artifact.

set -euo pipefail

TEST_NAME="inspect scouting fallback"
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
  [ ! -f "$RUN_LOG" ] || tail -100 "$RUN_LOG" >&2
  exit 1
}

mkdir -p "$FAKE_REPO/deps/fake-dep" "$FAKE_BIN" "$RESULTS_DIR" "$WORKSPACE_REPO" "$APP_LIB" "$TMP_DIR/scripts" "$TMP_DIR/scripts/lib"
cp "$REPO_ROOT/scripts/allowlist-helper.sh" "$TMP_DIR/scripts/allowlist-helper.sh"
if [ -f "$REPO_ROOT/scripts/scouting-allowlist.js" ]; then
  cp "$REPO_ROOT/scripts/scouting-allowlist.js" "$TMP_DIR/scripts/scouting-allowlist.js"
else
  cp "$REPO_ROOT/dist/scouting-allowlist.js" "$TMP_DIR/scripts/scouting-allowlist.js" || fail "failed to copy scouting allowlist"
fi
cp "$REPO_ROOT/scripts/lib/json.sh" "$TMP_DIR/scripts/lib/json.sh"
cp "$REPO_ROOT/scripts/lib/json-events.sh" "$TMP_DIR/scripts/lib/json-events.sh"
cp "$REPO_ROOT/scripts/lib/artifact-consolidation.sh" "$TMP_DIR/scripts/lib/artifact-consolidation.sh"
cp "$REPO_ROOT/scripts/write-run-metadata.mjs" "$TMP_DIR/scripts/write-run-metadata.mjs"
touch "$APP_LIB/event-aggregator.js" "$APP_LIB/timestamp-tracker.js" "$APP_LIB/progress-stream-utils.js"
MODIFIED_SCRIPT="$TMP_DIR/kaseki-agent-modified.sh"
sed "s#\"\${KASEKI_WORKSPACE_DIR}\"/repo#$WORKSPACE_REPO#g; s#\${KASEKI_WORKSPACE_DIR}/repo#$WORKSPACE_REPO#g; s#/workspace/repo#$WORKSPACE_REPO#g; s#/results#$RESULTS_DIR#g; s#/app/lib#$APP_LIB#g" "$REPO_ROOT/kaseki-agent.sh" > "$MODIFIED_SCRIPT"
chmod +x "$MODIFIED_SCRIPT"
"$REPO_ROOT/tests/helpers/stage-scouting-templates.sh" "$REPO_ROOT" "$MODIFIED_SCRIPT"

printf '%s\n' '{"name":"fake-inspect-repo","version":"1.0.0","private":true,"scripts":{"check":"exit 0"},"dependencies":{"fake-dep":"file:deps/fake-dep"}}' > "$FAKE_REPO/package.json"
printf '%s\n' '{"name":"fake-dep","version":"1.0.0","private":true}' > "$FAKE_REPO/deps/fake-dep/package.json"
cat > "$FAKE_REPO/package-lock.json" <<'JSON'
{"name":"fake-inspect-repo","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"fake-inspect-repo","version":"1.0.0","dependencies":{"fake-dep":"file:deps/fake-dep"}},"deps/fake-dep":{"version":"1.0.0"},"node_modules/fake-dep":{"resolved":"deps/fake-dep","link":true}}}
JSON
git -C "$FAKE_REPO" init -q -b main
git -C "$FAKE_REPO" add package.json package-lock.json deps/fake-dep/package.json
git -C "$FAKE_REPO" -c user.email=kaseki-test@example.invalid -c user.name="Kaseki Test" commit -q -m initial

cat > "$FAKE_BIN/pi" <<EOF_PI
#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo "pi 0.0.0-test"; exit 0; fi
if [ "\${1:-}" = "--list-models" ]; then echo "gateway"; exit 0; fi
prompt="\${*: -1}"
if printf '%s' "\$prompt" | grep -q 'goal-setting Pi agent'; then
  printf 'goal-setting\n' >> "$PI_CALLS"
  printf '%s\n' '{"original_prompt":"inspect only","upgraded_goal":"Inspect only","reasoning":"test","key_requirements":[],"success_criteria":[]}' > "$RESULTS_DIR/goal-setting-candidate.json"
  printf '%s\n' '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"goal-setting response"}],"stopReason":"stop","responseId":"resp_goal_1"},"toolResults":[]}'
elif printf '%s' "\$prompt" | grep -q 'read-only scouting Pi agent'; then
  printf 'scouting\n' >> "$PI_CALLS"
  # Simulate a model/tool path that exits 0 but forgets to write scouting-candidate.json.
  printf '%s\n' '{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"stop","responseId":"resp_scout_empty"},"toolResults":[]}'
elif printf '%s' "\$prompt" | grep -q 'read-only goal-check Pi agent'; then
  printf 'goal-check\n' >> "$PI_CALLS"
  printf '%s\n' '{"met":true,"confidence":"high","summary":"inspect done","evidence":[],"missing":[],"retry_prompt":"","validation_notes":[],"evidence_sources_inspected":[],"contradictions":[],"confidence_calibration":{"outcome":"confident","justification":"test"}}' > "$RESULTS_DIR/goal-check-candidate.json"
  printf '%s\n' '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"goal-check response"}],"stopReason":"stop","responseId":"resp_check_1"},"toolResults":[]}'
else
  printf 'coding\n' >> "$PI_CALLS"
  printf '%s\n' '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"read-only inspect output"}],"stopReason":"stop","responseId":"resp_coding_1"},"toolResults":[]}'
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

# Generate a proper summary JSON with required fields
# Support phase-specific summaries based on the summary file path
if [[ "$summary" == *"goal-check-summary"* ]]; then
  cat > "$summary" <<'JSON'
{
  "selected_model": "test-model",
  "selected_api": "gateway",
  "event_counts": {"message_end": 1},
  "assistant_event_counts": {"message_end": 1},
  "tool_start_count": 0,
  "tool_end_count": 0,
  "invalid_json_lines": 0,
  "first_event_at": "2026-09-18T00:00:00Z",
  "last_event_at": "2026-09-18T00:00:01Z",
  "completion_usage": [],
  "provider_errors": [],
  "raw_goal_check_response": "{\"met\":true,\"confidence\":\"high\",\"summary\":\"inspect done\",\"evidence\":[],\"missing\":[],\"retry_prompt\":\"\",\"validation_notes\":[],\"evidence_sources_inspected\":[],\"contradictions\":[],\"confidence_calibration\":{\"outcome\":\"confident\",\"justification\":\"test\"}}"
}
JSON
elif [[ "$summary" == *"scouting-summary"* ]]; then
  cat > "$summary" <<'JSON'
{
  "selected_model": "test-model",
  "selected_api": "gateway",
  "event_counts": {"message_end": 1},
  "assistant_event_counts": {"message_end": 1},
  "tool_start_count": 0,
  "tool_end_count": 0,
  "invalid_json_lines": 0,
  "first_event_at": "2026-09-18T00:00:00Z",
  "last_event_at": "2026-09-18T00:00:01Z",
  "completion_usage": [],
  "provider_errors": [],
  "provider_empty_assistant_turn": false
}
JSON
else
  cat > "$summary" <<'JSON'
{
  "selected_model": "test-model",
  "selected_api": "gateway",
  "event_counts": {"message_end": 1},
  "assistant_event_counts": {"message_end": 1},
  "tool_start_count": 0,
  "tool_end_count": 0,
  "invalid_json_lines": 0,
  "first_event_at": "2026-09-18T00:00:00Z",
  "last_event_at": "2026-09-18T00:00:01Z",
  "completion_usage": [],
  "provider_errors": []
}
JSON
fi
EOF_FILTER
cat > "$FAKE_BIN/timeout" <<'EOF_TIMEOUT'
#!/usr/bin/env bash
while [[ "${1:-}" == -* ]]; do shift; done
shift
"$@"
EOF_TIMEOUT
cat > "$FAKE_BIN/validation-output-filter" <<'EOF_VALIDATION_FILTER'
#!/usr/bin/env bash
cat
EOF_VALIDATION_FILTER
chmod +x "$FAKE_BIN"/*

set +e
env PATH="$FAKE_BIN:$PATH" REPO_URL="$FAKE_REPO" GIT_REF=main TASK_PROMPT="inspect only" \
  OPENROUTER_API_KEY=test LLM_GATEWAY_URL=https://example.invalid/v1 LLM_GATEWAY_API_KEY=test GITHUB_APP_ENABLED=0 KASEKI_GIT_CACHE_MODE=off KASEKI_TASK_MODE=inspect \
  KASEKI_GOAL_SETTING=1 KASEKI_SCOUTING=1 KASEKI_GOAL_CHECK=1 \
  KASEKI_JEV_WORKFLOW=0 \
  KASEKI_WORKSPACE_DIR="$TMP_DIR" \
  KASEKI_DEPENDENCY_CACHE_DIR="$TMP_DIR/dependency-cache" KASEKI_IMAGE_DEPENDENCY_CACHE_DIR="$TMP_DIR/image-cache" \
  KASEKI_PRE_AGENT_VALIDATION_COMMANDS="npm run check" KASEKI_VALIDATION_COMMANDS=":" \
  KASEKI_SKIP_GATEWAY_HEALTH_CHECK=1 \
  bash "$MODIFIED_SCRIPT" > "$RUN_LOG" 2>&1
run_exit=$?
set -e

[ "$run_exit" -eq 0 ] || fail "expected zero exit, got $run_exit"
expected_calls=$'goal-setting\nscouting\ncoding\ngoal-check'
actual_calls="$(cat "$PI_CALLS" 2>/dev/null || true)"
[ "$actual_calls" = "$expected_calls" ] || fail "expected fallback to continue through inspect agent, got: $(tr '\n' ',' < "$PI_CALLS")"
[ -s "$RESULTS_DIR/scouting.json" ] || fail "fallback scouting.json was not produced"
grep -q 'missing_scouting_candidate_for_inspect_mode' "$RESULTS_DIR/scouting.json" || fail "fallback reason missing"
grep -q '"reason_code":"inspect_fallback"' "$RESULTS_DIR/scouting-validation-errors.jsonl" || fail "fallback warning missing"
grep -q '^pi scouting agent[[:space:]]0[[:space:]]' "$RESULTS_DIR/stage-timings.tsv" || fail "scouting stage should remain successful"
node -e 'const fs=require("node:fs");const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(m.scouting_exit_code!==0)throw new Error("expected successful scouting");' "$RESULTS_DIR/metadata.json" || fail "metadata did not record successful scouting"

echo "PASS: $TEST_NAME"
