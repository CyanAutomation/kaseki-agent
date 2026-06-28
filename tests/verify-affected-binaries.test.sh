#!/usr/bin/env bash
set -euo pipefail

# Packaging verification for compiled entry points that depend on shared helpers.
# This intentionally is not behavioral coverage. Run `npm run build` before this
# post-build smoke so failures indicate missing or unloadable package artifacts.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for entry_point in pi-event-filter.js job-scheduler.js kaseki-api-routes.js; do
  if [ ! -f "$ROOT_DIR/dist/$entry_point" ]; then
    printf 'FAIL: missing compiled entry point dist/%s; run npm run build first\n' "$entry_point" >&2
    exit 1
  fi
done

node --input-type=module - \
  "$ROOT_DIR/dist/pi-event-filter.js" \
  "$ROOT_DIR/dist/job-scheduler.js" \
  "$ROOT_DIR/dist/kaseki-api-routes.js" <<'EOF_NODE'
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const [filterPath, schedulerPath, routesPath] = process.argv.slice(2);

const filterModule = await import(pathToFileURL(filterPath));
assert.equal(typeof filterModule.runPiEventFilter, 'function', 'pi-event-filter should export runPiEventFilter');

const schedulerModule = await import(pathToFileURL(schedulerPath));
assert.equal(typeof schedulerModule.JobScheduler, 'function', 'job-scheduler should export JobScheduler');

const routesModule = await import(pathToFileURL(routesPath));
assert.equal(typeof routesModule.createApiRouter, 'function', 'kaseki-api-routes should export createApiRouter');
assert.equal(typeof routesModule.classifyDockerFailure, 'function', 'kaseki-api-routes should export classifyDockerFailure');
EOF_NODE

printf '✓ packaging verification: compiled entry points exist and load successfully\n'
