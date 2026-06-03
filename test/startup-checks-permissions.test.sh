#!/usr/bin/env bash
#
# Behavior-focused test suite for scripts/startup-checks.sh permission detection.
#

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

TESTS_PASSED=0
TESTS_FAILED=0
LAST_STATUS=0
LAST_OUTPUT=''
TMP_ROOT=''

log_pass() {
  echo -e "${GREEN}[PASS]${NC} $*" >&2
  TESTS_PASSED=$((TESTS_PASSED + 1))
}

log_fail() {
  echo -e "${RED}[FAIL]${NC} $*" >&2
  TESTS_FAILED=$((TESTS_FAILED + 1))
}

setup_tmp_root() {
  TMP_ROOT="$(mktemp -d)"
  mkdir -p "$TMP_ROOT/home" "$TMP_ROOT/agents/kaseki-template" "$TMP_ROOT/agents/kaseki-results" "$TMP_ROOT/agents/kaseki-runs" "$TMP_ROOT/secrets"
  touch "$TMP_ROOT/agents/kaseki-template/run-kaseki.sh"
  chmod 755 "$TMP_ROOT" "$TMP_ROOT/home" "$TMP_ROOT/agents" "$TMP_ROOT/agents/kaseki-template" \
    "$TMP_ROOT/agents/kaseki-results" "$TMP_ROOT/agents/kaseki-runs" "$TMP_ROOT/secrets"
  chmod 755 "$TMP_ROOT/agents/kaseki-template/run-kaseki.sh"
  chown -R 65534:65534 "$TMP_ROOT"
}

cleanup_tmp_root() {
  if [ -n "$TMP_ROOT" ] && [ -d "$TMP_ROOT" ]; then
    chmod -R u+rwX "$TMP_ROOT" 2>/dev/null || true
    rm -rf "$TMP_ROOT"
  fi
}

run_startup_checks() {
  local mode="$1"
  shift

  LAST_OUTPUT="$({
    env \
      HOME="$TMP_ROOT/home" \
      KASEKI_ROOT="$TMP_ROOT/agents" \
      KASEKI_TEMPLATE_DIR="$TMP_ROOT/agents/kaseki-template" \
      KASEKI_RESULTS_DIR="$TMP_ROOT/agents/kaseki-results" \
      KASEKI_RUNS_DIR="$TMP_ROOT/agents/kaseki-runs" \
      KASEKI_SECRETS_DIR="$TMP_ROOT/secrets" \
      GITHUB_APP_ENABLED=0 \
      CONTAINER_UID=65534 \
      CONTAINER_GID=65534 \
      "$@" \
      runuser -u nobody -- bash scripts/startup-checks.sh "$mode"
  } 2>&1)" || LAST_STATUS=$?
  if [ -z "${LAST_STATUS+x}" ]; then
    LAST_STATUS=0
  fi
}

assert_status() {
  local expected="$1"
  local label="$2"

  if [ "$LAST_STATUS" -eq "$expected" ]; then
    log_pass "$label"
  else
    log_fail "$label (expected status $expected, got $LAST_STATUS)"
    printf '%s\n' "$LAST_OUTPUT" >&2
  fi
}

assert_output_contains() {
  local needle="$1"
  local label="$2"

  if printf '%s\n' "$LAST_OUTPUT" | grep -Fq "$needle"; then
    log_pass "$label"
  else
    log_fail "$label (missing: $needle)"
    printf '%s\n' "$LAST_OUTPUT" >&2
  fi
}

assert_output_not_contains() {
  local needle="$1"
  local label="$2"

  if printf '%s\n' "$LAST_OUTPUT" | grep -Fq "$needle"; then
    log_fail "$label (unexpected: $needle)"
    printf '%s\n' "$LAST_OUTPUT" >&2
  else
    log_pass "$label"
  fi
}

# Test: a readable explicit secret file lets the API key check pass.
test_readable_secret_file() {
  echo ""
  echo "Testing readable secret file behavior..."
  setup_tmp_root
  trap cleanup_tmp_root RETURN

  local secret_file="$TMP_ROOT/secrets/openrouter_api_key"
  printf 'test-key\n' > "$secret_file"
  chmod 644 "$secret_file"

  LAST_STATUS=0
  run_startup_checks all OPENROUTER_API_KEY_FILE="$secret_file"

  assert_status 0 "readable secret file exits successfully"
  assert_output_contains "OpenRouter API key found and readable: $secret_file" "reports readable secret file"
  assert_output_contains "All checks passed" "reports successful startup checks"

  cleanup_tmp_root
  trap - RETURN
}

# Test: an existing but unreadable secret file blocks startup with an actionable diagnostic.
test_unreadable_secret_file() {
  echo ""
  echo "Testing unreadable secret file behavior..."
  setup_tmp_root
  trap cleanup_tmp_root RETURN

  local secret_file="$TMP_ROOT/secrets/openrouter_api_key"
  printf 'test-key\n' > "$secret_file"
  chmod 000 "$secret_file"

  LAST_STATUS=0
  run_startup_checks all OPENROUTER_API_KEY_FILE="$secret_file"

  assert_status 2 "unreadable secret file blocks startup"
  assert_output_contains "OpenRouter API key exists but is not readable: $secret_file" "reports unreadable secret file"
  assert_output_contains "Fix with: ./scripts/setup-secrets.sh --fix" "prints secret permission fix guidance"
  assert_output_contains "Error detected; startup blocked" "reports blocked startup"

  cleanup_tmp_root
  trap - RETURN
}

# Test: a non-traversable parent directory is diagnosed as an access problem, not as a missing secret.
test_non_traversable_parent_directory() {
  echo ""
  echo "Testing non-traversable parent directory behavior..."
  setup_tmp_root
  trap cleanup_tmp_root RETURN

  local locked_parent="$TMP_ROOT/locked-parent"
  local secret_file="$locked_parent/openrouter_api_key"
  mkdir -p "$locked_parent"
  printf 'test-key\n' > "$secret_file"
  chmod 644 "$secret_file"
  chmod 600 "$locked_parent"

  LAST_STATUS=0
  run_startup_checks all OPENROUTER_API_KEY_FILE="$secret_file"

  assert_status 2 "non-traversable parent blocks startup"
  assert_output_contains "Parent directory is not traversable: $locked_parent" "reports the non-traversable parent"
  assert_output_contains "needed for $secret_file" "identifies the affected secret path"
  assert_output_not_contains "No OpenRouter API key configured" "does not misreport inaccessible secret as missing"

  cleanup_tmp_root
  trap - RETURN
}

# Test: a read-only/unwritable root path is reported without attempting broad auto-fixes.
test_read_only_mount_handling() {
  echo ""
  echo "Testing read-only mount handling behavior..."
  setup_tmp_root
  trap cleanup_tmp_root RETURN

  chmod 555 "$TMP_ROOT/agents"

  LAST_STATUS=0
  run_startup_checks quick

  assert_status 2 "read-only root blocks quick startup check"
  assert_output_contains "$TMP_ROOT/agents is not writable by UID 65534" "reports unwritable root path"
  assert_output_contains "read-only mount" "mentions read-only mount as a possible cause"
  assert_output_contains "Error detected; startup blocked" "reports blocked startup for read-only root"
  assert_output_not_contains "created" "does not claim to create resources on read-only root"

  cleanup_tmp_root
  trap - RETURN
}

# Test: Verify syntax is valid.
test_syntax() {
  echo ""
  echo "Testing bash syntax..."

  if bash -n scripts/startup-checks.sh; then
    log_pass "startup-checks.sh has valid bash syntax"
  else
    log_fail "startup-checks.sh has syntax errors"
  fi

  if bash -n test/startup-checks-permissions.test.sh; then
    log_pass "startup-checks-permissions.test.sh has valid bash syntax"
  else
    log_fail "startup-checks-permissions.test.sh has syntax errors"
  fi
}

main() {
  echo ""
  echo "========================================="
  echo "Startup Checks Permission Behavior Tests"
  echo "========================================="

  if [ ! -f "scripts/startup-checks.sh" ]; then
    echo "Error: scripts/startup-checks.sh not found"
    exit 1
  fi

  test_readable_secret_file
  test_unreadable_secret_file
  test_non_traversable_parent_directory
  test_read_only_mount_handling
  test_syntax

  echo ""
  echo "========================================="
  echo "Test Results"
  echo "========================================="
  echo -e "${GREEN}Passed:${NC} $TESTS_PASSED"
  echo -e "${RED}Failed:${NC} $TESTS_FAILED"
  echo ""

  if [ "$TESTS_FAILED" -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
    exit 0
  else
    echo -e "${RED}✗ Some tests failed (${TESTS_FAILED})${NC}"
    exit 1
  fi
}

main "$@"
