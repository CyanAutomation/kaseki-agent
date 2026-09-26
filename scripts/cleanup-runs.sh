#!/bin/bash
#
# cleanup-runs.sh - Manage retention of run artifacts and matching host logs
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
#   KASEKI_LOG_DIR         Path to host logs (default: /var/log/kaseki)
#

set -euo pipefail

# Defaults
DRY_RUN=false
FORCE=false
RETENTION_COUNT="${KASEKI_RETENTION_RUNS:-5}"
RESULTS_DIR="${KASEKI_RESULTS_DIR:-/agents/kaseki-results}"
CACHE_DIR="${KASEKI_CACHE_DIR:-/agents/kaseki-cache}"
LOG_DIR="${KASEKI_LOG_DIR:-/var/log/kaseki}"
RUNS_DIR="${KASEKI_ROOT:-/agents}/kaseki-runs"

# Color codes for output
RED='\033[0;31m'
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
      echo "  KASEKI_LOG_DIR         Path to host logs (default: /var/log/kaseki)"
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

# Use the shared plan so manual cleanup applies the same run and host-log policy.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
set +e
PREVIEW_OUTPUT="$(
  # JavaScript template interpolation must remain literal to the shell.
  # shellcheck disable=SC2016
  KASEKI_CLEANUP_SCRIPT_DIR="$SCRIPT_DIR" \
      KASEKI_CLEANUP_RESULTS_DIR="$RESULTS_DIR" \
      KASEKI_CLEANUP_LOG_DIR="$LOG_DIR" \
      KASEKI_CLEANUP_RUNS_DIR="$RUNS_DIR" \
      KASEKI_CLEANUP_RETENTION_COUNT="$RETENTION_COUNT" \
  node -e '
    const path = require("node:path");
    const { createCleanupPlan } = require(path.join(process.env.KASEKI_CLEANUP_SCRIPT_DIR, "dist/cleanup-manager.js"));
    try {
      const plan = createCleanupPlan(
        process.env.KASEKI_CLEANUP_RESULTS_DIR,
        Number.parseInt(process.env.KASEKI_CLEANUP_RETENTION_COUNT, 10),
        {
          logDir: process.env.KASEKI_CLEANUP_LOG_DIR,
          activeRunsDir: process.env.KASEKI_CLEANUP_RUNS_DIR,
        },
      );
      if (plan.runsToDelete.length === 0 && plan.logsToDelete.length === 0) {
        console.log(`✓ No cleanup needed: ${plan.allRuns.length} run(s) found, keeping ${process.env.KASEKI_CLEANUP_RETENTION_COUNT}`);
        process.exitCode = 2;
      } else {
        console.log("Cleanup Summary");
        console.log("===============");
        console.log(`Runs found:        ${plan.allRuns.length}`);
        console.log(`Retention count:   ${process.env.KASEKI_CLEANUP_RETENTION_COUNT}`);
        console.log(`Runs to delete:    ${plan.runsToDelete.length}`);
        console.log(`Host logs to delete: ${plan.logsToDelete.length}`);
        console.log("");
        console.log("Runs (newest first):");
        const deletable = new Set(plan.runsToDelete.map((run) => run.name));
        for (const run of plan.allRuns) {
          const marker = deletable.has(run.name) ? "[DELETE]" : "[KEEP]";
          console.log(`  ${marker} ${run.name}  (${new Date(run.mtime).toISOString().slice(0, 19)})`);
        }
        if (plan.logsToDelete.length > 0) {
          console.log("");
          console.log("Host logs to delete:");
          for (const log of plan.logsToDelete) console.log(`  [DELETE] ${log.name}`);
        }
      }
    } catch (error) {
      console.error("✗ Could not create a safe cleanup plan:", error.message);
      process.exitCode = 1;
    }
  '
)"
PLAN_STATUS=$?
set -e
printf '%s\n' "$PREVIEW_OUTPUT"
if (( PLAN_STATUS == 2 )); then
  exit 0
elif (( PLAN_STATUS != 0 )); then
  exit 1
fi

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

# Run Node.js cleanup (uses the cleanup-manager module)
KASEKI_CLEANUP_SCRIPT_DIR="$SCRIPT_DIR" \
KASEKI_CLEANUP_RESULTS_DIR="$RESULTS_DIR" \
KASEKI_CLEANUP_CACHE_DIR="$CACHE_DIR" \
KASEKI_CLEANUP_LOG_DIR="$LOG_DIR" \
KASEKI_CLEANUP_RUNS_DIR="$RUNS_DIR" \
KASEKI_CLEANUP_RETENTION_COUNT="$RETENTION_COUNT" \
node -e '
const path = require("node:path");
const { cleanupOldRuns } = require(path.join(process.env.KASEKI_CLEANUP_SCRIPT_DIR, "dist/cleanup-manager.js"));

(async () => {
  try {
    const result = await cleanupOldRuns(
      process.env.KASEKI_CLEANUP_RESULTS_DIR,
      process.env.KASEKI_CLEANUP_CACHE_DIR,
      Number.parseInt(process.env.KASEKI_CLEANUP_RETENTION_COUNT, 10),
      false,
      {
        logDir: process.env.KASEKI_CLEANUP_LOG_DIR,
        activeRunsDir: process.env.KASEKI_CLEANUP_RUNS_DIR,
      },
    );
    console.log("✓ Cleanup complete:");
    console.log("  Deleted runs:       " + result.deletedCount);
    console.log("  Host logs deleted:  " + result.deletedLogCount);
    console.log("  Freed space:        " + (result.freedBytes / 1024 / 1024).toFixed(2) + " MB");
    process.exit(0);
  } catch (error) {
    console.error("✗ Cleanup failed:", error.message);
    process.exit(1);
  }
})();
' || {
  # Fallback if compiled module not available
  echo -e "${RED}Error: cleanup-manager module not found. Make sure to run 'npm run build'${NC}" >&2
  exit 1
}
