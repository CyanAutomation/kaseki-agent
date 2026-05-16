#!/usr/bin/env bash
#
# npm-verify-publish.sh — Verify that a published npm package is available on the registry
#
# This script polls the npm registry with exponential backoff to verify that a package
# has been published and indexed. npm registry indexing can take 30-60+ seconds, so we
# use exponential backoff polling (1s, 2s, 4s, 8s, 16s, 32s) to avoid hammering the API.
#
# Usage:
#   ./scripts/npm-verify-publish.sh <PACKAGE_NAME> <VERSION> [MAX_ATTEMPTS]
#
# Arguments:
#   PACKAGE_NAME     Package name (e.g., @cyanautomation/kaseki-agent)
#   VERSION          Package version (e.g., 1.29.1)
#   MAX_ATTEMPTS     Maximum number of attempts (default: 6)
#
# Exit Codes:
#   0  — Package verified successfully on npm registry
#   1  — Package not found after all retries exhausted
#   2  — Invalid arguments
#   3  — jq not available
#
# Environment Variables:
#   KASEKI_VERIFY_DEBUG=1   Enable debug logging for each retry attempt
#

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Validate arguments
if [[ $# -lt 2 ]]; then
  cat >&2 <<EOF
${RED}Error: Missing required arguments${NC}

Usage:
  ${SCRIPT_NAME} <PACKAGE_NAME> <VERSION> [MAX_ATTEMPTS]

Arguments:
  PACKAGE_NAME     Package name (e.g., @cyanautomation/kaseki-agent)
  VERSION          Package version (e.g., 1.29.1)
  MAX_ATTEMPTS     Maximum number of attempts (default: 6)

Examples:
  ${SCRIPT_NAME} @cyanautomation/kaseki-agent 1.29.1
  ${SCRIPT_NAME} @cyanautomation/kaseki-agent 1.29.1 10
EOF
  exit 2
fi

PACKAGE_NAME="$1"
VERSION="$2"
MAX_ATTEMPTS="${3:-6}"

# Check if jq is available
if ! command -v jq &> /dev/null; then
  echo -e "${RED}Error: jq is required but not found on PATH${NC}" >&2
  exit 3
fi

# Exponential backoff delays (in seconds): 1, 2, 4, 8, 16, 32
DELAYS=(1 2 4 8 16 32)

# Ensure we don't exceed the array length
if [[ $MAX_ATTEMPTS -gt ${#DELAYS[@]} ]]; then
  MAX_ATTEMPTS=${#DELAYS[@]}
fi

echo -e "${BLUE}📦 Verifying npm registry publication${NC}"
echo "  Package: ${PACKAGE_NAME}"
echo "  Version: ${VERSION}"
echo "  Max attempts: ${MAX_ATTEMPTS}"
echo ""

ATTEMPT=1
TOTAL_DELAY=0

while [[ $ATTEMPT -le $MAX_ATTEMPTS ]]; do
  DELAY_INDEX=$((ATTEMPT - 1))
  CURRENT_DELAY=${DELAYS[$DELAY_INDEX]}
  
  if [[ $ATTEMPT -gt 1 ]]; then
    if [[ "${KASEKI_VERIFY_DEBUG:-0}" == "1" ]]; then
      echo -e "${YELLOW}Attempt ${ATTEMPT}/${MAX_ATTEMPTS}: Waiting ${CURRENT_DELAY}s before retry (total so far: ${TOTAL_DELAY}s)${NC}"
    fi
    sleep "$CURRENT_DELAY"
    TOTAL_DELAY=$((TOTAL_DELAY + CURRENT_DELAY))
  else
    echo -e "${YELLOW}Attempt ${ATTEMPT}/${MAX_ATTEMPTS}: Checking registry now${NC}"
  fi

  # Attempt to fetch package info from npm registry
  if npm view "${PACKAGE_NAME}@${VERSION}" --json > /tmp/npm-view.json 2>/dev/null; then
    # Successfully fetched package info
    PUBLISHED_VERSION=$(jq -r '.version // empty' /tmp/npm-view.json 2>/dev/null || echo "")
    
    if [[ "${PUBLISHED_VERSION}" == "${VERSION}" ]]; then
      # ✅ Package found and version matches
      echo ""
      echo -e "${GREEN}✅ Package successfully verified on npm registry${NC}"
      echo "  ${PACKAGE_NAME}@${VERSION}"
      
      # Show tarball URL
      TARBALL_URL=$(jq -r '.dist.tarball // empty' "/tmp/npm-verify-${VERSION}.json" 2>/dev/null || echo "")
      if [[ -n "${TARBALL_URL}" ]]; then
        echo "  Tarball: ${TARBALL_URL}"
      fi
      
      echo "  Time to availability: ${TOTAL_DELAY}s"
      rm -f /tmp/npm-view.json
      exit 0
    fi
  fi

  # Package not yet available, continue to next attempt
  if [[ "${KASEKI_VERIFY_DEBUG:-0}" == "1" ]]; then
    echo -e "${YELLOW}  → Not yet indexed (or fetch failed), will retry...${NC}"
  fi

  ATTEMPT=$((ATTEMPT + 1))
done

# Failed to verify after all retries exhausted
echo ""
echo -e "${RED}❌ Package not found on npm registry after ${MAX_ATTEMPTS} attempts${NC}"
echo "  ${PACKAGE_NAME}@${VERSION}"
echo "  Total wait time: ${TOTAL_DELAY}s"
echo ""
echo -e "${YELLOW}Possible causes:${NC}"
echo "  • npm publish failed (check workflow logs for errors)"
echo "  • npm registry is experiencing delays (try again in a few minutes)"
echo "  • Version string mismatch (check package.json vs git tag)"
echo ""

# Show last response for debugging
if [[ -f /tmp/npm-view.json ]]; then
  echo -e "${YELLOW}Last response from npm:${NC}"
  cat /tmp/npm-view.json
  rm -f /tmp/npm-view.json
fi

exit 1
