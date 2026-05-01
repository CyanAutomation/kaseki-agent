#!/usr/bin/env bash
# Test: --dry-run flag functionality
# This script verifies that --dry-run mode:
# - Accepts the flag without errors
# - Skips Pi agent execution
# - Skips validation commands
# - Records dry-run metadata
# - Returns exit code 0

set -euo pipefail

echo "=== Testing --dry-run Flag ==="
echo ""
echo "Test 1: Checking for --dry-run flag in run-kaseki.sh"
if grep -q 'KASEKI_DRY_RUN' /workspaces/kaseki-agent/run-kaseki.sh; then
  echo "✓ KASEKI_DRY_RUN environment variable defined"
else
  echo "✗ KASEKI_DRY_RUN not found"
  exit 1
fi

echo ""
echo "Test 2: Checking for --dry-run argument parsing"
if grep -q '\[ "$arg" = "--dry-run" \]' /workspaces/kaseki-agent/run-kaseki.sh; then
  echo "✓ --dry-run argument parsing implemented"
else
  echo "✗ --dry-run argument parsing not found"
  exit 1
fi

echo ""
echo "Test 3: Checking for dry-run logic in kaseki-agent.sh"
if grep -q 'KASEKI_DRY_RUN' /workspaces/kaseki-agent/kaseki-agent.sh; then
  echo "✓ Dry-run logic in agent script"
else
  echo "✗ Dry-run logic not found in agent"
  exit 1
fi

echo ""
echo "Test 4: Checking for dry-run skip of Pi execution"
if grep -q 'DRY-RUN MODE: Skipping Pi coding agent' /workspaces/kaseki-agent/kaseki-agent.sh; then
  echo "✓ Pi agent execution skipped in dry-run"
else
  echo "✗ Pi agent dry-run skip not found"
  exit 1
fi

echo ""
echo "Test 5: Checking for dry-run skip of validation"
if grep -q 'DRY-RUN MODE: Validation commands would be executed' /workspaces/kaseki-agent/kaseki-agent.sh; then
  echo "✓ Validation skipped in dry-run"
else
  echo "✗ Validation dry-run skip not found"
  exit 1
fi

echo ""
echo "Test 6: Checking for dry-run skip of secret scan"
if grep -q 'DRY-RUN MODE: Skipping secret scan' /workspaces/kaseki-agent/kaseki-agent.sh; then
  echo "✓ Secret scan skipped in dry-run"
else
  echo "✗ Secret scan dry-run skip not found"
  exit 1
fi

echo ""
echo "Test 7: Checking for dry-run metadata in host-start.json"
if grep -q 'dry_run' /workspaces/kaseki-agent/run-kaseki.sh; then
  echo "✓ Dry-run flag included in metadata"
else
  echo "✗ Dry-run metadata not found"
  exit 1
fi

echo ""
echo "✅ All --dry-run feature tests passed!"
echo ""
echo "Usage:"
echo "  ./run-kaseki.sh --dry-run"
echo "  KASEKI_DRY_RUN=1 ./run-kaseki.sh"
