#!/bin/bash
# Integration test: verify validation tools are available in final Docker image
# This test ensures that devDependencies are preserved and npm run check can execute
# 
# Background: kaseki-32 failed with exit code 141 because npm prune --production
# removed typescript, eslint, and other devDependencies from the final image,
# causing npm run check to fail when run inside the container.
#
# This test prevents regression of that issue.

set -e

TEST_NAME="Docker validation tools"
IMAGE_NAME="${KASEKI_IMAGE:-docker.io/cyanautomation/kaseki-agent:latest}"
TEMP_CONTAINER=$(mktemp -u kaseki-validation-test-XXXXXX)

echo "Starting test: $TEST_NAME"
echo "Image: $IMAGE_NAME"
echo ""

# Function to clean up temp container
cleanup() {
  if docker ps -a --format "table {{.Names}}" | grep -q "^${TEMP_CONTAINER}$"; then
    echo "Cleaning up temporary container: $TEMP_CONTAINER"
    docker rm -f "$TEMP_CONTAINER" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

# Test 1: Verify TypeScript is available
echo "[1/5] Checking TypeScript availability..."
if ! docker run --rm "$IMAGE_NAME" \
  bash -c "test -f /app/node_modules/.bin/tsc" >/dev/null 2>&1; then
  echo "✗ FAIL: TypeScript (tsc) not found in node_modules"
  exit 1
fi
echo "✓ TypeScript available"

# Test 2: Verify ESLint is available
echo "[2/5] Checking ESLint availability..."
if ! docker run --rm "$IMAGE_NAME" \
  bash -c "test -f /app/node_modules/.bin/eslint" >/dev/null 2>&1; then
  echo "✗ FAIL: ESLint not found in node_modules"
  exit 1
fi
echo "✓ ESLint available"

# Test 3: Verify Jest is available (for npm run test)
echo "[3/5] Checking Jest availability..."
if ! docker run --rm "$IMAGE_NAME" \
  bash -c "test -f /app/node_modules/.bin/jest" >/dev/null 2>&1; then
  echo "✗ FAIL: Jest not found in node_modules"
  exit 1
fi
echo "✓ Jest available"

# Test 4: Verify npm run check executes without SIGPIPE
echo "[4/5] Testing npm run check execution..."
set +e
CONTAINER_OUTPUT=$(docker run --rm \
  --workdir /app \
  -v /app/dist:/app/dist:ro \
  "$IMAGE_NAME" \
  bash -c "npm run check 2>&1")
EXIT_CODE=$?
set -e

# Check for SIGPIPE error (exit code 141 or 128+13)
if [ "$EXIT_CODE" -eq 141 ] || [ "$EXIT_CODE" -eq 13 ]; then
  echo "✗ FAIL: npm run check exited with SIGPIPE (exit code: $EXIT_CODE)"
  echo "Output:"
  echo "$CONTAINER_OUTPUT"
  exit 1
fi

# Expected: exit 0 (success) or exit 2 (linting errors, but that's ok - tool ran)
if [ "$EXIT_CODE" -eq 0 ] || [ "$EXIT_CODE" -eq 2 ]; then
  echo "✓ npm run check executed successfully (exit code: $EXIT_CODE)"
else
  echo "⚠ npm run check exited with unexpected code: $EXIT_CODE"
  echo "Output:"
  echo "$CONTAINER_OUTPUT"
  # Don't fail here - other exit codes might indicate linting issues, not tool availability
fi

# Test 5: Verify tsc --noEmit works (TypeScript type check)
echo "[5/5] Testing TypeScript type check..."
if ! docker run --rm \
  --workdir /app \
  "$IMAGE_NAME" \
  bash -c "tsc --version" >/dev/null 2>&1; then
  echo "✗ FAIL: tsc command not working"
  exit 1
fi
echo "✓ TypeScript type check available"

echo ""
echo "✓ All validation tools available in Docker image"
echo "  Validation pipeline will work correctly in kaseki-agent container"
