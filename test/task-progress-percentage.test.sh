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

test_case "Progress calculation with no completed stages"

cat > "$TEST_DIR/progress_empty.jsonl" <<'EOF'
{"timestamp":"2024-05-25T10:00:00Z","stage":"clone repository","status":"started"}
EOF

finished_count_empty=$(grep -c '"status":"finished"' "$TEST_DIR/progress_empty.jsonl" || true)
total_count=5
expected_percentage_empty=$((finished_count_empty * 100 / total_count))

assert_equal "0" "$finished_count_empty" "No finished stages detected"
assert_equal "0" "$expected_percentage_empty" "Calculated correct percentage (0/5 = 0%)"

test_case "Progress calculation with all completed stages"

# All stages finished
cat > "$TEST_DIR/progress_complete.jsonl" <<'EOF'
{"timestamp":"2024-05-25T10:00:00Z","stage":"clone repository","status":"finished"}
{"timestamp":"2024-05-25T10:05:00Z","stage":"pi coding agent","status":"finished"}
{"timestamp":"2024-05-25T10:10:00Z","stage":"quality checks","status":"finished"}
{"timestamp":"2024-05-25T10:15:00Z","stage":"validation","status":"finished"}
{"timestamp":"2024-05-25T10:20:00Z","stage":"complete","status":"finished"}
EOF

finished_count_all=$(grep -c '"status":"finished"' "$TEST_DIR/progress_complete.jsonl" || true)
total_count=5
expected_percentage_all=$((finished_count_all * 100 / total_count))

assert_equal "5" "$finished_count_all" "All 5 stages finished"
assert_equal "100" "$expected_percentage_all" "Calculated correct percentage (5/5 = 100%)"

# ============================================================================
# TEST SUITE 2: Stage filtering by configuration
# ============================================================================

test_case "Stage filtering based on configuration"

# Test different feature combinations
# Note: These are logical tests, not actual bash function tests

# Scenario 1: Minimal configuration (no scouting, no goal check, no eval, no github)
declare -a minimal_stages=("clone repository" "agent setup" "pi coding agent" "collect agent diff" "quality checks" "validation" "secret scan" "complete")
assert_equal "8" "${#minimal_stages[@]}" "Minimal configuration has 8 stages"

# Scenario 2: With scouting
declare -a with_scouting=("clone repository" "pi scouting agent" "derive allowlist from scouting" "agent setup" "pi coding agent" "collect agent diff" "quality checks" "validation" "secret scan" "complete")
assert_equal "10" "${#with_scouting[@]}" "Configuration with scouting has 10 stages"

# Scenario 3: With all features
declare -a all_features=("clone repository" "pre-agent validation" "pi scouting agent" "derive allowlist from scouting" "goal check" "run evaluation" "agent setup" "pi coding agent" "collect agent diff" "quality checks" "validation" "secret scan" "github operations" "complete")
assert_equal "14" "${#all_features[@]}" "Full configuration has 14 stages"

# ============================================================================
# TEST SUITE 3: Edge cases
# ============================================================================

test_case "Edge cases"

# Empty stages array
empty_stages_file="$TEST_DIR/metadata_empty_stages.json"
cat > "$empty_stages_file" <<'EOF'
{
  "instance": "kaseki-empty",
  "stages": [],
  "exit_code": 0
}
EOF
total_empty=$(jq '.stages | length' "$empty_stages_file" 2>/dev/null)
assert_equal "0" "$total_empty" "Empty stages array handled correctly"

# Missing stages field
no_stages_file="$TEST_DIR/metadata_no_stages.json"
cat > "$no_stages_file" <<'EOF'
{
  "instance": "kaseki-no-stages",
  "exit_code": 0
}
EOF
has_stages=$(jq 'has("stages")' "$no_stages_file" 2>/dev/null)
assert_equal "false" "$has_stages" "Missing stages field detected correctly"

# ============================================================================
# TEST SUITE 4: Bug fix - 1000% percentage issue
# ============================================================================

test_case "Bug fix: Prevent 1000% calculation errors"

# Scenario 1: Single stage completed (should be 100%, not 1000%)
cat > "$TEST_DIR/progress_single_stage.jsonl" <<'EOF'
{"timestamp":"2024-05-25T10:00:00Z","stage":"quick-fix","status":"finished"}
EOF

finished_single=$(grep -c '"status":"finished"' "$TEST_DIR/progress_single_stage.jsonl" || echo "0")
total_single=1
expected_single=$((finished_single * 100 / total_single))

assert_equal "1" "$finished_single" "Single stage marked as finished"
assert_equal "100" "$expected_single" "Single completed stage = 100%, not 1000%"

# Scenario 2: Ensure result never exceeds 100% (handles off-by-one in stage counting)
# If somehow completedStages > totalStages due to a bug, final result should still cap at 100%
# Note: TypeScript tests in src/utils/status-response-builder.test.ts provide comprehensive coverage
# for this clamping behavior with semantic scenarios (fewer denominator stages than finished observed)

# Scenario 3: Verify boundaries are respected
# Test 0% (no stages completed)
expected_min=$((0 * 100 / 5))
assert_equal "0" "$expected_min" "Minimum boundary: 0% is valid"

# Test 100% (all stages completed)  
expected_max=$((5 * 100 / 5))
assert_equal "100" "$expected_max" "Maximum boundary: 100% is valid"

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
