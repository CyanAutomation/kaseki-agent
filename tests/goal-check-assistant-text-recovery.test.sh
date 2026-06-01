#!/usr/bin/env bash
# Regression test: goal-check verdicts printed in assistant text are recovered into artifacts.
set -uo pipefail

TEST_NAME="goal-check assistant text artifact recovery"
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

mkdir -p "$FAKE_REPO/deps/fake-dep" "$FAKE_BIN" "$RESULTS_DIR" "$WORKSPACE_REPO" "$APP_LIB" "$TMP_DIR/scripts" || fail "failed to create test directories"
cp "$REPO_ROOT/scripts/allowlist-helper.sh" "$TMP_DIR/scripts/allowlist-helper.sh" || fail "failed to copy allowlist helper"
touch "$APP_LIB/event-aggregator.js" "$APP_LIB/timestamp-tracker.js" "$APP_LIB/progress-stream-utils.js" || fail "failed to create app lib stubs"
: > "$PI_CALLS" || fail "failed to initialize Pi call log"

MODIFIED_SCRIPT="$TMP_DIR/kaseki-agent-modified.sh"
sed "s#/workspace/repo#$WORKSPACE_REPO#g; s#/results#$RESULTS_DIR#g; s#/app/lib#$APP_LIB#g" "$REPO_ROOT/kaseki-agent.sh" > "$MODIFIED_SCRIPT" || fail "failed to prepare modified kaseki-agent.sh"
chmod +x "$MODIFIED_SCRIPT" || fail "failed to make modified kaseki-agent.sh executable"

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
  # Intentionally print the verdict in the event stream without creating goal-check-candidate.json.
  printf '%s\n' '{"type":"assistant_message","text":"{\\"met\\":true,\\"confidence\\":\\"high\\",\\"summary\\":\\"All requested checks passed.\\",\\"evidence\\":[\\"validation command passed\\",\\"diff inspected\\",\\"goal requirements satisfied\\"],\\"missing\\":[],\\"retry_prompt\\":\\"\\",\\"validation_notes\\":[\\"npm run check: passed\\"]}"}'
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
  OPENROUTER_API_KEY=test GITHUB_APP_ENABLED=0 KASEKI_GIT_CACHE_MODE=off KASEKI_GOAL_CHECK_MAX_RETRIES=0 \
  KASEKI_DEPENDENCY_CACHE_DIR="$TMP_DIR/dependency-cache" KASEKI_IMAGE_DEPENDENCY_CACHE_DIR="$TMP_DIR/image-cache" \
  KASEKI_PRE_AGENT_VALIDATION_COMMANDS="npm run check" KASEKI_VALIDATION_COMMANDS=":" KASEKI_ALLOW_EMPTY_DIFF=1 \
  bash "$MODIFIED_SCRIPT" > "$RUN_LOG" 2>&1
run_exit=$?

[ "$run_exit" -eq 0 ] || fail "expected successful recovery exit 0, got $run_exit"
[ "$(cat "$PI_CALLS")" = $'goal-setting
scouting
coding
goal-check' ] || fail "Pi calls did not reach the goal-check artifact recovery"
[ -s "$RESULTS_DIR/goal-check.json" ] || fail "missing recovered goal-check.json"
[ ! -s "$RESULTS_DIR/goal-check-validation-errors.jsonl" ] || fail "recovery should not create validation errors"
grep -q 'goal_check_artifact_recovered_from_assistant_text' "$RESULTS_DIR/goal-check-stderr.log" || fail "missing recovery diagnostic note"
node - "$RESULTS_DIR/goal-check.json" <<'NODE' || fail "recovered goal-check verdict was invalid"
const verdict = require(process.argv[2]);
if (verdict.met !== true) throw new Error(`expected met=true, got ${verdict.met}`);
if (verdict.confidence !== 'high') throw new Error(`expected high confidence, got ${verdict.confidence}`);
if (!Array.isArray(verdict.evidence) || verdict.evidence.length < 3) throw new Error('expected recovered evidence array');
if (verdict.attempt !== 1) throw new Error(`expected enriched attempt=1, got ${verdict.attempt}`);
NODE
[ ! -e "$RESULTS_DIR/goal-check-candidate.json" ] || fail "goal-check candidate artifact should be consumed after recovery validation"
echo "PASS: $TEST_NAME"
