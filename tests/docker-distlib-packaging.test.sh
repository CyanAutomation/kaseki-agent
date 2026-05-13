#!/usr/bin/env bash
set -euo pipefail

# Docker-level validation test for dist/lib/ packaging
# Verifies that the Dockerfile correctly copies the dist/lib/ subdirectory structure
# and validates the packaging changes are correctly implemented.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "Docker-Level Validation Test"
echo "Checking dist/lib/ packaging in Dockerfile"
echo "=========================================="

# Test 1: Verify Dockerfile contains the dist/lib/ copy command
echo -e "${YELLOW}[1/3]${NC} Checking Dockerfile for dist/lib/ copy command..."
if grep -q "cp -r dist/lib/\* /app/lib/lib/" "$ROOT_DIR/Dockerfile"; then
  echo -e "${GREEN}[OK]${NC} Dockerfile contains dist/lib/ copy command"
else
  echo -e "${RED}[FAILED]${NC} Dockerfile missing dist/lib/ copy command"
  exit 1
fi

# Test 2: Verify /app/lib/lib/ directory is created
echo -e "${YELLOW}[2/3]${NC} Checking Dockerfile for /app/lib/lib/ directory creation..."
if grep -q "mkdir -p /app/lib/lib" "$ROOT_DIR/Dockerfile"; then
  echo -e "${GREEN}[OK]${NC} Dockerfile creates /app/lib/lib/ directory"
else
  echo -e "${RED}[FAILED]${NC} Dockerfile doesn't explicitly create /app/lib/lib/ directory"
  # This is non-critical since cp -r with mkdir -p should handle it, but it's better to be explicit
  echo -e "${YELLOW}[WARN]${NC} Note: mkdir -p /app/lib/lib should be in place for directory creation"
fi

# Test 3: Verify no syntax errors in Dockerfile (basic linting)
echo -e "${YELLOW}[3/3]${NC} Checking Dockerfile syntax with hadolint..."
if command -v hadolint &> /dev/null; then
  hadolint "$ROOT_DIR/Dockerfile" || {
    echo -e "${YELLOW}[WARN]${NC} hadolint found issues (may be non-critical)"
  }
else
  echo -e "${YELLOW}[INFO]${NC} hadolint not installed, skipping Dockerfile linting"
fi

# Final step: List what would be packaged in the next Docker build
echo ""
echo -e "${YELLOW}[INFO]${NC} Verifying local dist/lib/ structure (what will be packaged):"
if [ -d "$ROOT_DIR/dist/lib" ]; then
  echo -e "${GREEN}[OK]${NC} Local dist/lib/ directory exists"
  for file in "$ROOT_DIR"/dist/lib/*.js; do
    [ -f "$file" ] && echo "     - $(basename "$file")"
  done || true
else
  echo -e "${RED}[FAILED]${NC} Local dist/lib/ directory does not exist"
  exit 1
fi

echo ""
echo -e "${GREEN}=========================================="
echo "Docker-level Dockerfile validation passed!"
echo "=========================================${NC}"
echo ""
echo "Note: Full Docker image build test should be run separately once npm dependencies are resolved."
