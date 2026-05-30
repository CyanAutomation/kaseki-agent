import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { IdempotencyStore } from './idempotency-store';
import { RunResponse } from './kaseki-api-types';

describe('IdempotencyStore persistence', () => {
  let resultsDir: string;

  beforeEach(async () => {
    resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-idempotency-'));
  });

  afterEach(async () => {
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  test('restores exact fulfilled response payload across restart', async () => {
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
    expect(await store1.claimOrGet(key, fingerprint)).toEqual({
      kind: 'claimed',
    });
    await store1.storeResponse(key, response, fingerprint);
    expect(await store1.claimOrGet(key, fingerprint)).toEqual({
      kind: 'fulfilled',
      response,
    });
    store1.shutdown();

    const store2 = new IdempotencyStore(resultsDir, 24);
    expect(await store2.claimOrGet(key, fingerprint)).toEqual({
      kind: 'fulfilled',
      response,
    });
    store2.shutdown();
  });

  test('supports older log lines without responsePayload fields', async () => {
    const persistencePath = path.join(
      resultsDir,
      '.kaseki-api-idempotency.jsonl',
    );
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

    fs.writeFileSync(
      persistencePath,
      `${JSON.stringify(legacyLine)}\n`,
      'utf-8',
    );

    const store = new IdempotencyStore(resultsDir, 24);
    expect(await store.claimOrGet('legacy-key', 'legacy-fp')).toEqual({
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

  test('only one parallel claimer gets claimed for the same key', async () => {
    const workerPath = path.join(resultsDir, 'claim-worker.ts');
    fs.writeFileSync(
      workerPath,
      `
      import { IdempotencyStore } from '${path.resolve('src/idempotency-store.ts').replace(/\\/g, '\\\\')}';
      void (async () => {
        const [resultsDir, key, fingerprint] = process.argv.slice(2);
        const store = new IdempotencyStore(resultsDir, 24);
        const result = await store.claimOrGet(key, fingerprint);
        store.shutdown();
        process.stdout.write(JSON.stringify(result));
      })().catch((error) => {
        console.error(error);
        process.exit(1);
      });
    `,
      'utf-8',
    );

    const claimFromProcess = (): Promise<{ kind: string }> =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [
          '--import',
          'tsx',
          workerPath,
          resultsDir,
          'concurrent-key',
          'same-fp',
        ]);
        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`worker exited with code ${code}: ${stderr}`));
            return;
          }
          const lines = stdout
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.startsWith('{') && line.endsWith('}'));
          resolve(JSON.parse(lines[lines.length - 1]) as { kind: string });
        });
      });

    const [result1, result2] = await Promise.all([
      claimFromProcess(),
      claimFromProcess(),
    ]);
    const kinds = [result1.kind, result2.kind].sort();

    expect(kinds).toEqual(['claimed', 'pending']);
  }, 15000);

  test('enforces exclusive critical section during long-held lock contention', async () => {
    const workerPath = path.join(resultsDir, 'lock-worker.ts');
    const markerPath = path.join(resultsDir, 'critical-section-marker.txt');
    const overlapPath = path.join(resultsDir, 'critical-overlap.log');

    fs.writeFileSync(markerPath, '0', 'utf-8');
    fs.writeFileSync(overlapPath, '', 'utf-8');

    fs.writeFileSync(
      workerPath,
      `
      import * as fs from 'fs';
      import { IdempotencyStore } from '${path.resolve('src/idempotency-store.ts').replace(/\\/g, '\\\\')}';

      void (async () => {
        const [resultsDir, markerPath, overlapPath] = process.argv.slice(2);
        const store = new IdempotencyStore(resultsDir, 24);

        await (store as any).withLock(() => {
        const active = Number(fs.readFileSync(markerPath, 'utf-8'));
        if (active > 0) {
          fs.appendFileSync(overlapPath, 'overlap\\n', 'utf-8');
        }

        fs.writeFileSync(markerPath, String(active + 1), 'utf-8');
        const start = Date.now();
        while (Date.now() - start < 250) {
          // Hold lock
        }
        const after = Number(fs.readFileSync(markerPath, 'utf-8'));
        fs.writeFileSync(markerPath, String(after - 1), 'utf-8');
        });

        store.shutdown();
        process.stdout.write('done');
      })().catch((error) => {
        console.error(error);
        process.exit(1);
      });
    `,
      'utf-8',
    );

    const runWorker = (): Promise<void> =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [
          '--import',
          'tsx',
          workerPath,
          resultsDir,
          markerPath,
          overlapPath,
        ]);
        let stderr = '';
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`worker exited with code ${code}: ${stderr}`));
            return;
          }
          resolve();
        });
      });

    await Promise.all([runWorker(), runWorker(), runWorker()]);
    const overlaps = fs
      .readFileSync(overlapPath, 'utf-8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    expect(overlaps).toEqual([]);
  }, 20000);

  test('keeps the event loop responsive while waiting for the idempotency lock', async () => {
    const lockPath = path.join(resultsDir, '.kaseki-api-idempotency.lock');
    fs.mkdirSync(lockPath, { recursive: true });
    fs.writeFileSync(
      path.join(lockPath, 'owner.json'),
      JSON.stringify({ pid: process.pid, token: 'test-holder' }),
      'utf-8',
    );

    const store = new IdempotencyStore(resultsDir, 24);
    let ticks = 0;
    const interval = setInterval(() => {
      ticks += 1;
    }, 5);
    const releaseLock = setTimeout(() => {
      fs.rmSync(lockPath, { recursive: true, force: true });
    }, 75);

    try {
      await expect(
        store.claimOrGet('responsive-key', 'responsive-fp'),
      ).resolves.toEqual({ kind: 'claimed' });
      expect(ticks).toBeGreaterThanOrEqual(5);
    } finally {
      clearInterval(interval);
      clearTimeout(releaseLock);
      store.shutdown();
    }
  });
});
