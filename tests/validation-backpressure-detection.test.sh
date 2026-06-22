#!/usr/bin/env bash
#
# Test: Validation output filter backpressure detection
#
# Verifies the filter handles large output without hanging or crashing.
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FILTER_BIN="$PROJECT_ROOT/dist/validation-output-filter.js"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

PASSED=0
FAILED=0

if [ ! -f "$FILTER_BIN" ]; then
  echo -e "${RED}ERROR: Filter not found at $FILTER_BIN${NC}"
  exit 1
fi

echo -e "${BLUE}=== Backpressure Detection Tests ===${NC}\n"

# Test 1: 10k lines
echo -e "${BLUE}→ Large output (10k lines)${NC}"
if seq 1 10000 | awk '{ printf "[INFO] line %d\n", $1 }' | \
   timeout 5 env FILTER_DIAGNOSTICS_LOG=/tmp/bp-test-1.log node "$FILTER_BIN" > /tmp/bp-out-1.log 2>/dev/null; then
  echo -e "${GREEN}✓ PASS${NC}: 10k lines completed"
  ((PASSED++))
else
  echo -e "${RED}✗ FAIL${NC}: 10k lines failed"
  ((FAILED++))
fi

# Test 2: 50k lines (stress test)
echo -e "${BLUE}→ Stress output (50k lines)${NC}"
if seq 1 50000 | awk '{ printf "[DEBUG] item %d\n", $1 }' | \
   timeout 15 env FILTER_DIAGNOSTICS_LOG=/tmp/bp-test-2.log node "$FILTER_BIN" > /tmp/bp-out-2.log 2>/dev/null; then
  echo -e "${GREEN}✓ PASS${NC}: 50k lines completed"
  ((PASSED++))
else
  echo -e "${RED}✗ FAIL${NC}: 50k lines failed"
  ((FAILED++))
fi

# Test 3: Large single line (1MB)
echo -e "${BLUE}→ Very large single line (1MB)${NC}"
if python3 -c "print('[INFO] ' + 'x' * (1024*1024))" 2>/dev/null | \
   timeout 5 env FILTER_DIAGNOSTICS_LOG=/tmp/bp-test-3.log node "$FILTER_BIN" > /tmp/bp-out-3.log 2>/dev/null; then
  echo -e "${GREEN}✓ PASS${NC}: 1MB line handled"
  ((PASSED++))
else
  echo -e "${RED}✗ FAIL${NC}: 1MB line failed"
  ((FAILED++))
fi

# Test 4: Rapid burst
echo -e "${BLUE}→ Rapid output burst (mixed patterns)${NC}"
if {
  for i in {1..2000}; do
    echo "[PASS] test $i"
    echo "[DEBUG] details $i"
  done
} | timeout 5 env FILTER_DIAGNOSTICS_LOG=/tmp/bp-test-4.log node "$FILTER_BIN" > /tmp/bp-out-4.log 2>/dev/null; then
  echo -e "${GREEN}✓ PASS${NC}: Rapid burst handled"
  ((PASSED++))
else
  echo -e "${RED}✗ FAIL${NC}: Rapid burst failed"
  ((FAILED++))
fi

# Summary
echo ""
echo -e "${BLUE}=== Results ===${NC}"
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"

if [ $FAILED -eq 0 ]; then
  echo -e "\n${GREEN}✓ All tests passed${NC}"
  exit 0
else
  echo -e "\n${RED}✗ Some tests failed${NC}"
  exit 1
fi
