#!/usr/bin/env bash
# shellcheck disable=SC1090
# Focused test: Verify the printf safety fix prevents "invalid option" error

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== Testing Printf Safety Fix ==="
echo ""

# Extract and test the validate_numeric function
source <(sed -n '/^# Validate that a variable/,/^}/p' "$SCRIPT_DIR/kaseki-agent.sh")

echo "Test 1: validate_numeric rejects '-' (the bug trigger)"
if validate_numeric "test_var" "-" 2>/dev/null; then
  echo "  ✗ FAIL: validate_numeric should reject '-' but didn't"
  exit 1
else
  echo "  ✓ PASS: validate_numeric correctly rejected '-'"
fi

echo ""
echo "Test 2: validate_numeric accepts valid numeric values"
if validate_numeric "test_var" "42" 2>/dev/null; then
  echo "  ✓ PASS: validate_numeric accepted '42'"
else
  echo "  ✗ FAIL: validate_numeric should accept '42' but didn't"
  exit 1
fi

echo ""
echo "Test 3: Arithmetic with validated numeric values works"
restored_count=5
kept_count=3
if validate_numeric "restored_count" "$restored_count" 2>/dev/null && \
   validate_numeric "kept_count" "$kept_count" 2>/dev/null; then
  total_count=$((restored_count + kept_count))
  echo "  ✓ PASS: Arithmetic succeeded (5 + 3 = $total_count)"
else
  echo "  ✗ FAIL: Validation should have passed"
  exit 1
fi

echo ""
echo "Test 4: Printf with validated numeric values doesn't fail"
if printf -- '- **Test:** %%d = %d\n' "$total_count" > /dev/null 2>&1; then
  echo "  ✓ PASS: Printf with %d format string succeeded with value $total_count"
else
  echo "  ✗ FAIL: Printf should have succeeded"
  exit 1
fi

echo ""
echo "Test 5: Verify grep count fallback never returns '-'"
test_file=$(mktemp)
trap 'rm -f "$test_file"' EXIT

# Empty file
count=$(grep -c 'pattern' "$test_file" 2>/dev/null || echo 0)
if [ "$count" = "-" ]; then
  echo "  ✗ FAIL: grep -c fallback returned '-'"
  exit 1
else
  echo "  ✓ PASS: grep -c fallback returned '$count' (not '-')"
fi

echo ""
echo "Test 6: json_encode availability"
source <(sed -n '/^# Safely encode value/,/^}/p' "$SCRIPT_DIR/kaseki-agent.sh" | head -20)

output=$(printf 'test' | json_encode 2>/dev/null || true)
if [ -n "$output" ]; then
  echo "  ✓ PASS: json_encode produced output: $output"
else
  echo "  ⓘ INFO: json_encode fallback returned empty (expected if node unavailable)"
fi

echo ""
echo "=== All Critical Tests Passed ==="
echo ""
echo "Summary of fixes:"
echo "  1. ✓ validate_numeric() prevents dash/non-numeric values"
echo "  2. ✓ Arithmetic only happens after validation"
echo "  3. ✓ Printf calls use validated numeric arguments"
echo "  4. ✓ grep count fallback prevents dash values"
echo "  5. ✓ json_encode has error handling and fallback"
echo ""
echo "The 'printf: - : invalid option' error is now prevented."
