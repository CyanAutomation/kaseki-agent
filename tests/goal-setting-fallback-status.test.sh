#!/usr/bin/env bash
# Integration test: optional goal-setting validation failure falls back without failing final run.

set -euo pipefail

TEST_NAME="goal-setting fallback status"
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
cp "$REPO_ROOT/scripts/lib/json-events.sh" "$TMP_DIR/scripts/lib/json-events.sh"
cp "$REPO_ROOT/scripts/lib/artifact-consolidation.sh" "$TMP_DIR/scripts/lib/artifact-consolidation.sh"
touch "$APP_LIB/event-aggregator.js" "$APP_LIB/timestamp-tracker.js" "$APP_LIB/progress-stream-utils.js"
: > "$PI_CALLS"

MODIFIED_SCRIPT="$TMP_DIR/kaseki-agent-modified.sh"
sed "s#\"\${KASEKI_WORKSPACE_DIR}\"/repo#$WORKSPACE_REPO#g; s#\${KASEKI_WORKSPACE_DIR}/repo#$WORKSPACE_REPO#g; s#/workspace/repo#$WORKSPACE_REPO#g; s#/results#$RESULTS_DIR#g; s#/app/lib#$APP_LIB#g" "$REPO_ROOT/kaseki-agent.sh" > "$MODIFIED_SCRIPT"
chmod +x "$MODIFIED_SCRIPT"
"$REPO_ROOT/tests/helpers/stage-scouting-templates.sh" "$REPO_ROOT" "$MODIFIED_SCRIPT"

printf '%s\n' '{"name":"fake-goal-fallback-repo","version":"1.0.0","private":true,"scripts":{"check":"exit 0"},"dependencies":{"fake-dep":"file:deps/fake-dep"}}' > "$FAKE_REPO/package.json"
printf '%s\n' '{"name":"fake-dep","version":"1.0.0","private":true}' > "$FAKE_REPO/deps/fake-dep/package.json"
cat > "$FAKE_REPO/package-lock.json" <<'JSON'
{"name":"fake-goal-fallback-repo","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"fake-goal-fallback-repo","version":"1.0.0","dependencies":{"fake-dep":"file:deps/fake-dep"}},"deps/fake-dep":{"version":"1.0.0"},"node_modules/fake-dep":{"resolved":"deps/fake-dep","link":true}}}
JSON
git -C "$FAKE_REPO" init -q -b main
git -C "$FAKE_REPO" add package.json package-lock.json deps/fake-dep/package.json
git -C "$FAKE_REPO" -c user.email=kaseki-test@example.invalid -c user.name="Kaseki Test" commit -q -m initial

cat > "$FAKE_BIN/pi" <<EOF_PI
#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo "pi 0.0.0-test"; exit 0; fi
prompt="\${*: -1}"
if printf '%s' "\$prompt" | grep -q 'goal-setting Pi agent'; then
  printf 'goal-setting\n' >> "$PI_CALLS"
  printf '%s\n' '{"original_prompt":"inspect then code","upgraded_goal":"INVALID UPGRADED GOAL SHOULD NOT BE USED","reasoning":"test","key_requirements":"not-an-array","success_criteria":[]}' > "$RESULTS_DIR/goal-setting-candidate.json"
elif printf '%s' "\$prompt" | grep -q 'read-only scouting Pi agent'; then
  printf 'scouting\n' >> "$PI_CALLS"
  printf '%s\n' '{"task":"inspect","requirements":[],"relevant_files":[],"observations":[],"plan":[],"validation":[],"risks":[],"test_impact":[]}' > "$RESULTS_DIR/scouting-candidate.json"
elif printf '%s' "\$prompt" | grep -q 'read-only goal-check Pi agent'; then
  printf 'goal-check\n' >> "$PI_CALLS"
  printf '%s\n' '{"met":true,"confidence":"high","summary":"done","evidence":[],"missing":[],"retry_prompt":"","validation_notes":[]}' > "$RESULTS_DIR/goal-check-candidate.json"
else
  printf 'coding\n' >> "$PI_CALLS"
  printf '%s' "\$prompt" > "$RESULTS_DIR/coding-prompt.txt"
fi
printf '{"type":"message","model":"test-model"}\n'
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
env KASEKI_WORKSPACE_DIR="$TMP_DIR" PATH="$FAKE_BIN:$PATH" REPO_URL="$FAKE_REPO" GIT_REF=main TASK_PROMPT="inspect then code" \
  OPENROUTER_API_KEY=test GITHUB_APP_ENABLED=0 KASEKI_GIT_CACHE_MODE=off \
  KASEKI_DEPENDENCY_CACHE_DIR="$TMP_DIR/dependency-cache" KASEKI_IMAGE_DEPENDENCY_CACHE_DIR="$TMP_DIR/image-cache" \
  KASEKI_PRE_AGENT_VALIDATION_COMMANDS="npm run check" KASEKI_VALIDATION_COMMANDS=":" KASEKI_ALLOW_EMPTY_DIFF=1 \
  bash "$MODIFIED_SCRIPT" > "$RUN_LOG" 2>&1
run_exit=$?
set -e

[ "$run_exit" -eq 0 ] || fail "expected zero exit, got $run_exit"
[ "$(cat "$PI_CALLS")" = $'goal-setting\nscouting\ncoding\ngoal-check' ] || fail "Pi calls did not continue through scouting/coding/goal-check"
[ -s "$RESULTS_DIR/goal-setting-validation-errors.jsonl" ] || fail "missing goal-setting validation errors"
[ -s "$RESULTS_DIR/goal-setting-validation-summary.txt" ] || fail "missing goal-setting validation summary"
grep -q '^pi goal-setting agent[[:space:]]86[[:space:]]' "$RESULTS_DIR/stage-timings.tsv" || fail "goal-setting failure timing missing"
grep -q 'inspect then code' "$RESULTS_DIR/coding-prompt.txt" || fail "coding prompt did not preserve original prompt"
! grep -q 'INVALID UPGRADED GOAL SHOULD NOT BE USED' "$RESULTS_DIR/coding-prompt.txt" || fail "coding prompt used invalid upgraded goal"
node - "$RESULTS_DIR/metadata.json" <<'NODE' || fail "metadata did not preserve successful final status with observable goal-setting failure"
const fs = require('node:fs');
const metadata = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (metadata.exit_code !== 0) throw new Error(`expected exit_code 0, got ${metadata.exit_code}`);
if (metadata.goal_setting_exit_code !== 86) throw new Error(`expected goal_setting_exit_code 86, got ${metadata.goal_setting_exit_code}`);
if (metadata.failed_command !== '') throw new Error(`expected empty failed_command, got ${metadata.failed_command}`);
if (metadata.goal_setting_attempts !== 1) throw new Error(`expected one deterministic goal-setting attempt, got ${metadata.goal_setting_attempts}`);
if (metadata.goal_setting_succeeded_on_attempt !== null) throw new Error('goal_setting_succeeded_on_attempt should be null');
NODE
node - "$RESULTS_DIR/progress.jsonl" <<'NODE' || fail "goal-setting error event did not advertise continue recovery"
const fs = require('node:fs');
const events = fs.readFileSync(process.argv[2], 'utf8').trim().split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
const invalid = events.find((event) => event.event_type === 'error' && event.error_type === 'pi_goal_setting_artifact_invalid');
if (!invalid) throw new Error('missing pi_goal_setting_artifact_invalid event');
if (invalid.recovery_action !== 'continue') throw new Error(`expected continue recovery, got ${invalid.recovery_action}`);
NODE

echo "PASS: $TEST_NAME"
