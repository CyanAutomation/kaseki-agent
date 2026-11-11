#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kaseki-caveman-extension.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

KASEKI_APP_ROOT="$ROOT_DIR" \
KASEKI_RESULTS_DIR="$TMP_DIR/results" \
LLM_GATEWAY_URL="https://gateway.example.test/v1" \
SENKU_KASEKI_API_TOKEN="synthetic-senku-kaseki-token-value-1234567890" \
SENKU_URL="https://senku.example.test" \
KASEKI_CAVEMAN=1 \
KASEKI_CAVEMAN_LEVEL=2 \
KASEKI_CAVEMAN_ROUTER=jev \
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const extensionPath = pathToFileURL(`${process.env.KASEKI_APP_ROOT}/.pi-extensions.js`).href;
const extension = (await import(extensionPath)).default;
let providerRegistration;
let toolResultHandler;
const requests = [];
globalThis.fetch = async (url, init) => {
  requests.push({ url: String(url), init });
  const answers = {
    disposition: {
      type: 'choice', choice: 'preserve', confidence: 0.99,
      probabilities: { preserve: 1, condense: 0, discard: 0 },
    },
  };
  return new Response(JSON.stringify({
    schemaVersion: '1', requestId: 'dec-router-test', status: 'completed',
    profileId: 'kaseki_context_routing_v1', profileVersion: '1', provider: 'jev',
    model: 'typesafe/jev-test', answers, result: answers, durationMs: 1, attemptCount: 1,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

await extension({
  registerProvider(name, config) {
    providerRegistration = { name, config };
  },
  on(event, handler) {
    if (event === 'tool_result') toolResultHandler = handler;
  },
});

assert.equal(providerRegistration?.name, 'gateway', 'gateway provider stays registered');
assert.equal(typeof toolResultHandler, 'function', 'JEV router registers Pi tool_result hook');
const output = Array.from({ length: 800 }, (_, index) => `unique result line ${index}`).join('\n');
await toolResultHandler({
  toolName: 'bash', toolCallId: 'tool-1', input: { command: 'npm test' }, isError: false,
  content: [{ type: 'text', text: output }],
});
assert.equal(requests.length, 1, 'router makes one Senku profile request');
assert.equal(requests[0].url, 'https://senku.example.test/v1/profiles/kaseki_context_routing_v1/evaluate');
const request = JSON.parse(String(requests[0].init.body));
assert.equal(request.input.mode, 'semantic_context');
assert.equal(request.input.evidence.toolName, 'bash');
assert.equal(JSON.stringify(request).includes('unique result line'), false, 'raw tool output is not sent to Senku');
console.log('✓ Gateway extension routes bounded Caveman metadata through the Senku profile client');
NODE
