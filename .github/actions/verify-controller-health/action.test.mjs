import assert from 'node:assert/strict';
import test from 'node:test';

import { parseHealthResponse } from './verify-controller-health.mjs';

test('accepts the current Kaseki health status', () => {
  assert.equal(parseHealthResponse('{"status":"ok"}'), 'ok');
});

test('accepts the legacy health status during deployment rollout', () => {
  assert.equal(parseHealthResponse('{"status":"healthy"}'), 'healthy');
});

test('rejects a non-live or unexpected health status', () => {
  for (const status of ['ready', 'degraded', 'not_ready', '']) {
    assert.throws(() => parseHealthResponse(JSON.stringify({ status })));
  }
});

test('rejects malformed JSON and responses without a string status', () => {
  for (const response of ['{', 'null', '[]', '{}', '{"status":1}']) {
    assert.throws(() => parseHealthResponse(response));
  }
});
