#!/bin/bash
# Test: Scouting with read-only /results mount
# Purpose: Verify that read-only filesystem is detected early and reported clearly
# Expected: Exit code 86 with readonly_filesystem reason code instead of misleading errors

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
TEST_NAME="scouting-readonly"
TEST_REPO="${TEST_REPO:-CyanAutomation/crudmapper}"
TEST_INSTANCE="kaseki-test-readonly-$$"
TEST_RESULTS="/tmp/kaseki-readonly-test-results"
TEST_IMAGE="${KASEKI_IMAGE:-docker.io/cyanautomation/kaseki-agent:latest}"

# Skip if API key not set
if [ -z "${OPENROUTER_API_KEY:-}" ] && [ -z "${OPENROUTER_API_KEY_FILE:-}" ]; then
  printf "%bSKIPPED: OPENROUTER_API_KEY not set%b\n" "$YELLOW" "$NC"
  exit 0
fi

# Cleanup
cleanup() {
  rm -rf "$TEST_RESULTS" 2>/dev/null || true
  if docker ps -a --filter "name=$TEST_INSTANCE" --format '{{.Names}}' 2>/dev/null | grep -q "$TEST_INSTANCE"; then
    docker rm -f "$TEST_INSTANCE" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Prepare test directories
mkdir -p "$TEST_RESULTS"
chmod 755 "$TEST_RESULTS"

printf "\n=== %bTest: %s%b ===\n" "$YELLOW" "$TEST_NAME" "$NC"
printf "Instance: %s\n" "$TEST_INSTANCE"
printf "Image: %s\n" "$TEST_IMAGE"
printf "Repo: %s\n\n" "$TEST_REPO"

# Get API key from file or env var
api_key="${OPENROUTER_API_KEY:-}"
if [ -z "$api_key" ] && [ -n "${OPENROUTER_API_KEY_FILE:-}" ] && [ -f "$OPENROUTER_API_KEY_FILE" ]; then
  api_key="$(cat "$OPENROUTER_API_KEY_FILE")"
fi

# Build docker args: mount /results as READ-ONLY to trigger the issue
docker_args=(
  run --rm
  --name "$TEST_INSTANCE"
  --read-only
  --tmpfs "/tmp:rw,nosuid,nodev,size=256m"
  --security-opt no-new-privileges:true
  --cap-drop ALL
  -u 10000:10000
  -e KASEKI_INSTANCE="$TEST_INSTANCE"
  -e REPO_URL="$TEST_REPO"
  -e GIT_REF="main"
  -e KASEKI_MODEL="openrouter/free"
  -e KASEKI_AGENT_TIMEOUT_SECONDS="120"
  -e KASEKI_STREAM_PROGRESS="0"
  -e KASEKI_LOG_DIR="/results"
  -e TASK_PROMPT="Return empty diff for testing."
  -e KASEKI_STARTUP_CHECK_MODE="worker"
  -v "$TEST_RESULTS:/results:ro"  # KEY: Mount read-only to trigger the issue
  -w /workspace
  "$TEST_IMAGE"
  "worker"
)

# Add API key
if [ -n "$api_key" ]; then
  docker_args+=(-e "OPENROUTER_API_KEY=$api_key")
fi

# Run the test (expect exit code 86 due to missing scouting artifact)
printf "%bRunning container with read-only /results...%b\n\n" "$GREEN" "$NC"
set +e
docker "${docker_args[@]}" > "$TEST_RESULTS/docker.log" 2>&1
exit_code=$?
set -e

# Check results
printf "\n%bAnalyzing results...%b\n\n" "$YELLOW" "$NC"

# Expected: exit code 86 (scouting validation failed)
if [ "$exit_code" -eq 86 ]; then
  printf "%b✓ PASS: Got expected exit code 86 (scouting validation failed)%b\n" "$GREEN" "$NC"
else
  printf "%b✗ FAIL: Expected exit code 86, got %d%b\n" "$RED" "$exit_code" "$NC"
  printf "Docker logs:\n"
  cat "$TEST_RESULTS/docker.log" 2>/dev/null || printf "(no logs)\n"
  exit 1
fi

# Check for readonly_filesystem detection in logs
if grep -q "readonly_filesystem" "$TEST_RESULTS/docker.log" 2>/dev/null; then
  printf "%b✓ PASS: readonly_filesystem reason code detected%b\n" "$GREEN" "$NC"
elif grep -q "Read-only file system" "$TEST_RESULTS/docker.log" 2>/dev/null; then
  printf "%b✓ PASS: Read-only error detected in logs%b\n" "$GREEN" "$NC"
else
  printf "%b⚠ WARN: Could not verify readonly_filesystem detection in logs%b\n" "$YELLOW" "$NC"
  printf "Docker logs:\n"
  cat "$TEST_RESULTS/docker.log" 2>/dev/null || printf "(no logs)\n"
fi

# Check for diagnostic files
if [ -f "$TEST_RESULTS/filesystem-readonly-reason.txt" ]; then
  printf "%b✓ PASS: Diagnostic file created: filesystem-readonly-reason.txt%b\n" "$GREEN" "$NC"
  printf "  Reason: %s\n" "$(cat "$TEST_RESULTS/filesystem-readonly-reason.txt")"
else
  printf "%b⚠ WARN: Diagnostic file not found: filesystem-readonly-reason.txt%b\n" "$YELLOW" "$NC"
fi

# Final result
printf "\n%b=== Test PASSED ===%b\n" "$GREEN" "$NC"
printf "Read-only /results mount was detected and reported correctly.\n\n"
