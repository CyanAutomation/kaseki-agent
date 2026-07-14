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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import express from 'express';

const [filterPath, schedulerPath, routesPath] = process.argv.slice(2);
const tempRoots = [];

function makeTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

async function withCleanup(fn) {
  try {
    await fn();
  } finally {
    for (const dir of tempRoots.reverse()) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

function createConfig(resultsDir) {
  return {
    port: 0,
    workspaceDir: path.join(resultsDir, 'workspace'),
    resultsDir,
    maxConcurrentRuns: 1,
    runTimeoutMs: 300_000,
    apiKeys: [],
    defaultTaskMode: 'patch',
    maxDiffBytes: 400_000,
    agentTimeoutSeconds: 300,
    logLevel: 'info',
    artifactCacheMaxEntries: 5,
    artifactCacheTtlMs: 60_000,
    artifactCacheMaxFileBytes: 1024 * 1024,
  };
}

function createMockWebhookManager() {
  return {
    isHealthy: () => true,
    enqueueWebhook: () => {},
    shutdown: async () => {},
  };
}

function createMockIdempotencyStore() {
  return {
    get: () => undefined,
    set: () => {},
    delete: () => false,
    clear: () => {},
  };
}

function createMockPreFlightValidator() {
  return {
    validate: async () => ({ valid: true, warnings: [] }),
  };
}

await withCleanup(async () => {
  const filterModule = await import(pathToFileURL(filterPath));
  const schedulerModule = await import(pathToFileURL(schedulerPath));
  const routesModule = await import(pathToFileURL(routesPath));

  const filterDir = makeTempDir('kaseki-dist-filter-');
  const inputPath = path.join(filterDir, 'events.raw.jsonl');
  const filteredPath = path.join(filterDir, 'events.filtered.jsonl');
  const summaryPath = path.join(filterDir, 'summary.json');
  fs.writeFileSync(inputPath, [
    JSON.stringify({ type: 'agent_start', timestamp: '2026-07-14T00:00:00.000Z', message: { model: 'gpt-test', api: 'responses' } }),
    JSON.stringify({ type: 'assistant_delta', assistantMessageEvent: { type: 'thinking_delta', partial: { content: [{ type: 'thinking', text: 'hidden reasoning' }] } } }),
    JSON.stringify({ type: 'tool_execution_start', timestamp: '2026-07-14T00:00:01.000Z', tool_name: 'shell' }),
    'not-json',
  ].join('\n') + '\n');

  await filterModule.runPiEventFilter(inputPath, filteredPath, summaryPath);
  const filteredContent = fs.readFileSync(filteredPath, 'utf8').trim();
  const filteredEvents = filteredContent ? filteredContent.split('\n').map((line) => JSON.parse(line)) : [];
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  assert.equal(filteredEvents.length, 2, 'runPiEventFilter should drop thinking events and keep visible events');
  assert.deepEqual(filteredEvents.map((event) => event.type), ['agent_start', 'tool_execution_start']);
  assert.equal(summary.invalid_json_lines, 1, 'runPiEventFilter should count invalid JSON lines');
  assert.equal(summary.tool_start_count, 1, 'runPiEventFilter should aggregate tool starts');
  assert.equal(summary.selected_model, 'gpt-test', 'runPiEventFilter should summarize the selected model');

  const schedulerDir = makeTempDir('kaseki-dist-scheduler-');
  const scheduler = new schedulerModule.JobScheduler(createConfig(schedulerDir), createMockWebhookManager());
  await scheduler.ready();
  assert.deepEqual(
    scheduler.getQueueStatus(),
    { pending: 0, running: 0, maxConcurrent: 1 },
    'JobScheduler should report an empty initialized queue',
  );
  assert.deepEqual(
    scheduler.getReadiness(),
    { ready: true, reasons: [] },
    'JobScheduler should report ready with writable results and healthy webhooks',
  );
  scheduler.shutdown();

  const dockerFailure = routesModule.classifyDockerFailure('Cannot connect to the Docker daemon at unix:///var/run/docker.sock');
  assert.equal(dockerFailure.detail, 'Docker daemon is unreachable from the API process.');
  assert.match(dockerFailure.remediation, /Docker daemon is running/);

  const app = express();
  const routeConfig = createConfig(makeTempDir('kaseki-dist-routes-'));
  const routeScheduler = {
    getQueueStatus: () => ({ pending: 0, running: 0, maxConcurrent: 1 }),
    getReadiness: () => ({ ready: true, reasons: [] }),
    getJob: () => undefined,
    submitJob: async () => { throw new Error('submitJob should not be called by /health'); },
    listJobs: () => [],
    cancelJob: () => undefined,
  };
  app.use('/api', routesModule.createApiRouter(
    routeScheduler,
    routeConfig,
    createMockIdempotencyStore(),
    createMockPreFlightValidator(),
  ));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    const body = await response.json();
    assert.equal(response.status, 200, 'createApiRouter should serve unauthenticated health checks');
    assert.equal(body.status, 'healthy', 'createApiRouter should expose healthy status from scheduler readiness');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
EOF_NODE

printf '\n✓ Post-build dist behavior smoke assertions passed.\n'
