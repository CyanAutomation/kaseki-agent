#!/usr/bin/env bash
# Integration tests for strict validation mode
# Tests KASEKI_SKIP_MISSING_NPM_SCRIPTS behavior and error messaging

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Load validation helpers
eval "$(awk '
  /^npm_run_script_name\(\)/ { emit=1 }
  /^missing_npm_script_for_validation_command\(\)/ { emit=1; next }
  /^compute_repo_memory_key\(\)/ { emit=0 }
  emit { print }
' "$ROOT_DIR/kaseki-agent.sh")"

pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }

# Setup test environment
mkdir -p "$TMP_DIR/results"
cd "$TMP_DIR"
: > /results/validation.log 2>/dev/null || true
VALIDATION_TIMINGS_FILE="$TMP_DIR/results/validation-timings.tsv"
touch "$VALIDATION_TIMINGS_FILE"

# Test 1: Lenient mode (KASEKI_SKIP_MISSING_NPM_SCRIPTS=1) - default behavior
echo "==> Test: Lenient mode - missing script is skipped"
{
  cat > package.json <<'JSON'
{
  "scripts": {
    "test": "echo test"
  }
}
JSON
  
  KASEKI_SKIP_MISSING_NPM_SCRIPTS=1
  
  # Try to check for missing "build" script
  if missing_script="$(missing_npm_script_for_validation_command 'npm run build' 2>/dev/null || true)"; then
    if [ "$missing_script" = "build" ]; then
      pass "Lenient mode: correctly identifies missing 'build' script"
    else
      fail "Lenient mode: expected 'build' but got '$missing_script'"
    fi
  else
    fail "Lenient mode: function should return missing script name"
  fi
}

# Test 2: Strict mode (KASEKI_SKIP_MISSING_NPM_SCRIPTS=0) - fail on missing
echo "==> Test: Strict mode - missing script detection"
{
  KASEKI_SKIP_MISSING_NPM_SCRIPTS=0
  
  # In strict mode, missing scripts should still be detected
  # The kaseki-agent.sh logic will set VALIDATION_FAILURE_REASON
  if missing_script="$(missing_npm_script_for_validation_command 'npm run check' 2>/dev/null || true)"; then
    if [ "$missing_script" = "check" ]; then
      pass "Strict mode: detects missing 'check' script"
    else
      fail "Strict mode: expected 'check' but got '$missing_script'"
    fi
  else
    fail "Strict mode: should detect missing npm script"
  fi
}

# Test 3: Script name extraction
echo "==> Test: Script name extraction"
{
  test_cases=(
    "npm run build"
    "npm run test -- --watch"
    "npm run lint:fix"
    "npm run 'complex-name'"
  )
  
  expected=(
    "build"
    "test"
    "lint:fix"
    "complex-name"
  )
  
  for i in "${!test_cases[@]}"; do
    cmd="${test_cases[$i]}"
    exp="${expected[$i]}"
    result="$(npm_run_script_name "$cmd")"
    
    if [ "$result" = "$exp" ]; then
      pass "Script extraction: '$cmd' → '$result'"
    else
      fail "Script extraction: expected '$exp' from '$cmd', got '$result'"
    fi
  done
}

# Test 4: Validation timing recording
echo "==> Test: Validation timing recording"
{
  cat > package.json <<'JSON'
{
  "scripts": {
    "format": "prettier --check ."
  }
}
JSON
  
  KASEKI_SKIP_MISSING_NPM_SCRIPTS=1
  
  # Simulate recording a skipped validation command
  : > "$VALIDATION_TIMINGS_FILE"
  
  # When a script is missing, record it in timings
  if missing_script="$(missing_npm_script_for_validation_command 'npm run lint' 2>/dev/null || true)"; then
    printf 'npm run lint\t1\t0\tmissing_npm_script=%s\n' "$missing_script" >> "$VALIDATION_TIMINGS_FILE"
  fi
  
  if grep -q "missing_npm_script=lint" "$VALIDATION_TIMINGS_FILE"; then
    pass "Timing recording: correctly logs missing npm script"
  else
    fail "Timing recording: should log missing script in timings"
  fi
}

# Test 5: Combined validation commands
echo "==> Test: Mixed validation commands (some missing)"
{
  cat > package.json <<'JSON'
{
  "scripts": {
    "test": "jest",
    "lint": "eslint ."
  }
}
JSON
  
  KASEKI_SKIP_MISSING_NPM_SCRIPTS=1
  
  commands=("npm run lint" "npm run build" "npm run test")
  
  missing_count=0
  for cmd in "${commands[@]}"; do
    if missing_npm_script_for_validation_command "$cmd" 2>/dev/null >/dev/null; then
      ((missing_count++))
    fi
  done
  
  if [ "$missing_count" -eq 1 ]; then
    pass "Mixed commands: correctly identified 1 missing script out of 3"
  else
    fail "Mixed commands: expected 1 missing script, found $missing_count"
  fi
}

# Test 6: Custom validation commands with missing scripts
echo "==> Test: Custom validation command handling"
{
  cat > package.json <<'JSON'
{
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
JSON
  
  KASEKI_SKIP_MISSING_NPM_SCRIPTS=0
  
  # Custom repo might only have specific scripts
  # Should still detect when expected ones are missing
  missing_count=0
  
  for cmd in "npm run typecheck" "npm run format"; do
    if missing_npm_script_for_validation_command "$cmd" 2>/dev/null >/dev/null; then
      ((missing_count++))
    fi
  done
  
  if [ "$missing_count" -eq 1 ]; then
    pass "Custom validation: correctly handles mixed script availability"
  else
    fail "Custom validation: expected 1 missing, found $missing_count"
  fi
}

# Test 7: Empty validation commands
echo "==> Test: Empty and whitespace handling"
{
  # Empty string should not crash
  if [ -z "$(npm_run_script_name '' 2>/dev/null || true)" ]; then
    pass "Empty command: handles gracefully"
  else
    fail "Empty command: should return empty for empty input"
  fi
  
  # Whitespace-only should not crash
  if [ -z "$(npm_run_script_name '   ' 2>/dev/null || true)" ]; then
    pass "Whitespace command: handles gracefully"
  else
    fail "Whitespace command: should handle whitespace"
  fi
}

printf '\n✅ All validation strict-mode tests passed\n'
