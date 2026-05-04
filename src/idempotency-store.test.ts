import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IdempotencyStore } from './idempotency-store';
import { RunResponse } from './kaseki-api-types';

describe('IdempotencyStore persistence', () => {
  let resultsDir: string;

  beforeEach(() => {
    resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-idempotency-'));
  });

  afterEach(() => {
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  test('restores exact fulfilled response payload across restart', () => {
    const key = 'a-key';
    const fingerprint = 'fp-1';
    const response: RunResponse = {
      id: 'kaseki-42',
      status: 'queued',
      createdAt: '2026-01-01T00:00:00.000Z',
      requestId: '11111111-1111-4111-8111-111111111111',
      correlationId: '22222222-2222-4222-8222-222222222222',
      error: 'transient warning',
    };

    const store1 = new IdempotencyStore(resultsDir, 24);
    expect(store1.claimOrGet(key, fingerprint)).toEqual({ kind: 'claimed' });
    store1.storeResponse(key, response, fingerprint);
    expect(store1.claimOrGet(key, fingerprint)).toEqual({ kind: 'fulfilled', response });
    store1.shutdown();

    const store2 = new IdempotencyStore(resultsDir, 24);
    expect(store2.claimOrGet(key, fingerprint)).toEqual({ kind: 'fulfilled', response });
    store2.shutdown();
  });

  test('supports older log lines without responsePayload fields', () => {
    const persistencePath = path.join(resultsDir, '.kaseki-api-idempotency.jsonl');
    const legacyLine = {
      idempotencyKey: 'legacy-key',
      requestFingerprint: 'legacy-fp',
      state: 'fulfilled',
      jobId: 'kaseki-legacy',
      requestTime: '2026-01-02T00:00:00.000Z',
      requestId: '33333333-3333-4333-8333-333333333333',
      correlationId: '44444444-4444-4444-8444-444444444444',
      expiresAt: Date.now() + 24 * 3600 * 1000,
    };

    fs.writeFileSync(persistencePath, `${JSON.stringify(legacyLine)}\n`, 'utf-8');

    const store = new IdempotencyStore(resultsDir, 24);
    expect(store.claimOrGet('legacy-key', 'legacy-fp')).toEqual({
      kind: 'fulfilled',
      response: {
        id: 'kaseki-legacy',
        status: 'queued',
        createdAt: '2026-01-02T00:00:00.000Z',
        requestId: '33333333-3333-4333-8333-333333333333',
        correlationId: '44444444-4444-4444-8444-444444444444',
      },
    });
    store.shutdown();
  });
});
