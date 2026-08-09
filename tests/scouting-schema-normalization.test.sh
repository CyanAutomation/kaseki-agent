#!/usr/bin/env bash
# Test suite for scouting schema normalization
# Ensures relevant_files strings are converted to objects

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load the production normalization entry point without executing the agent.
eval "$(awk '/^normalize_scouting_schema\(\) \{/{copy=1} copy{print} copy && /^}$/{exit}' "$SCRIPT_DIR/../kaseki-agent.sh")"

assert_relevant_files() {
  local actual_file="$1"
  local expected_file="$2"

  jq -e '.relevant_files | all(
    type == "object" and
    (.path | type == "string") and
    (.reason | type == "string")
  )' "$actual_file" >/dev/null &&
    diff -u \
      <(jq -S '.relevant_files' "$expected_file") \
      <(jq -S '.relevant_files' "$actual_file")
}

test_normalize_relevant_files_strings_to_objects() {
  local results_dir
  results_dir=$(mktemp -d)
  
  # Create a scouting artifact with strings in relevant_files (Pi's output)
  cat > "$results_dir/scouting-candidate.json" <<'EOF'
{
  "task": "Refactor parser to handle edge cases",
  "requirements": ["Preserve API", "Improve performance"],
  "relevant_files": ["src/lib/parser.ts", "tests/parser.test.ts", "src/types.ts"],
  "observations": ["Uses regex patterns", "Has memory leaks"],
  "plan": ["Refactor tokenizer", "Add caching"],
  "validation": ["npm test", "npm run lint"],
  "risks": [],
  "test_impact": [],
  "critical_change_expectations": {}
}
EOF

  cat > "$results_dir/expected.json" <<'EOF'
{
  "relevant_files": [
    {"path": "src/lib/parser.ts", "reason": "scope: src/lib/parser.ts"},
    {"path": "tests/parser.test.ts", "reason": "scope: tests/parser.test.ts"},
    {"path": "src/types.ts", "reason": "scope: src/types.ts"}
  ]
}
EOF

  if ! KASEKI_RESULTS_DIR="$results_dir" normalize_scouting_schema "$results_dir/scouting-candidate.json" ||
    ! assert_relevant_files "$results_dir/scouting-candidate.json" "$results_dir/expected.json"; then
    rm -rf "$results_dir"
    return 1
  fi
  rm -rf "$results_dir"
}

test_normalization_output_schema() {
  local results_dir
  results_dir=$(mktemp -d)
  
  # Create broken schema with strings
  cat > "$results_dir/broken.json" <<'EOF'
{
  "task": "test",
  "requirements": [],
  "relevant_files": ["file1.ts", "file2.ts"],
  "observations": [],
  "plan": [],
  "validation": [],
  "risks": [],
  "test_impact": [],
  "critical_change_expectations": {}
}
EOF

  # Expected normalized output
  cat > "$results_dir/expected.json" <<'EOF'
{
  "task": "test",
  "requirements": [],
  "relevant_files": [
    {"path": "file1.ts", "reason": "scope: file1.ts"},
    {"path": "file2.ts", "reason": "scope: file2.ts"}
  ],
  "observations": [],
  "plan": [],
  "validation": [],
  "risks": [],
  "test_impact": [],
  "critical_change_expectations": {}
}
EOF

  if ! KASEKI_RESULTS_DIR="$results_dir" normalize_scouting_schema "$results_dir/broken.json" ||
    ! assert_relevant_files "$results_dir/broken.json" "$results_dir/expected.json"; then
    rm -rf "$results_dir"
    return 1
  fi
  rm -rf "$results_dir"
}

# Run tests
echo "=== Scouting Schema Normalization Tests ==="
echo ""

test_count=0
pass_count=0

for test_func in test_normalize_relevant_files_strings_to_objects test_normalization_output_schema; do
  test_count=$((test_count + 1))
  echo "Running: $test_func"
  if "$test_func"; then
    pass_count=$((pass_count + 1))
  fi
  echo ""
done

echo "Results: $pass_count/$test_count tests passed"
test "$pass_count" -eq "$test_count"
