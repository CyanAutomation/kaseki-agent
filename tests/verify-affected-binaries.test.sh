#!/usr/bin/env bash
set -euo pipefail

# Post-build smoke test for compiled entry points that depend on shared helpers.
# This intentionally is not a source-level behavior test. Run `npm run build`
# immediately before this test so failures indicate broken compiled entry points
# rather than stale dist/ output.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

for entry_point in pi-event-filter.js job-scheduler.js kaseki-api-routes.js; do
  if [ ! -f "$ROOT_DIR/dist/$entry_point" ]; then
    printf 'FAIL: missing compiled entry point dist/%s; run npm run build first\n' "$entry_point" >&2
    exit 1
  fi
done

printf '%s\n' '{}' > "$TMP_DIR/events.jsonl"
node "$ROOT_DIR/dist/pi-event-filter.js" \
  "$TMP_DIR/events.jsonl" \
  "$TMP_DIR/filtered.jsonl" \
  "$TMP_DIR/summary.json"

node --input-type=module - \
  "$ROOT_DIR/dist/job-scheduler.js" \
  "$ROOT_DIR/dist/kaseki-api-routes.js" <<'EOF_NODE'
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const [schedulerPath, routesPath] = process.argv.slice(2);

const schedulerModule = await import(pathToFileURL(schedulerPath));
assert.equal(
  typeof schedulerModule.JobScheduler,
  'function',
  'job-scheduler should load with its runtime helper dependencies',
);

const routesModule = await import(pathToFileURL(routesPath));
assert.equal(
  typeof routesModule.classifyDockerFailure,
  'function',
  'kaseki-api-routes should export classifyDockerFailure',
);
EOF_NODE

printf '✓ post-build compiled entry points load and execute successfully\n'
