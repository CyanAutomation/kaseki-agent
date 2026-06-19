#!/usr/bin/env bash
# Regression tests: critical-change expectations fail fast before the LLM goal-check evaluator.
set -uo pipefail

TEST_NAME="goal-check critical-change expectations"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

fail() {
  echo "FAIL: $TEST_NAME: $*" >&2
  if [ -n "${RUN_LOG:-}" ] && [ -f "$RUN_LOG" ]; then
    tail -120 "$RUN_LOG" >&2 || true
  fi
  exit 1
}

setup_case() {
  CASE_NAME="$1"
  EXPECTATION_JSON="$2"
  CODING_ACTION="$3"
  EXPECTED_EXIT="$4"
  EXPECTED_CALLS="$5"
  EXPECTED_GOAL_CHECK_MET="$6"
  EXPECTED_GOAL_CHECK_ATTEMPTS="$7"
  EXPECTED_FAILED_COMMAND="$8"
  KASEKI_ALLOW_EMPTY_DIFF_CASE="$9"

  CASE_DIR="$TMP_ROOT/$CASE_NAME"
  FAKE_REPO="$CASE_DIR/fake-repo"
  FAKE_BIN="$CASE_DIR/bin"
  RESULTS_DIR="$CASE_DIR/results"
  WORKSPACE_REPO="$CASE_DIR/repo"
  APP_LIB="$CASE_DIR/app/lib"
  PI_CALLS="$CASE_DIR/pi-calls.log"
  RUN_LOG="$CASE_DIR/kaseki-run.log"
  CODING_ACTION="${CODING_ACTION//__WORKSPACE_REPO__/$WORKSPACE_REPO}"

  mkdir -p "$FAKE_REPO/deps/fake-dep" "$FAKE_BIN" "$RESULTS_DIR" "$WORKSPACE_REPO" "$APP_LIB" "$CASE_DIR/scripts" "$CASE_DIR/scripts/lib" || fail "failed to create directories for $CASE_NAME"
  cp "$REPO_ROOT/scripts/allowlist-helper.sh" "$CASE_DIR/scripts/allowlist-helper.sh" || fail "failed to copy allowlist helper"
  cp "$REPO_ROOT/scripts/scouting-allowlist.js" "$CASE_DIR/scripts/scouting-allowlist.js" || fail "failed to copy scouting allowlist"
  cp "$REPO_ROOT/scripts/lib/json.sh" "$CASE_DIR/scripts/lib/json.sh" || fail "failed to copy json helper"
  touch "$APP_LIB/event-aggregator.js" "$APP_LIB/timestamp-tracker.js" "$APP_LIB/progress-stream-utils.js" || fail "failed to create app stubs"
  : > "$PI_CALLS" || fail "failed to initialize Pi calls"

  MODIFIED_SCRIPT="$CASE_DIR/kaseki-agent-modified.sh"
  sed "s#\"\${KASEKI_WORKSPACE_DIR}\"/repo#$WORKSPACE_REPO#g; s#\${KASEKI_WORKSPACE_DIR}/repo#$WORKSPACE_REPO#g; s#/workspace/repo#$WORKSPACE_REPO#g; s#/results#$RESULTS_DIR#g; s#/app/lib#$APP_LIB#g" "$REPO_ROOT/kaseki-agent.sh" > "$MODIFIED_SCRIPT" || fail "failed to prepare modified script"
  chmod +x "$MODIFIED_SCRIPT" || fail "failed to chmod modified script"

  printf '%s\n' '{"name":"fake-critical-change-repo","version":"1.0.0","private":true,"scripts":{"check":"exit 0"},"dependencies":{"fake-dep":"file:deps/fake-dep"}}' > "$FAKE_REPO/package.json" || fail "failed package.json"
  printf '%s\n' '{"name":"fake-dep","version":"1.0.0","private":true}' > "$FAKE_REPO/deps/fake-dep/package.json" || fail "failed dep package"
  cat > "$FAKE_REPO/package-lock.json" <<'JSON' || fail "failed package-lock"
{"name":"fake-critical-change-repo","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"fake-critical-change-repo","version":"1.0.0","dependencies":{"fake-dep":"file:deps/fake-dep"}},"deps/fake-dep":{"version":"1.0.0"},"node_modules/fake-dep":{"resolved":"deps/fake-dep","link":true}}}
JSON
  printf 'initial target\n' > "$FAKE_REPO/target.txt" || fail "failed target"
  printf 'initial other\n' > "$FAKE_REPO/other.txt" || fail "failed other"
  mkdir -p "$FAKE_REPO/tests" || fail "failed tests dir"
  printf 'initial test\n' > "$FAKE_REPO/tests/target.test.js" || fail "failed test file"
  git -C "$FAKE_REPO" init -q -b main || fail "git init failed"
  git -C "$FAKE_REPO" add package.json package-lock.json deps/fake-dep/package.json target.txt other.txt tests/target.test.js || fail "git add failed"
  git -C "$FAKE_REPO" -c user.email=kaseki-test@example.invalid -c user.name="Kaseki Test" commit -q -m initial || fail "git commit failed"

  cat > "$FAKE_BIN/pi" <<EOF_PI || fail "failed fake pi"
#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo "pi 0.0.0-test"; exit 0; fi
prompt="\${*: -1}"
if printf '%s' "\$prompt" | grep -q 'goal-setting Pi agent'; then
  printf 'goal-setting\n' >> "$PI_CALLS"
  printf '%s\n' '{"original_prompt":"inspect then code","upgraded_goal":"Upgraded: inspect then code","reasoning":"test","key_requirements":[],"success_criteria":[]}' > "$RESULTS_DIR/goal-setting-candidate.json"
elif printf '%s' "\$prompt" | grep -q 'read-only scouting Pi agent'; then
  printf 'scouting\n' >> "$PI_CALLS"
  if [ '$EXPECTATION_JSON' != '__NO_SCOUTING_ARTIFACT__' ]; then
    printf '%s\n' '$EXPECTATION_JSON' > "$RESULTS_DIR/scouting-candidate.json"
  fi
elif printf '%s' "\$prompt" | grep -q 'read-only goal-check Pi agent'; then
  printf 'goal-check\n' >> "$PI_CALLS"
  printf '%s\n' '{"met":true,"confidence":"high","summary":"done","evidence":[],"missing":[],"retry_prompt":"","validation_notes":[]}' > "$RESULTS_DIR/goal-check-candidate.json"
else
  printf 'coding\n' >> "$PI_CALLS"
  printf '%s' "\$prompt" > "$RESULTS_DIR/coding-prompt.txt"
  $CODING_ACTION
fi
printf '{"type":"message","model":"test-model"}\n'
EOF_PI
  cat > "$FAKE_BIN/kaseki-pi-progress-stream" <<'EOF_PROGRESS' || fail "failed progress stream"
#!/usr/bin/env bash
cat
EOF_PROGRESS
  cat > "$FAKE_BIN/kaseki-pi-event-filter" <<'EOF_FILTER' || fail "failed event filter"
#!/usr/bin/env bash
cat "$1" > "$2"
printf '{"selected_model":"test-model"}\n' > "$3"
EOF_FILTER
  cat > "$FAKE_BIN/timeout" <<'EOF_TIMEOUT' || fail "failed timeout"
#!/usr/bin/env bash
shift 2
"$@"
EOF_TIMEOUT
  cat > "$FAKE_BIN/validation-output-filter" <<'EOF_VALIDATION_FILTER' || fail "failed validation filter"
#!/usr/bin/env bash
cat
EOF_VALIDATION_FILTER
  chmod +x "$FAKE_BIN"/* || fail "failed chmod fake bin"

  set +e
  env PATH="$FAKE_BIN:$PATH" REPO_URL="$FAKE_REPO" GIT_REF=main TASK_PROMPT="inspect then code" \
    OPENROUTER_API_KEY=test GITHUB_APP_ENABLED=0 KASEKI_GIT_CACHE_MODE=off KASEKI_GOAL_CHECK_MAX_RETRIES=1 KASEKI_HASHLINE_EDITS=0 KASEKI_BASELINE_VALIDATION_ENABLED=0 \
    KASEKI_WORKSPACE_DIR="$CASE_DIR" \
    KASEKI_DEPENDENCY_CACHE_DIR="$CASE_DIR/dependency-cache" KASEKI_IMAGE_DEPENDENCY_CACHE_DIR="$CASE_DIR/image-cache" \
    KASEKI_PRE_AGENT_VALIDATION_COMMANDS="npm run check" KASEKI_VALIDATION_COMMANDS=":" KASEKI_ALLOW_EMPTY_DIFF="$KASEKI_ALLOW_EMPTY_DIFF_CASE" \
    bash "$MODIFIED_SCRIPT" > "$RUN_LOG" 2>&1
  run_exit=$?
  set -e

  [ "$run_exit" -eq "$EXPECTED_EXIT" ] || fail "$CASE_NAME expected exit $EXPECTED_EXIT, got $run_exit"
  [ "$(< "$PI_CALLS")" = "$EXPECTED_CALLS" ] || fail "$CASE_NAME unexpected Pi calls: $(tr '\n' ',' < "$PI_CALLS")"
  [ -s "$RESULTS_DIR/critical-change-expectations.json" ] || fail "$CASE_NAME missing expectation artifact"
  [ -s "$RESULTS_DIR/metadata.json" ] || fail "$CASE_NAME missing metadata artifact"
  node - "$RESULTS_DIR/metadata.json" "$EXPECTED_GOAL_CHECK_MET" "$EXPECTED_GOAL_CHECK_ATTEMPTS" "$EXPECTED_FAILED_COMMAND" <<'NODE' || fail "$CASE_NAME metadata goal-check state was incorrect"
const fs = require('node:fs');
const [metadataPath, expectedMetRaw, expectedAttemptsRaw, expectedFailedCommand] = process.argv.slice(2);
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
const expectedMet = expectedMetRaw === 'true';
const expectedAttempts = Number(expectedAttemptsRaw);
if (metadata.goal_check_met !== expectedMet) {
  throw new Error(`expected goal_check_met=${expectedMet}, got ${metadata.goal_check_met}`);
}
if (metadata.goal_check_attempts !== expectedAttempts) {
  throw new Error(`expected goal_check_attempts=${expectedAttempts}, got ${metadata.goal_check_attempts}`);
}
if ((metadata.failed_command || '') !== expectedFailedCommand) {
  throw new Error(`expected failed_command=${JSON.stringify(expectedFailedCommand)}, got ${JSON.stringify(metadata.failed_command || '')}`);
}
NODE
}

empty_expectation='{"task":"inspect","requirements":[],"relevant_files":[],"observations":[],"plan":[],"validation":[],"risks":[],"test_impact":[],"suggested_allowlist":{"agent_patterns":["**"],"validation_patterns":["**"]},"critical_change_expectations":{"required_files":[],"required_search_strings":[],"forbidden_empty_diff":true}}'
setup_case "empty-diff" "$empty_expectation" ":" 8 $'goal-setting\nscouting\ncoding\ncoding' false 0 "critical change verification" 0
grep -q 'git.diff is empty but forbidden_empty_diff is true' "$RESULTS_DIR/critical-change-verification.log" || fail "empty-diff did not fail on empty diff"
! grep -q '^goal-check$' "$PI_CALLS" || fail "empty-diff invoked goal-check"

setup_case "fallback-empty-diff" "__NO_SCOUTING_ARTIFACT__" ":" 8 $'goal-setting\nscouting\ncoding\ncoding' false 0 "critical change verification" 0
node - "$RESULTS_DIR/critical-change-expectations.json" <<'NODE' || fail "fallback-empty-diff expectation artifact missing fallback marker"
const fs = require('node:fs');
const artifact = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (artifact.source_artifacts?.scouting_fallback !== true) {
  throw new Error('expected source_artifacts.scouting_fallback=true');
}
if (artifact.fallback_reason !== 'missing_scouting_candidate_for_patch_mode') {
  throw new Error(`unexpected fallback_reason=${artifact.fallback_reason}`);
}
if (artifact.forbidden_empty_diff !== true) {
  throw new Error('expected forbidden_empty_diff=true');
}
NODE
grep -q 'git.diff is empty but forbidden_empty_diff is true' "$RESULTS_DIR/result-summary.md" || fail "fallback-empty-diff summary did not name empty diff as terminal failure"
grep -q 'scouting did not produce a candidate artifact' "$RESULTS_DIR/result-summary.md" || fail "fallback-empty-diff summary missing missing-scouting context"
grep -q 'Kaseki used conservative patch fallback' "$RESULTS_DIR/result-summary.md" || fail "fallback-empty-diff summary missing conservative fallback context"
grep -q 'coding agent still produced no git diff' "$RESULTS_DIR/result-summary.md" || fail "fallback-empty-diff summary missing no-diff context"
grep -q 'no-op is not acceptable' "$RESULTS_DIR/goal-check-stderr.log" || fail "fallback-empty-diff retry prompt missing no-op guidance"
grep -q 'Do not finish until git diff is non-empty' "$RESULTS_DIR/goal-check-stderr.log" || fail "fallback-empty-diff retry prompt missing non-empty diff guidance"
grep -q 'Original task prompt:' "$RESULTS_DIR/coding-prompt.txt" || fail "fallback-empty-diff second coding prompt did not include original task"
grep -q 'no-op is not acceptable' "$RESULTS_DIR/coding-prompt.txt" || fail "fallback-empty-diff second coding prompt did not include repair guidance"
! grep -q '^goal-check$' "$PI_CALLS" || fail "fallback-empty-diff invoked goal-check"

missing_file_expectation='{"task":"inspect","requirements":[],"relevant_files":[],"observations":[],"plan":[],"validation":[],"risks":[],"test_impact":[],"suggested_allowlist":{"agent_patterns":["**"],"validation_patterns":["**"]},"critical_change_expectations":{"required_files":["target.txt"],"required_search_strings":[],"forbidden_empty_diff":false}}'
setup_case "missing-file" "$missing_file_expectation" "printf 'changed other\n' > '__WORKSPACE_REPO__/other.txt'" 8 $'goal-setting\nscouting\ncoding\ncoding' false 0 "critical change verification" 1
grep -q 'required file missing from changed-files.txt: target.txt' "$RESULTS_DIR/critical-change-verification.log" || fail "missing-file did not fail on required file"
! grep -q '^goal-check$' "$PI_CALLS" || fail "missing-file invoked goal-check"

tests_only_expectation='{"task":"implement target behavior","requirements":[],"relevant_files":[],"observations":[],"plan":[],"validation":[],"risks":[],"test_impact":[],"suggested_allowlist":{"agent_patterns":["**"],"validation_patterns":["**"]},"critical_change_expectations":{"required_files":["target.txt"],"required_search_strings":["MAGIC_EXPECTED_STRING"],"forbidden_empty_diff":true}}'
setup_case "tests-only-missing-core-change" "$tests_only_expectation" "printf 'MAGIC_EXPECTED_STRING test only\n' > '__WORKSPACE_REPO__/tests/target.test.js'" 8 $'goal-setting\nscouting\ncoding\ncoding' false 0 "critical change verification" 0
grep -q 'required file missing from changed-files.txt: target.txt' "$RESULTS_DIR/critical-change-verification.log" || fail "tests-only case did not fail on missing core file"
grep -q 'required search string' "$RESULTS_DIR/critical-change-verification.log" && fail "tests-only case should fail on missing core file, not diff marker copied into tests"
! grep -q '^goal-check$' "$PI_CALLS" || fail "tests-only case invoked goal-check"

present_expectation='{"task":"inspect","requirements":[],"relevant_files":[],"observations":[],"plan":[],"validation":[],"risks":[],"test_impact":[],"suggested_allowlist":{"agent_patterns":["**"],"validation_patterns":["**"]},"critical_change_expectations":{"required_files":["target.txt"],"required_search_strings":["MAGIC_EXPECTED_STRING"],"forbidden_empty_diff":true}}'
setup_case "present" "$present_expectation" "printf 'MAGIC_EXPECTED_STRING\n' > '__WORKSPACE_REPO__/target.txt'" 0 $'goal-setting\nscouting\ncoding\ngoal-check' true 1 "" 0
grep -q 'verification passed' "$RESULTS_DIR/critical-change-verification.log" || fail "present case did not pass verification"
grep -q '^goal-check$' "$PI_CALLS" || fail "present case did not invoke goal-check"

echo "PASS: $TEST_NAME"
