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
# Integration tests (invoke the real wrapper through a small shell entry point)
##############################################################################

TMP_DIR="$(mktemp -d)"
RETRY_ENTRY_POINT="$TMP_DIR/run-scouting-retry"

# Loading the complete agent would also run repository setup and every later
# phase.  This entry point instead loads the production classifier and wrapper,
# supplies the wrapper's collaborators, and exposes one command: run the retry
# wrapper and serialize the values passed on to metadata generation.
cat > "$RETRY_ENTRY_POINT" <<'EOF_ENTRY'
#!/usr/bin/env bash
set -uo pipefail

emit_progress() { :; }
capture_validation_error_classification() { return 1; }
capture_provider_error_from_log() { return 1; }
clear_provider_error() { :; }

run_scouting_agent() {
  local attempt=0
  [ ! -f "$FAKE_AGENT_STATE" ] || attempt="$(cat "$FAKE_AGENT_STATE")"
  attempt=$((attempt + 1))
  printf '%d\n' "$attempt" > "$FAKE_AGENT_STATE"
  node - "$attempt" <<'NODE' >> "$FAKE_AGENT_OBSERVATIONS"
const attempt = Number(process.argv[2]);
process.stdout.write(`${JSON.stringify({ attempt })}\n`);
NODE
  : > "$SCOUTING_RAW_EVENTS"
  printf '%s\n' '{}' > "$KASEKI_RESULTS_DIR/scouting-summary.json"
  if [ "$FAKE_SCOUTING_MODE" = "always-fail" ] ||
    { [ "$FAKE_SCOUTING_MODE" = "fail-once" ] && [ "$attempt" -eq 1 ]; }; then
    SCOUTING_EXIT=124
    printf '%s\n' 'transient scouting timeout' >&2
    return 124
  fi
  SCOUTING_EXIT=0
  : > "$SCOUTING_ARTIFACT"
  return 0
}

write_retry_metadata() {
  node - "$KASEKI_SCOUTING_ATTEMPTS" "${KASEKI_SCOUTING_SUCCEEDED_ON_ATTEMPT:-}" <<'NODE' > "$KASEKI_RESULTS_DIR/metadata.json"
const [attempts, succeeded] = process.argv.slice(2);
process.stdout.write(`${JSON.stringify({
  scouting_attempts: Number(attempts),
  scouting_succeeded_on_attempt: succeeded === '' ? null : Number(succeeded),
}, null, 2)}\n`);
NODE
}
EOF_ENTRY

sed -n '/^is_transient_scouting_failure()/,/^}/p' ./kaseki-agent.sh >> "$RETRY_ENTRY_POINT"
sed -n '/^run_scouting_agent_with_retry()/,/^snapshot_attempt_artifacts()/p' ./kaseki-agent.sh |
  sed '$d' >> "$RETRY_ENTRY_POINT"
cat >> "$RETRY_ENTRY_POINT" <<'EOF_ENTRY'

run_scouting_agent_with_retry
retry_exit=$?
write_retry_metadata
exit "$retry_exit"
EOF_ENTRY
chmod +x "$RETRY_ENTRY_POINT"

run_scouting_case() {
  local case_name="$1"
  local mode="$2"
  local expected_exit="$3"
  local expected_attempts="$4"
  local expected_success_json="$5"
  local case_root="$TMP_DIR/$case_name"
  local results_dir="$case_root/results"
  local state_file="$case_root/scouting-calls"
  local observations_file="$case_root/scouting-observations.jsonl"
  local run_exit

  mkdir -p "$results_dir"
  set +e
  env KASEKI_RESULTS_DIR="$results_dir" KASEKI_SCOUTING_MAX_ATTEMPTS=2 KASEKI_TASK_MODE=inspect \
    SCOUTING_ARTIFACT="$results_dir/scouting.json" SCOUTING_CANDIDATE_ARTIFACT="$results_dir/scouting-candidate.json" \
    SCOUTING_RAW_EVENTS="$results_dir/scouting-events.raw.jsonl" STATUS=0 FAILED_COMMAND='' \
    FAKE_AGENT_STATE="$state_file" FAKE_AGENT_OBSERVATIONS="$observations_file" FAKE_SCOUTING_MODE="$mode" \
    bash "$RETRY_ENTRY_POINT" > "$case_root/run.log" 2>&1
  run_exit=$?
  set -e

  if [ "$run_exit" -ne "$expected_exit" ]; then
    test_fail "$case_name exited $run_exit instead of $expected_exit"
    cat "$case_root/run.log" >&2 || true
    return
  fi

  if node - "$results_dir/metadata.json" "$observations_file" "$expected_attempts" "$expected_success_json" <<'NODE'
const fs = require('node:fs');
const [metadataPath, observationsPath, expectedAttemptsText, expectedSuccessText] = process.argv.slice(2);
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
const observations = fs.readFileSync(observationsPath, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
const expectedAttempts = JSON.parse(expectedAttemptsText);
const expectedSuccess = JSON.parse(expectedSuccessText);
if (observations.length !== expectedAttempts) {
  throw new Error(`fake scouting command: expected ${expectedAttempts} calls, got ${observations.length}`);
}
if (observations.some(({ attempt }, index) => attempt !== index + 1)) {
  throw new Error(`fake scouting command recorded unexpected attempts: ${JSON.stringify(observations)}`);
}
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
