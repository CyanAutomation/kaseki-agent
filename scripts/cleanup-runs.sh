#!/bin/bash
#
# cleanup-runs.sh - Manage retention of kaseki run artifacts
#
# Usage:
#   ./scripts/cleanup-runs.sh [--dry-run] [--force] [--count N]
#
# Options:
#   --dry-run     Show what would be deleted without actually deleting
#   --force       Skip confirmation prompt (use for automation)
#   --count N     Override KASEKI_RETENTION_RUNS (e.g., --count 5)
#
# Environment Variables:
#   KASEKI_RETENTION_RUNS  Number of recent runs to keep (default: 5)
#   KASEKI_RESULTS_DIR     Path to /agents/kaseki-results (default: /agents/kaseki-results)
#   KASEKI_CACHE_DIR       Path to /agents/kaseki-cache (default: /agents/kaseki-cache)
#

set -euo pipefail

# Defaults
DRY_RUN=false
FORCE=false
RETENTION_COUNT="${KASEKI_RETENTION_RUNS:-5}"
RESULTS_DIR="${KASEKI_RESULTS_DIR:-/agents/kaseki-results}"
CACHE_DIR="${KASEKI_CACHE_DIR:-/agents/kaseki-cache}"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --count)
      if [[ -z "${2:-}" ]]; then
        echo -e "${RED}Error: --count requires an argument${NC}" >&2
        exit 1
      fi
      RETENTION_COUNT="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $(basename "$0") [--dry-run] [--force] [--count N]"
      echo ""
      echo "Options:"
      echo "  --dry-run     Show what would be deleted without deleting"
      echo "  --force       Skip confirmation prompt"
      echo "  --count N     Override KASEKI_RETENTION_RUNS (default: $RETENTION_COUNT)"
      echo ""
      echo "Environment variables:"
      echo "  KASEKI_RETENTION_RUNS  Number of recent runs to keep (default: 5)"
      echo "  KASEKI_RESULTS_DIR     Path to results directory"
      echo "  KASEKI_CACHE_DIR       Path to cache directory"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}" >&2
      exit 1
      ;;
  esac
done

# Validate retention count
if ! [[ "$RETENTION_COUNT" =~ ^[0-9]+$ ]] || (( RETENTION_COUNT > 100 )); then
  echo -e "${RED}Error: Retention count must be a number between 0 and 100${NC}" >&2
  exit 1
fi

# Check if results directory exists
if [[ ! -d "$RESULTS_DIR" ]]; then
  echo -e "${YELLOW}Warning: Results directory does not exist: $RESULTS_DIR${NC}"
  exit 0
fi

# Count existing runs
RUN_COUNT=$(find "$RESULTS_DIR" -maxdepth 1 -type d -name 'kaseki-*' | wc -l)

if (( RUN_COUNT <= RETENTION_COUNT )); then
  echo -e "${GREEN}✓ No cleanup needed: $RUN_COUNT run(s) found, keeping $RETENTION_COUNT${NC}"
  exit 0
fi

# Determine which runs to delete
RUNS_TO_DELETE=$(( RUN_COUNT - RETENTION_COUNT ))

echo -e "${BLUE}Cleanup Summary${NC}"
echo "================"
echo "Runs to analyze:  $RUN_COUNT"
echo "Retention count:  $RETENTION_COUNT"
echo "Runs to delete:   $RUNS_TO_DELETE"
echo ""

# List runs sorted by modification time (newest first)
echo -e "${BLUE}Runs (newest first):${NC}"
ls -dt "$RESULTS_DIR"/kaseki-* 2>/dev/null | head -n "$RUN_COUNT" | nl | while read -r LINE; do
  RUN_PATH="$LINE"
  RUN_NAME=$(basename "$RUN_PATH")
  RUN_NUM=$(echo "$RUN_NAME" | sed 's/kaseki-//')
  MOD_TIME=$(stat -c '%y' "$RUN_PATH" 2>/dev/null | cut -d. -f1 || date -r "$RUN_PATH" '+%Y-%m-%d %H:%M:%S')
  
  if (( RUN_NUM <= RUNS_TO_DELETE )); then
    echo -e "  ${RED}[DELETE]${NC} $RUN_NAME  ($MOD_TIME)"
  else
    echo -e "  ${GREEN}[KEEP]${NC}   $RUN_NAME  ($MOD_TIME)"
  fi
done

echo ""

if [[ "$DRY_RUN" == true ]]; then
  echo -e "${YELLOW}[DRY RUN]${NC} No changes were made"
  exit 0
fi

# Ask for confirmation unless --force is set
if [[ "$FORCE" != true ]]; then
  read -p "Proceed with deletion? (y/N) " -r CONFIRM
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Cancelled${NC}"
    exit 0
  fi
fi

# Execute cleanup via Node.js
echo ""
echo -e "${BLUE}Executing cleanup...${NC}"

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Run Node.js cleanup (uses the cleanup-manager module)
node -e "
const path = require('path');
const { cleanupOldRuns } = require('$SCRIPT_DIR/dist/cleanup-manager');

(async () => {
  try {
    const result = await cleanupOldRuns('$RESULTS_DIR', '$CACHE_DIR', $RETENTION_COUNT, false);
    console.log('✓ Cleanup complete:');
    console.log('  Deleted runs:       ' + result.deletedCount);
    console.log('  Freed space:        ' + (result.freedBytes / 1024 / 1024).toFixed(2) + ' MB');
    console.log('  Cache entries removed: ' + result.cachedEntriesRemoved);
    process.exit(0);
  } catch (error) {
    console.error('✗ Cleanup failed:', error.message);
    process.exit(1);
  }
})();
" || {
  # Fallback if compiled module not available
  echo -e "${RED}Error: cleanup-manager module not found. Make sure to run 'npm run build'${NC}" >&2
  exit 1
}
