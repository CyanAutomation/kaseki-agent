#!/bin/bash
# Configure GitHub labels for kaseki-agent
# This script uses GitHub CLI (gh) to create standard labels

# Requires: gh CLI with authentication
# Install: https://cli.github.com/
# Login: gh auth login

set -e

REPO="CyanAutomation/kaseki-agent"

echo "🏷️  Creating GitHub labels for $REPO..."

# Define labels: name, color, description
declare -A labels=(
  ["bug"]="d73a49|Something is broken"
  ["feature"]="0075ca|New capability or enhancement"
  ["security"]="ae2a23|Security vulnerability or hardening"
  ["documentation"]="0e8a16|Documentation, guides, or comments"
  ["infrastructure"]="8f1a9a|Docker, CI/CD, operations, or deployment"
  ["good first issue"]="7057ff|Good for newcomers or new contributors"
  ["help wanted"]="fbca04|Need community input or assistance"
  ["stale"]="cccccc|Inactive or abandoned issue"
  ["testing"]="e99695|Tests, test coverage, or test improvements"
  ["performance"]="fbcf3f|Performance optimization or benchmarking"
  ["dependencies"]="0366d6|Dependency updates or version management"
)

for label in "${!labels[@]}"; do
  IFS='|' read -r color description <<< "${labels[$label]}"
  echo "  Creating label: $label (color: $color)"
  gh label create "$label" \
    --repo "$REPO" \
    --color "$color" \
    --description "$description" \
    --force 2>/dev/null || true
done

echo "✅ Labels created successfully!"
echo ""
echo "Verify labels at: https://github.com/$REPO/labels"
