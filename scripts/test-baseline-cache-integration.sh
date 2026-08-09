#!/bin/bash
# Integration test for baseline validation caching
# This test verifies cache hit/miss behavior, expiration, and disabling

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
TEMP_TEST_DIR=""
CACHE_ROOT=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

cleanup() {
  if [ -n "$TEMP_TEST_DIR" ] && [ -d "$TEMP_TEST_DIR" ]; then
    rm -rf "$TEMP_TEST_DIR" 2>/dev/null || true
  fi
}

trap cleanup EXIT

log_test() {
  printf "%b[TEST]%b %s\n" "$YELLOW" "$NC" "$1"
}

log_pass() {
  printf "%b[PASS]%b %s\n" "$GREEN" "$NC" "$1"
}

log_fail() {
  printf "%b[FAIL]%b %s\n" "$RED" "$NC" "$1"
  exit 1
}

# Setup test environment
setup_test_env() {
  TEMP_TEST_DIR="$(mktemp -d)"
  CACHE_ROOT="$TEMP_TEST_DIR/cache"
  mkdir -p "$CACHE_ROOT"
  
  log_test "Test environment setup at $TEMP_TEST_DIR"
}

# Test 1: Exercise the cache exclusively through the public baseline-validation workflow
test_shell_cache_functions() {
  local fixture_worktree="$TEMP_TEST_DIR/fixture-worktree"
  local fixture_repo="$CACHE_ROOT/baseline-cache-fixture.git"
  local runtime_root="$TEMP_TEST_DIR/runtime"
  local results_root="$runtime_root/kaseki-results"
  local original_artifact_hashes
  local cache_entry

  log_test "Testing baseline cache through the public baseline-validation workflow"

  if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
    printf "%b[SKIP]%b Docker is unavailable; skipping public workflow integration scenario\n" "$YELLOW" "$NC"
    return 0
  fi

  mkdir -p "$fixture_worktree" "$runtime_root"
  git -C "$fixture_worktree" init -q -b main
  git -C "$fixture_worktree" config user.name "Kaseki Integration Test"
  git -C "$fixture_worktree" config user.email "kaseki-integration@example.invalid"
  cat > "$fixture_worktree/package.json" <<'JSON'
{"name":"baseline-cache-fixture","version":"1.0.0","scripts":{"test":"node -e \"console.log('fixture validation passed')\""}}
JSON
  git -C "$fixture_worktree" add package.json
  git -C "$fixture_worktree" commit -q -m "Create baseline cache fixture"
  git clone -q --bare "$fixture_worktree" "$fixture_repo"

  run_public_workflow() {
    local instance="$1"
    local validation_commands="$2"
    local max_age_hours="${3:-24}"
    (
      cd "$REPO_ROOT"
      KASEKI_ROOT="$runtime_root" \
      KASEKI_CACHE_DIR="$CACHE_ROOT" \
      OPENROUTER_API_KEY="baseline-cache-integration-placeholder" \
      REPO_URL="$fixture_repo" \
      GIT_REF="main" \
      INSTANCE="$instance" \
      KASEKI_BASELINE_CACHE_ROOT="$CACHE_ROOT/baseline-validation" \
      KASEKI_BASELINE_CACHE_MAX_AGE_HOURS="$max_age_hours" \
      KASEKI_VALIDATION_COMMANDS="$validation_commands" \
      KASEKI_PRE_AGENT_VALIDATION_COMMANDS="$validation_commands" \
      KASEKI_STARTUP_CHECK_MODE="baseline-validation" \
      "$REPO_ROOT/run-kaseki.sh" --dry-run
    ) >"$TEMP_TEST_DIR/$instance.stdout.log" 2>"$TEMP_TEST_DIR/$instance.stderr.log"
  }

  assert_run() {
    local instance="$1"
    local expected_status="$2"
    local metadata="$results_root/$instance/metadata.json"
    shift 2

    [ -f "$metadata" ] || log_fail "$instance did not produce metadata.json"
    node -e '
      const fs = require("fs");
      const [metadataPath, expectedStatus, ...artifacts] = process.argv.slice(1);
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      if (metadata.baseline_cache_status !== expectedStatus) {
        throw new Error(`expected ${expectedStatus}, got ${metadata.baseline_cache_status}`);
      }
      if (metadata.baseline_validation_exit_code !== 0) {
        throw new Error(`expected successful baseline status, got exit code ${metadata.baseline_validation_exit_code}`);
      }
      for (const artifact of artifacts) {
        if (!fs.statSync(artifact).isFile() || fs.statSync(artifact).size === 0) {
          throw new Error(`missing or empty restored artifact: ${artifact}`);
        }
      }
    ' "$metadata" "$expected_status" "$@" || log_fail "$instance did not preserve the expected status and artifacts"
  }

  run_public_workflow cache-miss "npm test" || log_fail "Initial baseline-validation run failed"
  assert_run cache-miss completed
  cache_entry="$(find "$CACHE_ROOT/baseline-validation" -mindepth 1 -maxdepth 1 -type d | head -1)"
  [ -n "$cache_entry" ] || log_fail "Public workflow did not create a cache entry"
  original_artifact_hashes="$(sha256sum "$results_root/cache-miss/validation-baseline.log" "$results_root/cache-miss/validation-baseline-raw.log" "$results_root/cache-miss/validation-baseline-timings.tsv" | awk '{print $1}')"

  run_public_workflow cache-hit "npm test" || log_fail "Repeated baseline-validation run failed"
  assert_run cache-hit cache_hit \
    "$results_root/cache-hit/validation-baseline.log" \
    "$results_root/cache-hit/validation-baseline-raw.log" \
    "$results_root/cache-hit/validation-baseline-timings.tsv"
  [ "$original_artifact_hashes" = "$(sha256sum "$results_root/cache-hit/validation-baseline.log" "$results_root/cache-hit/validation-baseline-raw.log" "$results_root/cache-hit/validation-baseline-timings.tsv" | awk '{print $1}')" ] || \
    log_fail "Cache hit did not restore the original validation artifacts"
  log_pass "Identical inputs hit the cache and restore successful validation artifacts"

  run_public_workflow changed-input "npm test --silent" || log_fail "Changed-input baseline-validation run failed"
  assert_run changed-input completed
  log_pass "Changed validation inputs miss the cache"

  touch -d '2 hours ago' "$cache_entry/validation.log"
  run_public_workflow expired-entry "npm test" 1 || log_fail "Expired-entry baseline-validation run failed"
  assert_run expired-entry completed
  log_pass "Expired cache entries are rejected"

  rm -f "$cache_entry/validation-timings.tsv"
  run_public_workflow malformed-entry "npm test" || log_fail "Malformed-entry baseline-validation run failed"
  assert_run malformed-entry completed
  log_pass "Malformed cache entries are rejected"
}

# Test 2: Verify environment variables
test_environment_variables() {
  log_test "Testing environment variables"
  
  cd "$REPO_ROOT"
  
  # Check that cache env vars are defined with proper defaults
  if grep -q 'KASEKI_BASELINE_CACHE_ROOT=' kaseki-agent.sh; then
    log_pass "KASEKI_BASELINE_CACHE_ROOT default set"
  else
    log_fail "KASEKI_BASELINE_CACHE_ROOT default not found"
  fi
  
  if grep -q 'KASEKI_BASELINE_CACHE_MAX_AGE_HOURS=' kaseki-agent.sh; then
    log_pass "KASEKI_BASELINE_CACHE_MAX_AGE_HOURS default set"
  else
    log_fail "KASEKI_BASELINE_CACHE_MAX_AGE_HOURS default not found"
  fi
  
  if grep -q 'KASEKI_BASELINE_CACHE_DISABLED=' kaseki-agent.sh; then
    log_pass "KASEKI_BASELINE_CACHE_DISABLED option available"
  else
    log_fail "KASEKI_BASELINE_CACHE_DISABLED option not found"
  fi
}

# Test 3: Verify documentation
test_documentation() {
  log_test "Testing documentation"
  
  cd "$REPO_ROOT"
  
  # Check that ENV_VARS.md mentions cache
  if grep -q "KASEKI_BASELINE_CACHE" docs/ENV_VARS.md; then
    log_pass "Cache variables documented in ENV_VARS.md"
  else
    log_fail "Cache variables not documented"
  fi
  
  # Check for caching behavior explanation
  if grep -q "Baseline caching" docs/ENV_VARS.md; then
    log_pass "Baseline caching behavior documented"
  else
    log_fail "Baseline caching behavior not documented"
  fi
}

# Run all tests
main() {
  log_test "Baseline validation cache integration tests"
  setup_test_env
  
  test_shell_cache_functions
  test_environment_variables
  test_documentation
  
  log_pass "All integration tests passed!"
}

main
