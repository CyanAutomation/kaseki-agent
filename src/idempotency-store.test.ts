import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import {
  createProcessLivenessChecker,
  IdempotencyStore,
  withIdempotencyStoreLock,
} from './idempotency-store';
import { RunResponse } from './kaseki-api-types';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

/**
 * IdempotencyStore Tests
 *
 * Organized into 4 suites:
 * 1. Idempotency — Ensures responses are restored exactly across restarts
 * 2. Backward Compatibility — Handles legacy log formats
 * 3. Lock Management — Safe concurrent access via file-based locks
 * 4. Concurrent Claiming — Only one claimant succeeds for the same key
 */
describe('IdempotencyStore', () => {
  let resultsDir: string;

  beforeEach(async () => {
    resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-idempotency-'));
  });

  afterEach(async () => {
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  // ============================================================================
  // SUITE 1: Idempotency
  // ============================================================================
  // Spec: Idempotency Store ensures duplicate requests return identical responses
  // This is critical for API correctness: retries must not create duplicate side effects
  test('should restore exact fulfilled response payload across restart', async () => {
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

  test('reclaims a pending empty-job entry after process restart', async () => {
    let now = Date.parse('2026-07-21T00:00:00.000Z');
    const store1 = new IdempotencyStore(resultsDir, 24, { now: () => now });
    await expect(store1.claimOrGet('orphaned-key', 'same-fp')).resolves.toEqual({
      kind: 'claimed',
    });
    store1.shutdown();

    now += 30_001;
    const store2 = new IdempotencyStore(resultsDir, 24, { now: () => now });
    await expect(store2.claimOrGet('orphaned-key', 'same-fp')).resolves.toEqual({
      kind: 'claimed',
    });
    store2.shutdown();
  });

  test('persists release of a pending claim as a removal record', async () => {
    const store1 = new IdempotencyStore(resultsDir, 24);
    await store1.claimOrGet('failed-key', 'same-fp');
    await store1.releasePendingClaim('failed-key', 'same-fp');
    store1.shutdown();

    const log = fs.readFileSync(
      path.join(resultsDir, '.kaseki-api-idempotency.jsonl'),
      'utf-8',
    );
    expect(log).toContain('"operation":"remove"');

    const store2 = new IdempotencyStore(resultsDir, 24);
    await expect(store2.claimOrGet('failed-key', 'same-fp')).resolves.toEqual({
      kind: 'claimed',
    });
    store2.shutdown();
  });

  // ============================================================================
  // SUITE 2: Backward Compatibility
  // ============================================================================
  // Spec: Store must handle log entries created by older versions
  // Regression: GH#3456 — Gracefully migrate legacy responsePayload format
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

  // ============================================================================
  // SUITE 3: Lock Management
  // ============================================================================
  // Spec: Locks ensure only one claimant can claim a key
  // Expected behavior: Write owner metadata, prevent concurrent claims
  test('writes pid timestamp and token owner metadata while a lock is held', async () => {
    const lockPath = path.join(resultsDir, '.kaseki-api-idempotency.lock');
    const ownerPath = path.join(lockPath, 'owner.json');
    const now = Date.parse('2026-01-03T00:00:00.000Z');
    const store = new IdempotencyStore(resultsDir, 24, {
      now: () => now,
      lockTokenGenerator: () => 'owner-token',
    });

    await withIdempotencyStoreLock(store, () => {
      expect(fs.existsSync(ownerPath)).toBe(true);
      const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf-8')) as {
        pid?: number;
        createdAt?: string;
        token?: string;
      };

      expect(owner.pid).toBe(process.pid);
      expect(owner.createdAt).toBe('2026-01-03T00:00:00.000Z');
      expect(typeof owner.token).toBe('string');
      expect(owner.token).toBe(`${process.pid}-${now}-owner-token`);
    });

    expect(fs.existsSync(lockPath)).toBe(false);
    store.shutdown();
  });

  // Regression: GH#2345 — Do not release lock if ownership changed
  // This prevents race condition where another process claims lock
  test('does not release a lock when the owner token was replaced', async () => {
    const lockPath = path.join(resultsDir, '.kaseki-api-idempotency.lock');
    const ownerPath = path.join(lockPath, 'owner.json');
    const store = new IdempotencyStore(resultsDir, 24, {
      lockTokenGenerator: () => 'owner-token',
    });

    await withIdempotencyStoreLock(store, () => {
      fs.writeFileSync(
        ownerPath,
        JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString(),
          token: 'replacement-owner-token',
        }),
        'utf-8',
      );
    });

    expect(fs.existsSync(lockPath)).toBe(true);
    const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf-8')) as {
      token?: string;
    };
    expect(owner.token).toBe('replacement-owner-token');

    fs.rmSync(lockPath, { recursive: true, force: true });
    store.shutdown();
  });

  // Spec: Stale lock removal respects age and liveness checks
  test('removes stale locks only after owner age and liveness checks pass', async () => {
    const lockPath = path.join(resultsDir, '.kaseki-api-idempotency.lock');
    const ownerPath = path.join(lockPath, 'owner.json');
    fs.mkdirSync(lockPath, { mode: 0o700 });
    fs.writeFileSync(
      ownerPath,
      JSON.stringify({
        pid: 2147483647,
        createdAt: new Date(Date.now() - 60_000).toISOString(),
        token: 'stale-owner-token',
      }),
      'utf-8',
    );

    const store = new IdempotencyStore(resultsDir, 24, {
      processLivenessChecker: () => false,
    });
    await expect(store.claimOrGet('stale-key', 'stale-fp')).resolves.toEqual({
      kind: 'claimed',
    });

    expect(fs.existsSync(lockPath)).toBe(false);
    store.shutdown();
  });

  // Spec: Windows EPERM (permission denied) means process is dead
  test('treats EPERM process liveness checks as dead on Windows only', () => {
    const error = new Error('permission denied') as NodeJS.ErrnoException;
    error.code = 'EPERM';
    const kill = jest.fn(() => {
      throw error;
    }) as unknown as (pid: number, signal: 0) => unknown;

    expect(createProcessLivenessChecker(kill, 'linux')(12345)).toBe(true);
    expect(createProcessLivenessChecker(kill, 'win32')(12345)).toBe(false);
  });

  // ============================================================================
  // SUITE 4: Concurrent Claiming
  // ============================================================================
  // Spec: Exactly one claimant should succeed, others pending
  // Expected behavior: Race condition resolved deterministically
  test('only one parallel claimer gets claimed for the same key', async () => {
    const workerPath = path.join(resultsDir, 'claim-worker.ts');
    const lockPath = path.join(resultsDir, '.kaseki-api-idempotency.lock');
    const waiterPaths = [
      path.join(resultsDir, 'claim-worker-0-waiting'),
      path.join(resultsDir, 'claim-worker-1-waiting'),
    ];
    fs.mkdirSync(lockPath, { recursive: true });
    fs.writeFileSync(
      path.join(lockPath, 'owner.json'),
      JSON.stringify({
        pid: process.pid,
        token: 'test-lock-holder',
        createdAt: new Date().toISOString(),
      }),
      'utf-8',
    );
    fs.writeFileSync(
      workerPath,
      `
      import { IdempotencyStore } from '${path.resolve('src/idempotency-store.ts').replace(/\\/g, '\\\\')}';
      import * as fs from 'fs';
      void (async () => {
        const [resultsDir, key, fingerprint, resultPath, waiterPath] = process.argv.slice(2);
        const store = new IdempotencyStore(resultsDir, 24, {
          waitForLockRetry: async (delayMs) => {
            if (!fs.existsSync(waiterPath)) fs.writeFileSync(waiterPath, 'waiting', 'utf-8');
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          },
        });
        const result = await store.claimOrGet(key, fingerprint);
        store.shutdown();
        fs.writeFileSync(resultPath, JSON.stringify(result), 'utf-8');
      })().catch((error) => {
        console.error(error);
        process.exit(1);
      });
    `,
      'utf-8',
    );

    let claimWorkerIndex = 0;
    const claimFromProcess = (waiterPath: string): Promise<{ kind: string }> =>
      new Promise((resolve, reject) => {
        const resultPath = path.join(
          resultsDir,
          `concurrent-claim-result-${claimWorkerIndex++}.json`,
        );
        const child = spawn(process.execPath, [
          '--import',
          'tsx',
          workerPath,
          resultsDir,
          'concurrent-key',
          'same-fp',
          resultPath,
          waiterPath,
        ]);
        let stdout = '';
        let stderr = '';
        let settled = false;
        let timedOut = false;
        let forceKill: NodeJS.Timeout | undefined;

        const finish = (callback: () => void): void => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          if (forceKill) clearTimeout(forceKill);
          callback();
        };

        const timeout = setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          forceKill = setTimeout(() => child.kill('SIGKILL'), 1000);
        }, 10000);

        child.stdout.on('data', (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });
        child.on('error', (error) => {
          finish(() => reject(new Error(`worker failed to start: ${error.message}`)));
        });
        child.on('close', (code, signal) => {
          finish(() => {
            if (timedOut) {
              reject(
                new Error(
                  `worker timed out after 10000ms (stdout: ${stdout || '<empty>'}; stderr: ${stderr || '<empty>'})`,
                ),
              );
              return;
            }
            if (code !== 0) {
              reject(
                new Error(
                  `worker exited with code ${code ?? '<none>'}${signal ? ` (signal ${signal})` : ''}: ${stderr || '<empty stderr>'}`,
                ),
              );
              return;
            }

            if (!fs.existsSync(resultPath)) {
              reject(
                new Error(
                  `worker exited successfully without a result file (stdout: ${stdout || '<empty>'}; stderr: ${stderr || '<empty>'})`,
                ),
              );
              return;
            }

            try {
              resolve(
                JSON.parse(fs.readFileSync(resultPath, 'utf-8')) as { kind: string },
              );
            } catch (error) {
              reject(
                new Error(
                  `worker emitted an invalid result file: ${error instanceof Error ? error.message : String(error)} (stdout: ${stdout}; stderr: ${stderr})`,
                ),
              );
            } finally {
              fs.rmSync(resultPath, { force: true });
            }
          });
        });
      });

    const waitForBothClaimers = (): Promise<void> =>
      new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          watcher.close();
          if (error) reject(error);
          else resolve();
        };
        const checkReady = (): void => {
          if (waiterPaths.every((waiterPath) => fs.existsSync(waiterPath))) finish();
        };
        const watcher = fs.watch(resultsDir, checkReady);
        const timeout = setTimeout(
          () => finish(new Error('both idempotency claimers did not reach the held lock')),
          10000,
        );
        checkReady();
      });

    const workerResults = waiterPaths.map((waiterPath) => claimFromProcess(waiterPath));
    try {
      await waitForBothClaimers();
      fs.rmSync(lockPath, { recursive: true, force: true });

      const [result1, result2] = await Promise.all(workerResults);
      const kinds = [result1.kind, result2.kind].sort();
      expect(kinds).toEqual(['claimed', 'pending']);
    } finally {
      fs.rmSync(lockPath, { recursive: true, force: true });
      await Promise.allSettled(workerResults);
    }
  }, 15000);

  // Spec: Lock ensures exclusive critical sections during contention
  test('keeps a second operation outside the critical section until the first releases the lock', async () => {
    const firstEntered = deferred();
    const releaseFirst = deferred();
    const secondWaiting = deferred();
    const store = new IdempotencyStore(resultsDir, 24, {
      waitForLockRetry: async (delayMs) => {
        secondWaiting.resolve();
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      },
    });
    let firstIsActive = false;
    let secondEnteredWhileFirstActive = false;
    let secondEntered = false;
    let secondPromise: Promise<void> | undefined;

    const first = withIdempotencyStoreLock(store, async () => {
      firstIsActive = true;
      firstEntered.resolve();
      await releaseFirst.promise;
      firstIsActive = false;
    });

    try {
      await firstEntered.promise;
      secondPromise = withIdempotencyStoreLock(store, () => {
        secondEnteredWhileFirstActive = firstIsActive;
        secondEntered = true;
      });

      await secondWaiting.promise;
      expect(secondEntered).toBe(false);

      releaseFirst.resolve();
      await Promise.all([first, secondPromise]);

      expect(secondEnteredWhileFirstActive).toBe(false);
      expect(secondEntered).toBe(true);
    } finally {
      releaseFirst.resolve();
      await Promise.allSettled([first, ...(secondPromise ? [secondPromise] : [])]);
      store.shutdown();
    }
  });

  // Spec: Lock retry must yield so unrelated event-loop work can proceed.
  test('yields to other work while waiting for the idempotency lock', async () => {
    const lockPath = path.join(resultsDir, '.kaseki-api-idempotency.lock');
    fs.mkdirSync(lockPath, { recursive: true });
    fs.writeFileSync(
      path.join(lockPath, 'owner.json'),
      JSON.stringify({ pid: process.pid, token: 'test-holder' }),
      'utf-8',
    );

    const retryStarted = deferred();
    const releaseRetry = deferred();
    const store = new IdempotencyStore(resultsDir, 24, {
      waitForLockRetry: async () => {
        retryStarted.resolve();
        await releaseRetry.promise;
      },
    });

    try {
      const claimPromise = store.claimOrGet('responsive-key', 'responsive-fp');
      let claimSettledBeforeRelease = false;
      void claimPromise.then(
        () => {
          claimSettledBeforeRelease = true;
        },
        () => {
          claimSettledBeforeRelease = true;
        },
      );
      await retryStarted.promise;
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(claimSettledBeforeRelease).toBe(false);
      expect(fs.existsSync(lockPath)).toBe(true);

      fs.rmSync(lockPath, { recursive: true, force: true });
      releaseRetry.resolve();
      await expect(claimPromise).resolves.toEqual({ kind: 'claimed' });
    } finally {
      releaseRetry.resolve();
      store.shutdown();
    }
  });
});
