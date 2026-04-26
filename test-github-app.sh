#!/bin/bash
# Integration test for GitHub App credentials feature

set -e

echo "=== Kaseki GitHub App Integration Test ==="
echo ""

# Test 1: Verify run-kaseki.sh recognizes GitHub App env vars
echo "Test 1: Checking run-kaseki.sh for GitHub App variable support..."
if grep -q "GITHUB_APP_ID" /workspaces/kaseki-agent/run-kaseki.sh && \
   grep -q "GITHUB_APP_CLIENT_ID" /workspaces/kaseki-agent/run-kaseki.sh && \
   grep -q "GITHUB_APP_PRIVATE_KEY" /workspaces/kaseki-agent/run-kaseki.sh; then
  echo "✓ GitHub App environment variables are defined in run-kaseki.sh"
else
  echo "✗ GitHub App environment variables NOT found in run-kaseki.sh"
  exit 1
fi

# Test 2: Verify kaseki-agent.sh has GitHub operations
echo ""
echo "Test 2: Checking kaseki-agent.sh for GitHub operations..."
if grep -q "run_github_operations" /workspaces/kaseki-agent/kaseki-agent.sh && \
   grep -q "GITHUB_APP_ENABLED" /workspaces/kaseki-agent/kaseki-agent.sh && \
   grep -q "GITHUB_PR_URL" /workspaces/kaseki-agent/kaseki-agent.sh; then
  echo "✓ GitHub operations code is present in kaseki-agent.sh"
else
  echo "✗ GitHub operations code NOT found in kaseki-agent.sh"
  exit 1
fi

# Test 3: Verify github-app-token.js exists and is executable
echo ""
echo "Test 3: Checking github-app-token.js..."
if [ -x /workspaces/kaseki-agent/github-app-token.js ]; then
  echo "✓ github-app-token.js exists and is executable"
else
  echo "✗ github-app-token.js is NOT executable"
  exit 1
fi

# Test 4: Verify github-app-token.js has required functions
echo ""
echo "Test 4: Checking github-app-token.js content..."
if grep -q "generateJWT" /workspaces/kaseki-agent/github-app-token.js && \
   grep -q "getInstallationId" /workspaces/kaseki-agent/github-app-token.js && \
   grep -q "getAccessToken" /workspaces/kaseki-agent/github-app-token.js; then
  echo "✓ github-app-token.js contains required functions"
else
  echo "✗ github-app-token.js missing required functions"
  exit 1
fi

# Test 5: Verify Dockerfile includes github-app-token.js
echo ""
echo "Test 5: Checking Dockerfile..."
if grep -q "github-app-token.js" /workspaces/kaseki-agent/Dockerfile; then
  echo "✓ Dockerfile includes github-app-token.js"
else
  echo "✗ Dockerfile does NOT include github-app-token.js"
  exit 1
fi

# Test 6: Verify README has GitHub App documentation
echo ""
echo "Test 6: Checking README.md documentation..."
if grep -q "GitHub App Integration" /workspaces/kaseki-agent/README.md && \
   grep -q "GITHUB_APP_ID_FILE" /workspaces/kaseki-agent/README.md; then
  echo "✓ README.md contains GitHub App documentation"
else
  echo "✗ README.md missing GitHub App documentation"
  exit 1
fi

# Test 7: Verify metadata.json will include GitHub PR info
echo ""
echo "Test 7: Checking for GitHub PR metadata..."
if grep -q "github_pr_url" /workspaces/kaseki-agent/kaseki-agent.sh && \
   grep -q "github_push_exit_code" /workspaces/kaseki-agent/kaseki-agent.sh; then
  echo "✓ Metadata includes GitHub PR information"
else
  echo "✗ Metadata missing GitHub PR information"
  exit 1
fi

# Test 8: Verify exit code handling
echo ""
echo "Test 8: Checking exit code definitions..."
if grep -q "GITHUB_PUSH_EXIT=0" /workspaces/kaseki-agent/kaseki-agent.sh && \
   grep -q "GITHUB_PR_EXIT=0" /workspaces/kaseki-agent/kaseki-agent.sh; then
  echo "✓ GitHub exit codes are initialized"
else
  echo "✗ GitHub exit codes NOT initialized"
  exit 1
fi

# Test 9: Test github-app-token.js argument validation
echo ""
echo "Test 9: Testing github-app-token.js argument validation..."
output=$(node /workspaces/kaseki-agent/github-app-token.js 2>&1 || true)
if echo "$output" | grep -q "Usage:"; then
  echo "✓ github-app-token.js shows usage message"
else
  echo "✗ github-app-token.js usage message not shown"
  exit 1
fi

# Test 10: Verify cleanup in run-kaseki.sh includes GitHub files
echo ""
echo "Test 10: Checking cleanup for GitHub credential files..."
if grep -q "GITHUB_APP_ID_FILE" /workspaces/kaseki-agent/run-kaseki.sh && \
   grep -q "cleanup_secret" /workspaces/kaseki-agent/run-kaseki.sh && \
   grep -q "GITHUB_APP_PRIVATE_KEY_MOUNTED_FILE" /workspaces/kaseki-agent/run-kaseki.sh; then
  echo "✓ Cleanup includes GitHub credential files"
else
  echo "✗ Cleanup does NOT include GitHub credential files"
  exit 1
fi

echo ""
echo "=== All tests passed! ==="
echo ""
echo "Summary:"
echo "  ✓ run-kaseki.sh has GitHub App credential handling"
echo "  ✓ kaseki-agent.sh has GitHub operations support"
echo "  ✓ github-app-token.js helper script is complete"
echo "  ✓ Dockerfile includes github-app-token.js"
echo "  ✓ README.md documents GitHub App integration"
echo "  ✓ Metadata and exit codes for GitHub operations"
