#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kaseki-caveman-extension.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

KASEKI_APP_ROOT="$ROOT_DIR" \
KASEKI_RESULTS_DIR="$TMP_DIR/results" \
LLM_GATEWAY_URL="https://gateway.example.test/v1" \
OPENROUTER_API_KEY="unit-test-placeholder" \
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
console.log('✓ Gateway extension installs JEV Caveman router when decision credentials are available');
NODE
