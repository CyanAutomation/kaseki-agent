#!/usr/bin/env bash
# Regression test: inspect mode is read-only by default and does not enforce patch-only change gates.

set -euo pipefail

TEST_NAME="inspect mode defaults"
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
: > "$PI_CALLS"

MODIFIED_SCRIPT="$TMP_DIR/kaseki-agent-modified.sh"
sed "s#\"\${KASEKI_WORKSPACE_DIR}\"/repo#$WORKSPACE_REPO#g; s#\${KASEKI_WORKSPACE_DIR}/repo#$WORKSPACE_REPO#g; s#/workspace/repo#$WORKSPACE_REPO#g; s#/results#$RESULTS_DIR#g; s#/app/lib#$APP_LIB#g" "$REPO_ROOT/kaseki-agent.sh" > "$MODIFIED_SCRIPT"
chmod +x "$MODIFIED_SCRIPT"

printf '%s\n' '{"name":"fake-inspect-defaults","version":"1.0.0","private":true,"scripts":{"check":"exit 0"},"dependencies":{"fake-dep":"file:deps/fake-dep"}}' > "$FAKE_REPO/package.json"
printf '%s\n' '{"name":"fake-dep","version":"1.0.0","private":true}' > "$FAKE_REPO/deps/fake-dep/package.json"
cat > "$FAKE_REPO/package-lock.json" <<'JSON'
{"name":"fake-inspect-defaults","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"fake-inspect-defaults","version":"1.0.0","dependencies":{"fake-dep":"file:deps/fake-dep"}},"deps/fake-dep":{"version":"1.0.0"},"node_modules/fake-dep":{"resolved":"deps/fake-dep","link":true}}}
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
  printf '%s\n' '{"original_prompt":"inspect only","upgraded_goal":"Inspect only","reasoning":"test","key_requirements":[],"success_criteria":[]}' > "$RESULTS_DIR/goal-setting-candidate.json"
elif printf '%s' "\$prompt" | grep -q 'read-only scouting Pi agent'; then
  printf 'scouting\n' >> "$PI_CALLS"
  printf '%s\n' '{"task":"inspect","requirements":[],"relevant_files":[],"observations":[],"plan":[],"validation":[],"risks":[],"test_impact":[],"critical_change_expectations":{"required_files":["must-not-apply.txt"],"required_search_strings":["MUST_NOT_APPLY"],"forbidden_empty_diff":true}}' > "$RESULTS_DIR/scouting-candidate.json"
elif printf '%s' "\$prompt" | grep -q 'read-only goal-check Pi agent'; then
  printf 'goal-check\n' >> "$PI_CALLS"
  printf '%s\n' '{"met":true,"confidence":"high","summary":"inspect done","evidence":[],"missing":[],"retry_prompt":"","validation_notes":[]}' > "$RESULTS_DIR/goal-check-candidate.json"
else
  printf 'coding\n' >> "$PI_CALLS"
  printf '%s\n' 'read-only inspect output'
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
env PATH="$FAKE_BIN:$PATH" REPO_URL="$FAKE_REPO" GIT_REF=main TASK_PROMPT="inspect only" \
  OPENROUTER_API_KEY=test LLM_GATEWAY_URL=https://example.invalid/v1/responses LLM_GATEWAY_API_KEY=test GITHUB_APP_ENABLED=0 KASEKI_GIT_CACHE_MODE=off KASEKI_TASK_MODE=inspect \
  KASEKI_HASHLINE_EDITS=0 KASEKI_BASELINE_VALIDATION_ENABLED=0 \
  KASEKI_WORKSPACE_DIR="$TMP_DIR" \
  KASEKI_DEPENDENCY_CACHE_DIR="$TMP_DIR/dependency-cache" KASEKI_IMAGE_DEPENDENCY_CACHE_DIR="$TMP_DIR/image-cache" \
  KASEKI_PRE_AGENT_VALIDATION_COMMANDS="npm run check" KASEKI_VALIDATION_COMMANDS=":" \
  bash "$MODIFIED_SCRIPT" > "$RUN_LOG" 2>&1
run_exit=$?
set -e

[ "$run_exit" -eq 0 ] || fail "expected zero exit, got $run_exit"
[ "$(< "$PI_CALLS")" = "coding" ] || fail "expected only coding Pi call, got: $(tr '\n' ',' < "$PI_CALLS")"
[ -s "$RESULTS_DIR/critical-change-expectations.json" ] || fail "missing critical-change expectations artifact"
grep -q '"forbidden_empty_diff":false' "$RESULTS_DIR/critical-change-expectations.json" || fail "inspect expectations should allow empty diff"
grep -q 'critical change verification skipped for inspect mode' "$RESULTS_DIR/critical-change-verification.log" || fail "critical-change verification was not skipped"
node -e 'const fs=require("node:fs");const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(m.task_mode!=="inspect")throw new Error("wrong task mode");if(m.goal_check_enabled!==false)throw new Error("goal check should be disabled");if(m.scouting_exit_code!==0)throw new Error("scouting skip should be successful");if(m.exit_code!==0)throw new Error("inspect run should succeed");' "$RESULTS_DIR/metadata.json" || fail "metadata did not record inspect defaults"

echo "PASS: $TEST_NAME"
