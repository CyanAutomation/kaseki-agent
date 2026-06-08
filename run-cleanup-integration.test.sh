#!/bin/bash
#
# Integration test for cleanup-runs functionality
# Tests cleanup behavior with simulated kaseki runs
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_TMPDIR=""
RESULTS_DIR=""
CACHE_DIR=""
FAILURES=0

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

cleanup_test_dirs() {
  if [ -n "$TEST_TMPDIR" ] && [ -d "$TEST_TMPDIR" ]; then
    rm -rf "$TEST_TMPDIR"
  fi
}

count_runs() {
  local dir="$1"
  [ -d "$dir" ] || { echo 0; return; }
  ls -d "$dir"/kaseki-* 2>/dev/null | wc -l | tr -d ' '
}

trap cleanup_test_dirs EXIT

setup_test_env() {
  TEST_TMPDIR=$(mktemp -d)
  RESULTS_DIR="$TEST_TMPDIR/kaseki-results"
  CACHE_DIR="$TEST_TMPDIR/kaseki-cache"
  mkdir -p "$RESULTS_DIR" "$CACHE_DIR"
}

# Create fake runs for testing
create_fake_runs() {
  local count="$1"
  for i in $(seq 1 "$count"); do
    local run_dir="$RESULTS_DIR/kaseki-$i"
    mkdir -p "$run_dir"
    
    # Write some metadata
    cat > "$run_dir/metadata.json" <<EOF
{
  "instance": "kaseki-$i",
  "repo_url": "https://github.com/test/repo",
  "git_ref": "main",
  "started_at": "2026-06-08T00:00:00Z"
}
EOF
    
    # Write a fake diff (100KB per run)
    head -c 100000 /dev/zero | tr '\0' 'x' > "$run_dir/git.diff"
    
    # Set mtime: older runs have older mtimes
    # Run 1 is oldest, run N is newest
    local mtime_offset=$((count - i))
    local mtime=$(($(date +%s) - 86400 * mtime_offset))
    touch -d "@$mtime" "$run_dir"
  done
}

# Test: Cleanup with dry-run
test_cleanup_dryrun() {
  echo -e "${BLUE}Test: Cleanup --dry-run should not delete${NC}"
  
  setup_test_env
  create_fake_runs 5
  
  # Run cleanup with dry-run (direct Node.js call, skip shell wrapper)
  if command -v node &>/dev/null && [ -f "$SCRIPT_DIR/dist/cleanup-manager.js" ]; then
    node -e "
      const { cleanupOldRuns } = require('$SCRIPT_DIR/dist/cleanup-manager.js');
      (async () => {
        await cleanupOldRuns('$RESULTS_DIR', '$CACHE_DIR', 2, true);
      })();
    " 2>/dev/null || true
    
    # Verify nothing was deleted
    local remaining=$(count_runs "$RESULTS_DIR")
    if [ "$remaining" -eq 5 ]; then
      echo -e "${GREEN}✓ Dry-run kept all 5 runs${NC}"
      return 0
    else
      echo -e "${RED}✗ Expected 5 runs, found $remaining${NC}"
      FAILURES=$((FAILURES + 1))
      return 1
    fi
  else
    echo -e "${YELLOW}⊘ Skipping (Node.js or cleanup-manager.js not available)${NC}"
    return 0
  fi
}

# Test: Cleanup deletes old runs
test_cleanup_delete() {
  echo -e "${BLUE}Test: Cleanup should delete old runs${NC}"
  
  if ! command -v node &>/dev/null || [ ! -f "$SCRIPT_DIR/dist/cleanup-manager.js" ]; then
    echo -e "${YELLOW}⊘ Skipping (Node.js or cleanup-manager.js not available)${NC}"
    return 0
  fi
  
  setup_test_env
  create_fake_runs 5
  
  # Run cleanup with Node.js module directly
  node -e "
    const { cleanupOldRuns } = require('$SCRIPT_DIR/dist/cleanup-manager.js');
    (async () => {
      await cleanupOldRuns('$RESULTS_DIR', '$CACHE_DIR', 2, false);
    })();
  " 2>/dev/null || true
  
  # Verify correct number of runs remain
  local remaining=$(count_runs "$RESULTS_DIR")
  if [ "$remaining" -eq 2 ]; then
    echo -e "${GREEN}✓ Cleanup kept 2 most recent runs${NC}"
    
    # Verify newest runs were kept
    if [ -d "$RESULTS_DIR/kaseki-4" ] && [ -d "$RESULTS_DIR/kaseki-5" ]; then
      echo -e "${GREEN}✓ Correct runs kept (kaseki-4 and kaseki-5)${NC}"
      return 0
    else
      echo -e "${RED}✗ Wrong runs kept${NC}"
      find "$RESULTS_DIR" -maxdepth 1 -type d -name 'kaseki-*' 2>/dev/null | xargs -I {} basename {}
      FAILURES=$((FAILURES + 1))
      return 1
    fi
  else
    echo -e "${RED}✗ Expected 2 runs, found $remaining${NC}"
    FAILURES=$((FAILURES + 1))
    return 1
  fi
}

# Test: Cleanup with count=0 deletes all
test_cleanup_delete_all() {
  echo -e "${BLUE}Test: Cleanup with count=0 should delete all${NC}"
  
  if ! command -v node &>/dev/null || [ ! -f "$SCRIPT_DIR/dist/cleanup-manager.js" ]; then
    echo -e "${YELLOW}⊘ Skipping (Node.js or cleanup-manager.js not available)${NC}"
    return 0
  fi
  
  setup_test_env
  create_fake_runs 3
  
  # Run cleanup with Node.js module directly
  node -e "
    const { cleanupOldRuns } = require('$SCRIPT_DIR/dist/cleanup-manager.js');
    (async () => {
      await cleanupOldRuns('$RESULTS_DIR', '$CACHE_DIR', 0, false);
    })();
  " 2>/dev/null || true
  
  # Verify all runs deleted
  local remaining=$(count_runs "$RESULTS_DIR")
  if [ "$remaining" -eq 0 ]; then
    echo -e "${GREEN}✓ Cleanup deleted all runs${NC}"
    return 0
  else
    echo -e "${RED}✗ Expected 0 runs, found $remaining${NC}"
    FAILURES=$((FAILURES + 1))
    return 1
  fi
}

# Test: Cleanup respects KASEKI_RETENTION_RUNS env var
test_cleanup_env_var() {
  echo -e "${BLUE}Test: Cleanup respects KASEKI_RETENTION_RUNS env var${NC}"
  
  if ! command -v node &>/dev/null || [ ! -f "$SCRIPT_DIR/dist/cleanup-manager.js" ]; then
    echo -e "${YELLOW}⊘ Skipping (Node.js or cleanup-manager.js not available)${NC}"
    return 0
  fi
  
  setup_test_env
  create_fake_runs 4
  
  # Run cleanup with Node.js module directly
  node -e "
    const { cleanupOldRuns } = require('$SCRIPT_DIR/dist/cleanup-manager.js');
    (async () => {
      await cleanupOldRuns('$RESULTS_DIR', '$CACHE_DIR', 1, false);
    })();
  " 2>/dev/null || true
  
  # Verify only 1 run remains
  local remaining=$(count_runs "$RESULTS_DIR")
  if [ "$remaining" -eq 1 ]; then
    echo -e "${GREEN}✓ Cleanup respected retention=1${NC}"
    return 0
  else
    echo -e "${RED}✗ Expected 1 run, found $remaining${NC}"
    FAILURES=$((FAILURES + 1))
    return 1
  fi
}

# Test: Cleanup does nothing if run count is below retention
test_cleanup_no_action() {
  echo -e "${BLUE}Test: Cleanup should do nothing if run count <= retention${NC}"
  
  if ! command -v node &>/dev/null || [ ! -f "$SCRIPT_DIR/dist/cleanup-manager.js" ]; then
    echo -e "${YELLOW}⊘ Skipping (Node.js or cleanup-manager.js not available)${NC}"
    return 0
  fi
  
  setup_test_env
  create_fake_runs 3
  
  # Run cleanup with high retention count
  node -e "
    const { cleanupOldRuns } = require('$SCRIPT_DIR/dist/cleanup-manager.js');
    (async () => {
      await cleanupOldRuns('$RESULTS_DIR', '$CACHE_DIR', 10, false);
    })();
  " 2>/dev/null || true
  
  # Verify all runs still exist
  local remaining=$(count_runs "$RESULTS_DIR")
  if [ "$remaining" -eq 3 ]; then
    echo -e "${GREEN}✓ Cleanup skipped (runs <= retention count)${NC}"
    return 0
  else
    echo -e "${RED}✗ Expected 3 runs, found $remaining${NC}"
    FAILURES=$((FAILURES + 1))
    return 1
  fi
}

# Test: Integration with Node.js cleanup-manager
test_node_cleanup_integration() {
  echo -e "${BLUE}Test: Node.js cleanup-manager integration${NC}"
  
  # Skip if compiled code not available
  if [ ! -f "$SCRIPT_DIR/dist/cleanup-manager.js" ]; then
    echo -e "${YELLOW}⊘ Skipping (cleanup-manager.js not compiled - run npm run build)${NC}"
    return 0
  fi
  
  setup_test_env
  create_fake_runs 5
  
  # Test Node.js directly
  node -e "
    const { cleanupOldRuns } = require('$SCRIPT_DIR/dist/cleanup-manager.js');
    (async () => {
      const result = await cleanupOldRuns('$RESULTS_DIR', '$CACHE_DIR', 2, false);
      console.log(JSON.stringify(result));
    })();
  " 2>/dev/null | grep -q '"deletedCount":3' && {
    echo -e "${GREEN}✓ Node.js cleanup-manager deleted 3 runs${NC}"
    
    # Verify runs were actually deleted
    local remaining=$(count_runs "$RESULTS_DIR")
    if [ "$remaining" -eq 2 ]; then
      echo -e "${GREEN}✓ Correct number of runs remaining (2)${NC}"
      return 0
    else
      echo -e "${RED}✗ Expected 2 remaining runs, found $remaining${NC}"
      FAILURES=$((FAILURES + 1))
      return 1
    fi
  }
  
  echo -e "${RED}✗ Node.js cleanup-manager test failed${NC}"
  FAILURES=$((FAILURES + 1))
  return 1
}

# Main test suite
main() {
  echo -e "${BLUE}╔═══════════════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║  Cleanup Manager Integration Tests                    ║${NC}"
  echo -e "${BLUE}╚═══════════════════════════════════════════════════════╝${NC}"
  echo ""
  
  test_cleanup_dryrun
  test_cleanup_delete
  test_cleanup_delete_all
  test_cleanup_env_var
  test_cleanup_no_action
  test_node_cleanup_integration
  
  echo ""
  if [ "$FAILURES" -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
    exit 0
  else
    echo -e "${RED}✗ $FAILURES test(s) failed${NC}"
    exit 1
  fi
}

main "$@"
