import * as path from 'path';
import type { Server } from 'http';
import type { ShutdownDeps } from './kaseki-api/service-bootstrapper';

type IsAssignable<Actual, Expected> = Actual extends Expected ? true : false;
const shutdownDepsTypeCheck: IsAssignable<
  ShutdownDeps,
  {
    server: Server;
    scheduler: { shutdown: () => void };
    webhookManager: { shutdown: () => Promise<void> };
    idempotencyStore: { shutdown: () => void };
    forceExitAfterMs?: number;
    exit?: (code: number) => never;
  }
> = true;
void shutdownDepsTypeCheck;

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
      const ensureTemplate = jest.fn(async () => undefined);

      const context = await setupOrch.initializeSetup('/tmp/template-dir', {
        assertNodeVersion,
        ensureTemplate,
      });

      expect(context).toEqual({
        nodeVersionValid: true,
        templateInitialized: true,
        templateDir: '/tmp/template-dir',
      });
      expect(assertNodeVersion).toHaveBeenCalledTimes(1);
      expect(ensureTemplate).toHaveBeenCalledTimes(1);
      expect(ensureTemplate).toHaveBeenCalledWith('/tmp/template-dir');
      expect('bootstrapServices' in setupOrch).toBe(false);
      expect('gracefulShutdown' in setupOrch).toBe(false);
    });

    it('service bootstrapper constructs dependencies', async () => {
      const os = await import('os');
      const fs = await import('fs');
      const { bootstrapServices } = await import('./kaseki-api/service-bootstrapper');

      const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-bootstrapper-'));

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

        expect(typeof services.artifactCache.getOrLoad).toBe('function');
        expect(typeof services.webhookManager.shutdown).toBe('function');
        expect(typeof services.idempotencyStore.shutdown).toBe('function');
        expect(typeof services.preFlightValidator.validate).toBe('function');
        expect(typeof services.scheduler.shutdown).toBe('function');
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

      expect(typeof apiService.assertSupportedNodeVersion).toBe('function');
      expect(typeof apiService.ensureTemplateInitialized).toBe('function');
      expect(typeof apiService.createGracefulShutdown).toBe('function');
      expect(typeof apiService.ensureResultsDir).toBe('function');
      expect('initializeSetup' in apiService).toBe(false);
      expect('bootstrapServices' in apiService).toBe(false);
      expect('gracefulShutdown' in apiService).toBe(false);
    });

    it('barrel file exposes stable contracts and callable exports', async () => {
      const os = await import('os');
      const fs = await import('fs');
      const barrel = await import('./kaseki-api');

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
      } finally {
        services.scheduler.shutdown();
        await services.webhookManager.shutdown();
        services.idempotencyStore.shutdown();
        fs.rmSync(resultsDir, { recursive: true, force: true });
      }

      const shutdownOrder: string[] = [];
      const exitCodes: number[] = [];
      await expect(
        barrel.gracefulShutdown({
          server: {
            close: (callback: (err?: Error) => void) => {
              shutdownOrder.push('server.close');
              callback();
              return undefined as never;
            },
          } as unknown as Server,
          scheduler: {
            shutdown: () => shutdownOrder.push('scheduler.shutdown'),
          },
          webhookManager: {
            shutdown: async () => {
              shutdownOrder.push('webhookManager.shutdown');
            },
          },
          idempotencyStore: {
            shutdown: () => shutdownOrder.push('idempotencyStore.shutdown'),
          },
          forceExitAfterMs: 100,
          exit: ((code: number) => {
            exitCodes.push(code);
            return undefined as never;
          }) as (code: number) => never,
        }),
      ).resolves.toBeUndefined();

      expect(exitCodes).toEqual([0]);
      expect(shutdownOrder).toEqual([
        'server.close',
        'scheduler.shutdown',
        'webhookManager.shutdown',
        'idempotencyStore.shutdown',
      ]);
    });
  });

  describe('Graceful shutdown behavior', () => {
    it('should exit 0 on success in the expected shutdown order', async () => {
      const { gracefulShutdown } = await import('./kaseki-api/service-bootstrapper');

      const successCallOrder: string[] = [];
      const successExitCodes: number[] = [];
      const successDeps: ShutdownDeps = {
        server: {
          close: (callback: (err?: Error) => void) => {
            successCallOrder.push('server.close');
            callback();
            return undefined as never;
          },
        } as unknown as Server,
        scheduler: {
          shutdown: () => successCallOrder.push('scheduler.shutdown'),
        },
        webhookManager: {
          shutdown: async () => {
            successCallOrder.push('webhookManager.shutdown');
          },
        },
        idempotencyStore: {
          shutdown: () => successCallOrder.push('idempotencyStore.shutdown'),
        },
        forceExitAfterMs: 100,
        exit: ((code: number) => {
          successExitCodes.push(code);
          return undefined as never;
        }) as (code: number) => never,
      };

      await expect(gracefulShutdown(successDeps)).resolves.toBeUndefined();
      expect(successExitCodes).toEqual([0]);
      expect(successCallOrder).toEqual([
        'server.close',
        'scheduler.shutdown',
        'webhookManager.shutdown',
        'idempotencyStore.shutdown',
      ]);
    });

    it('should exit 1 and stop before idempotency shutdown when webhook shutdown fails', async () => {
      const { gracefulShutdown } = await import('./kaseki-api/service-bootstrapper');

      const errorCallOrder: string[] = [];
      const errorExitCodes: number[] = [];
      const errorDeps: ShutdownDeps = {
        server: {
          close: (callback: (err?: Error) => void) => {
            errorCallOrder.push('server.close');
            callback();
            return undefined as never;
          },
        } as unknown as Server,
        scheduler: {
          shutdown: () => errorCallOrder.push('scheduler.shutdown'),
        },
        webhookManager: {
          shutdown: async () => {
            errorCallOrder.push('webhookManager.shutdown');
            throw new Error('webhook failure');
          },
        },
        idempotencyStore: {
          shutdown: () => errorCallOrder.push('idempotencyStore.shutdown'),
        },
        forceExitAfterMs: 100,
        exit: ((code: number) => {
          errorExitCodes.push(code);
          return undefined as never;
        }) as (code: number) => never,
      };

      await expect(gracefulShutdown(errorDeps)).resolves.toBeUndefined();
      expect(errorExitCodes).toEqual([1]);
      expect(errorCallOrder).toEqual([
        'server.close',
        'scheduler.shutdown',
        'webhookManager.shutdown',
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
