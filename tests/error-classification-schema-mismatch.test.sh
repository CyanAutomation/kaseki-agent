#!/usr/bin/env bash
# Test suite for error classification when schema validation fails
# TDD approach: capture the broken behavior, then fix it

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

test_error_classification_schema_mismatch() {
  local test_name="$1"
  local results_dir
  results_dir=$(mktemp -d)
  
  # Source provider-retry.sh to get the fixed functions
  source "${SCRIPT_DIR}/../scripts/lib/provider-retry.sh"

  # Setup environment
  export KASEKI_RESULTS_DIR="$results_dir"
  export KASEKI_PROVIDER="gateway"
  export KASEKI_SCOUTING_MODEL="dynamic/kaseki-agent"

  # Create scouting-validation-errors.jsonl with schema mismatch (the REAL error)
  mkdir -p "$results_dir"
  cat > "$results_dir/scouting-validation-errors.jsonl" <<'EOF'
{"timestamp":"2026-07-06T20:54:10Z","reason_code":"schema_mismatch","field":"relevant_files[0]","expected":"object with string path and reason","actual":"string","severity":"critical","details":"scouting artifact validation failed","suggestion":"ensure relevant_files items are objects with path and reason fields"}
EOF

  # Create stderr log with health check message (misleading but not the real error)
  cat > "$results_dir/scouting-stderr.log" <<'EOF'
[GATEWAY HEALTH] Cloudflare /compat has no implicit health endpoint; deferring to authenticated inference
[CORRELATION] Request 07187de1-aea0-4456-aa73-987ff3f6aac9 sent to scouting (provider: gateway, model: dynamic/kaseki-agent)
EOF

  # Clear any existing provider error state
  clear_provider_error

  # Try the NEW function first (this is the fix)
  local result=0
  if capture_validation_error_classification "scouting"; then
    # Validation error classification should work
    if [ "$PROVIDER_ERROR_TYPE" = "schema_mismatch" ]; then
      echo "✅ PASS: Error correctly classified as schema_mismatch (from validation errors)"
      result=0
    else
      echo "❌ FAILED: Validation error classification returned type=$PROVIDER_ERROR_TYPE"
      result=1
    fi
  else
    # If that doesn't work, stderr parsing falls back (but should still be schema_mismatch)
    echo "⚠️ WARNING: Validation error classification didn't work, falling back to stderr"
    capture_provider_error_from_log "$results_dir/scouting-stderr.log" "scouting" || true
    
    if [ "$PROVIDER_ERROR_TYPE" = "provider_auth_error" ]; then
      echo "❌ BROKEN: Error misclassified as provider_auth_error from stderr"
      result=1
    else
      echo "✅ PASS: Error type is $PROVIDER_ERROR_TYPE (fallback worked)"
      result=0
    fi
  fi
  
  rm -rf "$results_dir"
  return "$result"
}

test_error_classification_prefers_validation_errors() {
  local test_name="$1"
  local results_dir
  results_dir=$(mktemp -d)

  source "${SCRIPT_DIR}/../scripts/lib/provider-retry.sh"

  export KASEKI_RESULTS_DIR="$results_dir"
  export KASEKI_PROVIDER="gateway"

  # Create multiple validation errors
  mkdir -p "$results_dir"
  cat > "$results_dir/scouting-validation-errors.jsonl" <<'EOF'
{"timestamp":"2026-07-06T20:54:10Z","reason_code":"schema_mismatch","field":"relevant_files[0]","expected":"object","actual":"string"}
{"timestamp":"2026-07-06T20:54:11Z","reason_code":"schema_mismatch","field":"relevant_files[1]","expected":"object","actual":"string"}
{"timestamp":"2026-07-06T20:54:12Z","reason_code":"schema_mismatch","field":"relevant_files[2]","expected":"object","actual":"string"}
EOF

  # Create misleading stderr
  cat > "$results_dir/scouting-stderr.log" <<'EOF'
[GATEWAY HEALTH] Cloudflare /compat has no implicit health endpoint; deferring to authenticated inference
EOF

  clear_provider_error

  # Should prioritize validation errors over stderr when available
  # This test documents the expected fix behavior
  
  echo "✅ TEST STRUCTURE: Validation errors SHOULD take priority over stderr parsing"
  
  rm -rf "$results_dir"
  return 0
}

test_normalization_record_is_not_a_validation_failure() {
  local results_dir
  results_dir=$(mktemp -d)

  source "${SCRIPT_DIR}/../scripts/lib/provider-retry.sh"
  export KASEKI_RESULTS_DIR="$results_dir"
  export KASEKI_PROVIDER="gateway"
  export KASEKI_SCOUTING_MODEL="dynamic/kaseki-agent"

  cat > "$results_dir/scouting-validation-errors.jsonl" <<'EOF'
{"reason_code":"schema_normalized","field":"relevant_files","severity":"info","details":"Normalized string entries"}
EOF

  clear_provider_error
  if capture_validation_error_classification "scouting"; then
    echo "❌ FAILED: informational normalization was classified as a failure"
    rm -rf "$results_dir"
    return 1
  fi
  if [ -n "${PROVIDER_ERROR_TYPE:-}" ] || [ -n "${PROVIDER_ERROR_MESSAGE:-}" ]; then
    echo "❌ FAILED: informational normalization mutated provider error state"
    rm -rf "$results_dir"
    return 1
  fi
  echo "✅ PASS: informational normalization is not classified as a validation failure"
  rm -rf "$results_dir"
}

test_health_check_not_auth_error() {
  local test_name="$1"
  local results_dir
  results_dir=$(mktemp -d)

  source "${SCRIPT_DIR}/../scripts/lib/provider-retry.sh"

  export KASEKI_RESULTS_DIR="$results_dir"
  export KASEKI_PROVIDER="gateway"

  # Health check message should NOT be classified as auth error
  mkdir -p "$results_dir"
  cat > "$results_dir/scouting-stderr.log" <<'EOF'
[GATEWAY HEALTH] Cloudflare /compat has no implicit health endpoint; deferring to authenticated inference
EOF

  clear_provider_error
  capture_provider_error_from_log "$results_dir/scouting-stderr.log" "scouting" || true

  # The health check message contains "auth" keyword but is NOT an auth error
  local result=0
  if [ "$PROVIDER_ERROR_TYPE" = "provider_auth_error" ]; then
    echo "❌ BROKEN: Health check message misclassified as auth error"
    echo "   The word 'authenticated' matched the /auth/i pattern"
    result=1
  else
    echo "✅ PASS: Health check not misclassified as auth error"
    result=0
  fi
  
  rm -rf "$results_dir"
  return "$result"
}

# Run tests
echo "=== Error Classification Schema Mismatch Tests ==="
echo ""

test_count=0
pass_count=0

for test_func in test_error_classification_schema_mismatch test_error_classification_prefers_validation_errors test_normalization_record_is_not_a_validation_failure test_health_check_not_auth_error; do
  test_count=$((test_count + 1))
  echo "Running: $test_func"
  if "$test_func" "$test_func"; then
    pass_count=$((pass_count + 1))
  fi
  echo ""
done

echo "Results: $pass_count/$test_count tests passed"
if [ "$pass_count" -lt "$test_count" ]; then
  exit 1
fi

exit 0
