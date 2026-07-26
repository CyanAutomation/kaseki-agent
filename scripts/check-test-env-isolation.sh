#!/usr/bin/env bash
# scripts/check-test-env-isolation.sh
#
# Detects potential environment variable pollution in tests.
# Looks for tests that delete some but not all CloudFlare metadata variables.
#
# Exit codes:
#   0 - No issues found
#   1 - Potential incomplete cleanup detected
#   2 - Script error

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🔍 Checking for incomplete environment variable cleanup in tests..."
echo ""

# CloudFlare metadata variables that should be cleaned up together
REQUIRED_VARS=(
  "KASEKI_INSTANCE"
  "KASEKI_INFERENCE_PHASE"
  "KASEKI_INFERENCE_ATTEMPT"
  "KASEKI_INFERENCE_REQUEST_ID"
)

# Find test files that delete KASEKI_INSTANCE
files_with_deletes=$(grep -r "delete process.env.KASEKI_INSTANCE" \
  "$PROJECT_ROOT/tests" "$PROJECT_ROOT/test" \
  --include="*.test.ts" --include="*.test.js" \
  -l 2>/dev/null || true)

if [[ -z "$files_with_deletes" ]]; then
  echo "✅ No test files delete KASEKI_INSTANCE"
  exit 0
fi

exit_code=0

while IFS= read -r file; do
  # Skip if file uses withIsolatedEnv helper
  if grep -q "withIsolatedEnv" "$file"; then
    echo "✅ $file uses withIsolatedEnv helper"
    continue
  fi

  # Check if all required vars are deleted
  missing_vars=()
  for var in "${REQUIRED_VARS[@]}"; do
    if ! grep -q "delete process.env.$var" "$file"; then
      missing_vars+=("$var")
    fi
  done

  if [[ ${#missing_vars[@]} -gt 0 ]]; then
    echo "❌ $file"
    echo "   Deletes KASEKI_INSTANCE but missing cleanup for:"
    for var in "${missing_vars[@]}"; do
      echo "     - $var"
    done
    echo "   Solution: Use withIsolatedEnvSync(CLOUDFLARE_METADATA_ENV_VARS, ...) helper"
    echo "   Or manually delete all four CloudFlare metadata variables"
    echo ""
    exit_code=1
  else
    echo "✅ $file"
  fi
done <<< "$files_with_deletes"

if [[ $exit_code -eq 0 ]]; then
  echo ""
  echo "✅ All tests properly clean up CloudFlare metadata environment variables"
else
  echo ""
  echo "❌ Found tests with incomplete environment variable cleanup"
  echo ""
  echo "See docs/TEST_ISOLATION_BEST_PRACTICES.md for guidance"
fi

exit $exit_code
