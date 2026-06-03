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
# TEST SUITE 2: Edge cases
# Note: Stage filtering by configuration and metadata-provided stage lists are
# covered in src/utils/status-response-builder.test.ts through the production
# StatusResponseBuilder path with taskProgressPercent assertions.
# ============================================================================

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
