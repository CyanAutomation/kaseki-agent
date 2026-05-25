import * as path from 'path';
import type { Server } from 'http';
import type { ShutdownDeps } from './kaseki-api/service-bootstrapper';

type IsAssignable<Actual, Expected> = Actual extends Expected ? true : false;
type Assert<T extends true> = T;
const shutdownDepsContract: Assert<
  IsAssignable<
    ShutdownDeps,
    {
      server: Server;
      scheduler: { shutdown: () => void };
      webhookManager: { shutdown: () => Promise<void> };
      idempotencyStore: { shutdown: () => void };
      forceExitAfterMs?: number;
      exit?: (code: number) => never;
    }
  >
> = true;
void shutdownDepsContract;

describe('KasekiApiService Integration', () => {
  describe('Service Integration', () => {
    it('should bootstrap services with callable contracts and cache behavior', async () => {
      const os = await import('os');
      const fs = await import('fs');
      const { bootstrapServices } = await import('./kaseki-api/service-bootstrapper');

      const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-integration-'));
      const artifactPath = path.join(resultsDir, 'artifact.log');
      fs.writeFileSync(artifactPath, 'payload-1', 'utf-8');

      let services;
      try {
        services = await bootstrapServices({
          port: 3000,
          host: 'localhost',
          resultsDir,
          logLevel: 'info',
          apiKeys: [],
          maxConcurrentRuns: 2,
          maxDiffBytes: 200000,
          agentTimeoutSeconds: 600,
          artifactCacheMaxEntries: 5,
          artifactCacheTtlMs: 60000,
          artifactCacheMaxFileBytes: 1024 * 1024,
          defaultTaskMode: 'patch',
        });

        expect(typeof services.scheduler.shutdown).toBe('function');
        expect(typeof services.webhookManager.shutdown).toBe('function');
        expect(typeof services.idempotencyStore.shutdown).toBe('function');
        expect(typeof services.preFlightValidator.validate).toBe('function');

        const first = services.artifactCache.getOrLoad(artifactPath);
        const second = services.artifactCache.getOrLoad(artifactPath);
        const stats = services.artifactCache.getStats();

        expect(first).toBe('payload-1');
        expect(second).toBe('payload-1');
        expect(stats.misses).toBe(1);
        expect(stats.hits).toBe(1);
      } finally {
        if (services) {
          services.scheduler.shutdown();
          await services.webhookManager.shutdown();
          services.idempotencyStore.shutdown();
        }
        fs.rmSync(resultsDir, { recursive: true, force: true });
      }
    });



    it('should return null and increment cache misses for missing artifacts', async () => {
      const os = await import('os');
      const fs = await import('fs');
      const { bootstrapServices } = await import('./kaseki-api/service-bootstrapper');

      const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-missing-artifact-'));
      const missingArtifactPath = path.join(resultsDir, 'missing-artifact.log');

      let services;
      try {
        services = await bootstrapServices({
          port: 3000,
          host: 'localhost',
          resultsDir,
          logLevel: 'info',
          apiKeys: [],
          maxConcurrentRuns: 2,
          maxDiffBytes: 200000,
          agentTimeoutSeconds: 600,
          artifactCacheMaxEntries: 5,
          artifactCacheTtlMs: 60000,
          artifactCacheMaxFileBytes: 1024 * 1024,
          defaultTaskMode: 'patch',
        });

        const firstLoad = services.artifactCache.getOrLoad(missingArtifactPath);
        const secondLoad = services.artifactCache.getOrLoad(missingArtifactPath);
        const stats = services.artifactCache.getStats();

        expect(firstLoad).toBeNull();
        expect(secondLoad).toBeNull();
        expect(stats.hits).toBe(0);
        expect(stats.misses).toBe(2);
        expect(stats.entries).toBe(0);
      } finally {
        if (services) {
          services.scheduler.shutdown();
          await services.webhookManager.shutdown();
          services.idempotencyStore.shutdown();
        }
        fs.rmSync(resultsDir, { recursive: true, force: true });
      }
    });

    // Circular dependency prevention must be enforced by a dedicated static CI tool
    // (dependency graph analyzer or lint rule), not runtime import tests.
    // Runtime import checks are insufficient cycle detectors because successful imports
    // can still occur in partially initialized cyclic module graphs.
  });

  describe('Module organization', () => {
    it('setup orchestrator handles setup responsibilities only', async () => {
      const setupOrch = await import('./kaseki-api/setup-orchestrator');
      const assertNodeVersion = jest.fn();
      const ensureTemplate = jest.fn<Promise<void>, [string]>(async () => undefined);
      const callOrder: string[] = [];

      assertNodeVersion.mockImplementation(() => callOrder.push('assertNodeVersion'));
      ensureTemplate.mockImplementation(async (templateDir: string) => {
        callOrder.push(`ensureTemplate:${templateDir}`);
      });

      const context = await setupOrch.initializeSetup('/tmp/template-dir', {
        assertNodeVersion,
        ensureTemplate,
      });

      expect(context).toEqual({
        nodeVersionValid: true,
        templateInitialized: true,
        templateDir: '/tmp/template-dir',
      });
      expect(callOrder).toEqual(['assertNodeVersion', 'ensureTemplate:/tmp/template-dir']);
    });

    it('service bootstrapper constructs dependencies', async () => {
      const os = await import('os');
      const fs = await import('fs');
      const { bootstrapServices } = await import('./kaseki-api/service-bootstrapper');

      const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-bootstrapper-'));
      const artifactPath = path.join(resultsDir, 'bootstrap-artifact.log');
      fs.writeFileSync(artifactPath, 'bootstrap-payload', 'utf-8');

      let services;
      try {
        services = await bootstrapServices({
          port: 3000,
          host: 'localhost',
          resultsDir,
          logLevel: 'info',
          apiKeys: [],
          maxConcurrentRuns: 2,
          maxDiffBytes: 200000,
          agentTimeoutSeconds: 600,
          artifactCacheMaxEntries: 5,
          artifactCacheTtlMs: 60000,
          artifactCacheMaxFileBytes: 1024 * 1024,
          defaultTaskMode: 'patch',
        });

        expect(services.artifactCache.getOrLoad(artifactPath)).toBe('bootstrap-payload');
        expect(services.artifactCache.getStats()).toEqual(
          expect.objectContaining({
            entries: 1,
            hits: 0,
            misses: 1,
          }),
        );
        expect(fs.existsSync(path.join(resultsDir, 'webhook-queue.ndjson'))).toBe(false);
        expect(fs.existsSync(path.join(resultsDir, 'idempotency-store.json'))).toBe(false);
      } finally {
        if (services) {
          services.scheduler.shutdown();
          await services.webhookManager.shutdown();
          services.idempotencyStore.shutdown();
        }
        fs.rmSync(resultsDir, { recursive: true, force: true });
      }
    });

    it('top-level service composes orchestrator and bootstrapper without leaking internals', async () => {
      const apiService = await import('./kaseki-api-service');
      const exitCodes: number[] = [];
      const shutdownOrder: string[] = [];
      const shutdown = apiService.createGracefulShutdown({
        server: {
          close: (callback: (err?: Error) => void) => {
            shutdownOrder.push('server.close');
            callback();
            return undefined as never;
          },
        } as unknown as Server,
        scheduler: { shutdown: () => shutdownOrder.push('scheduler.shutdown') },
        webhookManager: {
          shutdown: async () => {
            shutdownOrder.push('webhookManager.shutdown');
          },
        },
        idempotencyStore: { shutdown: () => shutdownOrder.push('idempotencyStore.shutdown') },
        forceExitAfterMs: 100,
        exit: ((code: number) => {
          exitCodes.push(code);
          return undefined as never;
        }) as (code: number) => never,
      });

      await expect(shutdown()).resolves.toBeUndefined();
      expect(exitCodes).toEqual([0]);
      expect(shutdownOrder).toEqual([
        'server.close',
        'scheduler.shutdown',
        'webhookManager.shutdown',
        'idempotencyStore.shutdown',
      ]);

      expect('initializeSetup' in apiService).toBe(false);
      expect('bootstrapServices' in apiService).toBe(false);
      expect('gracefulShutdown' in apiService).toBe(false);
    });

    // Type export checks belong in compile-time type tests, not runtime Jest assertions.
    it('barrel file exposes stable callable exports and runtime contracts', async () => {
      const os = await import('os');
      const fs = await import('fs');
      const barrel = await import('./kaseki-api');

      expect(Object.keys(barrel).sort()).toEqual([
        'bootstrapServices',
        'gracefulShutdown',
        'initializeSetup',
      ]);
      expect(barrel).toEqual(
        expect.objectContaining({
          initializeSetup: expect.any(Function),
          bootstrapServices: expect.any(Function),
          gracefulShutdown: expect.any(Function),
        }),
      );

      const assertNodeVersion = jest.fn();
      const ensureTemplate = jest.fn(async () => undefined);
      await expect(
        barrel.initializeSetup('/tmp/barrel-template-dir', {
          assertNodeVersion,
          ensureTemplate,
        }),
      ).resolves.toEqual({
        nodeVersionValid: true,
        templateInitialized: true,
        templateDir: '/tmp/barrel-template-dir',
      });

      const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-barrel-'));
      const services = await barrel.bootstrapServices({
        port: 3000,
        host: 'localhost',
        resultsDir,
        logLevel: 'info',
        apiKeys: [],
        maxConcurrentRuns: 2,
        maxDiffBytes: 200000,
        agentTimeoutSeconds: 600,
        artifactCacheMaxEntries: 5,
        artifactCacheTtlMs: 60000,
        artifactCacheMaxFileBytes: 1024 * 1024,
        defaultTaskMode: 'patch',
      });

      try {
        expect(typeof services.scheduler.shutdown).toBe('function');
        expect(typeof services.webhookManager.shutdown).toBe('function');
        expect(typeof services.idempotencyStore.shutdown).toBe('function');
        expect(services.artifactCache.getOrLoad(path.join(resultsDir, 'missing.log'))).toBeNull();
      } finally {
        services.scheduler.shutdown();
        await services.webhookManager.shutdown();
        services.idempotencyStore.shutdown();
        fs.rmSync(resultsDir, { recursive: true, force: true });
      }

      const exitCodes: number[] = [];
      await expect(
        barrel.gracefulShutdown({
          server: {
            close: (callback: (err?: Error) => void) => {
              callback();
              return undefined as never;
            },
          } as unknown as Server,
          scheduler: { shutdown: () => undefined },
          webhookManager: { shutdown: async () => undefined },
          idempotencyStore: { shutdown: () => undefined },
          forceExitAfterMs: 100,
          exit: ((code: number) => {
            exitCodes.push(code);
            return undefined as never;
          }) as (code: number) => never,
        }),
      ).resolves.toBeUndefined();

      await expect(
        barrel.gracefulShutdown({
          server: {
            close: (callback: (err?: Error) => void) => {
              callback(new Error('barrel server close error'));
              return undefined as never;
            },
          } as unknown as Server,
          scheduler: { shutdown: () => undefined },
          webhookManager: { shutdown: async () => undefined },
          idempotencyStore: { shutdown: () => undefined },
          forceExitAfterMs: 100,
          exit: ((code: number) => {
            exitCodes.push(code);
            return undefined as never;
          }) as (code: number) => never,
        }),
      ).resolves.toBeUndefined();

      expect(exitCodes).toEqual([0, 1]);
    });
  });

  describe('Graceful shutdown behavior', () => {
    it('should enforce explicit shutdown outcomes for success and error paths', async () => {
      const { gracefulShutdown } = await import('./kaseki-api/service-bootstrapper');

      const callOrder: string[] = [];
      const exitCodes: number[] = [];

      const successDeps: ShutdownDeps = {
        server: {
          close: (callback: (err?: Error) => void) => {
            callOrder.push('success.server.close');
            callback();
            return undefined as never;
          },
        } as unknown as Server,
        scheduler: {
          shutdown: () => callOrder.push('success.scheduler.shutdown'),
        },
        webhookManager: {
          shutdown: async () => {
            callOrder.push('success.webhookManager.shutdown');
          },
        },
        idempotencyStore: {
          shutdown: () => callOrder.push('success.idempotencyStore.shutdown'),
        },
        forceExitAfterMs: 100,
        exit: ((code: number) => {
          exitCodes.push(code);
          return undefined as never;
        }) as (code: number) => never,
      };

      await expect(gracefulShutdown(successDeps)).resolves.toBeUndefined();
      expect(exitCodes).toEqual([0]);
      expect(callOrder).toEqual([
        'success.server.close',
        'success.scheduler.shutdown',
        'success.webhookManager.shutdown',
        'success.idempotencyStore.shutdown',
      ]);
      const errorDeps: ShutdownDeps = {
        server: {
          close: (callback: (err?: Error) => void) => {
            callOrder.push('error.server.close');
            callback();
            return undefined as never;
          },
        } as unknown as Server,
        scheduler: {
          shutdown: () => callOrder.push('error.scheduler.shutdown'),
        },
        webhookManager: {
          shutdown: async () => {
            callOrder.push('error.webhookManager.shutdown');
            throw new Error('webhook failure');
          },
        },
        idempotencyStore: {
          shutdown: () => callOrder.push('error.idempotencyStore.shutdown'),
        },
        forceExitAfterMs: 100,
        exit: ((code: number) => {
          exitCodes.push(code);
          return undefined as never;
        }) as (code: number) => never,
      };

      await expect(gracefulShutdown(errorDeps)).resolves.toBeUndefined();
      expect(exitCodes).toEqual([0, 1]);
      expect(callOrder).toEqual([
        'success.server.close',
        'success.scheduler.shutdown',
        'success.webhookManager.shutdown',
        'success.idempotencyStore.shutdown',
        'error.server.close',
        'error.scheduler.shutdown',
        'error.webhookManager.shutdown',
      ]);
    });

    it('should exit 1 when server.close callback receives an error', async () => {
      const { gracefulShutdown } = await import('./kaseki-api/service-bootstrapper');

      const serverErrorCallOrder: string[] = [];
      const serverErrorExitCodes: number[] = [];
      const serverErrorDeps: ShutdownDeps = {
        server: {
          close: (callback: (err?: Error) => void) => {
            serverErrorCallOrder.push('server.close');
            callback(new Error('server error'));
            return undefined as never;
          },
        } as unknown as Server,
        scheduler: {
          shutdown: () => serverErrorCallOrder.push('scheduler.shutdown'),
        },
        webhookManager: {
          shutdown: async () => {
            serverErrorCallOrder.push('webhookManager.shutdown');
          },
        },
        idempotencyStore: {
          shutdown: () => serverErrorCallOrder.push('idempotencyStore.shutdown'),
        },
        forceExitAfterMs: 100,
        exit: ((code: number) => {
          serverErrorExitCodes.push(code);
          return undefined as never;
        }) as (code: number) => never,
      };

      await expect(gracefulShutdown(serverErrorDeps)).resolves.toBeUndefined();
      expect(serverErrorExitCodes).toEqual([1]);
      expect(serverErrorCallOrder).toEqual(['server.close']);
    });
  });

  describe('Top-level service behavior', () => {
    it('createGracefulShutdown delegates to gracefulShutdown with provided dependencies', async () => {
      const apiService = await import('./kaseki-api-service');

      const callOrder: string[] = [];
      const exitCodes: number[] = [];
      const deps: ShutdownDeps = {
        server: {
          close: (callback: (err?: Error) => void) => {
            callOrder.push('server.close');
            callback();
            return undefined as never;
          },
        } as unknown as Server,
        scheduler: {
          shutdown: () => callOrder.push('scheduler.shutdown'),
        },
        webhookManager: {
          shutdown: async () => {
            callOrder.push('webhookManager.shutdown');
          },
        },
        idempotencyStore: {
          shutdown: () => callOrder.push('idempotencyStore.shutdown'),
        },
        forceExitAfterMs: 100,
        exit: ((code: number) => {
          exitCodes.push(code);
          return undefined as never;
        }) as (code: number) => never,
      };

      const shutdown = apiService.createGracefulShutdown(deps);
      await expect(shutdown()).resolves.toBeUndefined();
      expect(exitCodes).toEqual([0]);
      expect(callOrder).toEqual([
        'server.close',
        'scheduler.shutdown',
        'webhookManager.shutdown',
        'idempotencyStore.shutdown',
      ]);
    });

    it('ensureResultsDir creates missing directories and enforces writable/readable access', async () => {
      const os = await import('os');
      const fs = await import('fs');
      const apiService = await import('./kaseki-api-service');

      const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-results-dir-'));
      const resultsDir = path.join(rootDir, 'nested', 'results');

      try {
        expect(fs.existsSync(resultsDir)).toBe(false);
        apiService.ensureResultsDir(resultsDir);
        expect(fs.existsSync(resultsDir)).toBe(true);

        fs.accessSync(resultsDir, fs.constants.R_OK | fs.constants.W_OK);
      } finally {
        fs.rmSync(rootDir, { recursive: true, force: true });
      }
    });
  });
});
