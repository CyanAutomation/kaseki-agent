#!/usr/bin/env bash
# Integration test: scouting writes a JSON artifact between baseline validation and coding.

set -euo pipefail

TEST_NAME="scouting order"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
FAKE_REPO="$TMP_DIR/fake-repo"
FAKE_BIN="$TMP_DIR/bin"
RESULTS_DIR="$TMP_DIR/results"
WORKSPACE_REPO="$TMP_DIR/repo"
APP_LIB="$TMP_DIR/app/lib"
PI_CALLS="$TMP_DIR/pi-calls.log"
PI_ARGS="$TMP_DIR/pi-args.log"
RUN_LOG="$TMP_DIR/kaseki-run.log"
trap 'cat "$RESULTS_DIR/scouting-validation-errors.jsonl" 2>/dev/null; rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "FAIL: $TEST_NAME: $*" >&2
  [ ! -f "$RUN_LOG" ] || tail -80 "$RUN_LOG" >&2
  exit 1
}

mkdir -p "$FAKE_REPO/deps/fake-dep" "$FAKE_BIN" "$RESULTS_DIR" "$WORKSPACE_REPO" "$APP_LIB" "$TMP_DIR/scripts" "$TMP_DIR/scripts/lib"
cp "$REPO_ROOT/scripts/allowlist-helper.sh" "$TMP_DIR/scripts/allowlist-helper.sh"
if [ -f "$REPO_ROOT/scripts/scouting-allowlist.js" ]; then
  cp "$REPO_ROOT/scripts/scouting-allowlist.js" "$TMP_DIR/scripts/scouting-allowlist.js"
else
  cp "$REPO_ROOT/dist/scouting-allowlist.js" "$TMP_DIR/scripts/scouting-allowlist.js"
fi
cp "$REPO_ROOT/scripts/lib/json.sh" "$TMP_DIR/scripts/lib/json.sh"
cp "$REPO_ROOT/scripts/lib/json-events.sh" "$TMP_DIR/scripts/lib/json-events.sh"
cp "$REPO_ROOT/scripts/lib/artifact-consolidation.sh" "$TMP_DIR/scripts/lib/artifact-consolidation.sh"
cp "$REPO_ROOT/scripts/dependency-cache-helpers.sh" "$TMP_DIR/scripts/dependency-cache-helpers.sh"
cp "$REPO_ROOT/scripts/npm-install-helpers.sh" "$TMP_DIR/scripts/npm-install-helpers.sh"
cp "$REPO_ROOT/scripts/agent-prompt.sh" "$TMP_DIR/scripts/agent-prompt.sh"
cp "$REPO_ROOT/scripts/evaluation-prompts.sh" "$TMP_DIR/scripts/evaluation-prompts.sh"
touch "$APP_LIB/event-aggregator.js" "$APP_LIB/timestamp-tracker.js" "$APP_LIB/progress-stream-utils.js"
cat > "$APP_LIB/hashline-event-handler-cli.js" <<'EOF_HASHLINE'
#!/usr/bin/env node
// Fake hashline-event-handler-cli.js for testing
const fs = require('fs');
const [, , eventsFile, workspaceDir, outputEventsFile, outputSummaryFile] = process.argv;
try {
  fs.writeFileSync(outputEventsFile, '');
  fs.writeFileSync(outputSummaryFile, JSON.stringify({processed: 0, successful: 0, failed: 0}));
  process.exit(0);
} catch (e) {
  process.exit(1);
}
EOF_HASHLINE
MODIFIED_SCRIPT="$TMP_DIR/kaseki-agent-modified.sh"
sed "s#\"\${KASEKI_WORKSPACE_DIR}\"/repo#$WORKSPACE_REPO#g; s#\${KASEKI_WORKSPACE_DIR}/repo#$WORKSPACE_REPO#g; s#/workspace/repo#$WORKSPACE_REPO#g; s#/results#$RESULTS_DIR#g; s#/app/lib#$APP_LIB#g" "$REPO_ROOT/kaseki-agent.sh" > "$MODIFIED_SCRIPT"
chmod +x "$MODIFIED_SCRIPT"
"$REPO_ROOT/tests/helpers/stage-scouting-templates.sh" "$REPO_ROOT" "$MODIFIED_SCRIPT"
: > "$PI_CALLS"
: > "$PI_ARGS"

printf '%s\n' '{"name":"fake-scouting-repo","version":"1.0.0","private":true,"scripts":{"check":"exit 0"},"dependencies":{"fake-dep":"file:deps/fake-dep"}}' > "$FAKE_REPO/package.json"
printf '%s\n' '{"name":"fake-dep","version":"1.0.0","private":true}' > "$FAKE_REPO/deps/fake-dep/package.json"
cat > "$FAKE_REPO/package-lock.json" <<'JSON'
{"name":"fake-scouting-repo","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"fake-scouting-repo","version":"1.0.0","dependencies":{"fake-dep":"file:deps/fake-dep"}},"deps/fake-dep":{"version":"1.0.0"},"node_modules/fake-dep":{"resolved":"deps/fake-dep","link":true}}}
JSON
git -C "$FAKE_REPO" init -q -b main
git -C "$FAKE_REPO" add package.json package-lock.json deps/fake-dep/package.json
git -C "$FAKE_REPO" -c user.email=kaseki-test@example.invalid -c user.name="Kaseki Test" commit -q -m initial

cat > "$FAKE_BIN/pi" <<EOF_PI
#!/usr/bin/env bash
printf '[fake-pi] args: %s\n' "\$*" >> "$TMP_DIR/debug.log"
if [ "\${1:-}" = "--version" ]; then echo "pi 0.0.0-test"; exit 0; fi
if [ "\${1:-}" = "--list-models" ]; then echo "gateway/dynamic/kaseki-agent"; exit 0; fi
prompt="\${*: -1}"
args="\$*"
if printf '%s' "\$prompt" | grep -q 'goal-setting Pi agent'; then
  printf 'goal-setting\t%s\n' "\$args" >> "$PI_ARGS"
  printf 'goal-setting\n' >> "$PI_CALLS"
  if printf '%s' "\$prompt" | grep -Fq 'Write exactly one JSON object to $RESULTS_DIR/goal-setting-candidate.json'; then
    printf '%s\n' '{"original_prompt":"inspect then code","upgraded_goal":"Upgraded: inspect then code","reasoning":"test","key_requirements":[],"success_criteria":[]}' > "$RESULTS_DIR/goal-setting-candidate.json"
  else
    printf '%s\n' '{"original_prompt":"inspect then code","upgraded_goal":"stdout only","reasoning":"test","key_requirements":[],"success_criteria":[]}'
  fi
elif printf '%s' "\$prompt" | grep -q 'read-only scouting Pi agent'; then
  printf 'scouting\t%s\n' "\$args" >> "$PI_ARGS"
  printf 'scouting\n' >> "$PI_CALLS"
  printf '%s\n' '{"task":"inspect","requirements":[],"relevant_files":[],"observations":[],"plan":[],"validation":[],"risks":[],"test_impact":[]}' > "$RESULTS_DIR/scouting-candidate.json"
elif printf '%s' "\$prompt" | grep -q 'read-only goal-check Pi agent'; then
  printf 'goal-check\t%s\n' "\$args" >> "$PI_ARGS"
  printf 'goal-check\n' >> "$PI_CALLS"
  printf '%s\n' '{"met":true,"confidence":"high","summary":"done","evidence":[],"missing":[],"retry_prompt":"","validation_notes":[],"evidence_sources_inspected":[],"contradictions":[],"confidence_calibration":{"outcome":"pass","justification":"test"}}' > "$RESULTS_DIR/goal-check-candidate.json"
else
  printf 'coding\t%s\n' "\$args" >> "$PI_ARGS"
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
printf '[kaseki-pi-event-filter] args: %s\n' "$*" >> "${KASEKI_DEBUG_LOG:-/dev/null}"
cat "$1" > "$2"
printf '{"selected_model":"test-model"}\n' > "$3"
EOF_FILTER
cat > "$FAKE_BIN/timeout" <<EOF_TIMEOUT
#!/usr/bin/env bash
printf '[fake-timeout] received args (%d): %s\n' "\$#" "\$*" >> "$TMP_DIR/debug.log"
# Skip all leading flag args (--signal=..., --kill-after=..., -s, etc.), then skip the duration
while [[ "\${1:-}" == -* ]]; do shift; done
shift
printf '[fake-timeout] running command: %s\n' "\$*" >> "$TMP_DIR/debug.log"
"\$@"
exit_code=\$?
printf '[fake-timeout] exit code: %d\n' "\$exit_code" >> "$TMP_DIR/debug.log"
exit "\$exit_code"
EOF_TIMEOUT
cat > "$FAKE_BIN/validation-output-filter" <<'EOF_VALIDATION_FILTER'
#!/usr/bin/env bash
cat
EOF_VALIDATION_FILTER
cat > "$FAKE_BIN/tsc" <<'EOF_TSC'
#!/usr/bin/env bash
exit 0
EOF_TSC
cat > "$FAKE_BIN/eslint" <<'EOF_ESLINT'
#!/usr/bin/env bash
exit 0
EOF_ESLINT
chmod +x "$FAKE_BIN"/*

# Create node_modules/.bin directory with links to fake tsc and eslint
mkdir -p "$FAKE_REPO/node_modules/.bin"
ln -sf "$FAKE_BIN/tsc" "$FAKE_REPO/node_modules/.bin/tsc"
ln -sf "$FAKE_BIN/eslint" "$FAKE_REPO/node_modules/.bin/eslint"

set +e
env \
  PATH="$FAKE_BIN:$PATH" \
  REPO_URL="$FAKE_REPO" \
  GIT_REF=main \
  TASK_PROMPT="inspect then code" \
  OPENROUTER_API_KEY=test \
  LLM_GATEWAY_URL=https://example.invalid/v1 \
  LLM_GATEWAY_API_KEY=test \
  GITHUB_APP_ENABLED=0 \
  KASEKI_GIT_CACHE_MODE=off \
  KASEKI_SKIP_GATEWAY_HEALTH_CHECK=1 \
  KASEKI_WORKSPACE_DIR="$TMP_DIR" \
  KASEKI_RESULTS_DIR="$RESULTS_DIR" \
  KASEKI_APP_LIB_DIR="$APP_LIB" \
  KASEKI_CACHE_DIR="$TMP_DIR/cache" \
  KASEKI_DEPENDENCY_CACHE_DIR="$TMP_DIR/dependency-cache" \
  KASEKI_IMAGE_DEPENDENCY_CACHE_DIR="$TMP_DIR/image-cache" \
  KASEKI_PRE_AGENT_VALIDATION_COMMANDS="npm run check" \
  KASEKI_VALIDATION_COMMANDS=":" \
  KASEKI_ALLOW_EMPTY_DIFF=1 \
  KASEKI_JEV_WORKFLOW=0 \
  KASEKI_DEBUG_LOG="$TMP_DIR/debug.log" bash "$MODIFIED_SCRIPT" > "$RUN_LOG" 2>&1
run_exit=$?
set -e

if [ "$run_exit" -ne 0 ]; then
  printf '\n=== DEBUG LOG ===\n' >&2
  cat "$TMP_DIR/debug.log" >&2 2>/dev/null || true
  fail "expected zero exit, got $run_exit"
fi
[ "$(head -4 "$PI_CALLS")" = $'goal-setting\nscouting\ncoding\ngoal-check' ] || fail "Pi calls were not goal-setting then scouting then coding then goal-check"
grep -Eq '^scouting[[:space:]].*--model dynamic/kaseki-agent( |$)' "$PI_ARGS" || fail "scouting Pi was not invoked with default gateway model dynamic/kaseki-agent"
grep -Eq '^coding[[:space:]].*--model dynamic/kaseki-agent( |$)' "$PI_ARGS" || fail "coding Pi was not invoked with default gateway model dynamic/kaseki-agent"
[ -s "$RESULTS_DIR/goal-setting.json" ] || fail "goal-setting.json was not copied into results"
[ ! -e "$RESULTS_DIR/goal-setting-candidate.json" ] || fail "goal-setting candidate artifact should be consumed after validation"
[ -s "$RESULTS_DIR/scouting.json" ] || fail "scouting.json was not copied into results"
grep -q '^pi scouting agent[[:space:]]0[[:space:]]' "$RESULTS_DIR/stage-timings.tsv" || fail "scouting stage timing missing"
{ [ -s "$RESULTS_DIR/context-handoff.json" ] || grep -q "$RESULTS_DIR/scouting.json" "$RESULTS_DIR/coding-prompt.txt"; } || fail "coding prompt did not reference scouting artifact (no context-handoff.json and no scouting.json path in prompt)"
node -e 'const fs=require("node:fs");const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(m.scouting_exit_code!==0)throw new Error("scouting metadata exit");' "$RESULTS_DIR/metadata.json"
echo "PASS: $TEST_NAME"
