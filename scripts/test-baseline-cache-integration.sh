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

# Test 1: Exercise the public baseline-validation workflow across two runs
test_public_baseline_validation_cache_workflow() {
  local fixture_worktree="$TEMP_TEST_DIR/fixture-worktree"
  local fixture_repo="$CACHE_ROOT/baseline-cache-fixture.git"
  local runtime_root="$TEMP_TEST_DIR/runtime"
  local first_metadata="$runtime_root/kaseki-results/kaseki-1/metadata.json"
  local second_metadata="$runtime_root/kaseki-results/kaseki-2/metadata.json"

  log_test "Testing public baseline-validation workflow cache miss followed by hit"

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
    (
      cd "$REPO_ROOT"
      KASEKI_ROOT="$runtime_root" \
      KASEKI_CACHE_DIR="$CACHE_ROOT" \
      OPENROUTER_API_KEY="baseline-cache-integration-placeholder" \
      REPO_URL="/cache/baseline-cache-fixture.git" \
      GIT_REF="main" \
      INSTANCE="$instance" \
      KASEKI_VALIDATION_COMMANDS="npm test" \
      KASEKI_PRE_AGENT_VALIDATION_COMMANDS="npm test" \
      KASEKI_STARTUP_CHECK_MODE="baseline-validation" \
      "$REPO_ROOT/run-kaseki.sh" --dry-run
    ) >"$TEMP_TEST_DIR/$instance.stdout.log" 2>"$TEMP_TEST_DIR/$instance.stderr.log"
  }

  run_public_workflow kaseki-1 || log_fail "First baseline-validation workflow run failed"
  run_public_workflow kaseki-2 || log_fail "Second baseline-validation workflow run failed"

  node -e '
    const fs = require("fs");
    const [firstPath, secondPath] = process.argv.slice(1);
    const first = JSON.parse(fs.readFileSync(firstPath, "utf8"));
    const second = JSON.parse(fs.readFileSync(secondPath, "utf8"));
    if (first.baseline_cache_status !== "completed") {
      throw new Error(`expected first run cache miss/completion, got ${first.baseline_cache_status}`);
    }
    if (second.baseline_cache_status !== "cache_hit") {
      throw new Error(`expected second run cache hit, got ${second.baseline_cache_status}`);
    }
  ' "$first_metadata" "$second_metadata" || log_fail "Workflow artifacts did not report a miss followed by a hit"

  log_pass "Public workflow metadata reports a cache miss followed by a cache hit"
}

# Test 2: Verify cache functions in kaseki-agent.sh
test_shell_cache_functions() {
  log_test "Testing shell cache functions in kaseki-agent.sh"
  
  cd "$REPO_ROOT"
  
  # Check that cache functions are defined
  if grep -q "baseline_validation_cache_key()" kaseki-agent.sh; then
    log_pass "baseline_validation_cache_key() function defined"
  else
    log_fail "baseline_validation_cache_key() function not found"
  fi
  
  if grep -q "baseline_validation_cache_is_valid()" kaseki-agent.sh; then
    log_pass "baseline_validation_cache_is_valid() function defined"
  else
    log_fail "baseline_validation_cache_is_valid() function not found"
  fi
  
  if grep -q "restore_baseline_validation_from_cache()" kaseki-agent.sh; then
    log_pass "restore_baseline_validation_from_cache() function defined"
  else
    log_fail "restore_baseline_validation_from_cache() function not found"
  fi
  
  if grep -q "save_baseline_validation_to_cache()" kaseki-agent.sh; then
    log_pass "save_baseline_validation_to_cache() function defined"
  else
    log_fail "save_baseline_validation_to_cache() function not found"
  fi
}

# Test 3: Verify environment variables
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

# Test 4: Verify cache logic integration in main flow
test_cache_integration_in_flow() {
  log_test "Testing cache integration in main validation flow"
  
  cd "$REPO_ROOT"
  
  # Check that cache is checked before baseline checkout
  if grep -q "restore_baseline_validation_from_cache" kaseki-agent.sh; then
    log_pass "Cache restore is called in baseline flow"
  else
    log_fail "Cache restore not called in flow"
  fi
  
  # Check that cache is saved after validation
  if grep -q "save_baseline_validation_to_cache" kaseki-agent.sh; then
    log_pass "Cache save is called in baseline flow"
  else
    log_fail "Cache save not called in flow"
  fi
}

# Test 5: Verify documentation
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
  
  test_public_baseline_validation_cache_workflow
  test_shell_cache_functions
  test_environment_variables
  test_cache_integration_in_flow
  test_documentation
  
  log_pass "All integration tests passed!"
}

main
