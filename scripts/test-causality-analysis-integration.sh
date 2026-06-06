#!/bin/bash
# Integration test for validation failure causality analysis
# Tests all three signals: comparative results, log markers, code impact

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
TEMP_TEST_DIR=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

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

setup_test_env() {
  TEMP_TEST_DIR="$(mktemp -d)"
  log_test "Test environment setup at $TEMP_TEST_DIR"
}

# Test 1: Exercise the validation-failure causality path from kaseki-agent.sh
# with fixture validation logs and assert user-observable outputs.
test_validation_failure_path() {
  log_test "Testing validation failure causality path"

  cd "$REPO_ROOT"

  local results_dir="$TEMP_TEST_DIR/results"
  mkdir -p "$results_dir"

  cat > "$results_dir/validation-baseline.log" << 'EOF'
PASS  src/index.test.ts (1.234 s)
  ✓ should parse input
  ✓ should validate config
EOF

  cat > "$results_dir/validation.log" << 'EOF'
FAIL  src/index.test.ts (2.456 s)
  ✓ should parse input
  ✗ should validate config - Error: Expected true but got false
Error: Expected true but got false
    at validateConfig (src/index.ts:6:10)
EOF

  cat > "$results_dir/git.diff" << 'EOF'
diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -5,7 +5,7 @@ export function validateConfig(config: Config) {
-  return config.version !== undefined;
+function validateConfig(config: Config) {
+  return config.version === undefined;
 }
EOF

  cat > "$results_dir/changed-files.txt" << 'EOF'
src/index.ts
EOF

  local harness="$TEMP_TEST_DIR/run-causality-path.sh"
  {
    printf '#!/usr/bin/env bash\n'
    printf 'set -euo pipefail\n'
    printf 'cd %q\n' "$REPO_ROOT"
    printf 'export KASEKI_RESULTS_DIR=%q\n' "$results_dir"
    cat << 'EOF'
emit_progress() {
  printf '[progress] %s %s: %s\n' "$1" "${3:-info}" "$2" >> "$KASEKI_RESULTS_DIR/progress.log"
}
EOF
    sed -n '/^analyze_validation_failure_causality() {/,/^run_validation_commands() {/p' kaseki-agent.sh | sed '$d'
    printf '\nanalyze_validation_failure_causality\n'
  } > "$harness"
  chmod +x "$harness"

  if "$harness" > "$TEMP_TEST_DIR/causality-stdout.log" 2> "$TEMP_TEST_DIR/causality-stderr.log"; then
    log_pass "Causality path exits successfully after validation failure analysis"
  else
    cat "$TEMP_TEST_DIR/causality-stdout.log" >&2 || true
    cat "$TEMP_TEST_DIR/causality-stderr.log" >&2 || true
    log_fail "Causality path exited with failure"
  fi

  local artifact_file="$results_dir/validation-causality-analysis.json"
  if [ -f "$artifact_file" ]; then
    log_pass "Causality path produced validation-causality-analysis.json"
  else
    cat "$results_dir/progress.log" >&2 || true
    log_fail "Causality artifact was not produced"
  fi

  if command -v jq >/dev/null 2>&1; then
    jq . "$artifact_file" >/dev/null 2>&1 || log_fail "Causality artifact is invalid JSON"

    local failure_type
    failure_type=$(jq -r '.assessment.failureType' "$artifact_file")
    if [ "$failure_type" = "change_related" ]; then
      log_pass "Causality artifact classifies the fixture failure as change_related"
    else
      jq . "$artifact_file" >&2 || true
      log_fail "Unexpected causality failure classification: $failure_type"
    fi

    local regression_count
    regression_count=$(jq -r '.assessment.signals.comparativeResults.analysis.regressionCount' "$artifact_file")
    if [ "$regression_count" -ge 1 ]; then
      log_pass "Causality artifact records at least one new regression"
    else
      jq . "$artifact_file" >&2 || true
      log_fail "Causality artifact did not record the fixture regression"
    fi

    local changed_file_marker
    changed_file_marker=$(jq -r '[.assessment.signals.logMarkers.markers[]? | select(.type == "changed_file" and .found == true)] | length' "$artifact_file")
    if [ "$changed_file_marker" -ge 1 ]; then
      log_pass "Causality artifact records a changed-file marker from the failure log"
    else
      jq . "$artifact_file" >&2 || true
      log_fail "Causality artifact did not record a changed-file marker"
    fi
  else
    log_pass "Causality artifact exists (jq not available for field checks)"
  fi
}

# Test 2: Unit tests pass
test_unit_tests() {
  log_test "Running causality analysis unit tests"
  
  cd "$REPO_ROOT"
  
  if npm test -- src/lib/validation-causality-analysis.test.ts 2>&1 | grep -q "Tests.*passed"; then
    log_pass "All causality analysis unit tests pass"
  else
    log_fail "Unit tests failed"
  fi
}

main() {
  log_test "Validation failure causality analysis integration tests"
  setup_test_env
  
  test_validation_failure_path
  test_unit_tests
  
  log_pass "All causality analysis integration tests passed!"
}

main
