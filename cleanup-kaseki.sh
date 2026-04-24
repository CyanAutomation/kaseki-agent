#!/usr/bin/env bash
set -euo pipefail

ROOT="${KASEKI_ROOT:-/agents}"
RUNS="$ROOT/kaseki-runs"
OLDER_THAN_DAYS="${KASEKI_CLEANUP_DAYS:-1}"

if [ "${1:-}" = "--help" ]; then
  cat <<HELP
Usage: KASEKI_CLEANUP_DAYS=1 $0

Deletes /agents/kaseki-runs/kaseki-N workspaces older than the configured age.
Results under /agents/kaseki-results are preserved.
HELP
  exit 0
fi

if [ ! -d "$RUNS" ]; then
  echo "No Kaseki runs directory found: $RUNS"
  exit 0
fi

find "$RUNS" -mindepth 1 -maxdepth 1 -type d -name 'kaseki-[0-9]*' -mtime +"$OLDER_THAN_DAYS" -print -exec rm -rf {} +
