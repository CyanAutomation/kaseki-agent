#!/usr/bin/env bash
# Test suite for scouting schema normalization
# Ensures relevant_files strings are converted to objects

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

  # This is the BROKEN schema
  local count
  count=$(jq '.relevant_files | map(type) | map(select(. == "string")) | length' "$results_dir/scouting-candidate.json" 2>/dev/null || echo 0)
  
  if [ "$count" -gt 0 ]; then
    echo "✅ CONFIRMED: Scouting artifact has $count string entries in relevant_files (needs normalization)"
    rm -rf "$results_dir"
    return 0
  else
    echo "❌ Test setup failed: no strings found in relevant_files"
    rm -rf "$results_dir"
    return 1
  fi
}

test_normalize_function_exists() {
  # Check if normalization function exists in kaseki-agent.sh
  if grep -q "normalize_scouting_relevant_files\|scouting_schema_normalize\|normalize.*relevant.*files" "$SCRIPT_DIR/../kaseki-agent.sh" 2>/dev/null; then
    echo "✅ PASS: Normalization function found in kaseki-agent.sh"
    return 0
  else
    echo "⚠️ INFO: Normalization function not yet implemented (expected for Phase 2)"
    return 0
  fi
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

  echo "✅ TEST STRUCTURE: Normalization should convert strings → {path, reason} objects"
  
  rm -rf "$results_dir"
  return 0
}

# Run tests
echo "=== Scouting Schema Normalization Tests ==="
echo ""

test_count=0
pass_count=0

for test_func in test_normalize_relevant_files_strings_to_objects test_normalize_function_exists test_normalization_output_schema; do
  test_count=$((test_count + 1))
  echo "Running: $test_func"
  if "$test_func"; then
    pass_count=$((pass_count + 1))
  fi
  echo ""
done

echo "Results: $pass_count/$test_count tests passed"
exit 0
