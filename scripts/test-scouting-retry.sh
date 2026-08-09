#!/bin/bash

##############################################################################
# test-scouting-retry.sh
#
# Test script for scouting phase retry mechanism.
# Validates that:
# 1. Transient failures (exit 124, JSON errors) trigger retry
# 2. Deterministic failures (exit 86) do NOT retry
# 3. Max attempts are respected (max 2 attempts)
# 4. Metadata is correctly populated with retry counts
#
# Run: bash scripts/test-scouting-retry.sh
##############################################################################

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

test_count=0
pass_count=0
fail_count=0

# The extracted classifier consults this path for validation diagnostics.
UNIT_RESULTS_DIR="$(mktemp -d)"
export KASEKI_RESULTS_DIR="$UNIT_RESULTS_DIR"
trap 'rm -rf "$UNIT_RESULTS_DIR"' EXIT

# Test utilities
test_header() {
  local title="$1"
  test_count=$((test_count + 1))
  printf '\n%s==> Test %d: %s%s\n' "$YELLOW" "$test_count" "$title" "$NC"
}

test_pass() {
  local msg="${1:-Test passed}"
  pass_count=$((pass_count + 1))
  printf '%s✓ PASS: %s%s\n' "$GREEN" "$msg" "$NC"
}

test_fail() {
  local msg="${1:-Test failed}"
  fail_count=$((fail_count + 1))
  printf '%s✗ FAIL: %s%s\n' "$RED" "$msg" "$NC"
}

# Load the is_transient_scouting_failure function
source_kaseki_functions() {
  # Extract the is_transient_scouting_failure function from kaseki-agent.sh
  local func_def
  func_def="$(sed -n '/^is_transient_scouting_failure()/,/^}/p' ./kaseki-agent.sh)"
  eval "$func_def"
}

##############################################################################
# Unit Tests for is_transient_scouting_failure()
##############################################################################

test_header "is_transient_scouting_failure: Exit 124 (timeout) → transient"
source_kaseki_functions
if is_transient_scouting_failure 124 ""; then
  test_pass "Exit 124 correctly identified as transient"
else
  test_fail "Exit 124 should be transient"
fi

test_header "is_transient_scouting_failure: Exit 86 (validation error) → NOT transient"
if ! is_transient_scouting_failure 86 "schema validation failed"; then
  test_pass "Exit 86 correctly identified as deterministic"
else
  test_fail "Exit 86 should NOT be transient"
fi

test_header "is_transient_scouting_failure: Exit 2 (missing config) → NOT transient"
if ! is_transient_scouting_failure 2 "missing API key"; then
  test_pass "Exit 2 correctly identified as deterministic"
else
  test_fail "Exit 2 should NOT be transient"
fi

test_header "is_transient_scouting_failure: Exit 1 with LLM error → transient"
if is_transient_scouting_failure 1 "Error: API connection failed"; then
  test_pass "Exit 1 with API error correctly identified as transient"
else
  test_fail "Exit 1 with API error should be transient"
fi

test_header "is_transient_scouting_failure: Exit 1 with schema error → NOT transient"
if ! is_transient_scouting_failure 1 "error: invalid JSON schema"; then
  test_pass "Exit 1 with schema error correctly identified as deterministic"
else
  test_fail "Exit 1 with schema error should NOT be transient"
fi

test_header "is_transient_scouting_failure: Exit 0 (success) → NOT transient"
if ! is_transient_scouting_failure 0 ""; then
  test_pass "Exit 0 correctly identified as not transient"
else
  test_fail "Exit 0 should NOT be transient"
fi

##############################################################################
# Integration Tests (execute the real scouting retry path)
##############################################################################

TMP_DIR="$(mktemp -d)"
FAKE_REPO="$TMP_DIR/fake-repo"
FAKE_BIN="$TMP_DIR/bin"
APP_LIB="$TMP_DIR/app/lib"
RUN_LOG="$TMP_DIR/kaseki-run.log"
AGENT_SCRIPT="$TMP_DIR/kaseki-agent.sh"

cleanup() {
  rm -rf "$TMP_DIR" "$UNIT_RESULTS_DIR"
}
trap cleanup EXIT

mkdir -p "$FAKE_REPO/deps/fake-dep" "$FAKE_BIN" "$APP_LIB"
touch "$APP_LIB/event-aggregator.js" "$APP_LIB/timestamp-tracker.js" "$APP_LIB/progress-stream-utils.js"
printf '%s\n' '{"name":"scouting-retry-fixture","version":"1.0.0","private":true,"dependencies":{"fake-dep":"file:deps/fake-dep"}}' > "$FAKE_REPO/package.json"
printf '%s\n' '{"name":"fake-dep","version":"1.0.0","private":true}' > "$FAKE_REPO/deps/fake-dep/package.json"
printf '%s\n' '{"name":"scouting-retry-fixture","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"scouting-retry-fixture","version":"1.0.0","dependencies":{"fake-dep":"file:deps/fake-dep"}},"deps/fake-dep":{"version":"1.0.0"},"node_modules/fake-dep":{"resolved":"deps/fake-dep","link":true}}}' > "$FAKE_REPO/package-lock.json"
git -C "$FAKE_REPO" init -q -b main
git -C "$FAKE_REPO" add package.json package-lock.json deps/fake-dep/package.json
git -C "$FAKE_REPO" -c user.email=kaseki-test@example.invalid -c user.name="Kaseki Test" commit -q -m initial

cp ./kaseki-agent.sh "$AGENT_SCRIPT"
chmod +x "$AGENT_SCRIPT"
./tests/helpers/stage-scouting-templates.sh "$(pwd)" "$AGENT_SCRIPT"
cat > "$TMP_DIR/scripts/scouting-allowlist.js" <<'EOF_SCOUTING_VALIDATOR'
#!/usr/bin/env node
const fs = require('node:fs');
const [, , command, candidatePath, finalPath] = process.argv;
if (command === 'derive') {
  process.stdout.write(JSON.stringify({ agent_patterns: ['package.json'], validation_patterns: ['package.json'] }));
  process.exit(0);
}
if (command !== 'validate') process.exit(2);
const artifact = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
const requiredArrays = ['requirements', 'relevant_files', 'observations', 'plan', 'validation', 'risks', 'test_impact'];
if (typeof artifact.task !== 'string' || requiredArrays.some((key) => !Array.isArray(artifact[key]))) process.exit(1);
fs.writeFileSync(finalPath, `${JSON.stringify(artifact, null, 2)}\n`);
EOF_SCOUTING_VALIDATOR
chmod +x "$TMP_DIR/scripts/scouting-allowlist.js"

cat > "$FAKE_BIN/pi" <<'EOF_PI'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then printf '%s\n' 'pi 0.0.0-test'; exit 0; fi
if [ "${1:-}" = "--list-models" ]; then printf '%s\n' 'gateway/dynamic/kaseki-agent'; exit 0; fi
if [ "${KASEKI_INFERENCE_PHASE:-}" = "scouting" ]; then
  count=0
  [ ! -f "$FAKE_AGENT_STATE" ] || count="$(cat "$FAKE_AGENT_STATE")"
  count=$((count + 1))
  printf '%d\n' "$count" > "$FAKE_AGENT_STATE"
  if [ "$FAKE_SCOUTING_MODE" = "fail-once" ] && [ "$count" -eq 1 ]; then
    printf '%s\n' 'transient scouting timeout' >&2
    exit 124
  fi
  if [ "$FAKE_SCOUTING_MODE" = "always-fail" ]; then
    printf '%s\n' 'transient scouting timeout' >&2
    exit 124
  fi
  cat > "$KASEKI_RESULTS_DIR/scouting-candidate.json" <<'JSON'
{"task":"inspect retry metadata","requirements":[],"relevant_files":[],"observations":[],"plan":[],"validation":[],"risks":[],"test_impact":[],"suggested_allowlist":{"agent_patterns":["package.json"],"validation_patterns":["package.json"]}}
JSON
fi
printf '%s\n' '{"type":"message","model":"test-model"}'
EOF_PI
cat > "$FAKE_BIN/kaseki-pi-progress-stream" <<'EOF_PROGRESS'
#!/usr/bin/env bash
cat >/dev/null
EOF_PROGRESS
cat > "$FAKE_BIN/kaseki-pi-event-filter" <<'EOF_FILTER'
#!/usr/bin/env bash
cat "$1" > "$2"
printf '%s\n' '{"selected_model":"test-model"}' > "$3"
EOF_FILTER
cat > "$FAKE_BIN/validation-output-filter" <<'EOF_VALIDATION_FILTER'
#!/usr/bin/env bash
cat
EOF_VALIDATION_FILTER
chmod +x "$FAKE_BIN"/*

run_scouting_case() {
  local case_name="$1"
  local mode="$2"
  local expected_exit="$3"
  local expected_attempts="$4"
  local expected_success_json="$5"
  local case_root="$TMP_DIR/$case_name"
  local results_dir="$case_root/results"
  local state_file="$case_root/scouting-calls"
  local run_exit

  mkdir -p "$results_dir" "$case_root/workspace"
  set +e
  env PATH="$FAKE_BIN:$PATH" REPO_URL="$FAKE_REPO" GIT_REF=main TASK_PROMPT="inspect retry metadata" \
    OPENROUTER_API_KEY=test LLM_GATEWAY_URL=https://example.invalid/v1 LLM_GATEWAY_API_KEY=test \
    GITHUB_APP_ENABLED=0 KASEKI_GIT_CACHE_MODE=off KASEKI_TASK_MODE=inspect KASEKI_SCOUTING=1 \
    KASEKI_GOAL_SETTING=0 KASEKI_GOAL_CHECK=0 KASEKI_RUN_EVALUATION=0 KASEKI_BASELINE_VALIDATION_ENABLED=0 \
    KASEKI_PRE_AGENT_VALIDATION_COMMANDS=: KASEKI_VALIDATION_COMMANDS=: KASEKI_ALLOW_EMPTY_DIFF=1 \
    KASEKI_RESULTS_DIR="$results_dir" KASEKI_WORKSPACE_DIR="$case_root/workspace" KASEKI_APP_LIB_DIR="$APP_LIB" \
    KASEKI_CACHE_DIR="$case_root/cache" KASEKI_DEPENDENCY_CACHE_DIR="$case_root/dependency-cache" \
    KASEKI_IMAGE_DEPENDENCY_CACHE_DIR="$case_root/image-cache" KASEKI_SKIP_GATEWAY_HEALTH_CHECK=1 \
    FAKE_AGENT_STATE="$state_file" FAKE_SCOUTING_MODE="$mode" \
    bash "$AGENT_SCRIPT" > "$RUN_LOG" 2>&1
  run_exit=$?
  set -e

  if [ "$run_exit" -ne "$expected_exit" ]; then
    test_fail "$case_name exited $run_exit instead of $expected_exit"
    tail -80 "$RUN_LOG" >&2 || true
    cat "$results_dir/scouting-validation-errors.jsonl" >&2 || true
    cat "$results_dir/scouting-stderr.log" >&2 || true
    cat "$results_dir/scouting-validation-reason.txt" >&2 || true
    return
  fi

  if node - "$results_dir/metadata.json" "$expected_attempts" "$expected_success_json" <<'NODE'
const fs = require('node:fs');
const [metadataPath, expectedAttemptsText, expectedSuccessText] = process.argv.slice(2);
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
const expectedAttempts = JSON.parse(expectedAttemptsText);
const expectedSuccess = JSON.parse(expectedSuccessText);
if (metadata.scouting_attempts !== expectedAttempts) {
  throw new Error(`scouting_attempts: expected ${JSON.stringify(expectedAttempts)}, got ${JSON.stringify(metadata.scouting_attempts)}`);
}
if (metadata.scouting_succeeded_on_attempt !== expectedSuccess) {
  throw new Error(`scouting_succeeded_on_attempt: expected ${JSON.stringify(expectedSuccess)}, got ${JSON.stringify(metadata.scouting_succeeded_on_attempt)}`);
}
NODE
  then
    test_pass "$case_name metadata records exact retry semantics"
  else
    test_fail "$case_name metadata retry fields were incorrect"
  fi
}

test_header "Controlled scouting retries once after a transient failure"
run_scouting_case transient-success fail-once 0 2 2

test_header "Controlled scouting records terminal failure after attempts are exhausted"
run_scouting_case terminal-failure always-fail 124 2 null

##############################################################################
# Summary
##############################################################################

printf '\n%s===================================================%s\n' "$YELLOW" "$NC"
printf 'Tests Run:    %d\n' "$test_count"
printf 'Passed:       %s%d%s\n' "$GREEN" "$pass_count" "$NC"
printf 'Failed:       %s%d%s\n' "$([ "$fail_count" -eq 0 ] && echo "$GREEN" || echo "$RED")" "$fail_count" "$NC"
printf '%s===================================================%s\n' "$YELLOW" "$NC"

if [ "$fail_count" -eq 0 ]; then
  printf '\n%s✓ All tests passed!%s\n\n' "$GREEN" "$NC"
  exit 0
else
  printf '\n%s✗ Some tests failed!%s\n\n' "$RED" "$NC"
  exit 1
fi
