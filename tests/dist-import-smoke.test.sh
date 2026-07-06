#!/usr/bin/env bash
# Post-build packaging smoke test. Requires `npm run build` to have produced dist/ first.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

for entry_point in pi-event-filter.js job-scheduler.js kaseki-api-routes.js; do
  if [ ! -f "$ROOT_DIR/dist/$entry_point" ]; then
    printf 'FAIL: missing compiled entry point dist/%s; run npm run build before this post-build packaging smoke test\n' "$entry_point" >&2
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
const schedulerModule = await import(pathToFileURL(schedulerPath));
const routesModule = await import(pathToFileURL(routesPath));

assert.equal(typeof filterModule.runPiEventFilter, 'function');
assert.equal(typeof schedulerModule.JobScheduler, 'function');
assert.equal(typeof routesModule.createApiRouter, 'function');
assert.equal(typeof routesModule.classifyDockerFailure, 'function');
EOF_NODE

printf '\n✓ Post-build dist import smoke assertions passed.\n'
