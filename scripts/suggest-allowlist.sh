#!/bin/bash
# suggest-allowlist.sh - Suggest allowlist patterns based on a completed kaseki run
# Usage: ./scripts/suggest-allowlist.sh <results-dir>
# Example: ./scripts/suggest-allowlist.sh /agents/kaseki-results/kaseki-1

set -e

RESULTS_DIR="${1:-.}"

if [ ! -f "$RESULTS_DIR/changed-files.txt" ]; then
  echo "❌ changed-files.txt not found in $RESULTS_DIR" >&2
  exit 1
fi

# Count files by directory pattern
declare -A dir_counts
declare -a patterns

while IFS= read -r file || [ -n "$file" ]; do
  [ -z "$file" ] && continue
  
  # Extract directory pattern (e.g., src/lib -> src/lib, src -> src)
  dir=$(dirname "$file")
  dir=${dir#./}  # Remove leading ./
  
  # Increment counter
  dir_counts["$dir"]=$((${dir_counts["$dir"]:-0} + 1))
  
  # Also track top-level directory
  top_dir=$(echo "$dir" | cut -d'/' -f1)
  dir_counts["$top_dir/**"]=$((${dir_counts["$top_dir/**"]:-0} + 1))
done < "$RESULTS_DIR/changed-files.txt"

# Sort by count (descending) and print suggestions
{
  printf '# Suggested allowlist based on: %s\n\n' "$(basename "$RESULTS_DIR")"
  printf '## Option 1: Specific directories (most restrictive)\n'
  printf 'Use this to be more specific about which directories are allowed:\n\n'
  printf '```bash\nKASEKI_CHANGED_FILES_ALLOWLIST="\n'
  
  for dir in "${!dir_counts[@]}"; do
    printf '  %s\n' "$dir"
  done | sort | head -10
  
  printf '"\n```\n\n'
  
  printf '## Option 2: Top-level directories (less restrictive)\n'
  printf 'Use this to allow entire directory trees:\n\n'
  printf '```bash\nKASEKI_CHANGED_FILES_ALLOWLIST="\n'
  
  for dir in "${!dir_counts[@]}"; do
    if [[ "$dir" == *"/**" ]]; then
      printf '  %s\n' "$dir"
    fi
  done | sort | uniq
  
  printf '"\n```\n\n'
  
  printf '## Statistics\n'
  printf '- Total files changed: %s\n' "$(wc -l < "$RESULTS_DIR/changed-files.txt")"
  printf '- Unique directories: %s\n' "${#dir_counts[@]}"
  printf '\n## All changed files\n\n'
  printf '```\n'
  sort "$RESULTS_DIR/changed-files.txt"
  printf '```\n'
} > "$RESULTS_DIR/allowlist-suggestions.md"

echo "✅ Suggestions written to: $RESULTS_DIR/allowlist-suggestions.md"
cat "$RESULTS_DIR/allowlist-suggestions.md"
