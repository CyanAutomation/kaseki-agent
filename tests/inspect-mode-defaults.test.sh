#!/usr/bin/env bash
# Regression test: inspect mode default decisions are sourceable and the real
# entrypoint applies them without rewriting kaseki-agent.sh.

set -euo pipefail

TEST_NAME="inspect mode defaults"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
FAKE_REPO="$TMP_DIR/fake-repo"
FAKE_BIN="$TMP_DIR/bin"
RESULTS_DIR="$TMP_DIR/results"
APP_LIB="$TMP_DIR/app/lib"
PI_CALLS="$TMP_DIR/pi-calls.log"
RUN_LOG="$TMP_DIR/kaseki-run.log"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "FAIL: $TEST_NAME: $*" >&2
  [ ! -f "$RUN_LOG" ] || tail -120 "$RUN_LOG" >&2
  exit 1
}

assert_eq() {
  local expected="$1" actual="$2" label="$3"
  [ "$expected" = "$actual" ] || fail "$label: expected <$expected>, got <$actual>"
}

# Focused assertions for the sourceable inspect-mode policy helper.
# shellcheck source=../scripts/inspect-mode-defaults.sh
. "$REPO_ROOT/scripts/inspect-mode-defaults.sh"
(
  KASEKI_TASK_MODE=inspect
  KASEKI_GOAL_SETTING_EXPLICIT=""
  KASEKI_SCOUTING_EXPLICIT=""
  KASEKI_GOAL_CHECK_EXPLICIT=""
  KASEKI_GOAL_SETTING=1
  KASEKI_SCOUTING=1
  KASEKI_GOAL_CHECK=1
  unset KASEKI_ALLOW_EMPTY_DIFF
  kaseki_apply_inspect_mode_agent_defaults
  kaseki_apply_task_mode_diff_defaults
  assert_eq 0 "$KASEKI_GOAL_SETTING" "inspect defaults disable goal-setting"
  assert_eq 0 "$KASEKI_SCOUTING" "inspect defaults skip scouting"
  assert_eq 0 "$KASEKI_GOAL_CHECK" "inspect defaults disable goal-check"
  assert_eq 1 "$KASEKI_ALLOW_EMPTY_DIFF" "inspect defaults allow empty diffs"
  kaseki_should_skip_critical_change_gates || fail "inspect mode should skip critical-change gates"
  helper_expectations="$TMP_DIR/helper-critical-change-expectations.json"
  kaseki_write_task_mode_critical_change_expectations "$helper_expectations"
  node -e 'const fs=require("node:fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (m.forbidden_empty_diff !== false) throw new Error("inspect expectations should not forbid empty diff"); if ((m.required_files || []).length) throw new Error("inspect expectations should not require files");' "$helper_expectations"
)
(
  KASEKI_TASK_MODE=inspect
  KASEKI_GOAL_SETTING_EXPLICIT=""
  KASEKI_SCOUTING_EXPLICIT=1
  KASEKI_GOAL_CHECK_EXPLICIT=""
  KASEKI_GOAL_SETTING=1
  KASEKI_SCOUTING=1
  KASEKI_GOAL_CHECK=1
  kaseki_apply_inspect_mode_agent_defaults
  assert_eq 0 "$KASEKI_GOAL_SETTING" "inspect defaults still disable implicit goal-setting"
  assert_eq 1 "$KASEKI_SCOUTING" "explicit inspect scouting remains enabled for read-only scouting"
  assert_eq 0 "$KASEKI_GOAL_CHECK" "inspect defaults still disable implicit goal-check"
)
(
  KASEKI_TASK_MODE=patch
  unset KASEKI_ALLOW_EMPTY_DIFF
  kaseki_apply_task_mode_diff_defaults
  assert_eq 0 "$KASEKI_ALLOW_EMPTY_DIFF" "patch defaults forbid empty diffs"
  if kaseki_should_skip_critical_change_gates; then
    fail "patch mode should not skip critical-change gates"
  fi
)

mkdir -p "$FAKE_REPO/deps/fake-dep" "$FAKE_BIN" "$RESULTS_DIR" "$APP_LIB"
touch "$APP_LIB/event-aggregator.js" "$APP_LIB/timestamp-tracker.js" "$APP_LIB/progress-stream-utils.js"
: > "$PI_CALLS"

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
if [ "\${1:-}" = "--list-models" ]; then echo "gateway/test-model"; exit 0; fi
printf '%s\n' "\${KASEKI_PI_PHASE:-unknown}" >> "$PI_CALLS"
printf '%s\n' 'read-only inspect output'
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
  OPENROUTER_API_KEY=test KASEKI_PROVIDER=openrouter GITHUB_APP_ENABLED=0 KASEKI_GIT_CACHE_MODE=off KASEKI_TASK_MODE=inspect \
  KASEKI_HASHLINE_EDITS=0 KASEKI_BASELINE_VALIDATION_ENABLED=0 KASEKI_TEST_DEFAULT_PATH_ROOT="$TMP_DIR" \
  KASEKI_DEPENDENCY_CACHE_DIR="$TMP_DIR/dependency-cache" KASEKI_IMAGE_DEPENDENCY_CACHE_DIR="$TMP_DIR/image-cache" \
  KASEKI_PRE_AGENT_VALIDATION_COMMANDS="npm run check" KASEKI_VALIDATION_COMMANDS=":" \
  bash "$REPO_ROOT/kaseki-agent.sh" > "$RUN_LOG" 2>&1
run_exit=$?
set -e

[ "$run_exit" -eq 0 ] || fail "expected zero exit, got $run_exit"
assert_eq "unknown" "$(< "$PI_CALLS")" "inspect defaults should invoke only the main Pi agent"
[ -s "$RESULTS_DIR/critical-change-expectations.json" ] || fail "missing critical-change expectations artifact"
grep -q '"forbidden_empty_diff":false' "$RESULTS_DIR/critical-change-expectations.json" || fail "inspect expectations should allow empty diff"
grep -q 'critical change verification skipped for inspect mode' "$RESULTS_DIR/critical-change-verification.log" || fail "critical-change verification was not skipped"
node -e 'const fs=require("node:fs");const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(m.task_mode!=="inspect")throw new Error("wrong task mode");if(m.goal_check_enabled!==false)throw new Error("goal check should be disabled");if(m.allow_empty_diff!=="1")throw new Error("empty diff should be allowed");if(m.scouting_exit_code!==0)throw new Error("scouting skip should be successful");if(m.exit_code!==0)throw new Error("inspect run should succeed");' "$RESULTS_DIR/metadata.json" || fail "metadata did not record inspect defaults"

[ ! -s "$RESULTS_DIR/scouting.json" ] || fail "default inspect mode should skip scouting artifact generation"
[ ! -s "$RESULTS_DIR/goal-check.json" ] || fail "default inspect mode should skip goal-check artifact generation"

echo "PASS: $TEST_NAME"
