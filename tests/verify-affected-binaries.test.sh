#!/usr/bin/env bash
set -euo pipefail

# Verification test for all three affected binaries
# Checks that pi-event-filter, kaseki-api-routes, and job-scheduler 
# have correct import paths to their helper modules in the compiled output

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=========================================="
echo "Binary Module Import Verification"
echo "==========================================${NC}"

FAILED=0

# Test 1: pi-event-filter imports event-timestamp-helpers
echo ""
echo -e "${YELLOW}[1/5]${NC} Verifying pi-event-filter imports..."
if grep -q "from ['\"]./lib/event-timestamp-helpers.js['\"]" "$ROOT_DIR/dist/pi-event-filter.js"; then
  echo -e "${GREEN}[OK]${NC} pi-event-filter correctly imports ./lib/event-timestamp-helpers.js"
else
  echo -e "${RED}[FAILED]${NC} pi-event-filter missing import for event-timestamp-helpers"
  FAILED=$((FAILED + 1))
fi

# Test 2: event-timestamp-helpers exports required symbols
echo -e "${YELLOW}[2/5]${NC} Verifying event-timestamp-helpers exports..."
if grep -q "export.*extractEventTimestamp\|exports.extractEventTimestamp" "$ROOT_DIR/dist/lib/event-timestamp-helpers.js"; then
  echo -e "${GREEN}[OK]${NC} event-timestamp-helpers correctly exports extractEventTimestamp"
else
  echo -e "${RED}[FAILED]${NC} event-timestamp-helpers missing extractEventTimestamp export"
  FAILED=$((FAILED + 1))
fi

# Test 3: kaseki-api-routes imports subprocess-helpers
echo -e "${YELLOW}[3/5]${NC} Verifying kaseki-api-routes imports..."
if grep -q "from ['\"]./lib/subprocess-helpers\|require(['\"]./lib/subprocess-helpers" "$ROOT_DIR/dist/kaseki-api-routes.js"; then
  echo -e "${GREEN}[OK]${NC} kaseki-api-routes correctly imports ./lib/subprocess-helpers"
else
  echo -e "${RED}[FAILED]${NC} kaseki-api-routes missing import for subprocess-helpers"
  FAILED=$((FAILED + 1))
fi

# Test 4: job-scheduler imports subprocess-helpers
echo -e "${YELLOW}[4/5]${NC} Verifying job-scheduler imports..."
if grep -q "from ['\"]./lib/subprocess-helpers\|require(['\"]./lib/subprocess-helpers" "$ROOT_DIR/dist/job-scheduler.js"; then
  echo -e "${GREEN}[OK]${NC} job-scheduler correctly imports ./lib/subprocess-helpers"
else
  echo -e "${RED}[FAILED]${NC} job-scheduler missing import for subprocess-helpers"
  FAILED=$((FAILED + 1))
fi

# Test 5: subprocess-helpers exports required symbols
echo -e "${YELLOW}[5/5]${NC} Verifying subprocess-helpers exports..."
if grep -q "export.*execDockerCommand\|export.*execSubprocess\|exports.execDockerCommand\|exports.execSubprocess" "$ROOT_DIR/dist/lib/subprocess-helpers.js"; then
  echo -e "${GREEN}[OK]${NC} subprocess-helpers correctly exports required functions"
else
  echo -e "${RED}[FAILED]${NC} subprocess-helpers missing required function exports"
  FAILED=$((FAILED + 1))
fi

# Summary
echo ""
if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}=========================================="
  echo "All binary verification tests passed!"
  echo "=========================================${NC}"
  exit 0
else
  echo -e "${RED}=========================================="
  echo "$FAILED verification test(s) FAILED"
  echo "=========================================${NC}"
  exit 1
fi
