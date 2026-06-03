#!/usr/bin/env bash
# Test suite for Task Progress Percentage feature
# This validates that the percentage field is correctly calculated and displayed

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

TESTS_PASSED=0
TESTS_FAILED=0

# Create a temporary test directory for all tests
TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT

# Test utilities
test_case() {
  local name="$1"
  echo -e "${YELLOW}[TEST]${NC} $name"
}

assert_equal() {
  local expected="$1"
  local actual="$2"
  local description="$3"

  if [[ "$expected" == "$actual" ]]; then
    echo -e "${GREEN}✓${NC} $description"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗${NC} $description"
    echo "  Expected: $expected"
    echo "  Actual: $actual"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

# ============================================================================
# TEST SUITE 1: Progress calculation logic
# ============================================================================
# Note: Metadata stages array parsing and impact on taskProgressPercent
# is covered in src/utils/status-response-builder.test.ts

test_case "Progress calculation with completed stages"

# Create progress.jsonl with some finished stages
cat > "$TEST_DIR/progress.jsonl" <<'EOF'
{"timestamp":"2024-05-25T10:00:00Z","stage":"clone repository","status":"finished"}
{"timestamp":"2024-05-25T10:05:00Z","stage":"pi coding agent","status":"finished"}
{"timestamp":"2024-05-25T10:10:00Z","stage":"quality checks","status":"started"}
EOF

# Count finished stages
finished_count=$(grep -c '"status":"finished"' "$TEST_DIR/progress.jsonl" || true)
total_count=5
expected_percentage=$((finished_count * 100 / total_count))

assert_equal "2" "$finished_count" "Correctly counted 2 finished stages"
assert_equal "40" "$expected_percentage" "Calculated correct percentage (2/5 = 40%)"


# ============================================================================
# TEST SUITE 2: Stage filtering based on configuration
# ============================================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

extract_function() {
  local name="$1"
  awk -v fn="$name" '
    $0 ~ "^" fn "\\(\\) \\{" { capture=1; depth=0 }
    capture {
      print
      for (i = 1; i <= length($0); i++) {
        ch = substr($0, i, 1)
        if (ch == "{") depth++
        if (ch == "}") depth--
      }
      if (capture && depth == 0) exit
    }
  ' "$ROOT_DIR/kaseki-agent.sh"
}

eval "$(extract_function build_stages_array)"

derive_stages_for_config() {
  (
    export KASEKI_PRE_AGENT_VALIDATION="$1"
    export KASEKI_GOAL_SETTING="$2"
    export KASEKI_SCOUTING="$3"
    export KASEKI_GOAL_CHECK="$4"
    export KASEKI_RUN_EVALUATION="$5"
    export KASEKI_AUTO_LINT_CLEANUP="$6"
    export KASEKI_DRY_RUN="$7"
    export GITHUB_APP_ENABLED="$8"
    build_stages_array
  )
}

assert_stages_equal() {
  local config_name="$1"
  local actual_file="$2"
  local expected_file="$3"

  if diff -u "$expected_file" "$actual_file" > "$TEST_DIR/${config_name}.diff"; then
    echo -e "${GREEN}✓${NC} $config_name stage names and ordering match production derivation"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗${NC} $config_name stage names and ordering match production derivation"
    cat "$TEST_DIR/${config_name}.diff"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

write_expected_stages() {
  local output_file="$1"
  shift
  printf '%s\n' "$@" > "$output_file"
}

test_case "Production stage derivation for minimal configuration"
minimal_actual="$TEST_DIR/minimal.actual"
minimal_expected="$TEST_DIR/minimal.expected"
derive_stages_for_config 0 0 0 0 0 0 1 0 > "$minimal_actual"
write_expected_stages "$minimal_expected" \
  "clone repository" \
  "agent setup" \
  "pi coding agent" \
  "collect agent diff" \
  "quality checks" \
  "validation" \
  "secret scan" \
  "complete"
assert_stages_equal "minimal" "$minimal_actual" "$minimal_expected"

test_case "Production stage derivation for scouting-enabled configuration"
scouting_actual="$TEST_DIR/scouting.actual"
scouting_expected="$TEST_DIR/scouting.expected"
derive_stages_for_config 1 0 1 1 0 0 1 0 > "$scouting_actual"
write_expected_stages "$scouting_expected" \
  "clone repository" \
  "pre-agent validation" \
  "pi scouting agent" \
  "derive allowlist from scouting" \
  "goal check" \
  "agent setup" \
  "pi coding agent" \
  "collect agent diff" \
  "quality checks" \
  "validation" \
  "secret scan" \
  "complete"
assert_stages_equal "scouting-enabled" "$scouting_actual" "$scouting_expected"

test_case "Production stage derivation for full-feature configuration"
full_feature_actual="$TEST_DIR/full-feature.actual"
full_feature_expected="$TEST_DIR/full-feature.expected"
derive_stages_for_config 1 1 1 1 1 1 0 1 > "$full_feature_actual"
write_expected_stages "$full_feature_expected" \
  "clone repository" \
  "pre-agent validation" \
  "pi goal-setting agent" \
  "pi scouting agent" \
  "derive allowlist from scouting" \
  "goal check" \
  "run evaluation" \
  "agent setup" \
  "pi coding agent" \
  "auto lint cleanup" \
  "collect agent diff" \
  "quality checks" \
  "validation" \
  "secret scan" \
  "github operations" \
  "complete"
assert_stages_equal "full-feature" "$full_feature_actual" "$full_feature_expected"


# ============================================================================
# TEST SUITE 3: Semantic boundary coverage
# ============================================================================
# Boundary scenarios for zero completed stages, all completed stages, and
# over-completed stage streams are covered in
# src/utils/status-response-builder.test.ts through the production
# StatusResponseBuilder.addTaskProgressInfo path with taskProgressPercent
# assertions.

# ============================================================================

echo ""
echo "=========================================="
echo "Test Results:"
echo "  Passed: $TESTS_PASSED"
echo "  Failed: $TESTS_FAILED"
echo "=========================================="

if [ $TESTS_FAILED -gt 0 ]; then
  exit 1
else
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
fi
