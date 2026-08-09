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
TMP_DIR=""

cleanup() {
  rm -rf "$UNIT_RESULTS_DIR"
  if [ -n "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

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
# Main-flow tests (launch the supported worker entry point)
##############################################################################

TMP_DIR="$(mktemp -d)"
FAKE_REPO="$TMP_DIR/fake-repo"
mkdir -p "$FAKE_REPO/deps/fake-dep"
printf '%s\n' '{"name":"scouting-retry-fixture","version":"1.0.0","private":true,"dependencies":{"fake-dep":"file:deps/fake-dep"}}' > "$FAKE_REPO/package.json"
printf '%s\n' '{"name":"fake-dep","version":"1.0.0","private":true}' > "$FAKE_REPO/deps/fake-dep/package.json"
printf '%s\n' '{"name":"scouting-retry-fixture","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"scouting-retry-fixture","version":"1.0.0","dependencies":{"fake-dep":"file:deps/fake-dep"}},"deps/fake-dep":{"version":"1.0.0"},"node_modules/fake-dep":{"resolved":"deps/fake-dep","link":true}}}' > "$FAKE_REPO/package-lock.json"
printf '%s\n' '# scouting retry fixture' > "$FAKE_REPO/README.md"
printf '%s\n' 'node_modules/' > "$FAKE_REPO/.gitignore"
git -C "$FAKE_REPO" init -q -b main
git -C "$FAKE_REPO" add .
git -C "$FAKE_REPO" -c user.email=kaseki-test@example.invalid -c user.name='Kaseki Test' commit -q -m initial

run_scouting_case() {
  local case_name="$1"
  local mode="$2"
  local expected_attempts="$3"
  local expected_success_json="$4"
  local expected_overall="$5"
  local expected_exit="$6"
  local case_root="$TMP_DIR/$case_name"
  local fake_bin="$case_root/bin"
  local results_dir="$case_root/results"
  local calls_file="$case_root/scouting-calls"
  local run_log="$case_root/run.log"
  local run_exit

  mkdir -p "$fake_bin" "$results_dir" "$case_root/app/lib"
  touch "$case_root/app/lib/event-aggregator.js" "$case_root/app/lib/timestamp-tracker.js" \
    "$case_root/app/lib/progress-stream-utils.js"
  : > "$calls_file"

  cat > "$fake_bin/pi" <<'EOF_PI'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then
  printf '%s\n' 'pi 0.0.0-test'
  exit 0
fi
prompt="${*: -1}"
if [[ "$prompt" == *"read-only scouting Pi agent"* ]]; then
  attempt=$(($(wc -l < "$FAKE_SCOUTING_CALLS") + 1))
  printf '%d\n' "$attempt" >> "$FAKE_SCOUTING_CALLS"
  if [ "$FAKE_SCOUTING_MODE" = "transient" ] && [ "$attempt" -eq 1 ]; then
    printf '%s\n' 'transient provider timeout' >&2
    exit 124
  fi
  if [ "$FAKE_SCOUTING_MODE" = "deterministic" ]; then
    printf '%s\n' 'invalid JSON schema' >&2
    exit 86
  fi
  cat > "$KASEKI_RESULTS_DIR/scouting-candidate.json" <<'EOF_ARTIFACT'
{"task":"inspect retry behavior","requirements":["preserve retry contract"],"relevant_files":[{"path":"README.md","reason":"fixture file"}],"observations":["fixture repository is available"],"plan":["inspect fixture"],"validation":["main flow completes"],"risks":[],"test_impact":[],"critical_change_expectations":{"required_files":[],"forbidden_empty_diff":false},"suggested_allowlist":{"agent_patterns":["README.md"],"validation_patterns":[]}}
EOF_ARTIFACT
  exit 0
fi
printf '%s\n' '{"type":"message","model":"test-model","message":{"content":"ok"}}'
exit 0
EOF_PI

  cat > "$fake_bin/kaseki-pi-progress-stream" <<'EOF_PROGRESS'
#!/usr/bin/env bash
cat
EOF_PROGRESS
  cat > "$fake_bin/kaseki-pi-event-filter" <<'EOF_FILTER'
#!/usr/bin/env bash
cat "$1" > "$2"
printf '%s\n' '{"selected_model":"test-model"}' > "$3"
EOF_FILTER
  cat > "$fake_bin/validation-output-filter" <<'EOF_VALIDATION_FILTER'
#!/usr/bin/env bash
cat
EOF_VALIDATION_FILTER
  chmod +x "$fake_bin"/*

  set +e
  env PATH="$fake_bin:$PATH" KASEKI_RESULTS_DIR="$results_dir" KASEKI_WORKSPACE_DIR="$case_root/workspace" \
    KASEKI_APP_LIB_DIR="$case_root/app/lib" REPO_URL="$FAKE_REPO" GIT_REF=main \
    TASK_PROMPT='inspect retry behavior' OPENROUTER_API_KEY=test KASEKI_PROVIDER=openrouter \
    FAKE_SCOUTING_CALLS="$calls_file" FAKE_SCOUTING_MODE="$mode" GITHUB_APP_ENABLED=0 \
    KASEKI_TASK_MODE=inspect KASEKI_SCOUTING=1 KASEKI_GOAL_SETTING=0 KASEKI_GOAL_CHECK=0 \
    KASEKI_GIT_CACHE_MODE=off KASEKI_BASELINE_VALIDATION_ENABLED=0 \
    KASEKI_PRE_AGENT_VALIDATION=0 KASEKI_TS_PRE_CHECK=0 KASEKI_VALIDATION_COMMANDS=: \
    KASEKI_RUN_EVALUATION=0 KASEKI_REPO_MEMORY_MODE=off KASEKI_STREAM_PROGRESS=0 \
    bash ./kaseki-agent.sh > "$run_log" 2>&1
  run_exit=$?
  set -e

  if [ "$run_exit" -ne "$expected_exit" ]; then
    test_fail "$case_name entry point exited $run_exit instead of $expected_exit"
    tail -100 "$run_log" >&2 || true
    return
  fi

  if node - "$results_dir/metadata.json" "$calls_file" "$expected_attempts" "$expected_success_json" "$expected_overall" <<'NODE'
const fs = require('node:fs');
const [metadataPath, callsPath, expectedAttemptsText, expectedSuccessText, expectedOverallText] = process.argv.slice(2);
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
const calls = fs.readFileSync(callsPath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(Number);
const expectedAttempts = Number(expectedAttemptsText);
const expectedSuccess = JSON.parse(expectedSuccessText);
const expectedOverall = Number(expectedOverallText);
if (calls.length !== expectedAttempts) {
  throw new Error(`fake scouting provider: expected ${expectedAttempts} calls, got ${calls.length}`);
}
if (calls.some((attempt, index) => attempt !== index + 1)) {
  throw new Error(`fake scouting provider recorded unexpected calls: ${JSON.stringify(calls)}`);
}
if (metadata.scouting_attempts !== expectedAttempts) {
  throw new Error(`scouting_attempts: expected ${expectedAttempts}, got ${metadata.scouting_attempts}`);
}
if (metadata.scouting_succeeded_on_attempt !== expectedSuccess) {
  throw new Error(`scouting_succeeded_on_attempt: expected ${JSON.stringify(expectedSuccess)}, got ${JSON.stringify(metadata.scouting_succeeded_on_attempt)}`);
}
if (metadata.exit_code !== expectedOverall) {
  throw new Error(`exit_code: expected ${expectedOverall}, got ${metadata.exit_code}`);
}
NODE
  then
    test_pass "$case_name preserves the user-visible scouting retry contract"
  else
    test_fail "$case_name invocation count, outcome, or retry metadata was incorrect"
    tail -100 "$run_log" >&2 || true
  fi
}

test_header "Main flow retries a transient scouting provider failure"
run_scouting_case transient-success transient 2 2 0 0

test_header "Main flow does not retry a deterministic scouting provider failure"
run_scouting_case deterministic-failure deterministic 1 null 86 86

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
