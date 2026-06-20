#!/bin/bash
# Integration tests for goal-setting fallback logic
# Tests the kaseki-agent.sh fallback mechanism when goal-setting fails

set -euo pipefail

# Utility functions
test_count=0
pass_count=0
fail_count=0

run_test() {
  local test_name="$1"
  local test_fn="$2"
  test_count=$((test_count + 1))
  
  if $test_fn; then
    echo "✓ Test $test_count: $test_name"
    pass_count=$((pass_count + 1))
    return 0
  else
    echo "✗ Test $test_count: $test_name"
    fail_count=$((fail_count + 1))
    return 1
  fi
}

assert_contains() {
  local file="$1"
  local pattern="$2"
  if grep -q "$pattern" "$file"; then
    return 0
  else
    echo "  Expected '$pattern' in $file but not found"
    echo "  File content:"
    head -20 "$file" | sed 's/^/    /'
    return 1
  fi
}

assert_not_contains() {
  local file="$1"
  local pattern="$2"
  if ! grep -q "$pattern" "$file"; then
    return 0
  else
    echo "  Unexpectedly found '$pattern' in $file"
    return 1
  fi
}

assert_json_valid() {
  local file="$1"
  if jq . < "$file" > /dev/null 2>&1; then
    return 0
  else
    echo "  JSON in $file is invalid"
    cat "$file" | head -20 | sed 's/^/    /'
    return 1
  fi
}

assert_json_has_field() {
  local file="$1"
  local field="$2"
  local value="$3"
  local actual=$(jq -r ".$field" < "$file" 2>/dev/null || echo "")
  if [ "$actual" = "$value" ]; then
    return 0
  else
    echo "  Expected $field=$value but got $actual"
    return 1
  fi
}

# Setup
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Test 1: Fallback artifact is valid JSON
test_fallback_produces_valid_json() {
  local task_prompt="Fix null-safety in parseRole()"
  
  # Create fallback using Node.js with compiled module
  node -e "
    const utils = require('./dist/lib/goal-setting-utils.js');
    const artifact = utils.createFallbackGoalSettingArtifact('$task_prompt');
    console.log(JSON.stringify(artifact, null, 2));
  " > "$TEMP_DIR/fallback.json"
  
  assert_json_valid "$TEMP_DIR/fallback.json"
}

# Test 2: Fallback has confidence=low
test_fallback_has_low_confidence() {
  node -e "
    const utils = require('./dist/lib/goal-setting-utils.js');
    const artifact = utils.createFallbackGoalSettingArtifact('test task');
    console.log(JSON.stringify(artifact, null, 2));
  " > "$TEMP_DIR/fallback.json"
  
  assert_json_has_field "$TEMP_DIR/fallback.json" "confidence" "low"
}

# Test 3: Fallback contains no placeholder text
test_fallback_has_no_placeholders() {
  node -e "
    const utils = require('./dist/lib/goal-setting-utils.js');
    const artifact = utils.createFallbackGoalSettingArtifact('test task');
    console.log(JSON.stringify(artifact, null, 2));
  " > "$TEMP_DIR/fallback.json"
  
  assert_not_contains "$TEMP_DIR/fallback.json" "the original user prompt"
  assert_not_contains "$TEMP_DIR/fallback.json" "concise goal (1-3 sentences)"
  assert_not_contains "$TEMP_DIR/fallback.json" "specific, measurable criterion"
}

# Test 4: Fallback includes task prompt in reasoning
test_fallback_reasoning_mentions_fallback() {
  node -e "
    const utils = require('./dist/lib/goal-setting-utils.js');
    const artifact = utils.createFallbackGoalSettingArtifact('test task');
    console.log(JSON.stringify(artifact, null, 2));
  " > "$TEMP_DIR/fallback.json"
  
  assert_contains "$TEMP_DIR/fallback.json" "Fallback goal-setting"
}

# Test 5: Placeholder detection works correctly
test_placeholder_detection() {
  local artifact_with_placeholders='{
    "original_prompt": "the original user prompt",
    "upgraded_goal": "concise goal (1-3 sentences), actionable for a coding agent",
    "reasoning": "test",
    "key_requirements": [],
    "success_criteria": [],
    "confidence": "high"
  }'
  
  node -e "
    const utils = require('./dist/lib/goal-setting-utils.js');
    const artifact = $artifact_with_placeholders;
    const has = utils.hasPlaceholders(artifact);
    process.exit(has ? 0 : 1);
  "
}

# Test 6: Valid artifact passes validation
test_valid_artifact_passes_validation() {
  node -e "
    const utils = require('./dist/lib/goal-setting-utils.js');
    const artifact = utils.createFallbackGoalSettingArtifact('test task');
    const valid = utils.isValidGoalSettingArtifact(artifact);
    process.exit(valid ? 0 : 1);
  "
}

# Test 7: Artifact with placeholders fails validation
test_artifact_with_placeholders_fails_validation() {
  local artifact_with_placeholders='{
    "original_prompt": "the original user prompt",
    "upgraded_goal": "real goal",
    "reasoning": "real",
    "key_requirements": [],
    "success_criteria": [],
    "confidence": "high"
  }'
  
  node -e "
    const utils = require('./dist/lib/goal-setting-utils.js');
    const artifact = $artifact_with_placeholders;
    const valid = utils.isValidGoalSettingArtifact(artifact);
    process.exit(valid ? 1 : 0);  // Expect false (exit 0 = success)
  "
}

# Test 8: Fallback has required fields
test_fallback_has_all_required_fields() {
  node -e "
    const utils = require('./dist/lib/goal-setting-utils.js');
    const artifact = utils.createFallbackGoalSettingArtifact('test task');
    const required = [
      'original_prompt',
      'upgraded_goal',
      'key_requirements',
      'success_criteria',
      'reasoning',
      'confidence'
    ];
    for (const field of required) {
      if (!(field in artifact)) {
        console.error('Missing field: ' + field);
        process.exit(1);
      }
    }
  "
}

# Test 9: Placeholder summary function works
test_placeholder_summary() {
  node -e "
    const utils = require('./dist/lib/goal-setting-utils.js');
    const artifact = {
      original_prompt: 'the original user prompt',
      upgraded_goal: 'real',
      reasoning: 'real',
      key_requirements: [],
      success_criteria: [],
      confidence: 'high'
    };
    const summary = utils.getPlaceholderSummary(artifact);
    if (summary.includes('original_prompt')) {
      process.exit(0);
    } else {
      console.error('Summary missing original_prompt: ' + summary);
      process.exit(1);
    }
  "
}

# Test 10: Multiple placeholders detected
test_multiple_placeholders_detected() {
  node -e "
    const utils = require('./dist/lib/goal-setting-utils.js');
    const artifact = {
      original_prompt: 'the original user prompt',
      upgraded_goal: 'concise goal (1-3 sentences), actionable for a coding agent',
      constraints: {
        operational: ['e.g., max 3 files changed'],
        technical: ['e.g., must pass type checking']
      },
      reasoning: 'real',
      key_requirements: [],
      success_criteria: [],
      confidence: 'high'
    };
    const found = utils.detectPlaceholders(artifact);
    if (found.length >= 3) {
      process.exit(0);
    } else {
      console.error('Expected >=3 placeholders, got ' + found.length);
      process.exit(1);
    }
  "
}

echo "Running goal-setting integration tests..."
echo

run_test "Fallback produces valid JSON" test_fallback_produces_valid_json
run_test "Fallback has confidence=low" test_fallback_has_low_confidence
run_test "Fallback has no placeholders" test_fallback_has_no_placeholders
run_test "Fallback reasoning mentions fallback" test_fallback_reasoning_mentions_fallback
run_test "Placeholder detection works" test_placeholder_detection
run_test "Valid artifact passes validation" test_valid_artifact_passes_validation
run_test "Artifact with placeholders fails validation" test_artifact_with_placeholders_fails_validation
run_test "Fallback has all required fields" test_fallback_has_all_required_fields
run_test "Placeholder summary function works" test_placeholder_summary
run_test "Multiple placeholders detected" test_multiple_placeholders_detected

echo
echo "Results: $pass_count passed, $fail_count failed out of $test_count total"

if [ $fail_count -eq 0 ]; then
  exit 0
else
  exit 1
fi
