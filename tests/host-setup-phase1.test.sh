#!/usr/bin/env bash
#
# tests/host-setup-phase1.test.sh — Phase 1 unit tests for validation infrastructure
#
# Usage:
#   bash tests/host-setup-phase1.test.sh [--verbose]
#   VERBOSE=1 bash tests/host-setup-phase1.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERBOSE="${VERBOSE:-0}"
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0
TEST_HOME=""
TEST_STATE_ROOT=""
TEST_SECRETS_DIR=""
TEST_LOG_DIR=""
TEST_SETUP_ROOT=""
TEST_TEMPLATE_DIR=""

cleanup() {
  if [ -n "$TEST_STATE_ROOT" ]; then
    rm -rf "$TEST_STATE_ROOT"
  fi
}
trap cleanup EXIT

init_test_environment() {
  TEST_STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/kaseki-host-setup-test.XXXXXX")"
  TEST_HOME="$TEST_STATE_ROOT/home"
  TEST_SECRETS_DIR="$TEST_HOME/secrets"
  TEST_LOG_DIR="$TEST_STATE_ROOT/logs"
  TEST_SETUP_ROOT="$TEST_STATE_ROOT/agents"
  TEST_TEMPLATE_DIR="$TEST_SETUP_ROOT/kaseki-template"

  mkdir -p "$TEST_HOME" "$TEST_SECRETS_DIR" "$TEST_LOG_DIR" \
    "$TEST_SETUP_ROOT/kaseki-results" "$TEST_SETUP_ROOT/kaseki-runs" \
    "$TEST_SETUP_ROOT/kaseki-cache" "$TEST_TEMPLATE_DIR"
  cat > "$TEST_TEMPLATE_DIR/run-kaseki.sh" <<'RUNNER'
#!/usr/bin/env bash
exit 0
RUNNER
  chmod +x "$TEST_TEMPLATE_DIR/run-kaseki.sh"
}

pass() {
  local test_name="$1"
  TESTS_PASSED=$((TESTS_PASSED + 1))
  if [ "$VERBOSE" = "1" ]; then
    echo "  ✓ $test_name"
  fi
}

fail() {
  local test_name="$1"
  local detail="${2:-}"
  TESTS_FAILED=$((TESTS_FAILED + 1))
  if [ -n "$detail" ]; then
    echo "  ✗ $test_name ($detail)" >&2
  else
    echo "  ✗ $test_name" >&2
  fi
}

skip() {
  local test_name="$1"
  local detail="${2:-skipped}"
  TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
  if [ "$VERBOSE" = "1" ]; then
    echo "  ⊘ $test_name ($detail)"
  fi
}

assert_file_exists() {
  local file="$1" test_name="$2"
  if [ -f "$file" ]; then
    pass "$test_name"
  else
    fail "$test_name" "file not found: $file"
  fi
}

assert_executable() {
  local file="$1" test_name="$2"
  if [ -x "$file" ]; then
    pass "$test_name"
  else
    fail "$test_name" "not executable: $file"
  fi
}

assert_file_contains() {
  local file="$1" pattern="$2" test_name="$3"
  if grep -q "$pattern" "$file"; then
    pass "$test_name"
  else
    fail "$test_name" "pattern not found: $pattern"
  fi
}

assert_json_valid() {
  local file="$1" test_name="$2"
  if ! command -v jq >/dev/null 2>&1; then
    skip "$test_name" "jq not available"
    return 0
  fi
  if jq . "$file" >/dev/null 2>&1; then
    pass "$test_name"
  else
    fail "$test_name" "invalid JSON: $file"
  fi
}

assert_json_has_keys() {
  local file="$1" jq_filter="$2" test_name="$3"
  if ! command -v jq >/dev/null 2>&1; then
    skip "$test_name" "jq not available"
    return 0
  fi
  if jq -e "$jq_filter" "$file" >/dev/null 2>&1; then
    pass "$test_name"
  else
    fail "$test_name" "required JSON keys missing in $file"
  fi
}

capture_command() {
  local __output_var="$1" __status_var="$2"
  shift 2
  local captured_output captured_status
  if captured_output=$("$@" 2>&1); then
    captured_status=0
  else
    captured_status=$?
  fi
  printf -v "$__output_var" '%s' "$captured_output"
  printf -v "$__status_var" '%s' "$captured_status"
}

run_setup_check_only() {
  HOME="$TEST_HOME" \
  KASEKI_HOST_HOME="$TEST_HOME" \
  KASEKI_ROOT="$TEST_SETUP_ROOT" \
  KASEKI_TEMPLATE_DIR="$TEST_TEMPLATE_DIR" \
  KASEKI_CHECKOUT_DIR="$SCRIPT_DIR" \
  KASEKI_LOG_DIR="$TEST_LOG_DIR" \
  KASEKI_HOST_SECRETS_DIR="$TEST_SECRETS_DIR" \
    "$SCRIPT_DIR/scripts/kaseki-setup-host.sh" --check-only
}

# Focused check: help output contract
test_help_output_contract() {
  echo "Test: help output contract"
  local output status
  capture_command output status env HOME="$TEST_HOME" KASEKI_HOST_HOME="$TEST_HOME" \
    "$SCRIPT_DIR/scripts/kaseki-setup-host.sh" --help

  if [ "$status" -eq 0 ]; then
    pass "--help exits 0"
  else
    fail "--help exits 0" "exit code: $status"
  fi
  if printf '%s' "$output" | grep -q '^Usage: scripts/kaseki-setup-host.sh'; then
    pass "--help includes usage line"
  else
    fail "--help includes usage line"
  fi
  if printf '%s' "$output" | grep -q -- '--check-only'; then
    pass "--help documents --check-only"
  else
    fail "--help documents --check-only"
  fi
  # shellcheck disable=SC2088 # Intentionally matching literal tilde in help text
  if printf '%s' "$output" | grep -q '~/.kaseki/host-state.json'; then
    pass "--help documents state output"
  else
    fail "--help documents state output"
  fi
}

# Focused check: --check-only writes host-state/setup-results to configured state dir
test_check_only_writes_configured_state_dir() {
  echo "Test: --check-only writes state to temporary HOME"
  local output status
  capture_command output status run_setup_check_only

  if [ "$status" -eq 0 ]; then
    pass "--check-only exits 0 with temporary target"
  else
    fail "--check-only exits 0 with temporary target" "exit code: $status; output: $output"
  fi

  assert_file_exists "$TEST_HOME/.kaseki/host-state.json" "host-state.json is written under temporary HOME"
  assert_file_exists "$TEST_HOME/.kaseki/setup-results.json" "setup-results.json is written under temporary HOME"

  if find "$TEST_STATE_ROOT" -path '*/.kaseki/*' -type f | grep -q "^$TEST_HOME/.kaseki/"; then
    pass "generated .kaseki files are isolated to temporary HOME"
  else
    fail "generated .kaseki files are isolated to temporary HOME"
  fi
}

# Focused check: generated JSON contains required keys
test_generated_json_contains_required_keys() {
  echo "Test: generated JSON contains required keys"
  [ -f "$TEST_HOME/.kaseki/host-state.json" ] || run_setup_check_only >/dev/null

  assert_json_valid "$TEST_HOME/.kaseki/host-state.json" "host-state.json is valid JSON"
  assert_json_valid "$TEST_HOME/.kaseki/setup-results.json" "setup-results.json is valid JSON"
  assert_json_has_keys "$TEST_HOME/.kaseki/host-state.json" \
    'has("normalized_secrets_dir") and has("timestamp") and has("version") and (.checkout_freshness_probe | has("status") and has("detail") and has("checkout_dir") and has("uid") and has("gid"))' \
    "host-state.json contains required keys"
  assert_json_has_keys "$TEST_HOME/.kaseki/setup-results.json" \
    'has("timestamp") and has("mode") and has("status") and has("message") and has("exit_code") and has("version") and (.checks | has("checkout_freshness_probe") and has("template_ready"))' \
    "setup-results.json contains required keys"
  assert_file_contains "$TEST_HOME/.kaseki/setup-results.json" '"mode": "check-only"' \
    "setup-results.json records check-only mode"
}

# Deterministic check: run against temporary target dir instead of inspecting /agents mtime
test_check_only_does_not_mutate_target_dir() {
  echo "Test: --check-only does not mutate temporary target"
  local marker="$TEST_SETUP_ROOT/check-only-marker"
  local before after
  printf 'deterministic-marker\n' > "$marker"
  before="$(find "$TEST_SETUP_ROOT" -type f | sed "s|^$TEST_SETUP_ROOT/||" | sort)"
  run_setup_check_only >/dev/null
  after="$(find "$TEST_SETUP_ROOT" -type f | sed "s|^$TEST_SETUP_ROOT/||" | sort)"

  if [ "$before" = "$after" ] && [ -f "$marker" ]; then
    pass "--check-only leaves temporary target file list unchanged"
  else
    fail "--check-only leaves temporary target file list unchanged"
  fi
}

# Focused check: validation functions accept documented modes
test_validation_functions_accept_documented_modes() {
  echo "Test: validation functions accept documented modes"
  local mode output status
  for mode in all permissions bootstrap quick worker; do
    capture_command output status env \
      KASEKI_ROOT="$TEST_SETUP_ROOT" \
      KASEKI_RESULTS_DIR="$TEST_SETUP_ROOT/kaseki-results" \
      KASEKI_RUNS_DIR="$TEST_SETUP_ROOT/kaseki-runs" \
      KASEKI_TEMPLATE_DIR="$TEST_TEMPLATE_DIR" \
      bash -c "source '$SCRIPT_DIR/scripts/validation-stages.sh' && validate_container_entry '$mode'"

    if printf '%s' "$output" | grep -q 'Unknown validation mode'; then
      fail "validate_container_entry accepts mode '$mode'" "unexpected diagnostic: $output"
    else
      pass "validate_container_entry accepts mode '$mode'"
    fi
  done

  capture_command output status bash -c "source '$SCRIPT_DIR/scripts/validation-stages.sh' && validate_container_entry not-a-mode"
  if [ "$status" -eq 1 ] && printf '%s' "$output" | grep -q 'Unknown validation mode: not-a-mode'; then
    pass "validate_container_entry rejects unknown mode with exit 1 and diagnostic"
  else
    fail "validate_container_entry rejects unknown mode with exit 1 and diagnostic" "exit code: $status; output: $output"
  fi
}

test_validation_stages_contract() {
  echo "Test: validation-stages.sh contract"
  assert_file_exists "$SCRIPT_DIR/scripts/validation-stages.sh" "validation-stages.sh is present"
  assert_executable "$SCRIPT_DIR/scripts/validation-stages.sh" "validation-stages.sh is executable"

  local output status func
  capture_command output status bash -c "source '$SCRIPT_DIR/scripts/validation-stages.sh'"
  if [ "$status" -eq 0 ]; then
    pass "validation-stages.sh sources correctly"
  else
    fail "validation-stages.sh sources correctly" "exit code: $status; output: $output"
  fi

  for func in validate_host_prerequisites validate_container_entry log_pass log_warn log_error log_info; do
    capture_command output status bash -c "source '$SCRIPT_DIR/scripts/validation-stages.sh' && declare -f '$func'"
    if [ "$status" -eq 0 ] && printf '%s' "$output" | grep -q "$func"; then
      pass "$func is exported"
    else
      fail "$func is exported" "exit code: $status"
    fi
  done
}

run_all_tests() {
  init_test_environment

  echo ""
  echo "===== Phase 1: Validation Infrastructure Tests ====="
  echo ""

  test_validation_stages_contract
  test_help_output_contract
  test_check_only_writes_configured_state_dir
  test_generated_json_contains_required_keys
  test_check_only_does_not_mutate_target_dir
  test_validation_functions_accept_documented_modes

  echo ""
  echo "===== Test Results ====="
  echo "Passed:  $TESTS_PASSED"
  echo "Failed:  $TESTS_FAILED"
  echo "Skipped: $TESTS_SKIPPED"
  echo ""

  if [ "$TESTS_FAILED" -eq 0 ]; then
    echo "✓ All tests passed!"
    return 0
  else
    echo "✗ Some tests failed"
    return 1
  fi
}

run_all_tests
