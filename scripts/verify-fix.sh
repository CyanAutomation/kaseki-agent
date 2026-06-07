#!/bin/bash
cd /workspaces/kaseki-agent || exit
echo "Building..."
npm run build > /tmp/build.log 2>&1
BUILD_EXIT=$?
echo "Build exit code: $BUILD_EXIT"

if [ $BUILD_EXIT -ne 0 ]; then
  echo "Build failed:"
  tail -50 /tmp/build.log
  exit 1
fi

echo ""
echo "Running tests..."
npm test > /tmp/test-run.log 2>&1
TEST_EXIT=$?
echo "Test exit code: $TEST_EXIT"

# Show the last 150 lines of test output
echo ""
echo "Test output (last 150 lines):"
tail -150 /tmp/test-run.log

exit $TEST_EXIT
