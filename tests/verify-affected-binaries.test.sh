#!/usr/bin/env bash
set -euo pipefail

# Runtime smoke test for compiled entry points that depend on shared helpers.
# Run `npm run build` before this test so dist/ reflects the current sources.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

for entry_point in pi-event-filter.js job-scheduler.js kaseki-api-routes.js; do
  if [ ! -f "$ROOT_DIR/dist/$entry_point" ]; then
    printf 'FAIL: missing compiled entry point dist/%s; run npm run build first\n' "$entry_point" >&2
    exit 1
  fi
done

# Executing pi-event-filter exercises its event timestamp helper through the
# compiled CLI's observable filtered-event and summary outputs.
printf '%s\n' '{"type":"session_start","timestamp":"2026-06-04T12:00:00.000Z"}' > "$TMP_DIR/events.jsonl"
node "$ROOT_DIR/dist/pi-event-filter.js" \
  "$TMP_DIR/events.jsonl" \
  "$TMP_DIR/filtered.jsonl" \
  "$TMP_DIR/summary.json"

node --input-type=module - \
  "$TMP_DIR/filtered.jsonl" \
  "$TMP_DIR/summary.json" \
  "$ROOT_DIR/dist/job-scheduler.js" \
  "$ROOT_DIR/dist/kaseki-api-routes.js" <<'EOF_NODE'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const [filteredPath, summaryPath, schedulerPath, routesPath] = process.argv.slice(2);

const filtered = fs.readFileSync(filteredPath, 'utf8').trim();
assert.equal(
  filtered,
  '{"type":"session_start","timestamp":"2026-06-04T12:00:00.000Z"}',
  'pi-event-filter should preserve the runtime event',
);

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
assert.equal(
  summary.first_event_at,
  '2026-06-04T12:00:00.000Z',
  'pi-event-filter should use the timestamp helper when building its summary',
);

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
const classification = routesModule.classifyDockerFailure('Cannot connect to the Docker daemon');
assert.match(
  classification.detail,
  /unreachable/,
  'kaseki-api-routes should expose a working subprocess-helper function',
);
EOF_NODE

printf '✓ compiled entry points and their helper modules load and run successfully\n'
