#!/bin/bash
# dry-run-allowlist.sh - Preview which files would be restored for a given allowlist
# Usage: ./scripts/dry-run-allowlist.sh [--changed-files <file>] [--allowlist <pattern>]
# Example: ./scripts/dry-run-allowlist.sh --changed-files /results/kaseki-1/changed-files.txt

set -e

CHANGED_FILES=""
ALLOWLIST="${KASEKI_CHANGED_FILES_ALLOWLIST:-src/lib/parser.ts tests/parser.validation.ts}"
RESULT_DIR=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --changed-files)
      CHANGED_FILES="$2"
      shift 2
      ;;
    --allowlist)
      ALLOWLIST="$2"
      shift 2
      ;;
    --result-dir|--results)
      RESULT_DIR="$2"
      shift 2
      ;;
    --help)
      cat << 'EOF'
dry-run-allowlist.sh - Preview which files would be restored for a given allowlist

Usage: ./scripts/dry-run-allowlist.sh [OPTIONS]

Options:
  --changed-files <file>   Path to changed-files.txt (default: /results/changed-files.txt)
  --allowlist <pattern>    Allowlist pattern (default: from KASEKI_CHANGED_FILES_ALLOWLIST)
  --result-dir <dir>       Result directory (for convenience, auto-finds changed-files.txt)
  --help                   Show this help message

Examples:
  # Preview current results
  ./scripts/dry-run-allowlist.sh --result-dir /results/kaseki-1

  # Test a custom allowlist
  ./scripts/dry-run-allowlist.sh --allowlist "src/lib/** tests/**" --changed-files /results/kaseki-1/changed-files.txt

  # Using template
  ./scripts/dry-run-allowlist.sh --allowlist "$(cat templates/allowlist-ui-component.txt | tr '\n' ' ')"

EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# Determine changed-files location
if [ -z "$CHANGED_FILES" ]; then
  if [ -n "$RESULT_DIR" ]; then
    CHANGED_FILES="$RESULT_DIR/changed-files.txt"
  else
    CHANGED_FILES="${KASEKI_RESULTS:-/results}/changed-files.txt"
  fi
fi

if [ ! -f "$CHANGED_FILES" ]; then
  echo "❌ changed-files.txt not found: $CHANGED_FILES" >&2
  exit 1
fi

# Source the allowlist helper
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ALLOWLIST_HELPER="$SCRIPT_DIR/allowlist-helper.sh"
if [ ! -r "$ALLOWLIST_HELPER" ]; then
  echo "❌ allowlist-helper.sh not found: $ALLOWLIST_HELPER" >&2
  exit 1
fi

source "$ALLOWLIST_HELPER"

# Build regex from allowlist
allowlist_regex="$(build_allowlist_regex "$ALLOWLIST")"

if [ -z "$allowlist_regex" ]; then
  echo "⚠️  Empty allowlist — all files would be restored"
  cat "$CHANGED_FILES"
  exit 0
fi

# Analyze files
declare -a would_restore
declare -a would_keep
total=0

while IFS= read -r file || [ -n "$file" ]; do
  [ -z "$file" ] && continue
  total=$((total + 1))
  
  if printf '%s\n' "$file" | grep -Eq "^(${allowlist_regex})$"; then
    would_keep+=("$file")
  else
    would_restore+=("$file")
  fi
done < "$CHANGED_FILES"

# Print results
{
  printf '# Dry-Run Allowlist Preview\n\n'
  printf 'Allowlist: `%s`\n' "$ALLOWLIST"
  printf 'Changed files: %s\n\n' "$CHANGED_FILES"
  
  printf '## Summary\n\n'
  printf '- **Total Files:** %d\n' "$total"
  printf '- **Would Keep (matched):** %d\n' "${#would_keep[@]}"
  printf '- **Would Restore (outside):** %d\n' "${#would_restore[@]}"
  
  if [ "$total" -gt 0 ]; then
    coverage=$((${#would_keep[@]} * 100 / total))
    printf '- **Coverage:** %d%%\n\n' "$coverage"
  else
    printf '\n'
  fi
  
  if [ "${#would_restore[@]}" -gt 0 ]; then
    printf '## Would Be Restored\n\n'
    printf 'These files would NOT pass through to validation:\n\n'
    for file in "${would_restore[@]}"; do
      printf '- `%s`\n' "$file"
    done
    printf '\n'
  fi
  
  if [ "${#would_keep[@]}" -gt 0 ]; then
    printf '## Would Be Kept\n\n'
    printf 'These files would pass through to validation:\n\n'
    for file in "${would_keep[@]}"; do
      printf '- `%s`\n' "$file"
    done
    printf '\n'
  fi
  
  printf '## Recommendations\n\n'
  if [ "${#would_restore[@]}" -gt 0 ] && [ "${#would_keep[@]}" -eq 0 ]; then
    printf '⚠️  **ALL files would be restored** — allowlist is too narrow or wrong.\n'
  elif [ "${#would_restore[@]}" -gt 0 ] && [ "$coverage" -lt 30 ]; then
    printf '⚠️  **Low coverage (%d%%)** — consider:\n' "$coverage"
    printf '1. Expanding the allowlist patterns\n'
    printf '2. Using a broader template (e.g., `allowlist-utility`)\n'
    printf '3. Reviewing the TASK_PROMPT for clarity\n'
  elif [ "${#would_restore[@]}" -eq 0 ]; then
    printf '✅ **Perfect coverage** — all files match the allowlist.\n'
  else
    printf '✅ **Good coverage** — allowlist looks reasonable.\n'
  fi
} | tee /tmp/dry-run-allowlist-preview.md

echo ""
echo "Preview saved to: /tmp/dry-run-allowlist-preview.md"
