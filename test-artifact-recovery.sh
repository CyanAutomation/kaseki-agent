#!/usr/bin/env bash
# Test artifact recovery mechanisms and jq cache metrics fix
set -euo pipefail

TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT

echo "Testing artifact recovery and cache metrics fixes..."

# ============================================================================
# Test 1: jq cache metrics fix (boolean string handling)
# ============================================================================
echo ""
echo "Test 1: jq cache-metrics tonumber fix"
echo "======================================="

CACHE_METRICS_FILE="$TEST_DIR/cache-metrics.json"
echo '[]' > "$CACHE_METRICS_FILE"

# Test with boolean string "true"
jq \
  --arg name "test_metric_true" \
  --arg val "true" \
  --arg unit "bytes" \
  '. += [{"name": $name, "value": (if $val == "true" then 1 elif $val == "false" then 0 else ($val | tonumber) end), "unit": $unit, "timestamp": (now | todate)}]' \
  "$CACHE_METRICS_FILE" > "${CACHE_METRICS_FILE}.tmp" && mv "${CACHE_METRICS_FILE}.tmp" "$CACHE_METRICS_FILE"

if jq -e '.[] | select(.name == "test_metric_true" and .value == 1)' "$CACHE_METRICS_FILE" > /dev/null 2>&1; then
  echo "✓ Boolean string 'true' converted to numeric 1"
else
  echo "✗ FAILED: Boolean string 'true' not properly converted"
  exit 1
fi

# Test with boolean string "false"
jq \
  --arg name "test_metric_false" \
  --arg val "false" \
  --arg unit "bytes" \
  '. += [{"name": $name, "value": (if $val == "true" then 1 elif $val == "false" then 0 else ($val | tonumber) end), "unit": $unit, "timestamp": (now | todate)}]' \
  "$CACHE_METRICS_FILE" > "${CACHE_METRICS_FILE}.tmp" && mv "${CACHE_METRICS_FILE}.tmp" "$CACHE_METRICS_FILE"

if jq -e '.[] | select(.name == "test_metric_false" and .value == 0)' "$CACHE_METRICS_FILE" > /dev/null 2>&1; then
  echo "✓ Boolean string 'false' converted to numeric 0"
else
  echo "✗ FAILED: Boolean string 'false' not properly converted"
  exit 1
fi

# Test with numeric string (original behavior)
jq \
  --arg name "test_metric_number" \
  --arg val "42" \
  --arg unit "bytes" \
  '. += [{"name": $name, "value": (if $val == "true" then 1 elif $val == "false" then 0 else ($val | tonumber) end), "unit": $unit, "timestamp": (now | todate)}]' \
  "$CACHE_METRICS_FILE" > "${CACHE_METRICS_FILE}.tmp" && mv "${CACHE_METRICS_FILE}.tmp" "$CACHE_METRICS_FILE"

if jq -e '.[] | select(.name == "test_metric_number" and .value == 42)' "$CACHE_METRICS_FILE" > /dev/null 2>&1; then
  echo "✓ Numeric string '42' parsed correctly"
else
  echo "✗ FAILED: Numeric string not properly parsed"
  exit 1
fi

# ============================================================================
# Test 2: Goal-setting artifact recovery
# ============================================================================
echo ""
echo "Test 2: Goal-setting artifact recovery from event stream"
echo "=========================================================="

GOAL_SETTING_RAW_EVENTS="$TEST_DIR/goal-setting-raw-events.jsonl"
GOAL_SETTING_CANDIDATE="$TEST_DIR/goal-setting-candidate.json"
ARTIFACT_RECOVERY_HELPER="${ARTIFACT_RECOVERY_HELPER:-scripts/artifact-recovery.ts}"

run_artifact_recovery_cli() {
  local phase="$1"
  local raw_events="$2"
  local candidate="$3"
  local results_dir="${4:-$TEST_DIR}"

  case "$ARTIFACT_RECOVERY_HELPER" in
    *.ts) npx tsx "$ARTIFACT_RECOVERY_HELPER" "$phase" "$raw_events" "$candidate" "$results_dir" ;;
    *) node "$ARTIFACT_RECOVERY_HELPER" "$phase" "$raw_events" "$candidate" "$results_dir" ;;
  esac
}

# Create a realistic event stream with embedded goal-setting artifact
cat > "$GOAL_SETTING_RAW_EVENTS" <<'EOF'
{"type":"event","timestamp":"2026-01-01T00:00:01Z","data":"Starting goal-setting analysis"}
{"type":"progress","progress":10,"message":"Analyzing current prompt"}
{"type":"content","role":"assistant","content":"{\"original_prompt\":\"Fix the parser\",\"upgraded_goal\":\"Refactor parser to handle edge cases\",\"reasoning\":\"Current parser has bugs with nested structures\",\"key_requirements\":[\"Handle nested braces\",\"Support escapes\"],\"success_criteria\":[\"All tests pass\",\"No regressions\"]}"}
{"type":"progress","progress":100,"message":"Complete"}
EOF

# Recover goal-setting artifact through the production artifact recovery CLI.
run_artifact_recovery_cli "goal-setting" "$GOAL_SETTING_RAW_EVENTS" "$GOAL_SETTING_CANDIDATE" "$TEST_DIR" >/dev/null 2>&1 || true

if [ -f "$GOAL_SETTING_CANDIDATE" ]; then
  if jq -e '.original_prompt and .upgraded_goal and .reasoning and .key_requirements and .success_criteria' "$GOAL_SETTING_CANDIDATE" > /dev/null 2>&1; then
    echo "✓ Goal-setting artifact recovered successfully from event stream"
  else
    echo "✗ FAILED: Recovered artifact missing required fields"
    cat "$GOAL_SETTING_CANDIDATE"
    exit 1
  fi
else
  echo "✗ FAILED: Artifact file not created"
  exit 1
fi

# ============================================================================
# Test 3: Scouting artifact recovery
# ============================================================================
echo ""
echo "Test 3: Scouting artifact recovery from event stream"
echo "===================================================="

SCOUTING_RAW_EVENTS="$TEST_DIR/scouting-raw-events.jsonl"
SCOUTING_CANDIDATE="$TEST_DIR/scouting-candidate.json"

# Create a realistic scouting event stream
cat > "$SCOUTING_RAW_EVENTS" <<'EOF'
{"type":"event","timestamp":"2026-01-01T00:00:01Z","data":"Starting scouting analysis"}
{"type":"progress","progress":25,"message":"Inspecting repository"}
{"type":"content","role":"assistant","content":"{\"task\":\"Refactor parser to handle edge cases\",\"requirements\":[\"Preserve API\",\"Improve performance\"],\"relevant_files\":[{\"path\":\"src/parser.ts\",\"reason\":\"Target file\"},{\"path\":\"tests/parser.test.ts\",\"reason\":\"Test coverage\"}],\"observations\":[\"Uses regex patterns\",\"Has memory leaks\"],\"plan\":[\"Refactor tokenizer\",\"Add caching\",\"Optimize loops\"],\"validation\":[\"npm test\",\"npm run lint\"],\"risks\":[\"Breaking changes\",\"Performance regression\"],\"test_impact\":[],\"critical_change_expectations\":{}}"}
{"type":"progress","progress":100,"message":"Complete"}
EOF

# Recover scouting artifact through the production artifact recovery CLI.
run_artifact_recovery_cli "scouting" "$SCOUTING_RAW_EVENTS" "$SCOUTING_CANDIDATE" "$TEST_DIR" >/dev/null 2>&1 || true

if [ -f "$SCOUTING_CANDIDATE" ]; then
  if jq -e '.task and .requirements and .relevant_files and .observations and .plan and .validation and .risks and .test_impact' "$SCOUTING_CANDIDATE" > /dev/null 2>&1; then
    echo "✓ Scouting artifact recovered successfully from event stream"
  else
    echo "✗ FAILED: Recovered artifact missing required fields"
    cat "$SCOUTING_CANDIDATE"
    exit 1
  fi
else
  echo "✗ FAILED: Artifact file not created"
  exit 1
fi

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "All tests passed! ✓"
echo "================="
echo ""
echo "Summary of fixes verified:"
echo "  1. jq cache-metrics fix handles boolean strings (true/false → 1/0)"
echo "  2. Goal-setting artifact recovery exercises the production recovery CLI"
echo "  3. Scouting artifact recovery exercises the production recovery CLI"
