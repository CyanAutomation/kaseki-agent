#!/usr/bin/env bash
# TDD Test: goal-check verdicts wrapped in markdown code fences are extracted correctly.
# This tests the enhanced JSON extraction logic (Tier 2 fix).
set -uo pipefail

TEST_NAME="goal-check markdown-wrapped JSON extraction"
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

if [[ ! -r "$REPO_ROOT/kaseki-agent.sh" ]]; then
  fail "kaseki-agent.sh not found or not readable"
fi

mkdir -p "$FAKE_REPO/deps/fake-dep" "$FAKE_BIN" "$RESULTS_DIR" "$WORKSPACE_REPO" "$APP_LIB" "$TMP_DIR/scripts" "$TMP_DIR/scripts/lib" || fail "failed to create test directories"
cp "$REPO_ROOT/scripts/allowlist-helper.sh" "$TMP_DIR/scripts/allowlist-helper.sh" || fail "failed to copy allowlist helper"
if [ -f "$REPO_ROOT/scripts/scouting-allowlist.js" ]; then
  cp "$REPO_ROOT/scripts/scouting-allowlist.js" "$TMP_DIR/scripts/scouting-allowlist.js"
else
  cp "$REPO_ROOT/dist/scouting-allowlist.js" "$TMP_DIR/scripts/scouting-allowlist.js" || fail "failed to copy scouting allowlist"
fi
cp "$REPO_ROOT/scripts/lib/json.sh" "$TMP_DIR/scripts/lib/json.sh"
cp "$REPO_ROOT/scripts/lib/json-events.sh" "$TMP_DIR/scripts/lib/json-events.sh"
cp "$REPO_ROOT/scripts/lib/artifact-consolidation.sh" "$TMP_DIR/scripts/lib/artifact-consolidation.sh"
cp "$REPO_ROOT/scripts/context-handoff.js" "$TMP_DIR/scripts/context-handoff.js"
touch "$APP_LIB/event-aggregator.js" "$APP_LIB/timestamp-tracker.js" "$APP_LIB/progress-stream-utils.js" || fail "failed to create app lib stubs"
: > "$PI_CALLS" || fail "failed to initialize Pi call log"

MODIFIED_SCRIPT="$TMP_DIR/kaseki-agent-modified.sh"
sed "s#\"\${KASEKI_WORKSPACE_DIR}\"/repo#$WORKSPACE_REPO#g; s#\${KASEKI_WORKSPACE_DIR}/repo#$WORKSPACE_REPO#g; s#/workspace/repo#$WORKSPACE_REPO#g; s#/results#$RESULTS_DIR#g; s#/app/lib#$APP_LIB#g" "$REPO_ROOT/kaseki-agent.sh" > "$MODIFIED_SCRIPT" || fail "failed to prepare modified kaseki-agent.sh"
chmod +x "$MODIFIED_SCRIPT" || fail "failed to make modified kaseki-agent.sh executable"
"$REPO_ROOT/tests/helpers/stage-scouting-templates.sh" "$REPO_ROOT" "$MODIFIED_SCRIPT"

printf '%s\n' '{"name":"fake-goal-check-repo","version":"1.0.0","private":true,"scripts":{"check":"exit 0"},"dependencies":{"fake-dep":"file:deps/fake-dep"}}' > "$FAKE_REPO/package.json" || fail "failed to write fake package.json"
printf '%s\n' '{"name":"fake-dep","version":"1.0.0","private":true}' > "$FAKE_REPO/deps/fake-dep/package.json" || fail "failed to write fake dependency package.json"
cat > "$FAKE_REPO/package-lock.json" <<'JSON' || fail "failed to write fake package-lock.json"
{"name":"fake-goal-check-repo","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"fake-goal-check-repo","version":"1.0.0","dependencies":{"fake-dep":"file:deps/fake-dep"}},"deps/fake-dep":{"version":"1.0.0"},"node_modules/fake-dep":{"resolved":"deps/fake-dep","link":true}}}
JSON
git -C "$FAKE_REPO" init -q -b main || fail "failed to initialize fake git repo"
git -C "$FAKE_REPO" add package.json package-lock.json deps/fake-dep/package.json || fail "failed to stage fake repo files"
git -C "$FAKE_REPO" -c user.email=kaseki-test@example.invalid -c user.name="Kaseki Test" commit -q -m initial || fail "failed to commit fake repo files"

cat > "$FAKE_BIN/pi" <<'EOF_PI' || fail "failed to write fake pi executable"
#!/usr/bin/env bash
set -e
if [ "${1:-}" = "--version" ]; then echo "pi 0.0.0-test"; exit 0; fi
prompt="${*: -1}"
if printf '%s' "$prompt" | grep -Fq 'You are a goal-setting Pi agent'; then
  printf 'goal-setting\n' >> "$PI_CALLS"
  printf '%s\n' '{"original_prompt":"inspect then code","upgraded_goal":"Upgraded: inspect then code","reasoning":"test","key_requirements":[],"success_criteria":[]}' > "$RESULTS_DIR/goal-setting-candidate.json"
elif printf '%s' "$prompt" | grep -Fq 'You are a read-only scouting Pi agent'; then
  printf 'scouting\n' >> "$PI_CALLS"
  printf '%s\n' '{"task":"inspect","requirements":[],"relevant_files":[],"observations":[],"plan":[],"validation":[],"risks":[],"test_impact":[]}' > "$RESULTS_DIR/scouting-candidate.json"
elif printf '%s' "$prompt" | grep -Fq 'You are a read-only goal-check Pi agent'; then
  printf 'goal-check\n' >> "$PI_CALLS"
  # MARKDOWN WRAPPED JSON: Simulates model wrapping JSON in code fences
  # This is the key test case: extraction must handle this pattern
  # Emit the provider event stream on stdout; this is what run_pi_json_capture
  # persists and what the controller's recovery logic parses.
  cat <<'EOF_VERDICT'
{"type":"message_start","role":"assistant"}
{"type":"text_delta","text":"Let me analyze this carefully:"}
{"type":"text_delta","text":"\n\n\`\`\`json"}
{"type":"text_delta","text":"\n{\"met\":true,\"confidence\":\"high\",\"summary\":\"Requirements met\",\"evidence\":[\"Changed README.md\"],\"missing\":[],\"retry_prompt\":\"\",\"validation_notes\":[\"npm check passed\"],\"evidence_sources_inspected\":[\"goal-setting.json\",\"changed-files.txt\"],\"contradictions\":[],\"confidence_calibration\":{\"outcome\":\"met\",\"justification\":\"Evidence supports verdict\"}}"}
{"type":"text_delta","text":"\n\`\`\`"}
EOF_VERDICT
else
  # The fixture also handles the normal coding phase. The phase-order
  # assertion below ensures goal-setting and scouting are not misclassified.
  printf 'coding\n' >> "$PI_CALLS"
  printf '%s' "$prompt" > "$RESULTS_DIR/coding-prompt.txt"
fi
printf '{"type":"message","model":"test-model"}\n'
EOF_PI
chmod +x "$FAKE_BIN/pi"

cat > "$FAKE_BIN/kaseki-pi-progress-stream" <<'EOF_PROGRESS' || fail "failed to write fake progress stream executable"
#!/usr/bin/env bash
cat
EOF_PROGRESS
chmod +x "$FAKE_BIN/kaseki-pi-progress-stream"

cat > "$FAKE_BIN/kaseki-pi-event-filter" <<'EOF_FILTER' || fail "failed to write fake event filter executable"
#!/usr/bin/env bash
cat "$1" > "$2"
printf '{"selected_model":"test-model"}\n' > "$3"
EOF_FILTER
chmod +x "$FAKE_BIN/kaseki-pi-event-filter"

cat > "$FAKE_BIN/timeout" <<'EOF_TIMEOUT' || fail "failed to write fake timeout executable"
#!/usr/bin/env bash
while [[ "${1:-}" == --* ]]; do
  shift
done
shift
"$@"
EOF_TIMEOUT
chmod +x "$FAKE_BIN/timeout"

cat > "$FAKE_BIN/validation-output-filter" <<'EOF_VALIDATION_FILTER' || fail "failed to write fake validation output filter executable"
#!/usr/bin/env bash
cat
EOF_VALIDATION_FILTER
chmod +x "$FAKE_BIN/validation-output-filter"

env PATH="$FAKE_BIN:$PATH" PI_CALLS="$PI_CALLS" RESULTS_DIR="$RESULTS_DIR" REPO_URL="$FAKE_REPO" GIT_REF=main TASK_PROMPT="inspect then code" KASEKI_PROVIDER=openrouter \
  OPENROUTER_API_KEY=test GITHUB_APP_ENABLED=0 KASEKI_GIT_CACHE_MODE=off KASEKI_GOAL_CHECK_MAX_RETRIES=0 \
  KASEKI_JEV_WORKFLOW=0 \
  KASEKI_WORKSPACE_DIR="$TMP_DIR" \
  KASEKI_DEPENDENCY_CACHE_DIR="$TMP_DIR/dependency-cache" KASEKI_IMAGE_DEPENDENCY_CACHE_DIR="$TMP_DIR/image-cache" \
  KASEKI_PRE_AGENT_VALIDATION_COMMANDS="npm run check" KASEKI_VALIDATION_COMMANDS=":" KASEKI_ALLOW_EMPTY_DIFF=1 \
  bash "$MODIFIED_SCRIPT" > "$RUN_LOG" 2>&1
run_exit=$?

[ "$run_exit" -eq 0 ] || fail "expected success with markdown-wrapped JSON, got exit $run_exit"

# Verify the fake provider recognized the current pre-goal-check prompts rather
# than falling through before the markdown extraction path was exercised.
expected_phases=$'goal-setting\nscouting\ncoding\ngoal-check'
actual_phases="$(head -4 "$PI_CALLS" 2>/dev/null || true)"
[ "$actual_phases" = "$expected_phases" ] || fail "unexpected fake Pi phase order: $(printf '%q' "$actual_phases")"

# Verify the extracted JSON was validated and persisted as the durable artifact.
[ -f "$RESULTS_DIR/goal-check.json" ] || fail "goal-check.json not found"
node - "$RESULTS_DIR/goal-check.json" <<'NODE' || fail "final goal-check verdict is invalid"
const verdict = require(process.argv[2]);
if (verdict.met !== true) throw new Error('final verdict met should be true');
if (verdict.confidence !== 'high') throw new Error('final verdict confidence should be high');
if (!Array.isArray(verdict.evidence)) throw new Error('evidence must be array');
if (!Array.isArray(verdict.missing)) throw new Error('missing must be array');
NODE

echo "PASS: $TEST_NAME"
