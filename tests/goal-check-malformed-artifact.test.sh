#!/usr/bin/env bash
# Regression test: malformed goal-check artifacts produce structured validation errors.
set -uo pipefail

TEST_NAME="goal-check malformed artifact validation"
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

if [[ ! -x "$REPO_ROOT/kaseki-agent.sh" ]]; then
  fail "kaseki-agent.sh not found or not executable"
fi

mkdir -p "$FAKE_REPO/deps/fake-dep" "$FAKE_BIN" "$RESULTS_DIR" "$WORKSPACE_REPO" "$APP_LIB" "$TMP_DIR/scripts" "$TMP_DIR/scripts/lib" || fail "failed to create test directories"
cp "$REPO_ROOT/scripts/allowlist-helper.sh" "$TMP_DIR/scripts/allowlist-helper.sh" || fail "failed to copy allowlist helper"
cp "$REPO_ROOT/scripts/scouting-allowlist.js" "$TMP_DIR/scripts/scouting-allowlist.js" || fail "failed to copy scouting allowlist"
cp "$REPO_ROOT/scripts/lib/json.sh" "$TMP_DIR/scripts/lib/json.sh"
cp "$REPO_ROOT/scripts/lib/json-events.sh" "$TMP_DIR/scripts/lib/json-events.sh"
cp "$REPO_ROOT/scripts/lib/artifact-consolidation.sh" "$TMP_DIR/scripts/lib/artifact-consolidation.sh"
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

cat > "$FAKE_BIN/pi" <<EOF_PI || fail "failed to write fake pi executable"
#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo "pi 0.0.0-test"; exit 0; fi
prompt="\${*: -1}"
if printf '%s' "\$prompt" | grep -q 'goal-setting Pi agent'; then
  printf 'goal-setting\n' >> "$PI_CALLS"
  printf '%s\n' '{"original_prompt":"inspect then code","upgraded_goal":"Upgraded: inspect then code","reasoning":"test","key_requirements":[],"success_criteria":[]}' > "$RESULTS_DIR/goal-setting-candidate.json"
elif printf '%s' "\$prompt" | grep -q 'read-only scouting Pi agent'; then
  printf 'scouting\n' >> "$PI_CALLS"
  printf '%s\n' '{"task":"inspect","requirements":[],"relevant_files":[],"observations":[],"plan":[],"validation":[],"risks":[],"test_impact":[]}' > "$RESULTS_DIR/scouting-candidate.json"
elif printf '%s' "\$prompt" | grep -q 'read-only goal-check Pi agent'; then
  printf 'goal-check\n' >> "$PI_CALLS"
  printf '{"met":true, "confidence":"high"' > "$RESULTS_DIR/goal-check-candidate.json"
else
  printf 'coding\n' >> "$PI_CALLS"
  printf '%s' "\$prompt" > "$RESULTS_DIR/coding-prompt.txt"
fi
printf '{"type":"message","model":"test-model"}\n'
EOF_PI
cat > "$FAKE_BIN/kaseki-pi-progress-stream" <<'EOF_PROGRESS' || fail "failed to write fake progress stream executable"
#!/usr/bin/env bash
cat
EOF_PROGRESS
cat > "$FAKE_BIN/kaseki-pi-event-filter" <<'EOF_FILTER' || fail "failed to write fake event filter executable"
#!/usr/bin/env bash
cat "$1" > "$2"
printf '{"selected_model":"test-model"}\n' > "$3"
EOF_FILTER
cat > "$FAKE_BIN/timeout" <<'EOF_TIMEOUT' || fail "failed to write fake timeout executable"
#!/usr/bin/env bash
shift 2
"$@"
EOF_TIMEOUT
cat > "$FAKE_BIN/validation-output-filter" <<'EOF_VALIDATION_FILTER' || fail "failed to write fake validation output filter executable"
#!/usr/bin/env bash
cat
EOF_VALIDATION_FILTER
chmod +x "$FAKE_BIN"/* || fail "failed to make fake executables runnable"

env PATH="$FAKE_BIN:$PATH" REPO_URL="$FAKE_REPO" GIT_REF=main TASK_PROMPT="inspect then code" \
  OPENROUTER_API_KEY=test LLM_GATEWAY_URL=https://example.invalid/v1 LLM_GATEWAY_API_KEY=test GITHUB_APP_ENABLED=0 KASEKI_GIT_CACHE_MODE=off KASEKI_GOAL_CHECK_MAX_RETRIES=0 \
  KASEKI_WORKSPACE_DIR="$TMP_DIR" \
  KASEKI_DEPENDENCY_CACHE_DIR="$TMP_DIR/dependency-cache" KASEKI_IMAGE_DEPENDENCY_CACHE_DIR="$TMP_DIR/image-cache" \
  KASEKI_PRE_AGENT_VALIDATION_COMMANDS="npm run check" KASEKI_VALIDATION_COMMANDS=":" KASEKI_ALLOW_EMPTY_DIFF=1 \
  bash "$MODIFIED_SCRIPT" > "$RUN_LOG" 2>&1
run_exit=$?

[ "$run_exit" -eq 8 ] || fail "expected goal-check failure exit 8, got $run_exit"
[ "$(cat "$PI_CALLS")" = $'goal-setting\nscouting\ncoding\ngoal-check' ] || fail "Pi calls did not reach the malformed goal-check artifact"
[ -s "$RESULTS_DIR/goal-check-validation-errors.jsonl" ] || fail "missing goal-check-validation-errors.jsonl"
[ "$(cat "$RESULTS_DIR/goal-check-validation-reason.txt")" = "malformed_json" ] || fail "expected malformed_json reason"
grep -q 'goal-check validation error' "$RESULTS_DIR/goal-check-validation-summary.txt" || fail "missing goal-check validation summary"
grep -q '^goal check[[:space:]]86[[:space:]]' "$RESULTS_DIR/stage-timings.tsv" || fail "goal-check validation did not preserve exit 86"
node - "$RESULTS_DIR/goal-check-validation-errors.jsonl" <<'NODE' || fail "goal-check validation error log did not capture parse failure"
const fs = require('node:fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').trim().split(/\n+/).filter(Boolean);
if (lines.length !== 1) throw new Error(`expected exactly one JSONL entry, got ${lines.length}`);
const entry = JSON.parse(lines[0]);
if (entry.field !== 'root') throw new Error(`expected field root, got ${entry.field}`);
if (entry.expected !== 'valid JSON object') throw new Error(`expected valid JSON object, got ${entry.expected}`);
if (entry.severity !== 'critical') throw new Error(`expected critical severity, got ${entry.severity}`);
if (!/JSON|parse|Unexpected|position|end/i.test(String(entry.actual))) throw new Error(`actual did not contain parse error details: ${entry.actual}`);
NODE

[ ! -e "$RESULTS_DIR/goal-check-candidate.json" ] || fail "goal-check candidate artifact should be consumed after validation failure"
echo "PASS: $TEST_NAME"
