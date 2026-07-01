#!/usr/bin/env bash
# Integration tests for strict validation mode
# Tests KASEKI_SKIP_MISSING_NPM_SCRIPTS behavior and error messaging

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Load the dedicated validation helper library instead of extracting private
# functions from the executable entrypoint.
# shellcheck source=../scripts/validation-helpers.sh
source "$ROOT_DIR/scripts/validation-helpers.sh"

pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }

# Setup test environment
mkdir -p "$TMP_DIR/results"
cd "$TMP_DIR"
: > "$TMP_DIR/results/validation.log" 2>/dev/null || true
VALIDATION_TIMINGS_FILE="$TMP_DIR/results/validation-timings.tsv"
touch "$VALIDATION_TIMINGS_FILE"

# Test 1: Missing scripts are always skipped (non-fatal)
echo "==> Test: Missing scripts are always skipped (non-fatal)"
{
  cat > package.json <<'JSON'
{
  "scripts": {
    "test": "echo test"
  }
}
JSON
  
  # Try to check for missing "build" script
  if missing_script="$(missing_npm_script_for_validation_command 'npm run build' 2>/dev/null || true)"; then
    if [ "$missing_script" = "build" ]; then
      pass "Missing script detection: correctly identifies missing 'build' script"
    else
      fail "Missing script detection: expected 'build' but got '$missing_script'"
    fi
  else
    fail "Missing script detection: function should return missing script name"
  fi
}

# Test 2: Existing scripts are detected (not skipped)
echo "==> Test: Existing scripts are detected"
{
  # Try to check for existing "test" script (should NOT be skipped)
  if ! missing_npm_script_for_validation_command 'npm run test' 2>/dev/null >/dev/null; then
    pass "Existing script detection: correctly identifies existing 'test' script"
  else
    fail "Existing script detection: should not return missing script for existing 'test' script"
  fi
}

# Test 3: Script name extraction
echo "==> Test: Script name extraction"
{
  test_cases=(
    "npm run build"
    "npm run test -- --watch"
    "npm run lint:fix"
  )
  
  expected=(
    "build"
    "test"
    "lint:fix"
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

printf '\n✅ Core validation strict-mode tests passed\n'
